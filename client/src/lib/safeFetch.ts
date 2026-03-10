/**
 * safeFetch — wrapper de fetch que trata respostas não-OK e body vazio
 * Evita o erro "Unexpected end of JSON input" quando o backend retorna 404/500 com body vazio
 */
export async function safeFetch<T = unknown>(
  url: string,
  options?: RequestInit,
  fallback?: T
): Promise<T> {
  try {
    const res = await fetch(url, options);

    // Se não for OK, retorna fallback sem tentar parsear JSON
    if (!res.ok) {
      console.warn(`[safeFetch] ${options?.method ?? "GET"} ${url} → ${res.status} ${res.statusText}`);
      if (fallback !== undefined) return fallback;
      throw new Error(`HTTP ${res.status}: ${res.statusText || url}`);
    }

    // Verifica se há body antes de parsear
    const contentLength = res.headers.get("content-length");
    const contentType = res.headers.get("content-type") ?? "";

    if (contentLength === "0" || !contentType.includes("json")) {
      if (fallback !== undefined) return fallback;
      throw new Error(`[safeFetch] Resposta não-JSON de ${url}`);
    }

    const text = await res.text();
    if (!text || text.trim() === "") {
      if (fallback !== undefined) return fallback;
      throw new Error(`[safeFetch] Body vazio de ${url}`);
    }

    return JSON.parse(text) as T;
  } catch (err) {
    if (err instanceof SyntaxError) {
      console.warn(`[safeFetch] JSON inválido de ${url}:`, err.message);
      if (fallback !== undefined) return fallback;
    }
    throw err;
  }
}
