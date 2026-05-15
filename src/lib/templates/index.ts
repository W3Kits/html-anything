/**
 * Static template registry for the W3Kits iframe build. The source of truth is
 * still upstream HTML Anything's src/lib/templates/skills/* folders;
 * scripts/generate-static-templates.mjs compiles them into generated.ts before
 * building the static plugin.
 */

"use client";

import { STATIC_TEMPLATES } from "./generated";
import type { StaticTemplate, StaticTemplateExample } from "./static-types";

export type TemplateDef = Omit<StaticTemplate, "body" | "exampleContent" | "exampleHtml">;
export type TemplateExampleMeta = StaticTemplateExample;

const templates: TemplateDef[] = STATIC_TEMPLATES.map(({ body, exampleContent, exampleHtml, ...template }) => template);

export function useTemplates(): TemplateDef[] | undefined {
  return templates;
}

export async function fetchTemplateExample(id: string): Promise<{
  id: string;
  name: string;
  templateId: string;
  format: string;
  tagline: string;
  desc: string;
  source?: { url: string; label: string };
  content: string;
  html: string;
} | null> {
  const template = STATIC_TEMPLATES.find((item) => item.id === id);
  if (!template?.example) return null;
  return {
    id: template.example.id,
    name: template.example.name,
    templateId: template.id,
    format: template.example.format,
    tagline: template.example.tagline,
    desc: template.example.desc,
    source: template.example.source,
    content: template.exampleContent,
    html: template.exampleHtml,
  };
}

export function getCachedTemplate(id: string): TemplateDef | undefined {
  return templates.find((t) => t.id === id);
}

export function getStaticTemplatePrompt(id: string): { body: string; zhName: string; aspectHint: string } | undefined {
  const template = STATIC_TEMPLATES.find((item) => item.id === id);
  if (!template) return undefined;
  return { body: template.body, zhName: template.zhName, aspectHint: template.aspectHint };
}

export function getTemplateExampleHtml(id: string): string {
  return STATIC_TEMPLATES.find((item) => item.id === id)?.exampleHtml ?? "";
}

export { SCENARIO_KEYS, SCENARIO_ORDER, scenarioLabelKey } from "./scenarios";
