import {
  runProductTranslation,
  reportTranslationError,
} from "../../run-products.ts";
import { prepareResumeTasks } from "./tasks.ts";

runProductTranslation(
  "translate",
  "续跑未完成 pending，再从普通翻译上次进度后继续处理。",
  prepareResumeTasks,
).catch(reportTranslationError);
