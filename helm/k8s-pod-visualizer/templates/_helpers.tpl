{{/*
K8s Pod Visualizer — Helm Chart Helpers
CentralDevOps — https://centraldevops.com
*/}}

{{/*
Nome completo do chart
*/}}
{{- define "k8s-pod-visualizer.fullname" -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Nome do chart
*/}}
{{- define "k8s-pod-visualizer.name" -}}
{{- .Chart.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Namespace
*/}}
{{- define "k8s-pod-visualizer.namespace" -}}
{{- .Values.namespace.name | default .Release.Namespace }}
{{- end }}

{{/*
Labels padrão
*/}}
{{- define "k8s-pod-visualizer.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/name: {{ include "k8s-pod-visualizer.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/component: dashboard
app.kubernetes.io/part-of: k8s-pod-visualizer
{{- with .Values.commonLabels }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "k8s-pod-visualizer.selectorLabels" -}}
app.kubernetes.io/name: {{ include "k8s-pod-visualizer.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Nome do ServiceAccount
*/}}
{{- define "k8s-pod-visualizer.serviceAccountName" -}}
{{- if .Values.rbac.create }}
{{- .Values.rbac.serviceAccountName | default (include "k8s-pod-visualizer.fullname" .) }}
{{- else }}
default
{{- end }}
{{- end }}

{{/*
StorageClassName resolvido por tipo
*/}}
{{- define "k8s-pod-visualizer.storageClassName" -}}
{{- if .Values.storage.storageClassName }}
{{- .Values.storage.storageClassName }}
{{- else if eq .Values.storage.type "azure" }}
managed-csi
{{- else if eq .Values.storage.type "gke" }}
pd-ssd
{{- else if eq .Values.storage.type "eks" }}
gp3
{{- else if eq .Values.storage.type "longhorn" }}
longhorn
{{- else }}
standard
{{- end }}
{{- end }}
