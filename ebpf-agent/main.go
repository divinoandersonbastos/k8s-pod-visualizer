// eBPF Network Flow Agent — k8s-pod-visualizer
// Captura fluxos TCP/UDP via eBPF (tcptracer/sock_ops) e expõe via HTTP REST
// Compatível com qualquer CNI (não requer Cilium) — usa kprobe/tracepoint padrão do kernel
//
// Dependências:
//   - github.com/cilium/ebpf (biblioteca eBPF pura em Go, sem CGO)
//   - k8s.io/client-go (para resolver IPs → pods/namespaces)
//
// Build: CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o ebpf-agent .
// Requer: kernel >= 4.18, CAP_BPF ou CAP_SYS_ADMIN

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/cilium/ebpf"
	"github.com/cilium/ebpf/link"
	"github.com/cilium/ebpf/rlimit"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

// ─── Estruturas de dados ──────────────────────────────────────────────────────

// FlowKey identifica um fluxo de rede (5-tupla)
type FlowKey struct {
	SrcIP    string `json:"srcIp"`
	DstIP    string `json:"dstIp"`
	SrcPort  uint16 `json:"srcPort"`
	DstPort  uint16 `json:"dstPort"`
	Protocol string `json:"protocol"` // "TCP" | "UDP"
}

// FlowMeta metadados Kubernetes resolvidos para um IP
type FlowMeta struct {
	PodName      string `json:"podName,omitempty"`
	Namespace    string `json:"namespace,omitempty"`
	ServiceName  string `json:"serviceName,omitempty"`
	DeployName   string `json:"deployName,omitempty"`
	NodeName     string `json:"nodeName,omitempty"`
	ExternalCIDR string `json:"externalCidr,omitempty"` // "internet" | "azure" | "aws" | "gcp"
}

// NetworkFlow representa um fluxo agregado
type NetworkFlow struct {
	FlowKey
	Src       FlowMeta  `json:"src"`
	Dst       FlowMeta  `json:"dst"`
	Bytes     uint64    `json:"bytes"`
	Packets   uint64    `json:"packets"`
	FirstSeen time.Time `json:"firstSeen"`
	LastSeen  time.Time `json:"lastSeen"`
	Verdict   string    `json:"verdict"` // "forwarded" | "dropped" | "redirected"
}

// ─── Mapa de fluxos em memória ────────────────────────────────────────────────

type FlowStore struct {
	mu    sync.RWMutex
	flows map[string]*NetworkFlow // key = "srcIP:srcPort->dstIP:dstPort/proto"
	maxAge time.Duration
}

func NewFlowStore() *FlowStore {
	fs := &FlowStore{
		flows:  make(map[string]*NetworkFlow),
		maxAge: 5 * time.Minute,
	}
	go fs.pruneLoop()
	return fs
}

func (fs *FlowStore) key(f FlowKey) string {
	return fmt.Sprintf("%s:%d->%s:%d/%s", f.SrcIP, f.SrcPort, f.DstIP, f.DstPort, f.Protocol)
}

func (fs *FlowStore) Upsert(flow *NetworkFlow) {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	k := fs.key(flow.FlowKey)
	if existing, ok := fs.flows[k]; ok {
		existing.Bytes += flow.Bytes
		existing.Packets += flow.Packets
		existing.LastSeen = flow.LastSeen
	} else {
		fs.flows[k] = flow
	}
}

func (fs *FlowStore) List(namespace string) []*NetworkFlow {
	fs.mu.RLock()
	defer fs.mu.RUnlock()
	result := make([]*NetworkFlow, 0, len(fs.flows))
	for _, f := range fs.flows {
		if namespace == "" || f.Src.Namespace == namespace || f.Dst.Namespace == namespace {
			result = append(result, f)
		}
	}
	return result
}

func (fs *FlowStore) pruneLoop() {
	ticker := time.NewTicker(60 * time.Second)
	for range ticker.C {
		fs.mu.Lock()
		cutoff := time.Now().Add(-fs.maxAge)
		for k, f := range fs.flows {
			if f.LastSeen.Before(cutoff) {
				delete(fs.flows, k)
			}
		}
		fs.mu.Unlock()
	}
}

// ─── Resolvedor de IPs → metadados Kubernetes ────────────────────────────────

type K8sResolver struct {
	client    *kubernetes.Clientset
	mu        sync.RWMutex
	ipToPod   map[string]*corev1.Pod
	svcCIDRs  []string
	lastSync  time.Time
}

func NewK8sResolver() (*K8sResolver, error) {
	cfg, err := rest.InClusterConfig()
	if err != nil {
		return nil, fmt.Errorf("não está rodando dentro do cluster: %w", err)
	}
	client, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		return nil, err
	}
	r := &K8sResolver{
		client:  client,
		ipToPod: make(map[string]*corev1.Pod),
	}
	if err := r.sync(); err != nil {
		log.Printf("[warn] sync inicial falhou: %v", err)
	}
	go r.syncLoop()
	return r, nil
}

