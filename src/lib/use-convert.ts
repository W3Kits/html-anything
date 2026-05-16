"use client";

import { useCallback } from "react";
import { useStore } from "./store";
import { summarizeForAgent } from "./parsers/auto";
import { assemblePrompt } from "./templates/shared";
import { getStaticTemplatePrompt } from "./templates";
import { getW3KitsOpenAiBaseUrl, getW3KitsOpenAiHeaders, isW3KitsLoginRequired, requestW3KitsLogin, W3KITS_DEFAULT_MODEL } from "./w3kits-runtime";

type ConvertReq = {
  taskId: string;
  agent: string;
  templateId: string;
  content: string;
  format?: string;
  model?: string;
};

const DIFF_LOG_PREFIX = "diff-edit mode";
const controllers = new Map<string, AbortController>();

function buildEditPrompt(args: {
  templateName: string;
  templateAspect: string;
  newContent: string;
  oldContent: string;
  oldHtml: string;
  format: string;
}): string {
  return [
    "You are performing a minimal-diff HTML edit, not regenerating from zero.",
    "",
    `Template style: ${args.templateName} (${args.templateAspect})`,
    `Input format: ${args.format}`,
    "",
    "Hard rules:",
    "1. Output only the complete updated HTML document. The first character must be < and the final content must end with </html>.",
    "2. Do not wrap the answer in Markdown fences and do not include explanatory text.",
    "3. Preserve the previous HTML head, CSS, layout, typography, colors, animations, and component structure unless the new content requires a local change.",
    "4. Only change text, data, and repeated elements implied by the diff between old content and new content.",
    "5. Do not invent facts or data.",
    "",
    "Old content:",
    args.oldContent,
    "",
    "New content:",
    args.newContent,
    "",
    "Existing HTML to edit and return in full:",
    args.oldHtml,
  ].join("\n");
}

function extractTextDelta(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return "";
  return choices.map((choice) => {
    if (!choice || typeof choice !== "object") return "";
    const delta = (choice as { delta?: { content?: unknown } }).delta;
    if (typeof delta?.content === "string") return delta.content;
    const text = (choice as { text?: unknown }).text;
    return typeof text === "string" ? text : "";
  }).join("");
}

