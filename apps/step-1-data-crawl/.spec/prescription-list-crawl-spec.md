# 处方药 SSR 列表 Bootstrap

## 1. 命令和配置

配置：`src/commands/bootstrap-prescription/config.ts`。沿用用户提供的 URL：

```text
https://www.chemistwarehouse.co.nz/v1/shop-online/261/prescriptions?page=
```

在仓库根目录或应用目录执行：

```sh
pnpm bootstrap-prescription
pnpm bootstrap-prescription --max-pages=1
pnpm bootstrap-prescription --fresh
```

- `page` 从 1 开始递增，与通用 bootstrap 的搜索 API offset 不同。
- `PAGE_SIZE = 24`。实际采样首屏为 24 条，总数 267，末页 12 为 3 条。这些数量是采样结果，不写死为停止条件。
- `MAX_PAGES = Infinity` 默认处理全部页，可在 config.ts 改为正整数；命令行 --max-pages 优先。
- `--fresh` 重置分页进度，不删除 MongoDB 商品。
- `--help` 不连接数据库。
- MONGODB_URI 默认 `mongodb://127.0.0.1:27017`，不自动加载 .env。
- 当前只编写脚本，尚未运行该命令、测试或数据库写入。

## 2. SSR 页面解析

`parse.ts` 仅解析 `#Left-Content .product-list-container a.product-container[href]`：

1. 验证最终响应 URL、`.Pager` 当前页、Results 总数、Last 和 Next 链接。
2. 从 `/buy/{sid}` 提取数字字符串，核对 data-analytics-sku。
3. 商品名优先读取链接 title，其次图片 alt，最后卡片名称；缺少完整名称时报错，避免写入被省略号截断的名称。
4. 大小写不敏感地排除名称包含 `EXCLUDED_NAME_KEYWORDS` 中关键词的商品，当前为 Blackmores。排除后不处理图片、价格或商品入库。
5. 当前价格只取卡片 `.prices .Price`，不取 Save / Why Pay 参考价；Free（忽略大小写）记录为 0，缺失为 null。
6. 图片只取该卡片 `.product-image img[src]`，排除 NoImage、erase 和空地址，不解析注释或 onerror，不猜测大图文件名，不下载图片文件。
7. 图片可能为源站实际提供的 `_150.jpg`；此列表阶段保留真实 URL，详情页不提供大图时不虚构替代地址。
8. 以过滤前的卡片数检查预期分页条数，以原始 sid 核对页内、页间重复；过滤后的商品才生成入库操作。

末页的 Next 实际指向自身，脚本使用 Results / PAGE_SIZE 计算末页并停止，不直接循环跟随 Next。

## 3. MongoDB 更新

仍使用 `cw_data.data_raw`，按 sid 匹配，建立 sid_unique 唯一索引。

```javascript
{
  sid: "130239",
  name: "商品的完整原名",
  price: 12.99,
  images: ["实际列表图片 URL"],
  isPrescription: true,
  list_category_ids: ["261"]
}
```

此处名称和价格为结构示例，不是固定写入值。

每个商品使用原子聚合更新管道 + upsert：

- sid 已有：仅当原 images 缺失、为 null 或空数组时补充图片，设置 isPrescription=true、合并列表分类 261；名称和价格仅在缺失或 null 时补齐。
- bootstrap 同时向商品 category_ids 有序去重补入数字 261，包含已经完成详情抓取的商品；这一步不更新 collection_raw，也不建立继承分类的父子关系。详情写入时原子合并最新 list_category_ids，避免并行执行覆盖分类补丁。
- sid 不存在：插入相同结构的列表基本资料。
- 列表图片按首次出现顺序去重，大小写不敏感地排除 NoImage 占位图。已有非空 images 原样保留，不合并或覆盖；原 images 为空且本次没有有效图片时保存 []，新商品同理。
- list_category_ids 按字符串数组有序合并，保留其他大分类。
- 不替换整份商品，不清空 info、supplier、category_ids、fetched_at 等已有详情。
- 不保存详情 URL、列表抓取时间，不写 collection_raw；分类关系仍由详情面包屑负责。
- isPrescription 表示本命令从处方药分类采集的标记，不由脚本从药名或成分推断。
- 排除的 Blackmores 广告不新增、不打补丁，也不会从数据库中删除通用 bootstrap 已发现的同名商品。

## 4. 详情命令字段保护

crawl-details 继续解析普通详情大图，但更新时使用 MongoDB 原子条件：

- 数据库中的 isPrescription 为 true：images 保留原值，避免处方药解析结果 [] 清空列表图片。
- 其他商品：按正常详情解析结果更新 images。
- isPrescription 不进入详情更新字段，不会被覆盖或删除。

使用数据库更新时的标记判断，不依赖之前读到的旧值；即使处方药补丁与详情更新交错执行，也会在设置标记后保护列表图片。其余字符串、对象和数组通过 $literal 保存，避免正文被当作 MongoDB 表达式。

## 5. 断点与失败恢复

进度文件：`storage/prescription-list-crawl-state.json`，与通用 bootstrap 的 list-crawl-state.json 分开。

- 保存配置 URL、分页大小、过滤关键词、nextPage、原始总数、末页、各页原始 sid、实际写入条数和完成状态。
- 原始 sid 包含广告，仅用于本地分页核对，不代表对应广告已写入商品表。
- 整页 MongoDB 写入确认后才推进 nextPage；部分写入失败重试整页，幂等 upsert 不产生重复商品。
- 默认恢复未完成扫描；上一轮已完成则从第 1 页开始新一轮。
- 更改 URL、PAGE_SIZE 或过滤关键词后需要 --fresh。
- 每页最多尝试 3 次，30 秒请求超时，重试退避；429 尊重 Retry-After。失败耗尽保存错误并停止，不跳页。
- 每页成功后等待 500ms。页数限制暂停时正常退出，进度保留。
- 完成时以过滤前原始 sid 总数和去重数核对服务端总数，另报告实际写入和跳过条数。
- 总数变化、重复或漏项时报错，可检查后 --fresh 重新扫描。SSR 默认排序不构成商品快照。
- 切换或清空数据库后需要 --fresh；仅运行一个该命令的采集进程。
