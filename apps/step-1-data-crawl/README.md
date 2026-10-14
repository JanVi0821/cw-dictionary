# 商品数据 Bootstrap

处方药 SSR 列表使用独立命令 `pnpm bootstrap-prescription`，配置在 `src/commands/(2)bootstrap-prescription/config.ts`。支持 `--max-pages=1` 限页及 `--fresh` 重扫，默认断点续跑。名称包含 Blackmores 的广告商品会被排除，其余商品按 sid 仅在原 `images` 缺失、为 null 或空数组时补充有效图片，并补充 `isPrescription: true`。NoImage 占位图不会采集。详情采集会保留这些商品的图片及标记。详见 [处方药列表规范](.spec/prescription-list-crawl-spec.md)。

读取 `src/const/crawl_sites.ts` 中的五个大分类，分页请求列表 API，写入本地 MongoDB 的 `cw_data.data_raw`。不请求商品详情页。

## 运行

需要 Node.js 24+、项目依赖和本地 MongoDB。默认连接 `mongodb://127.0.0.1:27017`。

采集逻辑独立放在 `src/commands/(1)bootstrap/`：`index.ts` 为命令入口，`api.ts` 解析接口，`crawl.ts` 负责分页、写库和断点恢复。

在仓库根目录或当前应用目录执行：

```sh
pnpm bootstrap
```

默认恢复未完成的扫描；上一轮全部完成后会启动新扫描。每页 48 条，按接口已验证的 packageid 升序采集，单请求并发。

查看帮助（不连接数据库）：

```sh
pnpm bootstrap --help
```

只处理一页以检查数据：

```sh
pnpm bootstrap --max-pages=1
```

从头扫描所有配置分类：

```sh
pnpm bootstrap --fresh
```

`--fresh` 只重置采集进度，不删除 MongoDB 文档。切换或清空数据库后，应使用该选项。

其他本地连接：

```sh
MONGODB_URI='mongodb://127.0.0.1:27017' pnpm bootstrap
```

连接环境变量由进程读取，不自动加载 `.env`。数据库和 collection 固定为 `cw_data.data_raw`。

## 数据和恢复

- sid 为字符串，具有唯一索引；每个商品一份文档。
- 存储 sid、name、price、list_category_ids。
- 跨分类命中的商品合并到同一文档，分类编号去重。
- 不存完整详情 URL；详情阶段使用 sid 构造请求地址。
- 不存列表抓取时间；断点文件内的时间仅用于采集进度。
- 使用字段更新，不替换整份文档；已有详情字段保留。
- `storage/list-crawl-state.json` 保存分页进度，只在 MongoDB 写入确认成功后推进。
- 不支持同时运行多个采集进程；不要在扫描期间删除 checkpoint。
- 每页最多尝试三次。分类总数变化、漏项或重复导致核对失败时报告错误，可调查后用 --fresh 重新扫描。
- 不自动删除历史商品或历史分类关联。

字段和处理规则见 [列表数据规范](.spec/product-list-crawl-spec.md)；详情阶段见 [商品详情规范](.spec/product-detail-data-spec.md)。

## 类型检查

```sh
pnpm exec tsc --noEmit
```

## 商品详情采集

独立命令 `pnpm crawl-details`，数量由 [config.ts](src/commands/crawl-details/config.ts) 的 `LIMIT` 控制，最多尝试数量以 config.ts 的 LIMIT 为准。默认跳过已有 `fetched_at` 的商品；`--refresh` 可刷新已有详情，仍受 LIMIT 限制。

每个商品先 upsert `cw_data.collection_raw`（`collection_id` 唯一、`name` 为名称、`parent_id` 为父分类，根分类为 null），再更新 `cw_data.data_raw` 的详情和完成时间。商品 `category_ids` 为数字数组，包含面包屑分类及继承的 `list_category_ids`。

详见 [详情采集命令规范](.spec/product-detail-crawl-spec.md)。采集数量以 config.ts 的实际 LIMIT 为准。

分类关系只使用 parseDetail.collections，通过内存 Set 去重：启动读取命令目录的 `breadcrumb-paths.json`，命中原始面包屑 ID 链后跳过分类表处理。每处理 100 个商品保存一次，任务结束也保存尾批。list_category_ids 仅在商品入库前合并到商品 category_ids，不参与分类缓存或 collection_raw 写入。缓存不负责商品完成状态；需要刷新分类名称或父级时，可删除该文件。

## 导出分类树和叶子路径

```sh
pnpm export-collection-tree
pnpm export-collection-tree --help
```

独立命令位于 `src/commands/(3)export-collection-tree/`，配置位于同目录的 `config.ts`。只读查询 `cw_data.collection_raw`，依据实际 `parent_id` 生成森林，不依赖预设大分类、商品面包屑缓存或 `list_category_ids`。

输出到本应用的 `storage/collection-tree/`，从仓库根目录执行时路径也不变：

- `tree.json`：所有根节点构成的数组；节点包含 `collection_id`、`name`、`parent_id`、`children`，叶子的 `children` 为 `[]`。
- `leaves.json`：全部叶子的平铺数组；每条包含 `collection_id`、`name`、`parent_id`、`ancestor_ids`、`path_ids`。两种路径均从根到叶子方向排列，前者不包含叶子自身，后者包含。

