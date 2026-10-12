# 商品数据 Bootstrap

处方药 SSR 列表使用独立命令 `pnpm bootstrap-prescription`，配置在 `src/commands/bootstrap-prescription/config.ts`。支持 `--max-pages=1` 限页及 `--fresh` 重扫，默认断点续跑。名称包含 Blackmores 的广告商品会被排除，其余商品按 sid 仅在原 `images` 缺失、为 null 或空数组时补充有效图片，并补充 `isPrescription: true`。NoImage 占位图不会采集。详情采集会保留这些商品的图片及标记。详见 [处方药列表规范](.spec/prescription-list-crawl-spec.md)。

读取 `src/const/crawl_sites.ts` 中的五个大分类，分页请求列表 API，写入本地 MongoDB 的 `cw_data.data_raw`。不请求商品详情页。

## 运行

需要 Node.js 24+、项目依赖和本地 MongoDB。默认连接 `mongodb://127.0.0.1:27017`。

采集逻辑独立放在 `src/commands/bootstrap/`：`index.ts` 为命令入口，`api.ts` 解析接口，`crawl.ts` 负责分页、写库和断点恢复。

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

独立命令 `pnpm crawl-details`，数量由 [config.ts](src/commands/crawl-details/config.ts) 的 `LIMIT` 控制，当前最多尝试 1000 个商品。默认跳过已有 `fetched_at` 的商品；`--refresh` 可刷新已有详情，仍受 LIMIT 限制。

每个商品先 upsert `cw_data.collection_raw`（`collection_id` 唯一、`name` 为名称、`parent_id` 为父分类，根分类为 null），再更新 `cw_data.data_raw` 的详情和完成时间。商品 `category_ids` 为数字数组，包含面包屑分类及继承的 `list_category_ids`。

详见 [详情采集命令规范](.spec/product-detail-crawl-spec.md)。采集数量以 config.ts 的实际 LIMIT 为准。

分类关系只使用 parseDetail.collections，通过内存 Set 去重：启动读取命令目录的 `breadcrumb-paths.json`，命中原始面包屑 ID 链后跳过分类表处理。每处理 100 个商品保存一次，任务结束也保存尾批。list_category_ids 仅在商品入库前合并到商品 category_ids，不参与分类缓存或 collection_raw 写入。缓存不负责商品完成状态；需要刷新分类名称或父级时，可删除该文件。
