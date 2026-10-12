# 商品详情采集 Command

## 1. 入口和数量控制

仓库根目录或 `apps/step-1-data-crawl` 下运行：

```sh
pnpm crawl-details
```

脚本支持按 LIMIT 采集商品；重新采集前可清除 data_raw 的 fetched_at，成功后重新写入完成时间。

数量配置在 `src/commands/crawl-details/config.ts`：

```ts
export const LIMIT = 1000;
```

- LIMIT 为正整数，按实际尝试的商品数计数，失败也计入。
- 单个商品最多尝试 MAX_ATTEMPTS 次，重试不另占商品名额。
- 默认只处理 `fetched_at` 缺失或为 null 的商品，按 sid 字符串升序。
- 再次执行默认命令会继续处理尚未完成的商品。
- `pnpm crawl-details --refresh` 允许重新采集已有详情，仍受 LIMIT 限制。每次刷新从 sid 排序起点开始，不维护刷新轮次断点。
- `pnpm crawl-details --help` 只显示帮助，不连接 MongoDB。
- MONGODB_URI 默认 `mongodb://127.0.0.1:27017`，不自动加载 .env。

## 2. 文件职责

| 文件        | 职责                                                      |
| ----------- | --------------------------------------------------------- |
| `index.ts`  | 参数解析、连接数据库、关闭连接与错误退出                  |
| `config.ts` | 数量、间隔、超时、重试次数常量                            |
| `parse.ts`  | SSR HTML 解析、有效内容判断、富文本、特征、价格及关联商品 |
| `crawl.ts`  | 商品读取、请求与重试、分类合并、两个 collection 的写入    |

每个主要处理步骤均有中文注释。

## 3. MongoDB 数据契约

### 商品：cw_data.data_raw

沿用 bootstrap 的 sid 唯一索引，不替换整份文档，不重建商品集合。

详情字段遵循 `product-detail-data-spec.md`，本次分类规则更新为：

- `category_ids` 为 `number[]`，存储面包屑分类与 bootstrap `list_category_ids` 的并集。
- 面包屑顺序优先，其余大分类按 bootstrap 数组顺序追加，数字 ID 去重。
- 商品只保存分类编号，不保存分类 Name 或路径。
- 原 `list_category_ids` 保持 bootstrap 的字符串数组，作为列表发现依据；继承时统一转为数字。
- 不从单一面包屑覆盖掉商品属于其他大分类的事实。

示例（仅说明合并规则）：

```javascript
{
  sid: "12345",
  list_category_ids: ["257", "259"],
  category_ids: [257, 665, 1020, 259]
  // 其他详情字段遵循商品详情规范
}
```

该数组表达分类关联集合，不是唯一父子路径。

### 分类：cw_data.collection_raw

```javascript
{
  _id: ObjectId("..."),
  collection_id: 257,
  name: "Beauty",
  parent_id: null
}
```

- 业务字段为 `collection_id: number`、`name: string`、`parent_id: number | null`。
- 建立 `{ collection_id: 1 }` 唯一索引 `collection_id_unique`。
- 按 collection_id 执行 updateOne + upsert；已有记录更新 Name，新分类插入一次。
- parent_id 只根据 parseDetail.collections 的原始面包屑链写入：首项为 null，后续项指向左侧相邻 ID。list_category_ids 不参与分类表处理。
- 同一分类若遇到不同父级会使该商品失败，避免静默覆盖已有关系；缺少 parent_id 的旧记录会在本次处理时补齐。
- 不保存 product 数组、分类路径或商品详情。
- Name 仅从当前商品面包屑读取，不从共享配置或列表分类补充。
- list_category_ids 仅在商品入库前作为 category_ids 的兜底 ID 合并，不创建或修改 collection_raw 记录，不查找其名称或父级。
- 已有同类型重复 ID 导致唯一索引创建失败时停止，不自动删除或合并历史分类。该集合应统一使用数字 ID，外部写入也需遵循此规则。

## 4. 单商品完整处理顺序

1. 从 data_raw 选出 bootstrap 商品，校验 sid。
2. 请求 `/buy/{sid}`，手动跟随最多五次重定向，每一跳校验域名、HTTPS 和 sid。
3. 根据最终 URL、可选 skuId、主商品标题和详情容器校验响应确实为该商品 HTML。
4. 解析详情规范全部字段；清除注释、脚本及样式节点，保留 section 的 class、属性和正文结构。
5. 使用 parseDetail.collections 中的分类 ID、名称和父级准备分类数据，与 list_category_ids 无关。
6. 检查面包屑 Set 缓存，仅对需要处理的分类执行 collection_raw 批量 upsert，等待写入确认后加入缓存。
7. 入库前重读 list_category_ids，与面包屑 ID 去重合并到商品 category_ids，再更新 data_raw 的详情字段和 fetched_at，保留 bootstrap 字段。
8. 该商品完成后等待 PRODUCT_INTERVAL_MS，再处理下一个。

只执行 `$set`，不执行 replaceOne、不删除原商品。详情可空字段按解析结果写 null，空集合写 [] 或 {}，刷新时会更新旧详情结果。

本地 standalone MongoDB 不支持跨 collection 事务，因此这里保证写入顺序和重试幂等，无法保证两个 collection 同时提交：

