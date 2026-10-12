# 商品列表基准数据采集与落库设计

本步骤作为项目数据的 bootstrap，从 `src/const/crawl_sites.ts` 的大分类发现商品，生成后续详情采集的商品集合。只请求列表 API，不请求商品详情，不创建详情完成记录。

代码独立位于 `src/commands/bootstrap/`，通过 `pnpm bootstrap` 执行（仓库根目录和应用目录均可）。入口 `index.ts` 负责参数与 MongoDB 连接，`api.ts` 负责请求构造和解析，`crawl.ts` 负责分页、批量写入与断点恢复。

数据存储已确定为本地 MongoDB 的 `cw_data.data_raw` collection。每个商品一份文档，不创建独立分类表或分页 collection。分页进度保存到本地 storage 文件。

## 1. 接口验证结果

已实际请求 Health 分类 `256` 的首屏、第二页和末页：

| fh_start_index | 返回商品数 | total-items | start-index |
| -------------- | ---------- | ----------- | ----------- |
| 0              | 48         | 3417        | 0           |
| 48             | 48         | 3417        | 48          |
| 3408           | 9          | 3417        | 3408        |

因此本次样本的 Health 共 72 页，偏移为 `0, 48, …, 3408`。数量会变化，不使用配置文件注释中的数量控制分页。

首屏 48 条记录的 `item.id`、`secondid` 和 `producturl` 中的 sid 均一致。抽查首屏和第二页没有重复 sid；这不代表全量分页一定无重复。

接口存在两种实际返回形式：

- 原始响应是 JSON 对象文本，一次 JSON.parse 后得到对象。
- 原始响应是经过 JSON 编码的字符串，一次 JSON.parse 后仍为字符串，再解析一次才得到对象。

首屏响应 Content-Type 为 `text/plain; charset=utf-8`。不能只因 Content-Type 不是 application/json 就拒绝解析；也不能假定一次 response.json() 就得到对象。最多解析两层，之后必须验证结构，不无限循环解码。

## 2. 请求构造与返回路径

从配置 URL `/shop-online/{categoryId}/...` 提取分类 ID，不新增一套手写分类编号映射。

```text
GET https://www.chemistwarehouse.co.nz/searchapiv2/search

identifier=nz
fh_location=//catalog01/en_AU/categories<{catalog01_chemnz}/categories<{chemnz{categoryId}}
fh_start_index={offset}
fh_sort=packageid
```

上面的 `chemnz{categoryId}` 表示字符串拼接。例如分类 256 对应实际参数：

```text
//catalog01/en_AU/categories<{catalog01_chemnz}/categories<{chemnz256}
```

使用 URL 参数编码一次，不手动重复编码 `%3C`。实际实现必须核对响应中的 start-index 和分类范围，避免请求参数被忽略后反复存入首屏。

```ts
const universe = response.universes.universe[0];
const section = universe["items-section"];
const items = section.items.item;
const results = section.results;
```

分页元信息：

- `results["total-items"]`：分类结果总数。
- `results["view-size"]`：服务端分页大小，本次为 48。
- `results["start-index"]`：实际返回页的起点。

不把 `view-set-size` 或 `current-set` 当作总页数。

## 3. 商品属性解析

单个商品的 `attribute` 是以 name 标识字段的数组。先转换为按 name 查询的映射，不按数组下标取值。

```text
attribute[name="producturl"].value[0].value
```

优先使用 `value` 中的可读值，不使用 `non-ml` 作为名称。例如名称的 non-ml 可能是编码后的索引值。

需处理缺少 attribute、isnull=true、空 value 数组等情况。多值属性不能无条件压为一个值；本步骤需要的单值字段若返回不同的多个值，应作为异常报告。

## 4. MongoDB 文档结构

固定数据库 `cw_data`，collection `data_raw`。默认连接 `mongodb://127.0.0.1:27017`，可通过 MONGODB_URI 环境变量指定连接地址。

| 字段                | 类型           | 规则                                                                |
| ------------------- | -------------- | ------------------------------------------------------------------- |
| `_id`               | ObjectId       | MongoDB 自动生成。                                                  |
| `sid`               | string         | item.id，与 secondid、producturl 的 sid 核对；唯一索引 sid_unique。 |
| `name`              | string 或 null | name，规范化空白。                                                  |
| `price`             | number 或 null | price_cw_nz，当前 NZD 金额；不存参考价，不做金额计算。              |
| `list_category_ids` | string[]       | 商品命中的配置大分类 ID，跨分类合并去重。                           |

bootstrap 的业务字段仅为 `sid`、`name`、`price`、`list_category_ids`（另有 MongoDB 自动生成的 `_id`）。不记录完整详情 URL 或列表抓取时间。详情阶段根据 sid 构造请求地址，其 fetched_at 仍按商品详情规范记录。

建立 `{ sid: 1 }` 唯一索引；若已有重复 sid 导致失败，程序停止，不删除原有文档。

