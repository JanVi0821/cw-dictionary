import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { DEEPL_API_KEYS, usedKeys } from "./deep-api-keys.ts";

/** key 耗尽或文件更新失败必须停止，不进入普通接口重试。 */
export class DeepLKeyPoolError extends Error {}

/** 单进程顺序使用文件中的 key；只有 456 才将 key 移入 usedKeys。 */
export async function createDeeplKeyPool() {
  const file = new URL("./deep-api-keys.ts", import.meta.url);
  let expectedContent = await readFile(file, "utf8");
  let available: string[] = [...DEEPL_API_KEYS];
  let used: string[] = [...usedKeys];
  if (
    [...available, ...used].some(
      (key) => typeof key !== "string" || !key.trim() || key !== key.trim(),
    )
  )
    throw new DeepLKeyPoolError("Invalid key entry in deep-api-keys.ts");

  function current(): string {
    const key = available[0];
    if (!key)
      throw new DeepLKeyPoolError(
        "DEEPL_API_KEYS exhausted; add available keys to deep-api-keys.ts before resuming",
      );
    return key;
  }
  current();

  let rotations = Promise.resolve();
  async function rotate(key: string) {
    // 多个在途请求都可能收到旧 key 的 456；此时不重复写文件。
    if (used.includes(key) && !available.includes(key)) {
      current();
      return;
    }
    if (key !== current())
      throw new DeepLKeyPoolError("DeepL active key changed unexpectedly");
    const next = available.filter((value) => value !== key);
    const nextUsed = [...new Set([...used, key])];
    const content = `// Available keys are consumed in order; HTTP 456 moves a key to usedKeys.\nexport const DEEPL_API_KEYS: string[] = ${JSON.stringify(next, null, 2)};\n\nexport const usedKeys: string[] = ${JSON.stringify(nextUsed, null, 2)};\n`;
    const temporary = new URL(
      `./.deep-api-keys.${randomUUID()}.tmp`,
      import.meta.url,
    );
    try {
      // 不覆盖任务运行期间用户手动编辑的 key 文件，也不在持久化失败后继续轮换。
      if ((await readFile(file, "utf8")) !== expectedContent)
        throw new DeepLKeyPoolError(
          "deep-api-keys.ts changed during execution; restart to reload keys",
        );
      await writeFile(temporary, content, { mode: 0o600, flag: "wx" });
      await rename(temporary, file);
      expectedContent = content;
      available = next;
      used = nextUsed;
      DEEPL_API_KEYS.splice(0, DEEPL_API_KEYS.length, ...next);
      usedKeys.splice(0, usedKeys.length, ...nextUsed);
    } catch (error) {
      if (error instanceof DeepLKeyPoolError) throw error;
      throw new DeepLKeyPoolError(
        "Unable to persist exhausted DeepL key to deep-api-keys.ts; task stopped",
      );
    } finally {
      try {
        await rm(temporary, { force: true });
      } catch {
        throw new DeepLKeyPoolError(
          "Unable to clean up temporary DeepL key file; task stopped",
        );
      }
    }
    console.log(
      JSON.stringify({
        event: "deepl_key_exhausted",
        remaining: available.length,
        used: used.length,
      }),
    );
    // 最后一个 key 也先持久化到 usedKeys，再终止当前商品。
    current();
  }
  function exhaust(key: string) {
    const rotation = rotations.then(() => rotate(key));
    rotations = rotation;
    return rotation;
  }
  return { current, exhaust };
}

export type DeepLKeyPool = Awaited<ReturnType<typeof createDeeplKeyPool>>;