- 分类写失败：本轮不更新商品，整商品重试。
- 分类成功、商品失败：分类记录可能已更新；整商品重试仍按唯一编号写入。
- 商品更新成功后不会再进行可能影响完成标记的分类写入。
- 已完成商品刷新失败时保留之前详情和 fetched_at；再次刷新需使用 --refresh。

## 5. 详情解析要点

- 大图只读取主商品画廊真实的 image_enlarger href，排除 NoImage。
- Supplier 去前缀；Product ID 与 sid 分开；额外 product-information 保留标签。
- info 以有效 details 内容判断，不因 hidden 丢弃正文；source_hidden 检查 section 及详情容器内的祖先。
- 空 section 不记录；注释内模板不解析；未被 section 包裹的正文在克隆 DOM 上整理为 unsectioned，避免重复。
- 同名 section 拼接完整 HTML；多个 General Information 的特征按顺序提取。
- KV 和 KEY FEATURES 提取只读取逻辑行，不删改保存的富文本。
- KEY FEATURES 只接受 • 开头的条目，普通续行归入当前条目；下一标题或 KV 结束该区域。
- 价格限定主商品 offers，排除隐藏来源；币种异常、非法价格和多个候选价格报错，缺失为 null。
- related_sids 取 product-list-container；处方药另读取 Alternative Product(s) 标题链接。
- 存储富文本不等于前端可直接安全渲染；前端需要定义 class 样式，并在展示前处理 HTML 安全性。

## 6. 错误与恢复

每个商品最多尝试三次，默认退避 1 秒、2 秒；429 尊重 Retry-After，单次请求含重定向和正文读取默认超时 30 秒。数据库写入失败也进入整商品重试。

重试耗尽后记录 `storage/detail-crawl-errors.jsonl`，包含 sid、失败时间和错误原因；日志仅追加，历史失败可能已在后续运行中修复，不代表当前最终状态。失败商品不写新的完成时间，继续其他商品；命令最终以非零状态退出。

不将失败错误写进商品的业务字段，不自动删除缺货、404 或无法解析的商品。

仅运行一个详情采集进程；不要在同一时间修改或删除正在处理的商品与分类。命令不会自动执行 bootstrap、全量采集或数据库迁移。

## 7. 面包屑关系缓存

实现位于 `src/commands/crawl-details/breadcrumb-cache.ts`。缓存文件 `breadcrumb-paths.json` 放在同一命令目录，已加入 Git 忽略规则。仅在运行时生成，不从合并后的商品 category_ids 反推历史面包屑。

- 启动读取 JSON 字符串数组，恢复为 Set。文件不存在时使用空 Set；格式损坏时报错。
- 按原始面包屑 ID 顺序生成键，例如 `257,665,1020`。不排序，不包含额外继承的 list_category_ids。
- 更新 collection_raw 前查询 Set，命中后跳过该链的查询、父级冲突检查和 upsert，商品详情照常保存。
- 先检查 Set.has 完整命中；未命中时遍历 Set，已有链以 `当前键 + 逗号` 开头也视为命中。例如已有 `257,665,1020,2000` 可覆盖 `257,665,1020`；不反向覆盖，不匹配链中间片段，也不会把 `10` 与 `1020` 混淆。
- 未命中时按原逻辑校验并写分类，全部成功才加入 Set。随后商品写入失败不会撤销已经成功处理的分类链。
- 命中时不更新 collection_raw，不因 list_category_ids 的不同补写额外分类。列表分类仅在最后商品入库时作为 ID 兜底合并。
- 启动时读取包含 parent_id 的分类 ID；缓存链中有分类不存在或缺少 parent_id 时，重新执行该链。运行期间要求单进程，不能外部修改分类表。
- 每处理 100 个商品保存完整 Set，成功和失败都计数，单商品重试不重复计数。正常结束或可捕获异常退出也保存尾批。
- 强制终止可能丢失最近一批缓存，下次重复执行幂等 upsert，不会产生重复分类。
- 先写临时文件再 rename；缓存写入失败会使任务退出。
- 缓存命中不会刷新已有分类名称和父级。需要重新核对关系或名称时应删除缓存文件，商品重采范围仍由 fetched_at / --refresh 决定。

该缓存仅优化分类处理，商品续跑仍依赖 MongoDB 的 fetched_at。

## 8. 处方药 HTML 模板

parseDetail 根据 `.prescription-pdp` 切换到处方药布局，允许没有旧模板容器，名称及价格优先读取可见处方药区域；supplier 在旧模板存在时补充。图片不采集，images 为 []。

上述 [] 是解析结果。实际写入时，数据库 isPrescription=true 的商品保留原 images，isPrescription 本身不参与详情更新。列表阶段通过独立的 bootstrap-prescription 命令写入这两个字段。

Use 保存为 `info.use`，使用 title、html、source_hidden；通用 Prescription Information 和 IMPORTANT NOTE 不采集或存储。Active Ingredient Name 存入 additional_info。Alternative Product(s) 的标题链接映射到 related_sids。

旧隐藏 description 与 Use 完全相同的正文只保存可见 Use；不同的有效旧模板详情继续保留。具体选择器和规则见商品详情数据规范第 9 节。
