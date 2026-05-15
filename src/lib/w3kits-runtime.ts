export const W3KITS_PLUGIN_ID = "html-anything";
export const W3KITS_DEFAULT_MODEL = "gpt-5.4-mini";

export function getW3KitsOpenAiBaseUrl(): string {
  if (typeof window === "undefined") return "https://w3kits.com/api/ai/html-anything/openai/v1";
  const url = new URL(window.location.href);
  return (
    url.searchParams.get("openaiBaseUrl") ||
    url.searchParams.get("w3kitsOpenAiBaseUrl") ||
    "https://w3kits.com/api/ai/html-anything/openai/v1"
  ).replace(/\/+$/, "");
}

export function isW3KitsLoginRequired(payload: unknown, status?: number): boolean {
  if (status === 401) return true;
  if (!payload || typeof payload !== "object") return false;
  const record = payload as Record<string, unknown>;
  const error = record.error;
  if (error && typeof error === "object") {
    const code = (error as Record<string, unknown>).code;
    return code === "login_required";
  }
  return record.error === "login_required" || record.code === "login_required";
}

export function requestW3KitsLogin(reason = "ai_request") {
  window.parent?.postMessage({ type: "w3kits:auth:required", reason, pluginId: W3KITS_PLUGIN_ID }, "*");
}
