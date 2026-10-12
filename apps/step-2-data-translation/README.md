# Chemist Warehouse 商品翻译

仅使用 DeepL，将 `cw_data.data_raw` 的英文商品翻译为简体中文，完整结果写入 `cw_data.data_raw_translated`。源集合不修改。参考 grocery-dictionary 的 DeepL、字段级重试、商品内缓存实现，跨商品缓存已改为 Redis，没有接入其他供应商。

## 字段分析与配置

2026-10-12 只读分析：原集合共 19,349 条，全部具备 fetched_at。字段配置在 [src/config.ts](src/config.ts) 的 `TRANSLATION_FIELDS`，不是在业务代码中逐个写死。

| 配置路径             | 处理                                                                         |
| -------------------- | ---------------------------------------------------------------------------- |
| `name`               | 商品名称                                                                     |
| `additional_info.*`  | 元数据文本，例如 Active Ingredient Name 及内容                               |
| `info.*.title`       | section 标题                                                                 |
| `info.*.html`        | 整个 section 的富文本，使用 DeepL HTML 模式                                  |
| `feature_attributes` | `{label,value}[]`，逐项翻译 label 和 value；value 为数组时逐项翻译，保持数组 |
| `key_features.*`     | bullet 特征文本，保持原数组顺序                                              |

实际 info 包括 general_info、directions、ingredients、warnings、description、commonuses、use、indications；未来出现 unsectioned 或其他 section 也由通配符覆盖。info 对象的 section key 和 source_hidden 不翻译。非空字符串才处理，纯数字/标点直接保留。`200g`、`75 Tablets` 等带字母的单位文本仍交给 DeepL，不在本地改变剂量或单位。

`feature_attributes` 使用 `{label,value}[]`，既有 Size、Suitable For 等常见标签，也有整句描述，因此不限定标签枚举。逐项翻译 label 和 value，保留条目顺序及 value 的字符串/字符串数组类型。译后 label 重名也保留为独立条目，不覆盖或合并。data_raw 保留英文，data_raw_translated 保存译文。

2026-10-12 已将两个集合的历史对象格式转换为数组：data_raw 19,349 条，data_raw_translated 1 条；空对象转换为 []，其他字段原样保留。当时全量检查确认均符合 `{label,value}[]`，一次性迁移脚本及命令已删除。采集脚本也已输出新格式。结构和翻译配置变化仅记录到新结果的 hash，不影响默认续跑；重译旧结果需指定 --sid 和 --force，Redis 短文本缓存仍可复用。

以下字段原值复制，不调用翻译：`supplier`（供应商专名）、`_id`、`sid`、`product_id`、`category_ids`、`list_category_ids`、`related_sids`、`images`、`price`、`fetched_at`、`isPrescription`，以及未列入配置的其他字段。General Information 的富文本仍整体保留，翻译特征不会从正文删除任何内容。

历史残留的 prescription_information、prescription_note 通过 `EXCLUDED_INFO_KEYS` 排除，不翻译、不写入目标，源集合不在此任务中清理。此次分析时源集合中还有 1 条带这两个历史字段。

## 使用

目录中的现有 `.env` 已保留，配置项：

```dotenv
MONGODB_URI=mongodb://127.0.0.1:27017/cw_data
REDIS_URL=redis://127.0.0.1:6379
```

MongoDB URI 的路径只应包含数据库名，不应追加 collection。脚本显式 `client.db(DATABASE)`，数据库和集合以 config 为准，因此也兼容当前 env 中多带集合名的路径；不会重写现有 env 或输出凭证。

在仓库根目录运行：

```sh
pnpm translate --limit=10 --concurrency=4
pnpm translate --sid=43194
pnpm translate --limit=all
pnpm translate --sid=43194 --force
pnpm translate --help
```

也可在本目录执行相同命令。默认数量由 `src/config.ts` 的 `LIMIT` 控制，CLI 可覆盖。limit 统计本次实际完成翻译并写入的商品数量，自动跳过的商品不占额度。所有非 help 命令都会调用真实 DeepL，可能消耗额度；本次开发没有执行翻译任务。

## API key 轮换

密钥改从 `src/deep-api-keys.ts` 的 `DEEPL_API_KEYS` 数组读取，始终使用第一项，不读取 env 的 DEEPL_API_KEY。真实密钥文件已被 Git 忽略，首次配置可复制 `src/deep-api-keys.example.ts` 并填写字符串数组。

遇到 HTTP 456 时，先将当前 key 从 DEEPL_API_KEYS 删除、去重追加到 usedKeys，使用临时文件和 rename 原子写回原文件，再用新的第一项重试同一字段。写回文件可能规范化格式，保留的是两个数组内容。轮换不消耗普通重试次数，也不重新翻译当前商品此前成功的字段。每次请求重新选择 Free/Pro 域名；日志只输出剩余和已使用数量，不输出密钥。

