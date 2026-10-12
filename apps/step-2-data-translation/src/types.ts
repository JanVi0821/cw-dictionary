import type { Document } from "mongodb";

export type TextMode = "text" | "html";
export type TranslateContext = {
  sid: string;
  path: string;
  mode: TextMode;
  context: string;
};
export type TranslateText = (
  text: string,
  context: TranslateContext,
) => Promise<string>;
export type TranslationMetadata = {
  task_id?: string;
  status: "completed";
  lang: string;
  provider: string;
  version: number;
  source_hash: string;
  recipe_hash: string;
  context_hash: string;
  field_count: number;
  completed_at: Date;
};
export type ProductDocument = Document & {
  sid: string;
  name: string;
  fetched_at?: string;
  translation?: TranslationMetadata;
};
