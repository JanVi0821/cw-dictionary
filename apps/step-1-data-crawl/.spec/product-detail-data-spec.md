# 商品详情数据规范

适用项目：Chemist Warehouse New Zealand 商品翻译及展示工具。

本文定义 `apps/step-1-data-crawl` 的商品详情采集结果，不沿用 Grocer Dictionary 的表结构。本文是数据契约。详情采集实现与运行规则见 `product-detail-crawl-spec.md`。

样本页面：`https://www.chemistwarehouse.co.nz/buy/43194/blackmores-mega-b-complex-75-tablets`。

## 1. 数据范围与原则

- 详情正文以商品页返回的原始 HTML 为依据。分类列表页和商品详情页的渲染方式不同，不据此推断整个站点均为服务端渲染。
- 商品唯一标识为 URL `/buy/{sid}/...` 中的 `sid`。本例为 `43194`。
- 页面显示的 `Product ID` 另存。本例为 `2581984`，不能与 `sid` 混用。
- sid、product_id、related_sids 使用字符串；category_ids 与 collection_raw.collection_id 使用数字。bootstrap 的 list_category_ids 保持字符串数组，继承时转换为数字。数组去重保留首次出现的位置。
- 字符串元数据去除首尾空白、合并连续空白，并解码 HTML 实体。富文本保留段落和换行结构。
- 不记录 `source`、`barcode`、分类 path、canonical URL、内容 hash、参考价或折扣。
- 不采集库存、评论、评分、购物车状态、页面模板状态和会话信息。
- General Information 始终完整保留。提取 KV 和 KEY FEATURES 是增加商品属性，不能删除或改写详情中的原文。

## 2. 商品对象

| 字段                 | 类型                                             | 规则                                                                                           |
| -------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `sid`                | `string`                                         | 必填；URL 中的 CW 商品唯一编号。                                                               |
| `name`               | `string`                                         | 必填；主商品名称。                                                                             |
| `category_ids`       | `number[]`                                       | 面包屑分类与 list_category_ids 的并集，不包含 Home，不保存分类名称或 path。                    |
| `images`             | `string[]`                                       | 商品大图 URL 数组，排除 NoImage 占位图。                                                       |
| `supplier`           | `string \| null`                                 | 去掉 `Supplier:` 前缀；不推断品牌。                                                            |
| `product_id`         | `string \| null`                                 | 去掉 `Product ID:` 前缀后的编号。                                                              |
| `additional_info`    | `string[]`                                       | `.product-id.product-information` 中除 Product ID 外的非空信息，保留标签，例如 `TAPS: 10594`。 |
| `info`               | `Record<string, InfoBlock>`                      | 按 section 保存的富文本对象，包含未被 section 包裹的内容兜底字段。                             |
| `feature_attributes` | `{ label: string; value: string \| string[] }[]` | 从 General Information 提取的 KV；按标签出现顺序保存。重复标签具有不同值时 value 使用数组。    |
| `key_features`       | `string[]`                                       | 从 General Information 的 KEY FEATURES 区域提取的 bullet point 内容。                          |
| `price`              | `number \| null`                                 | 主商品当前 NZD 价格，不记录参考价。                                                            |
| `related_sids`       | `string[]`                                       | `.product-list-container` 内关联商品链接中的 sid。                                             |
| `fetched_at`         | `string`                                         | 成功取得并解析当前商品 HTML 的时间，使用 UTC ISO 8601，例如 `2026-10-11T00:00:00.000Z`。       |

`InfoBlock` 的结构为：

```ts
type InfoBlock = {
  title: string | null;
  html: string;
  source_hidden: boolean | null;
};
```

实际 section 使用原始标题和隐藏标记。兜底块 `unsectioned` 的 `title`、`source_hidden` 为 `null`，因为其中可能合并多个独立片段。

缺失值：普通可空字段为 `null`；集合为空时为 `[]` 或 `{}`；`info` 中无有效内容的字段直接省略，不写入空块。

缺少合法 `sid` 或非空主商品名称时，不生成正常商品记录，应进入采集错误处理流程。可选字段解析失败不能伪造默认值，例如不能把缺失价格写成 `0`。