最后一项耗尽时也先写回空 DEEPL_API_KEYS 与完整 usedKeys，再退出任务（退出码 1）；当前商品不写入部分译文，之前完成商品和缓存保留。补充新 key 后正常续跑。文件更新失败，或任务运行期间手动改动密钥文件，都会停止，不覆盖用户改动。单次只运行一个实例。

## DeepL 与富文本

沿用参考项目：`:fx` 结尾的密钥使用 Free 域名，其他密钥使用 Pro 域名，HTTPS JSON POST `/v2/translate`，源语言 EN，zh 映射 ZH-HANS。每个字段一个请求，不接入其他服务，不自动降级。

富文本使用 `tag_handling: html`、`tag_handling_version: v2`，由 DeepL 在 HTML 结构中翻译正文；启用 preserve_formatting。保留 HTML 标签、class、style 和链接的目标不等同于字节级相同，服务可能规范化空白和实体。图片里的英文不进行 OCR，展示时仍需自己的 CSS。

API 行为依据 [DeepL 翻译接口](https://developers.deepl.com/api-reference/translate/request-translation) 和 [HTML 翻译文档](https://developers.deepl.com/docs/translate/translating-html)。请求体超过 128 KiB 直接停止，不截断药品说明；目前不做超长字段自动切分。

## 商品上下文

任务启动时从 `cw_data.collection_raw` 一次读取 collection_id 和英文 name 到内存。每个商品按 category_ids 顺序查找分类名称、去重，并加入原始英文商品名、供应商、additional_info、feature_attributes 和 key_features，拼成 DeepL 的 context 参数。缺失或空属性跳过，所有翻译字段使用同一份背景。例如：

```text
This text describes a product sold by Chemist Warehouse New Zealand. Its product categories are: Beauty, Skin Care, Facial Moisturisers.
Product name: Example Hydrating Face Cream 50ml
Supplier: Example Skincare
Product attributes: Skin Type: Dry; Size: 50ml
Key features: Helps maintain skin hydration
```

前缀由 `CATEGORY_CONTEXT_PREFIX` 配置，背景属性由 `CONTEXT_PRODUCT_FIELDS` 配置。`CONTEXT_MAX_CHARS=6000` 只截断过长背景，不截断实际翻译正文。分类名称列表不是父子路径，不将兜底继承分类误当作 breadcrumbs 链；不修改 collection_raw。缺少 category_ids 或找不到分类名称会停止当前任务，不在缺失上下文时静默翻译。row_started 日志输出实际 context，方便检查。

同时发送 config.ts 中的 CUSTOM_INSTRUCTIONS：营养、药品及美容成分采用标准简体中文术语（包括产品标题和引用的产品名），保留制造商与品牌专名，剂量及原文含义保持忠实。不包含针对特定商品或品牌的术语映射。指令配置记录在 recipe_hash，背景记录在 context_hash，均不参与默认续跑判断。修改指令或上下文后可用 --sid 和 --force 显式重译；原文缓存仍可能命中旧译文，需按需清理缓存。分类表启动后发生的变化会在下次启动时读取。

## 并发与任务分配

使用单个 Node.js 进程中的异步 worker 并发处理 API 网络任务，无需为每个商品启动操作系统线程。默认 `CONCURRENCY=4`，可通过 `--concurrency=8` 调整（允许 1–64）；每个商品内部逐字段翻译。`LIMIT` 是所有 worker 合计的本次完成数量，不是每个 worker 的数量。DeepL 请求启动间隔由共享队列统一限速，等待网络响应期间其他请求可以继续。

`cw_data.translation_pending` 是持久待办表，复用原商品 `_id`，入队时即保存 sid、force、generation。worker 使用 findOneAndUpdate 原子设置 owner；其他 worker 不会领取已被占用的同一商品。商品完整翻译并写入目标集合后才删除待办。generation 写入目标的 translation.task_id，因此写商品后、删待办前发生崩溃时，包括强制重译任务在内也不会再次调用翻译。

Redis 全局运行锁保护待办恢复和共享 key 文件。一个项目同时只允许一个命令实例，内部 worker 并发；重复启动第二个命令会立即退出。运行锁和缓存文本锁每 20 秒自动续期，TTL 60 秒；释放时校验令牌，不删除其他 owner 的锁。正常退出释放运行锁，强制 kill 后等待旧锁 TTL 到期再启动。Redis 不可用或锁丢失时停止任务，不降级为无锁并发。

## Redis 实时缓存

- Redis 地址取 `REDIS_URL`，缺失时默认 `redis://127.0.0.1:6379`。脚本不启动 Redis 服务。
- Hash 名称为 `cw:translation:cache:deepl:zh:v2`（命名空间由 REDIS_NAMESPACE 配置，语言和版本随配置变化）。Hash 的 field **仅为原文转小写**，Warnings/warnings 共用同一条；不拼接文本 hash、分类或上下文。value 为译文。
- 跨商品缓存继续遵循 `GLOBAL_CACHE_MAX_CHARS=100`，按原文 Unicode code point 数计数，包含空格及 HTML 标签。0 可关闭跨商品缓存。长文本仍在商品内的 Map 中复用，不跨商品持久化。
- 查询 Redis 命中时直接返回。未命中时按小写原文加锁，持锁 worker 调用 DeepL；其他 worker 等待锁，获得锁后再次查询缓存，复用已生成的译文。
- 每次成功译文立即通过 Lua 校验锁令牌并执行 HSETNX，保留首次成功写入的结果；没有 CACHE_SAVE_EVERY、定时快照或退出保存逻辑。缓存内容不设置过期时间，数据淘汰和服务重启后的保留由 Redis 实例的持久化/内存策略决定。
- 本地 cache JSON 不再读取或写入；历史文件保留；现有 deepl-zh-v2.json 的 15,821 条缓存已迁移到 Redis，正常翻译命令不重复导入。更换翻译规则后需要清理 Redis 对应字段或调整 VERSION 才能绕过旧缓存。
- 认证、连接或写入 Redis 失败直接停止，已成功写入的译文缓存不受后续商品失败影响。等待缓存锁最多 300 秒，每隔 100 毫秒重试；超时停止。锁按文本区分，不同文本可并行翻译。

实现参考 [node-redis 文档](https://redis.io/docs/latest/develop/clients/nodejs/) 和 [Redis 锁文档](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/)。

## 写入、续跑与失败

默认先恢复 translation_pending 中未完成的任务，再以目标集合最大 `_id` 为断点，从原表选取 `_id > 断点` 且 fetched_at 非空的详情商品写入待办；目标为空则从头开始。新商品按 ID 升序入队和领取，但并发完成顺序可以不同。本命令已入队的较小 ID 未完成商品始终保留在待办中，不会因较大 ID 先成功而漏掉。原文、上下文或配置变化不触发历史结果自动重译。单次最多按 limit 个新商品入队，未处理的待办会保留到下次。

`--sid` 定向入队，并只处理该 sid；已有 completed 结果则跳过。`--sid=xxx --force` 定向强制重译；单独 `--force` 从原表开头按 limit 创建强制重译任务。尚未完成的强制重译任务会保留 force 状态供下次续跑。旧商品在引入待办表前就有的空洞、手动删除的历史译文不会自动补齐，可定向处理。单独处理较大 ID 商品仍会推进默认断点，不会自动补建此前从未入队的中间商品。

商品全部字段成功才 replaceOne 原子写入 data_raw_translated，复用原 `_id`，sid 有唯一索引。translation 元数据保存 status、lang、provider、version、source_hash、recipe_hash、context_hash、task_id、field_count、completed_at；hash 仅追踪来源，不参与默认续跑判断。

除 HTTP 456 轮换密钥外，其他接口失败等待 4/8/8/16 秒，最多 5 次尝试；每个请求 30 秒超时。首个错误停止所有 worker 领取新任务，未完成任务保留在 pending；等待在途 worker 结束后再关闭 Redis/MongoDB，不会提前关连接影响其他 worker。失败退出码为 1。成功写入目标但待办未删除的任务，下次凭 completed 状态/task_id 清理待办而不重译。

Ctrl+C/SIGTERM 停止领取新任务，等待正在处理的商品结束；强制终止后默认续跑恢复 pending。运行锁丢失后禁止提交新结果。翻译过程中源数据变化时结果对应读取时快照，后续更新需定向重译。此命令不修改 data_raw、不翻译 collection_raw，也不清理源集合删除商品的历史译文。

## 文件

| 文件             | 职责                                              |
| ---------------- | ------------------------------------------------- |
| `src/config.ts`  | 翻译字段、数据库/集合、语言、数量、缓存与重试配置 |
| `src/index.ts`   | CLI、env、MongoDB、批处理续跑及退出清理           |
| `src/fields.ts`  | 字段定位、原数据复制、KV、商品内缓存及 hash       |
| `src/deepl.ts`   | 唯一翻译供应商、HTML 模式、重试及限速             |
| `src/context.ts` | 加载分类名称、拼接 context 及计算上下文 hash      |
| `src/cache.ts`   | Redis 实时缓存与相同原文请求合并                  |
| `src/redis.ts`   | Redis 连接、令牌锁及自动续期                      |
| `src/tasks.ts`   | 待办入队、断点恢复和原子领取                      |
| `src/types.ts`   | 翻译协议和完成元数据                              |