function usageFromPayload(payload: unknown): Record<string, number> | null {
  if (!payload || typeof payload !== "object") return null;
  const usage = (payload as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return null;
  const record = usage as Record<string, unknown>;
  return {
    input_tokens: Number(record.prompt_tokens ?? record.input_tokens ?? 0),
    output_tokens: Number(record.completion_tokens ?? record.output_tokens ?? 0),
  };
}

async function readErrorPayload(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

async function streamOpenAiCompletion(input: {
  prompt: string;
  model: string;
  signal: AbortSignal;
  onDelta: (text: string) => void;
  onMeta: (key: string, value: unknown) => void;
}): Promise<void> {
  const response = await fetch(`${getW3KitsOpenAiBaseUrl()}/chat/completions`, {
    method: "POST",
    credentials: "include",
    headers: await getW3KitsOpenAiHeaders(),
    signal: input.signal,
    body: JSON.stringify({
      model: input.model,
      stream: true,
      messages: [
        { role: "system", content: "You generate production-quality self-contained HTML documents. Return only HTML." },
        { role: "user", content: input.prompt },
      ],
    }),
  });

  if (!response.ok || !response.body) {
    const payload = await readErrorPayload(response);
    if (isW3KitsLoginRequired(payload, response.status)) {
      requestW3KitsLogin("ai_request");
      throw new Error("Sign in required before using W3Kits AI.");
    }
    const message = payload && typeof payload === "object" ? JSON.stringify(payload).slice(0, 400) : response.statusText;
    throw new Error(`HTTP ${response.status}: ${message}`);
  }

  input.onMeta("model", input.model);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") return;
    try {
      const payload = JSON.parse(data) as unknown;
      const usage = usageFromPayload(payload);
      if (usage) input.onMeta("usage", usage);
      const delta = extractTextDelta(payload);
      if (delta) input.onDelta(delta);
    } catch {
      // Ignore malformed SSE chunks.
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) consumeLine(line);
  }
  const rest = decoder.decode();
  if (rest) buffer += rest;
  if (buffer) {
    for (const line of buffer.split(/\r?\n/)) consumeLine(line);
  }
}

export function useConvert() {
  const cancel = useCallback((taskId: string) => {
    const ctl = controllers.get(taskId);
    if (ctl) {
      ctl.abort();
      controllers.delete(taskId);
    }
    useStore.getState().setStatusFor(taskId, "idle");
  }, []);

  const run = useCallback(
    async (req: ConvertReq) => {
      const { taskId } = req;
      cancel(taskId);
      const ctl = new AbortController();
      controllers.set(taskId, ctl);
      const store = useStore.getState();
      store.setStatusFor(taskId, "running");
      store.resetHtmlFor(taskId);
      store.clearLogFor(taskId);
      store.resetStatsFor(taskId);
      const startedAt = Date.now();
      store.patchStatsFor(taskId, { startedAt });

      const taskWithAssets = store.tasks.find((t) => t.id === taskId);
      const assets = taskWithAssets?.assets ?? {};
      const inlinedContent = Object.keys(assets).length
        ? req.content.replace(/asset:([a-z0-9_]+)/gi, (m, id) => assets[id] ?? m)
        : req.content;

      const summary = summarizeForAgent(inlinedContent);
      const enrichedContent =
        summary.preview && summary.format !== "markdown" && summary.format !== "html" && summary.format !== "text"
          ? `${summary.preview}\n\n--- Raw content ---\n${summary.raw}`
          : summary.raw;

      const template = getStaticTemplatePrompt(req.templateId);
      if (!template) {
        store.pushLogFor(taskId, { kind: "error", text: `Unknown template: ${req.templateId}` });
        store.setStatusFor(taskId, "error");
        return;
      }

      const task = store.tasks.find((t) => t.id === taskId);
      const isEdit = !!task?.baseHtml && !!task?.baseContent && task.baseContent.trim() !== req.content.trim();
      const prompt = isEdit
        ? buildEditPrompt({
            templateName: template.zhName,
            templateAspect: template.aspectHint,
            newContent: enrichedContent,
            oldContent: task!.baseContent!,
            oldHtml: task!.baseHtml!,
            format: req.format ?? summary.format,
          })
        : assemblePrompt({ body: template.body, content: enrichedContent, format: req.format ?? summary.format });

      const model = req.model && req.model !== "default" ? req.model : W3KITS_DEFAULT_MODEL;
      const sizeNote = `input ${enrichedContent.length.toLocaleString()} chars (${summary.format})`;
      store.pushLogFor(taskId, {
        kind: "info",
        text: isEdit
          ? `${DIFF_LOG_PREFIX} · W3Kits AI · model ${model} · template ${req.templateId} · ${sizeNote}`
          : `Preparing W3Kits AI · model ${model} · template ${req.templateId} · ${sizeNote}`,
      });

      try {
        await streamOpenAiCompletion({
          prompt,
          model,
          signal: ctl.signal,
          onDelta: (text) => store.appendHtmlFor(taskId, text),
          onMeta: (key, value) => {
            if (key === "usage" && value && typeof value === "object") {
              const u = value as Record<string, number>;
              store.patchStatsFor(taskId, { inputTokens: u.input_tokens, outputTokens: u.output_tokens });
            }
            if (key === "model" && typeof value === "string") store.patchStatsFor(taskId, { model: value });
            store.pushLogFor(taskId, { kind: "meta", elapsed: Date.now() - startedAt, text: formatMeta(key, value), data: value });
          },
        });
        const endedAt = Date.now();
        store.patchStatsFor(taskId, { endedAt, durationMs: endedAt - startedAt });
        store.setStatusFor(taskId, "done");
        store.commitBaseFor(taskId);
      } catch (err) {
        if ((err as Error)?.name === "AbortError") {
          store.pushLogFor(taskId, { kind: "info", text: "Canceled" });
          store.setStatusFor(taskId, "idle");
          return;
        }
        store.pushLogFor(taskId, { kind: "error", text: (err as Error)?.message ?? String(err) });
        store.setStatusFor(taskId, "error");
      } finally {
        if (controllers.get(taskId) === ctl) controllers.delete(taskId);
      }
    },
    [cancel],
  );

  return { run, cancel };
}

function formatMeta(key: string, value: unknown): string {
  if (key === "model") return `model = ${value}`;
  if (key === "usage" && value && typeof value === "object") {
    const u = value as Record<string, number>;
    const parts: string[] = [];
    if (u.input_tokens) parts.push(`in=${u.input_tokens}`);
    if (u.output_tokens) parts.push(`out=${u.output_tokens}`);
    return `usage: ${parts.join(" · ")}`;
  }
  return `${key}: ${typeof value === "object" ? JSON.stringify(value).slice(0, 120) : String(value)}`;
}