## 3. 基础字段提取

### 3.1 sid 与 Product ID

- 从最终商品页面 URL 的 `/buy/{sid}/` 提取 `sid`。
- `input#skuId[value]` 可用于核对，不额外记录。若与 URL 不一致，应报告冲突，不能静默覆盖。
- 在 `.product-id.product-information` 中根据 `Product ID:` 标签识别 `product_id`，不依赖节点位置。
- 剩余节点的非空文本放入 `additional_info`。空节点不记录，也不根据“第二个节点”推断其含义。
- 页面全局脚本、评论组件中的编号只用于辅助核对，不新增商品 ID 字段。

### 3.2 category_ids

面包屑只处理 `.breadcrumbs a`，从其链接 `/shop-online/{id}/...` 中提取分类 ID 及名称。商品只保存 ID，名称单独 upsert 到 `cw_data.collection_raw`（collection_id、name、parent_id），collection_id 建唯一索引。parent_id 按原始面包屑链写入，根分类为 null，不能把额外 list_category_ids 接到链尾。

- `/` 对应的 Home 不记录。
- 保持面包屑从父级到子级的顺序，再追加 bootstrap `list_category_ids` 中尚未出现的分类；先统一为数字再去重。
- list_category_ids 仅用于商品入库时补充 category_ids，不参与 collection_raw 的名称、父级、缓存或写入处理。
- 无法提取分类 ID 的链接跳过。
- 品牌分类属于原站面包屑的一部分，保留其 ID，不推断为独立的通用品类。
- 不使用其他区域的分类菜单、推荐区域或全局 `categoryid` 变量替代面包屑。

本例面包屑结果（若列表还命中其他大分类，继续追加）：

```json
[256, 81, 513, 1474]
```

### 3.3 images

优先在主商品图片画廊内读取 `a.image_enlarger[href]`，使用 HTML 已提供的大图地址。不要扫描整个页面的图片。

- `images` 仅存大图地址，不额外记录缩略图或中等尺寸图。
- 排除文件名包含 `NoImage` 的占位图，不区分大小写。
- 将相对 URL 转为绝对 URL，去除空值并按顺序去重。
- 不把 `onerror` 中的占位图地址当作商品图。
- 不通过将 `_50` 改成 `_800` 猜测地址。找不到实际大图链接时不生成猜测值。
- 不因图片暂时不可访问而自动替换为页面模板中的 NoImage。
- 保持画廊顺序，不根据运行时的 `selected_image` 状态推断封面图。

本例大图为 `ADD4_800.jpg`、`2DF_800.jpg`、`ADD3_800.jpg`；`.sub_images img[src]` 的 `_50.jpg` 为缩略图，`img.hero_image[src2]` 的 `_200.jpg` 为中等尺寸图。

### 3.4 name 与 supplier

- 普通商品名读取主商品 `.product-name h1`；处方药读取 `.prescription-pdp h1.prescription-pdp-details__name`，避免误取隐藏旧模板或关联商品。
- 供应商读取 `.manufacturer-name.product-information`，去掉开头的 `Supplier:` 和紧随空白。
- 供应商字段仍命名为 `supplier`；不拆分城市，不推断品牌。

## 4. info 富文本对象

只处理主商品的 `.product-info-container`，不合并全站警示、药师提示模板、评论或推荐商品内容。不额外记录整个 `details_html`。

### 4.1 section 字段映射

以 `section.product-info-section` 的语义 class 生成字段名，忽略 `product-info-section`、`hidden` 等展示 class，连字符转换为下划线。

| 来源 class     | `info` 中的字段 |
| -------------- | --------------- |
| `description`  | `description`   |
| `general-info` | `general_info`  |
| `warnings`     | `warnings`      |
| `commonuses`   | `commonuses`    |
| `ingredients`  | `ingredients`   |
| `directions`   | `directions`    |
| `indications`  | `indications`   |

未来出现的其他实际 section 按同样规则保留；不得只允许上述固定字段而丢弃新内容。无可识别语义 class 的 section 使用稳定的顺序字段名 `section_1`、`section_2` 等，避免键冲突。

