import { setTimeout as delay } from "node:timers/promises";
import type { TranslateText } from "./types.ts";
import {
  DeepLKeyPoolError,
  type DeepLKeyPool,
} from "./deepl-api-keys/deepl-key-pool.ts";

export type DeeplOptions = {
  sourceLang: string;
  targetLang: string;
  customInstructions: readonly string[];
  requestIntervalMs: number;
  requestTimeoutMs: number;
  retryDelaysMs: readonly number[];
};

/** 公共 DeepL 请求模块；业务指令和请求参数由各命令独立提供。 */
export function createDeeplTranslator(
  keys: DeepLKeyPool,
  assertRunning: () => void,
  options: DeeplOptions,
): TranslateText {
  const language = options.targetLang.replaceAll("_", "-").toUpperCase();
  const aliases: Record<string, string> = {
    ZH: "ZH-HANS",
    "ZH-CN": "ZH-HANS",
    "ZH-TW": "ZH-HANT",
  };
  let lastStarted = 0;
  // 串行分配请求启动时间，网络响应仍可并发；重试和轮换共享此限速队列。
  let scheduling = Promise.resolve();
  async function waitForRequestSlot() {
    const slot = scheduling.then(async () => {
      const wait = options.requestIntervalMs - (Date.now() - lastStarted);
      if (wait > 0) await delay(wait);
      lastStarted = Date.now();
    });
    scheduling = slot.catch(() => {});
    await slot;
  }

  return async (text, context) => {
    if (!text.trim()) return text;
    const body = JSON.stringify({
      text: [text],
      source_lang: options.sourceLang,
      target_lang: aliases[language] ?? language,
      context: context.context,
      ...(options.customInstructions.length
        ? { custom_instructions: options.customInstructions }
        : {}),
      preserve_formatting: true,
      ...(context.mode === "html"
        ? { tag_handling: "html", tag_handling_version: "v2" }
        : {}),
    });
    // 不截断药品说明，超过服务限制时停止当前商品并保留原结果。
    if (Buffer.byteLength(body, "utf8") > 128 * 1024)
      throw new Error(`DeepL request exceeds 128 KiB: ${context.path}`);

    for (let attempt = 0; ; attempt++) {
      // 其他 worker 已失败时，不再为当前字段发起新的重试请求。
      assertRunning();
      try {
        // 每次请求都取当前 key，轮换后重新计算 Free/Pro endpoint。
        await waitForRequestSlot();
        const apiKey = keys.current();
        const endpoint = apiKey.endsWith(":fx")
          ? "https://api-free.deepl.com/v2/translate"
          : "https://api.deepl.com/v2/translate";
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `DeepL-Auth-Key ${apiKey}`,
            "Content-Type": "application/json",
          },
          body,
          signal: AbortSignal.timeout(options.requestTimeoutMs),
        });
        if (response.status === 456) {
          await response.body?.cancel();
          await keys.exhaust(apiKey);
          // 下一项 key 从当前字段继续，重置普通重试次数，不重翻此前成功字段。
          attempt = -1;
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(`DeepL HTTP ${response.status}`);
        }
        const data = (await response.json()) as {
          translations?: { text?: string }[];
        } | null;
        const result = data?.translations?.[0]?.text;
        if (
          data?.translations?.length !== 1 ||
          typeof result !== "string" ||
          !result.trim()
        )
          throw new Error("DeepL returned invalid translation");
        return result;
      } catch (error) {
        if (error instanceof DeepLKeyPoolError) throw error;
        // 不输出请求体、服务响应体或原始异常对象，避免凭证和长说明进入日志。
        const message =
          error instanceof Error ? error.message : "Unknown error";
        const delayMs = options.retryDelaysMs[attempt];
        if (delayMs === undefined)
          throw new Error(
            `DeepL failed after ${attempt + 1} attempts: sid=${context.sid}, field=${context.path}, ${message}`,
          );
        console.error(
          JSON.stringify({
            event: "translation_retry",
            sid: context.sid,
            field: context.path,
            retry: attempt + 1,
            delayMs,
            error: message,
          }),
        );
        await delay(delayMs);
      }
    }
  };
}