例如关系 `256 → 81 → 513`，叶子输出：

```json
{
  "collection_id": 513,
  "name": "Blackmores",
  "parent_id": 81,
  "ancestor_ids": [256, 81],
  "path_ids": [256, 81, 513]
}
```

根分类如果没有子分类，也会作为叶子输出，其 `ancestor_ids` 为 `[]`、`path_ids` 为 `[根ID]`。空集合生成两个空数组。输出按根与子分类 ID 升序进行深度优先遍历，顺序稳定。

发现重复 ID、无效名称/父级 ID、缺失父级、自引用或父级循环时会报错，且在校验失败时不覆盖已有输出文件。每次成功运行重新生成两份文件；不会修改 MongoDB 或 Supabase，也不会开始商品分类补全或请求官网。

连接与其他 step-1 命令一致：读取进程 MONGODB_URI，缺失时连接本地 MongoDB，不自动加载 `.env`。

## 按叶子分类补全商品 category_ids

```sh
# 先生成/刷新叶子文件
pnpm export-collection-tree
# 默认续跑全部未完成叶子
pnpm complete-product-collections
# 本次最多处理 2 页，所有叶子合计
pnpm complete-product-collections --max-pages=2
# 从首个叶子重扫，不删除已有商品或分类
pnpm complete-product-collections --fresh
```

命令独立位于 `src/commands/(4)complete-product-collections/`，配置在该目录的 `config.ts`。读取 `storage/collection-tree/leaves.json`，逐个叶子遍历其商品列表：普通分类复用 bootstrap 的搜索 API，使用叶子 collection_id 查询，按 packageid 升序、每页 48 条；处方药分类 261 复用现有 SSR 分页解析器，每页 24 条，并沿用排除 Blackmores 广告的规则。

每页为每个商品生成一次 updateOne，批量写入 `cw_data.data_raw`：

- 按 sid 唯一匹配；用 `$setUnion` 原子合并现有 category_ids 与当前叶子的完整 path_ids，并去重。
- 新商品仅写入 sid、name、category_ids（MongoDB 自动生成 _id）；不写 price、详情或完成标记。
- 已有 name 保留，name 字段缺失时补齐；其他已有字段不修改。不更新 list_category_ids。
- 商品在不同叶子中重复出现时，会继续合并每条分类路径。category_ids 是分类集合，不应据其顺序推断父子关系；父子关系只取 collection_raw.parent_id。
- 新商品可随后用 crawl-details 补详情；详情脚本已调整为原子合并已有 category_ids，防止覆盖本阶段补全结果。
- 此命令不更新 collection_raw、data_raw_translated 或 Supabase。

进度保存在 `storage/collection-completion-state.json`，包含当前叶子索引、下一页偏移量、当前分类总数和已读取 SID。整页数据库写入成功后才原子保存 checkpoint；部分 bulkWrite 成功但随后失败时不推进，重跑整页仍可通过 upsert/集合合并安全恢复。HTTP/解析失败最多重试 3 次，耗尽重试或写库失败后退出，保留已提交进度。

页号、分类 ID、页内条数、跨页重复与分类总数均进行核对；总数变化或跨页重复时报错，需 --fresh 重扫。处方药使用原始卡片 SID（包含被排除广告）核对分页，不将广告计为需要写入的商品。

叶子 ID/路径及顺序写入 checkpoint 的输入 hash，输入改变后须使用 --fresh；仅名称变化不影响续跑。全部完成后重复执行直接退出，须 --fresh 才会重新扫描。SIGINT/SIGTERM 等当前页写入和进度保存后停止；强制退出时，最多重新处理未确认保存进度的当前页。

仅支持单实例运行；连接读取进程 MONGODB_URI，缺失时使用本地 MongoDB，不自动加载 `.env`。首次运行前必须导出叶子文件。MAX_PAGES 可在 config.ts 配置，Infinity 表示全部。

## 补抓分类补全阶段新增的商品详情

```sh
pnpm crawl-details
```

默认通过 fetched_at 为 null（同时匹配字段缺失）选取尚未完成的商品，支持仅含 sid、name、category_ids 的增量记录，不要求 list_category_ids、price、images 或 isPrescription 预先存在。已完成商品默认跳过；失败商品不写完成标记，下次执行可重试。--refresh 用于明确重抓全部已有详情。

抓取详情后补齐官网名称、价格、图片、供应商、商品编号、信息 section、特征和关联商品。category_ids 在写库时原子合并官网 breadcrumbs、可选 list_category_ids 和数据库已有 category_ids，保留叶子分类补全的全部 ID；分类父子关系仍仅依据页面 breadcrumbs。成功日志输出实际写入的分类数组。

新商品如果由详情页面识别为处方药，会在原标记缺失时补写 isPrescription=true；已有标记不覆盖。处方药保留已有图片，图片缺失时写入 []，详情页不推测处方药图片。

所有详情字段与 fetched_at 同次写入；不更新翻译表或 Supabase。数量与重试参数继续由 src/commands/crawl-details/config.ts 管理。