每个 section：

1. 检查其中 `.details[itemprop="description"]` 是否有有效内容。
2. 没有有效内容则整个 section 不记录，无论其是否隐藏。
3. 有有效内容时，`html` 保存 section 本身及其内部完整 HTML，保留标题、class、必要属性、段落、换行及列表结构。
4. `title` 保存 section 中的标题文本，缺失时为 `null`。
5. `source_hidden` 标记来源 HTML 中明确的隐藏状态。有 `hidden` class、HTML `hidden` 属性或明确的内联 `display:none` / `visibility:hidden` 时为 `true`；检查 section 及其在详情容器内的祖先。无明确标记时为 `false`，不代表已计算全部外部 CSS。

`source_hidden` 仅保留来源状态，不用于过滤有内容的 section，也不代表新的前端必须隐藏该内容。前端展示和 class 样式后续处理。

若多个有效 section 映射到同一字段，按来源顺序拼接它们的完整 HTML，不覆盖丢失；标题取首个非空标题，只有所有合并 section 均明确隐藏时 `source_hidden` 才为 `true`。

### 4.2 有效内容判断

- HTML 注释始终忽略，不解析其中的 section，也不将注释内容纳入兜底。
- 空白、`&nbsp;`、仅有 `<br>`、空段落或空容器均不构成有效内容。
- 有非空正文文本即为有效；图片等实际内容节点具有非空资源地址且不是占位图时也可视为有效。
- section 标题本身不能使空 `.details` 变成有效内容。
- 不将 script、style 或纯布局占位节点视为商品内容。

本例仅保存 `general_info`、`warnings`、`ingredients`、`directions`。空的 `description`、`commonuses`、`indications` 不记录；注释中的 `miscellaneous`、`druginteractions` 不记录、不处理。

### 4.3 无 section 内容的兜底

详情容器中不在任何 section 内的有效 HTML 片段，按文档顺序合并到 `info.unsectioned.html`，不与已保存的 section 内容重复。

- 通过 DOM 结构识别内容归属，不能用正则删除 section 后直接拼接破损 HTML。
- 混合包装节点同时包含 section 和独立正文时，应保留独立正文必要的包装结构，不重复嵌入 section。
- 仅有标题但 `.details` 为空的 section 不通过兜底重新写入。
- 无 section 的整个详情正文也适用这条规则。
- 空白、注释、脚本、样式和纯布局占位不记录，例如本例 `clear:both; height:10px` 的空白 div。
- 没有有效兜底内容时，省略 `unsectioned` 字段。

## 5. General Information 的商品特征

`feature_attributes` 和 `key_features` 只从有效的 General Information section 中提取，不从 Warnings、Ingredients、Directions 或推荐区提取。

这两类属性用于列表 tag 等展示。**提取过程不改变 `info.general_info.html`；富文本中的 KV、KEY FEATURES 标题和 bullet point 全部原样保留。**

### 5.1 feature_attributes：KV

按原始段落、列表项或 `<br>` 分隔的逻辑行处理 `标签: 值`，支持半角 `:` 和全角 `：`。

- 只识别完整的独立 KV 行，不从正文段落中任意切出含冒号的片段。
- 按第一个分隔冒号拆分，标签和值都必须非空。
- 标签和值保留原始语言及大小写，规范化空白；值中后续冒号保留。
- 以 `•` 开始的行属于 bullet point，不作为 KV。
- KEY FEATURES 标题、普通叙述和 URL 不作为 KV。
- 同一键值重复出现时去重；相同键具有不同值时使用字符串数组，保持出现顺序，避免覆盖。
- 不从名称猜测规格，不从其他 section 补充 KV，不在采集阶段解释医学含义。

本例：

```json
[{ "label": "Size", "value": "75 Tablets" }]
```

### 5.2 key_features：bullet point 数组