接口 producturl 仅用于核对 sid，不写入 MongoDB。详情结果仍遵循 `product-detail-data-spec.md`。

校验：

- sid 为非空数字字符串，不转为数值。
- producturl 为 Chemist Warehouse NZ 的 HTTPS 商品链接，路径 `/buy/{sid}/...` 中的编号与记录一致，不允许其他域名、凭据或自定义端口。
- 不保存 producturl 或 item.link，也不从名称生成 slug。
- 缺少合法 URL、ID 冲突或非法非空价格使整页失败，不跳过商品后宣称整页成功。
- 名称、价格缺失时首次插入 null；重复采集缺失值不覆盖已有有效值。合法的零价格不视为缺失。
- 不保存缩略图、参考价、评分、票数、促销图标、处方标记、source 或 barcode。大图在详情阶段采集。

## 5. 分类关联

用 `$addToSet: { list_category_ids: categoryId }` 合并当前请求的分类编号。跨分类命中同一个 sid 时更新同一份文档。

list_category_ids 是大分类发现关系，不等于详情页完整面包屑 category_ids；本阶段不写入或覆盖 category_ids，也不保存接口 l1_category、l2_category、l3_category。详情阶段从商品页面面包屑取得分类，并与 list_category_ids 合并为数字 category_ids；名称单独写入 collection_raw。

## 6. 分页和批量写入

按每页 48 条递增偏移；读取接口 total-items，而不是配置注释。服务端 view-size 若不为 48，停止该页并报告，不按错误步长继续。

每页依次进行：

1. 请求并检查状态，最多解码两层 JSON。
2. 校验响应分类、start-index、view-size、排序和本页预期条数。
3. 完成整页商品校验。
4. bulkWrite 批量执行 updateOne + upsert，以 sid 匹配；$set 更新有效列表资料，$setOnInsert 补首次插入的默认值，$addToSet 合并分类。
5. 所有写入确认成功后保存完成页 checkpoint，再推进下一页。

不执行 replaceOne，不清空已有 info、supplier、product_id 等详情字段。有效列表 name/price 会更新对应顶层字段；缺失值不覆盖已有值。

本地 MongoDB 可以是 standalone，因此不依赖多文档事务。单份文档更新是原子的，bulkWrite 整页不是事务。部分商品写入后失败时，整页不标完成，重试整页，由唯一索引和幂等 upsert 防止重复商品。MongoDB 和本地 checkpoint 不属于同一个事务。

请求单并发，成功分页间等待 250ms；每页最多尝试三次，递增退避，429 尊重 Retry-After，单次请求超时 30 秒。重试耗尽后保存分类错误，其他分类继续。无限制运行存在未完成分类时以非零退出码结束。

计划范围内的空页、错配或错误结构均不可当成分类完成。主动作 --max-pages 限页时保留进度，正常退出供检查数据。

## 7. 本地断点文件

`storage/list-crawl-state.json` 记录 run_id、开始时间、排序，以及每个分类的总数、已完成页、页内 sid、采集时间、完成状态和错误原因。storage 已被 Git 忽略，不在 data_raw 中插入分页任务文档。

- 临时文件写入后 rename，减少写一半导致进度损坏的风险。
- 默认恢复未完成扫描；上一次已全部完成时启动新扫描。
- --fresh 从头扫描，仅重置本地进度，不删除 MongoDB 商品。
- 配置分类改变、切换或清空数据库后，应 --fresh；checkpoint 不推断数据库是否被外部清空。
- 仅运行一个采集进程，避免同时覆盖 checkpoint。
- 长时间中断可能使分页结果变化；断点恢复不等于快照恢复，需要一致性时应重新扫描。

## 8. 排序和完整性

已实际验证 `fh_sort=packageid`，服务端返回 sort-attribute=packageid、sort-direction=asc；实现采用该排序，每页验证服务端未忽略参数。此前探查 secondid 未得到有效排序信息，不能采用。

packageid 排序比默认转化率策略适合扫描，但仍不是快照，商品增删可能影响 offset。

每个分类结束检查：所有页报告的 total-items 一致；原始条数和 sid 去重条数都等于该分类 total-items。任一失败不标完成，需要调查或 --fresh 复扫。全局去重防止重复入库，不能弥补漏项。

全局基准数量为五个配置分类的 sid 并集，不能用各分类总数直接相加。尚未证明五个分类覆盖网站每一个商品。

新扫描不自动删除历史商品或历史分类命中，也不据此标记下架；list_category_ids 是累计发现关系，不是某一轮分类快照。

## 9. 文档示例

```javascript
{
  sid: "95534",
  name: "Sanderson Fish Oil 3,000mg 540mg EPA/360mg DHA 150 Capsules",
  price: 37.99,
  list_category_ids: ["256"]
}
```

后续详情爬虫读取 sid 并构造商品详情请求地址，每个 sid 只处理一次。列表采集不创建空白详情 info，也不标记详情完成。
