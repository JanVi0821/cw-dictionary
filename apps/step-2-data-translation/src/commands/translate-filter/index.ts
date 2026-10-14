import {
  runProductTranslation,
  reportTranslationError,
} from "../../run-products.ts";
import { prepareFilterTasks } from "./tasks.ts";

runProductTranslation(
  "translate-filter",
  "按 config.ts 的 TRANSLATION_FILTER 强制重译；使用 FILTER_COMPLETION_FLAG 断点续跑。",
  prepareFilterTasks,
).catch(reportTranslationError);