- 在 General Information 中定位独立的 `KEY FEATURES` 标题，忽略大小写和首尾空白。
- 仅提取该标题之后、下一独立标题或该 section 结束之前，以 `•` 开始的 bullet point。
- 保留逻辑换行和段落边界识别 bullet point，不将整个 section 压成一行后匹配。
- 只移除开头的 `•` 及空白，保留条目文字和内部标点；一个 bullet 内部的续行归入同一条。
- 不识别其他 bullet 符号，不把普通句子或 KV 当作 KEY FEATURES。
- 没有 KEY FEATURES 标题或没有符合条件的 bullet point 时返回空数组，不进行语义推断。
- 非空条目按来源顺序去重。

本例：

```json
[
  "Supports daily cellular energy production",
  "Assists in times of strenuous physical activity",
  "Supports a healthy function of the nervous system",
  "Helps convert food to energy"
]
```

## 6. price 与 related_sids

### 6.1 price

- 在主商品 `[itemprop="offers"]` 区域读取 `[itemprop="price"] .product__price`，不能取页面第一个金额。
- 解析为数值，例如 `18.99`；没有合法金额时为 `null`，不填 `0`。
- 本项目价格固定解释为 NZD，不新增币种字段。可使用页面 `priceCurrency` 核对，币种异常时报告错误，不自动换算。
- 不记录 `.retailPrice` 的 Why Pay 参考价、折扣或推荐商品价格。
- 不从隐藏模板中选择价格，也不求多个价格的最小值；遇到无法判定的多价格情况应报告异常。

### 6.2 related_sids

- 普通推荐限定在 `.product-list-container` 内查找商品链接；处方药额外读取 `.alternative-drug .alternative-drug-item__title a[href]` 的 Alternative Product(s) 链接。
- 由 `/buy/{sid}/...` 提取关联商品 sid；不采集其他区域的商品编号。
- 保持首次出现顺序，去重，排除当前商品自己的 sid。
- 不保存推荐商品名称、图片、价格或站内 Product ID。
- 没有关联商品时返回 `[]`；隐藏字段 `.PageGroupSKUs` 不作为全页补充来源。
- 推荐区结果可能随请求变化，不将样本中的某个关联商品顺序写死。

## 7. 对象结构示例

以下为说明结构的缩略示例：`html` 内的省略标记仅用于文档，真实数据必须保留完整 section。`related_sids` 为空仅表示允许无关联商品，不表示本样本没有推荐商品。价格为采样时的示例值，不能作为固定值。

```json
{
  "sid": "43194",
  "name": "Blackmores Mega B Complex 75 Tablets",
  "category_ids": [256, 81, 513, 1474],
  "images": [
    "https://static.chemistwarehouse.co.nz/ams/media/pi/43194/ADD4_800.jpg",
    "https://static.chemistwarehouse.co.nz/ams/media/pi/43194/2DF_800.jpg",
    "https://static.chemistwarehouse.co.nz/ams/media/pi/43194/ADD3_800.jpg"
  ],
  "supplier": "Blackmores NZ, Auckland",
  "product_id": "2581984",
  "additional_info": [],
  "info": {
    "general_info": {
      "title": "General Information",
      "html": "<section class=\"product-info-section general-info\"><h2>General Information</h2><div class=\"details\" itemprop=\"description\">……完整正文、Size 和 KEY FEATURES 均保留……</div></section>",
      "source_hidden": false
    },
    "warnings": {
      "title": "Warnings",
      "html": "<section class=\"product-info-section warnings\"><h2>Warnings</h2><div class=\"details\" itemprop=\"description\">……完整警示原文……</div></section>",
      "source_hidden": false
    },
    "ingredients": {
      "title": "Ingredients",
      "html": "<section class=\"product-info-section ingredients\"><h2>Ingredients</h2><div class=\"details\" itemprop=\"description\">……完整成分原文……</div></section>",
      "source_hidden": false
    },
    "directions": {
      "title": "Directions",
      "html": "<section class=\"product-info-section directions\"><h2>Directions</h2><div class=\"details\" itemprop=\"description\">……完整用法及储存说明……</div></section>",
      "source_hidden": false
    }
  },
  "feature_attributes": [{ "label": "Size", "value": "75 Tablets" }],
  "key_features": [
    "Supports daily cellular energy production",
    "Assists in times of strenuous physical activity",
    "Supports a healthy function of the nervous system",
    "Helps convert food to energy"
  ],
  "price": 18.99,
  "related_sids": [],
  "fetched_at": "2026-10-11T00:00:00.000Z"
}
```

