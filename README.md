# infoverify
* 交叉验证（多来源，多引用、跨域相证）
  * 基石知识库（如物理、数学等现代科学文章理论，例子如通信原理）
  * 进阶的应用还有鉴定某项信息时通过参考不同语言的版本来提高可靠性等等，另外使用信息进行验证前注意该信息的传递质量或者直接使用以前已被验证的信息（积累的）
  * 二次事件 / 事不过三 - 交叉验证的变体，比如某个事件或问题出现一次可能是偶然或意外，但是当出现两次时就很可能不是偶然问题了必须严肃对待，通常用于工程系统的检测研判；注意该思想更偏向于交叉验证而不是可重复性因为可重复性强调高频高概率而交叉验证强调非单一验证
* 可再现性、可重复性、较高概率重现
  * 过往一致性
  * 经时间验证
* 详细内容或数据证明（多细节、多证据、多量化）
  * 为 DIKW 框架里的 DI 以及定理 K
  * 5W1H 分析法
  * 贝叶斯公式，比如基于的细节、证据本身是否信息熵低、精确、概率低
  * 数据、信息核查方法
    * 奇怪的数据，比如特别整的违反常识的数据
    * 数据对不上，比如总数据不等于子数据之和
    * 数据与结论的相关性（即应该有且只有真实有效数据，并且应有数据齐全不缺失）

提供链接，爬文章数据来推理并开一个新 tab（结论链接）来给出答案，移动客户端则可以使用分享给系统的客户端，然后客户端会有记录（包含原文与结论）。  

## 运行
`docker-compose up -d`  

## 停止
`docker-compose down`

## 迁移
最小表结构脚本：
`internal/dal/postgres/migrations/20260310_0900_create_articles_reports.sql`

当前完整表结构：
`internal/dal/postgres/schema.sql`

生成/更新 schema 文件（需安装 `pg_dump`）：
```bash
./scripts/gen_schema.sh
```

快速应用（本地默认配置）：
```bash
psql "postgres://postgres:postgres@localhost:5432/infoverify?sslmode=disable" -f internal/dal/postgres/migrations/20260310_0900_create_articles_reports.sql
```

## 数据库
默认使用 Postgres（`DATABASE_URL` 可覆盖）：
`postgres://postgres:postgres@localhost:5432/infoverify?sslmode=disable`

## API
提交 URL 进入爬取队列：
```bash
curl -X POST http://localhost:8080/api/basic/check \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/article"}'
```

直接提交文章内容进入索引：
```bash
curl -X POST http://localhost:8080/api/basic/check \
  -H "Content-Type: application/json" \
  -d '{"article":{"title":"t","author":"a","content":"c"}}'
```

获取已索引内容：
```bash
curl "http://localhost:8080/api/basic/get?id=<article_id>"
```

## Milestone
* [ ] Article
* [ ] Audio / Video

## 架构
![](./arch.png)  

* 前后矛盾检查（逻辑匹配）功能
* 先用协程实现异步推理
