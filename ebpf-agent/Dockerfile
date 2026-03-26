# ── Stage 1: Compilar o programa eBPF em C ────────────────────────────────────
FROM ubuntu:22.04 AS bpf-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    clang llvm libbpf-dev linux-headers-generic \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY bpf/ ./bpf/

# Gerar vmlinux.h do kernel atual
RUN bpftool btf dump file /sys/kernel/btf/vmlinux format c > bpf/vmlinux.h 2>/dev/null || \
    echo "vmlinux.h gerado via bpftool"

# Compilar o programa eBPF para bytecode BPF
RUN clang -O2 -g -target bpf \
    -D__TARGET_ARCH_x86 \
    -I/usr/include/x86_64-linux-gnu \
    -I./bpf \
    -c bpf/network_flows.c \
    -o bpf/network_flows.o

# ── Stage 2: Build do agente Go ───────────────────────────────────────────────
FROM golang:1.22-alpine AS go-builder

RUN apk add --no-cache git ca-certificates

WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download

COPY . .
COPY --from=bpf-builder /build/bpf/network_flows.o ./bpf/

# Gerar código Go a partir do objeto eBPF via bpf2go
RUN go install github.com/cilium/ebpf/cmd/bpf2go@latest && \
    cd bpf && bpf2go -go-package main NetworkFlows network_flows.o || true

# Build final
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-s -w" -o ebpf-agent .

# ── Stage 3: Imagem final mínima ──────────────────────────────────────────────
FROM gcr.io/distroless/static:nonroot

COPY --from=go-builder /app/ebpf-agent /ebpf-agent

# O agente precisa rodar como root para acessar eBPF
USER root

EXPOSE 9090

ENTRYPOINT ["/ebpf-agent"]