## 8. 实现核对清单

- 两种商品 ID 分开保存，sid 为唯一映射键。
- 分类只存 ID，Home 被排除。
- 主商品和关联商品的名称、图片、价格提取范围不混淆。
- 大图地址来自真实链接，NoImage 被排除。
- section 是否保留取决于 `.details` 的有效内容，不取决于是否隐藏。
- HTML 注释不解析；空 section 不通过兜底回流。
- 有效的非 section 内容按顺序保留在单一 `unsectioned` 字段。
- 完整详情只存于 `info`，没有重复的 `details_html`。
- KV 和 KEY FEATURES 是独立属性，提取前后 General Information 富文本保持完整。
- 不把成分原文中的重复内容自行删改，也不合并、改写原始医学描述。
- 不保存 Why Pay、库存模板或评论挂载节点为商品属性。
- 关联商品只来自 `.product-list-container`，处方药另允许明确的 Alternative Product(s) 标题链接，不扫描整页链接。
- 所有采集结果包含 `fetched_at`。

## 9. 处方药布局兼容

处方药列表 bootstrap 额外保存 `isPrescription: true` 和实际列表图片。parseDetail 本身不抓取处方药图片、返回 images=[]；crawl-details 入库时按数据库中的 isPrescription 标记保留原 images，不覆盖该标记。普通商品仍按详情大图规则处理。SSR 列表命令见 `prescription-list-crawl-spec.md`。

样本：`/buy/140137/vigisom-2mg-prolonged-release-tablets-270-9-x-30-melatonin`。页面存在可见的 `.prescription-pdp` 和隐藏的旧模板；旧模板名称是 div，不是普通商品的 h1。

识别到 `.prescription-pdp` 时，沿用原商品对象结构：

| 字段            | 处方药处理                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| name            | `.prescription-pdp-details__name` 的 h1                                                                     |
| images          | 固定为空数组，不读取隐藏画廊或图标                                                                          |
| supplier        | 可用时从旧模板 `.manufacturer-name.product-information` 补充，缺失为 null                                   |
| product_id      | 读取可见 `.prescription-pdp-details__additional-info > span` 的 Product ID，并与旧模板编号核对              |
| additional_info | 可见元数据中的其他非空文本，例如 `Active Ingredient Name: Melatonin 2mg`，保留标签并去重                    |
| price           | `.prescription-pdp-details__price` 第一个 span 的金额，第二个 span 核对 NZD；不使用隐藏旧价格或替代商品价格 |
| related_sids    | 原推荐区加 Alternative Product(s) 标题链接，按文档顺序去重并排除自身                                        |

处方说明沿用 InfoBlock 对象，不新增顶层药品字段：

- Prescription Information 为商品共用声明，不采集或存储；其中嵌套的 Use 仍独立提取。
- `info.use`：独立保存 `.prescription-pdp-section__usage` 的完整 HTML、Use 标题及来源隐藏状态；只有实际正文有效时记录。
- IMPORTANT NOTE 为商品共用处方配送说明，不采集或存储。
- 其他有效旧模板 section 继续按原规则保留。旧 description 只有在正文与已保存的可见 Use 完全相同时去重；不同文本仍保留，不因 hidden 丢弃。
- 仅有标题、空正文的块不记录，source_hidden 沿用明确 HTML 标记判断。
- KV 和 KEY FEATURES 仍只从 General Information 提取，不从 Use 或处方警示推断。

本样本 HTML 对应 product_id 为 `5009417`，分类为 `[261]`，当前采样价格为 `92.99`。Alternative Product(s) 的 sid 为 `130239`、`141870`、`141871`、`141872`、`141873`；这些均是采样结果，不写死在代码中。

分类解析和缓存仍只使用实际面包屑返回的 collections；list_category_ids 仅在商品入库前作为 category_ids 的兜底合并。