func (r *K8sResolver) sync() error {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	pods, err := r.client.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return err
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	r.ipToPod = make(map[string]*corev1.Pod, len(pods.Items))
	for i := range pods.Items {
		pod := &pods.Items[i]
		if pod.Status.PodIP != "" {
			r.ipToPod[pod.Status.PodIP] = pod
		}
	}
	r.lastSync = time.Now()
	return nil
}

func (r *K8sResolver) syncLoop() {
	ticker := time.NewTicker(30 * time.Second)
	for range ticker.C {
		if err := r.sync(); err != nil {
			log.Printf("[warn] sync K8s falhou: %v", err)
		}
	}
}

func (r *K8sResolver) Resolve(ip string) FlowMeta {
	r.mu.RLock()
	pod, ok := r.ipToPod[ip]
	r.mu.RUnlock()

	if ok {
		meta := FlowMeta{
			PodName:   pod.Name,
			Namespace: pod.Namespace,
			NodeName:  pod.Spec.NodeName,
		}
		// Detectar deployment pelo ownerReference
		for _, ref := range pod.OwnerReferences {
			if ref.Kind == "ReplicaSet" {
				// Nome do deployment = nome do RS sem o sufixo hash
				if len(ref.Name) > 10 {
					meta.DeployName = ref.Name[:len(ref.Name)-10]
				}
			}
		}
		return meta
	}

	// IP não é um pod — classificar como externo
	return FlowMeta{
		ExternalCIDR: classifyExternalIP(ip),
	}
}

// classifyExternalIP detecta se o IP pertence a Azure, AWS, GCP ou Internet
func classifyExternalIP(ip string) string {
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return "unknown"
	}
	// RFC1918 — rede privada (node, service CIDR, etc.)
	privateRanges := []string{
		"10.0.0.0/8",
		"172.16.0.0/12",
		"192.168.0.0/16",
		"100.64.0.0/10", // CGNAT
	}
	for _, cidr := range privateRanges {
		_, network, _ := net.ParseCIDR(cidr)
		if network.Contains(parsed) {
			return "internal"
		}
	}
	// Azure datacenter ranges (simplificado — principais /8)
	azureRanges := []string{
		"13.64.0.0/11",
		"20.0.0.0/8",
		"40.64.0.0/10",
		"52.224.0.0/11",
		"104.208.0.0/13",
	}
	for _, cidr := range azureRanges {
		_, network, _ := net.ParseCIDR(cidr)
		if network.Contains(parsed) {
			return "azure"
		}
	}
	return "internet"
}

// ─── Programa eBPF (kprobe em tcp_connect / tcp_close) ───────────────────────
// O código BPF é embutido como bytes compilados (gerado via go generate + bpf2go)
// Para desenvolvimento, usamos um fallback de simulação quando o kernel não suporta

// bpfFlowEvent é o evento enviado pelo programa eBPF via perf buffer
type bpfFlowEvent struct {
	SrcIP   uint32
	DstIP   uint32
	SrcPort uint16
	DstPort uint16
	Proto   uint8
	Bytes   uint32
	Packets uint32
	Verdict uint8 // 0=forwarded, 1=dropped
}

func uint32ToIP(n uint32) string {
	return fmt.Sprintf("%d.%d.%d.%d", n&0xff, (n>>8)&0xff, (n>>16)&0xff, (n>>24)&0xff)
}

// ─── Servidor HTTP ────────────────────────────────────────────────────────────

type Agent struct {
	store    *FlowStore
	resolver *K8sResolver
	nodeName string
}

func (a *Agent) handleFlows(w http.ResponseWriter, r *http.Request) {
	ns := r.URL.Query().Get("namespace")
	flows := a.store.List(ns)

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	type response struct {
		Node      string         `json:"node"`
		Namespace string         `json:"namespace"`
		Count     int            `json:"count"`
		Flows     []*NetworkFlow `json:"flows"`
		Timestamp time.Time      `json:"timestamp"`
	}

	json.NewEncoder(w).Encode(response{
		Node:      a.nodeName,
		Namespace: ns,
		Count:     len(flows),
		Flows:     flows,
		Timestamp: time.Now(),
	})
}

