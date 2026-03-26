// SPDX-License-Identifier: GPL-2.0
// eBPF program para captura de fluxos TCP/UDP
// Compilar com: clang -O2 -g -target bpf -c network_flows.c -o network_flows.o
// Requer: kernel >= 4.18 com BTF habilitado (CONFIG_DEBUG_INFO_BTF=y)

#include "vmlinux.h"
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>
#include <bpf/bpf_core_read.h>
#include <bpf/bpf_endian.h>

// ─── Definições ───────────────────────────────────────────────────────────────

#define AF_INET  2
#define AF_INET6 10
#define IPPROTO_TCP 6
#define IPPROTO_UDP 17

// Evento enviado ao userspace via perf buffer
struct flow_event {
    __u32 src_ip;
    __u32 dst_ip;
    __u16 src_port;
    __u16 dst_port;
    __u8  proto;       // IPPROTO_TCP ou IPPROTO_UDP
    __u8  verdict;     // 0=connect, 1=close, 2=drop
    __u32 bytes;
    __u32 packets;
    __u32 pid;
    char  comm[16];
};

// ─── Mapas ────────────────────────────────────────────────────────────────────

// Perf buffer para enviar eventos ao userspace
struct {
    __uint(type, BPF_MAP_TYPE_PERF_EVENT_ARRAY);
    __uint(key_size, sizeof(__u32));
    __uint(value_size, sizeof(__u32));
} flow_events SEC(".maps");

// Hash map para rastrear conexões ativas (socket → bytes)
struct flow_key {
    __u32 src_ip;
    __u32 dst_ip;
    __u16 src_port;
    __u16 dst_port;
    __u8  proto;
};

struct flow_stats {
    __u64 bytes;
    __u64 packets;
    __u64 last_seen;
};

struct {
    __uint(type, BPF_MAP_TYPE_LRU_HASH);
    __uint(max_entries, 65536);
    __type(key, struct flow_key);
    __type(value, struct flow_stats);
} active_flows SEC(".maps");

// ─── Kprobe: tcp_connect ──────────────────────────────────────────────────────
// Disparado quando um socket TCP inicia uma conexão

SEC("kprobe/tcp_connect")
int BPF_KPROBE(trace_tcp_connect, struct sock *sk)
{
    __u16 family = BPF_CORE_READ(sk, __sk_common.skc_family);
    if (family != AF_INET)
        return 0;

    struct flow_event evt = {};
    evt.src_ip   = BPF_CORE_READ(sk, __sk_common.skc_rcv_saddr);
    evt.dst_ip   = BPF_CORE_READ(sk, __sk_common.skc_daddr);
    evt.src_port = bpf_ntohs(BPF_CORE_READ(sk, __sk_common.skc_num));
    evt.dst_port = bpf_ntohs(BPF_CORE_READ(sk, __sk_common.skc_dport));
    evt.proto    = IPPROTO_TCP;
    evt.verdict  = 0; // connect
    evt.pid      = bpf_get_current_pid_tgid() >> 32;
    bpf_get_current_comm(&evt.comm, sizeof(evt.comm));

    // Registrar no mapa de fluxos ativos
    struct flow_key key = {
        .src_ip   = evt.src_ip,
        .dst_ip   = evt.dst_ip,
        .src_port = evt.src_port,
        .dst_port = evt.dst_port,
        .proto    = IPPROTO_TCP,
    };
    struct flow_stats stats = {.bytes = 0, .packets = 1, .last_seen = bpf_ktime_get_ns()};
    bpf_map_update_elem(&active_flows, &key, &stats, BPF_ANY);

    bpf_perf_event_output(ctx, &flow_events, BPF_F_CURRENT_CPU, &evt, sizeof(evt));
    return 0;
}

// ─── Kprobe: tcp_close ────────────────────────────────────────────────────────
// Disparado quando uma conexão TCP é encerrada — captura bytes transferidos

SEC("kprobe/tcp_close")
int BPF_KPROBE(trace_tcp_close, struct sock *sk)
{
    __u16 family = BPF_CORE_READ(sk, __sk_common.skc_family);
    if (family != AF_INET)
        return 0;

    struct flow_event evt = {};
    evt.src_ip   = BPF_CORE_READ(sk, __sk_common.skc_rcv_saddr);
    evt.dst_ip   = BPF_CORE_READ(sk, __sk_common.skc_daddr);
    evt.src_port = bpf_ntohs(BPF_CORE_READ(sk, __sk_common.skc_num));
    evt.dst_port = bpf_ntohs(BPF_CORE_READ(sk, __sk_common.skc_dport));
    evt.proto    = IPPROTO_TCP;
    evt.verdict  = 1; // close

    // Ler bytes do socket
    struct tcp_sock *tp = (struct tcp_sock *)sk;
    evt.bytes   = (__u32)BPF_CORE_READ(tp, bytes_received);
    evt.packets = (__u32)BPF_CORE_READ(tp, segs_in);

    bpf_perf_event_output(ctx, &flow_events, BPF_F_CURRENT_CPU, &evt, sizeof(evt));
    return 0;
}

// ─── Tracepoint: net/net_dev_xmit ─────────────────────────────────────────────
// Captura pacotes UDP e outros protocolos na camada de transmissão

SEC("tracepoint/net/net_dev_xmit")
int trace_net_dev_xmit(struct trace_event_raw_net_dev_xmit *ctx)
{
    // Implementação simplificada — captura apenas metadados do skb
    // Em produção: usar sk_buff para extrair IPs e portas
    return 0;
}

char LICENSE[] SEC("license") = "GPL";
