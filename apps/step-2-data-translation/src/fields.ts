import { createHash } from "node:crypto";
import { cacheKey } from "./cache.ts";
import {
  EXCLUDED_INFO_KEYS,
  CUSTOM_INSTRUCTIONS,
  CATEGORY_CONTEXT_PREFIX,
  CONTEXT_PRODUCT_FIELDS,
  CONTEXT_MAX_CHARS,
  LANG,
  PROVIDER,
  SOURCE_LANG,
  TRANSLATION_FIELDS,
  VERSION,
} from "./config.ts";
import type { ProductDocument, TextMode, TranslateText } from "./types.ts";
import { contextHash } from "./context.ts";

type Node = Record<string, unknown>;
type Slot = {
  node: Node;
  key: string;
  path: string;
  mode: TextMode;
  text: string;
};
type AttributeSlot = {
  node: Node;
  key: string;
  path: string;
  attributes: { label: string; value: string | string[] }[];
};
const isObject = (value: unknown): value is Node =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** 记录生成译文时的配置，供追踪使用；默认续跑不比较 hash 或重译旧结果。 */
export const RECIPE_HASH = hash({
  customInstructions: CUSTOM_INSTRUCTIONS,
  contextPrefix: CATEGORY_CONTEXT_PREFIX,
  contextFields: CONTEXT_PRODUCT_FIELDS,
  contextMaxChars: CONTEXT_MAX_CHARS,
  attributeFormat: "label-value-array",
  fields: TRANSLATION_FIELDS,
  excluded: EXCLUDED_INFO_KEYS,
  sourceLang: SOURCE_LANG,
  lang: LANG,
  provider: PROVIDER,
  version: VERSION,
});
export const sourceHash = (row: ProductDocument) => hash(row);

/** 只定位配置字段，* 同时支持数组项和 info 的动态 section 名称。 */
function visit(
  value: unknown,
  parts: string[],
  prefix: string,
  action: (node: Node, key: string, path: string) => void,
) {
  if (value === null || typeof value !== "object") return;
  const node = value as Node;
  const [key, ...rest] = parts;
  if (!key) throw new Error("Empty translation field path");
  const keys = key === "*" ? Object.keys(node) : [key];
  for (const k of keys) {
    if (!Object.hasOwn(node, k)) continue;
    const path = prefix ? `${prefix}.${k}` : k;
    if (rest.length) visit(node[k], rest, path, action);
    else action(node, k, path);
  }
}

/** 不调用 DeepL 的字段分析也复用此准备步骤，不改动源文档或 BSON _id。 */
export function prepareTranslation(row: ProductDocument) {
  if (
    typeof row.sid !== "string" ||
    !/^\d+$/.test(row.sid) ||
    typeof row.name !== "string" ||
    !row.name.trim() ||
    typeof row.fetched_at !== "string" ||
    !row.fetched_at.trim()
  )
    throw new Error("Expected product with sid, name and completed detail");
  const { _id, ...data } = row;
  const copy = { ...structuredClone(data), _id } as ProductDocument;
  delete copy.translation;
  // Filter 任务完成标记仅属于原表任务状态，不复制到翻译结果。
  delete copy.translation_flags;
  if (isObject(copy.info))
    for (const key of EXCLUDED_INFO_KEYS) delete copy.info[key];

  const slots: Slot[] = [];
  const attributes: AttributeSlot[] = [];
  for (const rule of TRANSLATION_FIELDS) {
    visit(copy, rule.path.split("."), "", (node, key, path) => {
      const value = node[key];
      if (value == null) return;
      if (rule.mode === "attributes") {
        if (
          !Array.isArray(value) ||
          value.some(
            (item) =>
              !isObject(item) ||
              typeof item.label !== "string" ||
              !(
                typeof item.value === "string" ||
                (Array.isArray(item.value) &&
                  item.value.every((v) => typeof v === "string"))
              ),
          )
        )
          throw new Error(`Expected {label,value} attributes array: ${path}`);
        attributes.push({ node, key, path, attributes: value });
      } else {
        if (typeof value !== "string")
          throw new Error(`Expected string: ${path}`);
        if (value.trim())
          slots.push({ node, key, path, mode: rule.mode, text: value });
      }
    });
  }
  return { copy, slots, attributes };
}

/** 按商品串行翻译，行内所有长度文本均复用；全局缓存另受 100 字符限制。 */
export async function translateRow(
  row: ProductDocument,
  translate: TranslateText,
  context: string,
) {
  const { copy, slots, attributes } = prepareTranslation(row);
  const rowCache = new Map<string, string>();
  let fieldCount = 0;
  async function text(value: string, path: string, mode: TextMode = "text") {
    // 纯数字/标点无须翻译；带单位的文本仍交给 DeepL，例如 75 Tablets。
    if (!value.trim() || (mode === "text" && !/\p{L}/u.test(value)))
      return value;
    fieldCount++;
    const key = cacheKey(value);
    const hit = rowCache.get(key);
    if (hit !== undefined) return hit;
    const result = await translate(value, {
      sid: row.sid,
      path,
      mode,
      context,
    });
    if (!result.trim()) throw new Error(`Empty translation: ${path}`);
    rowCache.set(key, result);
    return result;
  }
  for (const slot of slots)
    slot.node[slot.key] = await text(slot.text, slot.path, slot.mode);

  for (const slot of attributes) {
    const translated: { label: string; value: string | string[] }[] = [];
    for (const [index, attribute] of slot.attributes.entries()) {
      const label = await text(attribute.label, `${slot.path}.${index}.label`);
      const value = attribute.value;
      // 标签是普通字段而非对象键；译后重名仍保留独立条目，不覆盖或合并。
      if (typeof value === "string")
        translated.push({
          label,
          value: await text(value, `${slot.path}.${index}.value`),
        });
      else if (Array.isArray(value)) {
        const values: string[] = [];
        for (const [valueIndex, item] of value.entries()) {
          if (typeof item !== "string")
            throw new Error(
              `Expected attribute string: ${slot.path}.${index}.value.${valueIndex}`,
            );
          values.push(
            await text(item, `${slot.path}.${index}.value.${valueIndex}`),
          );
        }
        translated.push({ label, value: values });
      } else
        throw new Error(
          `Expected attribute string or string array: ${slot.path}.${index}.value`,
        );
    }
    slot.node[slot.key] = translated;
  }
  copy.translation = {
    status: "completed",
    lang: LANG,
    provider: PROVIDER,
    version: VERSION,
    source_hash: sourceHash(row),
    recipe_hash: RECIPE_HASH,
    context_hash: contextHash(context),
    field_count: fieldCount,
    completed_at: new Date(),
  };
  return copy;
}
