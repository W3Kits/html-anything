export const W3KITS_PLUGIN_ID = "html-anything";
export const W3KITS_DEFAULT_MODEL = "gpt-5.4-mini";
export const W3KITS_RUNTIME_SESSION_REQUEST = "W3KITS_RUNTIME_SESSION_REQUEST";
export const W3KITS_RESPONSE = "W3KITS_RESPONSE";

export interface W3KitsRuntimeSession {
  token: string;
  expiresIn: number;
  pluginId: string;
  pluginVersion: string;
  packageName?: string;
  packageIntegrity?: string;
  openaiBaseUrl: string;
  runtimeSessionHeader: string;
  identityHeaders: Record<string, string | undefined>;
}

let cachedRuntimeSession: { value: W3KitsRuntimeSession; expiresAt: number } | null = null;

function queryParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URL(window.location.href).searchParams.get(name);
}

export function getW3KitsOpenAiBaseUrl(): string {
  if (typeof window === "undefined") return "https://w3kits.com/api/ai/openai/v1";
  return (
    queryParam("openaiBaseUrl") ||
    queryParam("w3kitsOpenAiBaseUrl") ||
    "https://w3kits.com/api/ai/openai/v1"
  ).replace(/\/+$/, "");
}

export function isW3KitsLoginRequired(payload: unknown, status?: number): boolean {
  if (status === 401) return true;
  if (!payload || typeof payload !== "object") return false;
  const record = payload as Record<string, unknown>;
  const error = record.error;
  if (error && typeof error === "object") {
    const code = (error as Record<string, unknown>).code;
    return code === "login_required" || code === "plugin_runtime_session_required" || code === "invalid_plugin_runtime_session";
  }
  return record.error === "login_required" || record.code === "login_required";
}

function getW3KitsParentOrigin(): string {
  if (typeof window === "undefined") return "https://w3kits.com";
  const parentOrigin = queryParam("w3kitsParentOrigin");
  if (parentOrigin) return parentOrigin;
  const baseUrl = getW3KitsOpenAiBaseUrl();
  try {
    return new URL(baseUrl).origin;
  } catch {
    return "https://w3kits.com";
  }
}

export function requestW3KitsLogin(reason = "ai_request") {
  if (typeof window === "undefined" || window.parent === window) return;
  window.parent.postMessage(
    {
      type: "W3KITS_AUTH_REQUIRED",
      version: 1,
      pluginId: W3KITS_PLUGIN_ID,
      reason,
    },
    getW3KitsParentOrigin(),
  );
}

function bridgeRequest<T>(message: Record<string, unknown>, timeoutMs = 10000): Promise<T> {
  if (typeof window === "undefined" || window.parent === window) {
    return Promise.reject(new Error("W3Kits runtime bridge is unavailable."));
  }
  const requestId = "html-anything-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  const parentOrigin = getW3KitsParentOrigin();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("W3Kits runtime bridge timed out."));
    }, timeoutMs);

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      if (event.origin !== parentOrigin) return;
      const data = event.data as { type?: unknown; requestId?: unknown; ok?: unknown; data?: unknown; error?: { code?: unknown; message?: unknown } };
      if (data?.type !== W3KITS_RESPONSE || data.requestId !== requestId) return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      if (data.ok) resolve(data.data as T);
      else reject(new Error(typeof data.error?.message === "string" ? data.error.message : typeof data.error?.code === "string" ? data.error.code : "W3Kits runtime bridge failed."));
    };

    window.addEventListener("message", onMessage);
    window.parent.postMessage({ ...message, version: 1, requestId }, parentOrigin);
  });
}

export async function getW3KitsRuntimeSession(): Promise<W3KitsRuntimeSession> {
  const now = Date.now();
  if (cachedRuntimeSession && cachedRuntimeSession.expiresAt - now > 30000) {
    return cachedRuntimeSession.value;
  }
  const session = await bridgeRequest<W3KitsRuntimeSession>({
    type: W3KITS_RUNTIME_SESSION_REQUEST,
    pluginId: W3KITS_PLUGIN_ID,
    origin: typeof window === "undefined" ? undefined : window.location.origin,
  });
  cachedRuntimeSession = {
    value: session,
    expiresAt: now + Math.max(30, session.expiresIn - 30) * 1000,
  };
  return session;
}

export async function getW3KitsOpenAiHeaders(): Promise<Record<string, string>> {
  const session = await getW3KitsRuntimeSession();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-w3kits-runtime-session": session.token,
    "x-w3kits-plugin-id": session.pluginId || W3KITS_PLUGIN_ID,
    "x-w3kits-plugin-version": session.pluginVersion,
  };
  for (const [key, value] of Object.entries(session.identityHeaders || {})) {
    if (typeof value === "string" && value) headers[key] = value;
  }
  if (session.packageName) headers["x-w3kits-plugin-package"] = session.packageName;
  if (session.packageIntegrity) headers["x-w3kits-plugin-integrity"] = session.packageIntegrity;
  return headers;
}
