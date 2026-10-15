# Step 3：MongoDB → Supabase

## 配置

本应用 `.env` 必填：

```env
MONGODB_URI=mongodb://127.0.0.1:27017/cw_data
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
```

现有 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` 用于公开客户端读取，`SUPABASE_JWKS_URL` 用于用户 JWT 验证；这两个变量不参与迁移。迁移是本地可信脚本，不创建用户会话、不校验用户 JWT，也不需要 `SUPABASE_DB_URL`。不要提交 `.env` 或将 Secret Key 放进前端。

按项目 `.agents/skills/supabase-server` 的指导，使用 `@supabase/server/core` 的 `createAdminClient` 创建服务端 Supabase client，内部通过 supabase-js 调用 Data API。显式把 NEXT_PUBLIC_SUPABASE_URL 映射为 SDK 的 url，使用 SUPABASE_SECRET_KEY 进行管理写入。

所有非敏感配置集中在 [src/config.ts](src/config.ts)：环境变量名、MongoDB 数据库和源集合、目标 schema 和表、字段白名单及 SQL 类型、唯一键、语言、批量大小、数量限制和超时。

## 表结构 SQL

四张表已经创建，无需重新建表。此应用不直接连接 PostgreSQL，也不通过 RPC 执行任意 SQL。

```bash
pnpm generate-schema
```

命令只依据 config 生成 `sql/schema.sql`，不读取 `.env`、不连接数据库、不执行 SQL。Supabase Data API 不提供建表 DDL；如需在新项目初始化，可在 Supabase Dashboard SQL Editor 审阅并执行该文件。文件在同一事务内创建表、索引和 RLS；已有同名表时会失败并回滚，不用于修改现有表。

| 表                      | MongoDB 源集合            | 业务唯一键             |
| ----------------------- | ------------------------- | ---------------------- |
| products                | data_raw                  | sid                    |
| product_translations    | data_raw_translated       | sid + locale           |
| collections             | collection_raw            | collection_id          |
| collection_translations | collection_raw_translated | collection_id + locale |

所有表都有 `id bigint generated always as identity` 主键，不建立外键。业务关联使用 sid、collection_id、parent_id。名称都有 GIN trigram 索引，商品 category_ids 有 GIN 数组索引，两张分类表都有 `(parent_id, collection_id)` 索引。

## 独立迁移命令

以下命令可从本目录或项目根目录执行，每个命令只处理一张表：

```bash
pnpm migrate:collections
pnpm migrate:collection-translations
pnpm migrate:products
pnpm migrate:product-translations
```

商品与商品译文先比较目标，仅 upsert 新记录或发生变化的记录，内容完全一致时跳过。分类和分类译文继续批量 upsert。已存在记录保留自增 ID，更新白名单内的业务字段。

重复执行会从源表开头重新读取，不按目标最大 ID 截断，因此老商品的新分类和重新生成的译文也会同步。已经提交的批次不丢失，不存在跨表自动运行入口或本地断点文件；失败后重跑会跳过已经同步且未变化的商品/译文。自增序列在 upsert/回滚时可能出现间隙，属于正常行为。

默认迁移全部记录，数量限制可通过统一配置 LIMIT 或命令参数设置：

```bash
pnpm migrate:products --limit=100
pnpm migrate:products --limit=all
```

每批默认 100 条，通过 `supabase.from(table).upsert(batch, { onConflict, ignoreDuplicates: false, defaultToNull: false })` 提交一次 Data API 请求；请求超时由 REQUEST_TIMEOUT_MS 配置。已知数据库错误会使本批事务回滚，之前批次已提交；网络错误或超时可能发生在服务器已经提交之后，因此可重复执行 upsert 恢复。SIGINT/SIGTERM 停止读取新记录并提交当前有效批次。强制退出或连接中断后可重新执行命令，已提交数据按唯一键更新，不会重复创建业务记录。源表不会被修改。不发起 SQL 或 ANALYZE 请求。

没有外键，因此四个命令执行顺序不受数据库限制；业务展示前应完成全部四张表的迁移。脚本不删除目标中已经存在、但源表中不存在的记录。

## 商品与译文增量同步

```bash
pnpm migrate:products
pnpm migrate:product-translations
```

- `migrate:products` 扫描 data_raw，以 sid 匹配 products。将本地最新 category_ids 数字数组去重后写入目标，不与 Supabase 旧数组再做并集，避免已从本地移除的错误分类继续残留。其他白名单字段变化时也同步，目标不存在的商品插入完整记录。
- `migrate:product-translations` 扫描 data_raw_translated，以 `(sid, translation.lang)` 匹配目标 `(sid, locale)`，新增不存在的译文、更新变化的旧译文。不会复制分类、价格或图片，也不生成本地不存在的译文；之后有新译文时再次执行即可补入。
- 两张商品表的 `incremental` 开关位于 TABLES。目标查询按业务唯一键过滤，使用 LOOKUP_PAGE_SIZE 分页，避免多语言匹配结果超出单次 Data API 返回限制。
- JSONB 对象使用深比较，不因对象键顺序变化而重复写入；数组按顺序比较。MongoDB 内部 ID、抓取/翻译元数据和 filter 完成标记不参与比较。
- 日志包含 processed（累计扫描）、written、unchanged、new_records 和 changed_records。新增/变化数量按写入前快照分类；有其他管理任务并发写入时，实际 insert/update 比例可能变化，业务唯一键仍防止重复记录。
- `--limit` 限制候选读取数量，不是变化记录数量；全部分类更新应使用默认全部或 `--limit=all`。
- 新商品应先完成 crawl-details，译文应先完成翻译。缺少价格或字段格式不完整时报告业务 ID 并停止，不将缺失价格伪造为 0。

## 字段处理

- products 保留英文业务字段、price、images、supplier、product_id、related_sids；category_ids 数组保留顺序并去重；不重复保存 list_category_ids。
- isPrescription 映射成 is_prescription，原字段缺失时为 false。
- product_translations 仅保存 sid、locale、name、additional_info、info、feature_attributes、key_features。
- 译文 info 仅保存各 section 的 title/html；原文 info 另保留 source_hidden。HTML 和 class 不改写。
- feature_attributes 保持 `{label,value}[]`，value 保留字符串或字符串数组类型。
- collection_translations 的 parent_id 读取自 collection_raw，根分类为 null。
- 译文必须为 completed 状态；locale 直接读取各条源记录的 translation.lang，保留原语言值，不固定为中文。缺失或空语言值会报错。
- 不迁移 MongoDB _id、fetched_at、translation 元数据；未知字段不进入白名单。
- 价格必须是非负有限数且最多两位小数，不静默舍入；字段不符合约定时报告业务 ID 并停止。
- related_sids 保持 ID 数组，不要求关联商品都已采集。

## 公开只读权限

所有表启用 RLS，仅为 anon/authenticated 建立 `SELECT USING (true)` 策略，并显式撤销写入和自增序列权限。迁移使用 Secret Key 创建的 Admin Client 执行管理写入并绕过 RLS；不要在前端暴露 Secret Key。

客户端查询示例：

```ts
// supabase 是已配置的 Supabase client；公开读取使用 Publishable Key。
const original = await supabase
  .from("products")
  .select("sid,name,price")
  .ilike("name", "%Blackmores%");
const translated = await supabase
  .from("product_translations")
  .select("sid,name")
  .eq("locale", "zh")
  .ilike("name", "%生物素%");
const products = await supabase
  .from("products")
  .select("sid,name,price")
  .contains("category_ids", [256]);
```

一两个字符的关键词可能无法有效利用 trigram 索引。各表之间没有外键，关联由业务按 sid/collection_id 查询合并，不依赖 Data API 的外键嵌套查询。

参考：[Supabase upsert](https://supabase.com/docs/reference/javascript/upsert)、[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)、项目 `.agents/skills/supabase-server/SKILL.md` 及安装包 `@supabase/server/docs/core-primitives.md`。