func (a *Agent) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "ok",
		"node":      a.nodeName,
		"flowCount": len(a.store.flows),
		"lastSync":  a.resolver.lastSync,
	})
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Println("[ebpf-agent] iniciando...")

	// Remover limite de memória locked para mapas eBPF
	if err := rlimit.RemoveMemlock(); err != nil {
		log.Printf("[warn] não foi possível remover memlock limit: %v (pode falhar em kernels antigos)", err)
	}

	nodeName := os.Getenv("NODE_NAME")
	if nodeName == "" {
		nodeName, _ = os.Hostname()
	}

	// Inicializar resolvedor K8s
	resolver, err := NewK8sResolver()
	if err != nil {
		log.Fatalf("[fatal] falha ao inicializar K8s resolver: %v", err)
	}

	store := NewFlowStore()
	agent := &Agent{
		store:    store,
		resolver: resolver,
		nodeName: nodeName,
	}

	// Tentar carregar programa eBPF
	go func() {
		if err := loadAndRuneBPF(store, resolver); err != nil {
			log.Printf("[warn] eBPF não disponível (%v) — usando fallback via /proc/net/tcp", err)
			runProcNetFallback(store, resolver)
		}
	}()

	// Servidor HTTP
	mux := http.NewServeMux()
	mux.HandleFunc("/flows", agent.handleFlows)
	mux.HandleFunc("/health", agent.handleHealth)

	port := os.Getenv("AGENT_PORT")
	if port == "" {
		port = "9090"
	}

	srv := &http.Server{
		Addr:    ":" + port,
		Handler: mux,
	}

	go func() {
		log.Printf("[ebpf-agent] escutando em :%s", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[fatal] servidor HTTP: %v", err)
		}
	}()

	// Graceful shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh
	log.Println("[ebpf-agent] encerrando...")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
}

// ─── Carregamento do programa eBPF ───────────────────────────────────────────

func loadAndRuneBPF(store *FlowStore, resolver *K8sResolver) error {
	// Verificar suporte a eBPF no kernel
	if _, err := ebpf.NewMap(&ebpf.MapSpec{
		Type:       ebpf.Hash,
		KeySize:    4,
		ValueSize:  4,
		MaxEntries: 1,
	}); err != nil {
		return fmt.Errorf("kernel não suporta eBPF maps: %w", err)
	}

	// O programa eBPF compilado é embutido via go:generate
	// Para este build inicial, retornamos erro para usar o fallback
	// Em produção: usar bpf2go para gerar o código Go a partir do .c
	return fmt.Errorf("programa eBPF compilado não disponível neste build — use o Dockerfile de produção")
}

// ─── Fallback via /proc/net/tcp ───────────────────────────────────────────────
// Quando eBPF não está disponível, lê conexões TCP ativas do /proc/net/tcp
// Menos preciso que eBPF mas funciona sem privilégios especiais

func runProcNetFallback(store *FlowStore, resolver *K8sResolver) {
	log.Println("[fallback] monitorando via /proc/net/tcp (sem eBPF)")
	ticker := time.NewTicker(10 * time.Second)
	for range ticker.C {
		readProcNetTCP(store, resolver, "/proc/net/tcp", "TCP")
		readProcNetTCP(store, resolver, "/proc/net/tcp6", "TCP")
		readProcNetTCP(store, resolver, "/proc/net/udp", "UDP")
	}
}

func readProcNetTCP(store *FlowStore, resolver *K8sResolver, path, proto string) {
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}
	lines := splitLines(string(data))
	for _, line := range lines[1:] { // pular header
		fields := splitFields(line)
		if len(fields) < 4 {
			continue
		}
		srcIP, srcPort := parseHexAddr(fields[1])
		dstIP, dstPort := parseHexAddr(fields[2])
		state := fields[3]
		// state 01 = ESTABLISHED
		if state != "01" {
			continue
		}
		flow := &NetworkFlow{
			FlowKey: FlowKey{
				SrcIP:    srcIP,
				DstIP:    dstIP,
				SrcPort:  srcPort,
				DstPort:  dstPort,
				Protocol: proto,
			},
			Src:       resolver.Resolve(srcIP),
			Dst:       resolver.Resolve(dstIP),
			Bytes:     0,
			Packets:   1,
			FirstSeen: time.Now(),
			LastSeen:  time.Now(),
			Verdict:   "forwarded",
		}
		store.Upsert(flow)
	}
}

func parseHexAddr(s string) (string, uint16) {
	if len(s) < 9 {
		return "0.0.0.0", 0
	}
	// Formato: XXXXXXXX:YYYY (little-endian hex)
	ipHex := s[:8]
	portHex := s[9:]
	var ip uint32
	fmt.Sscanf(ipHex, "%x", &ip)
	var port uint16
	fmt.Sscanf(portHex, "%x", &port)
	return uint32ToIP(ip), port
}

func splitLines(s string) []string {
	var lines []string
	start := 0
	for i, c := range s {
		if c == '\n' {
			lines = append(lines, s[start:i])
			start = i + 1
		}
	}
	return lines
}

func splitFields(s string) []string {
	var fields []string
	inField := false
	start := 0
	for i, c := range s {
		if c == ' ' || c == '\t' {
			if inField {
				fields = append(fields, s[start:i])
				inField = false
			}
		} else {
			if !inField {
				start = i
				inField = true
			}
		}
	}
	if inField {
		fields = append(fields, s[start:])
	}
	return fields
}

// Suprime warnings de variáveis não usadas para link e ebpf quando eBPF não está disponível
var _ = link.Kprobe
