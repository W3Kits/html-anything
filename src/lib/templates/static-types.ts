export type StaticTemplateExample = {
  id: string;
  name: string;
  format: string;
  tagline: string;
  desc: string;
  hasHtml: boolean;
  hasMd: boolean;
  source?: { url: string; label: string };
};

export type StaticTemplate = {
  id: string;
  zhName: string;
  enName: string;
  emoji: string;
  description: string;
  category: string;
  scenario: string;
  aspectHint: string;
  featured?: number;
  recommended?: number;
  tags: string[];
  example?: StaticTemplateExample;
  body: string;
  exampleContent: string;
  exampleHtml: string;
};
