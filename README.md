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
在项目根路径下创建 `.env` 文件，配置必要的环境变量（如数据库连接、Gemini API key 等）。
```
GEMINI_API_KEY=your_key
GEMINI_MODEL=gemini-2.5-flash
DATABASE_URL=postgres://postgres:postgres@postgres:5432/infoverify?sslmode=disable
```  

然后即可运行：  
`docker-compose build --no-cache infoverify`  
`docker-compose up -d`  

这将启动完整的栈：
- Postgres 数据库
- pgAdmin（数据库管理界面，访问 http://localhost:5050）
- infoverify API 服务（监听 :8080）

## 停止
`docker-compose down`

## 数据库
pgAdmin（本地可视化）  
docker-compose up -d 后访问 http://localhost:5050，使用 admin@admin.com / admin 登录。  
首次使用需手动注册服务器：左侧右键 Servers -> Register -> Server，Connection 填写：
```
Host: postgres
Port: 5432
Database: infoverify
Username / Password: postgres / postgres
```

## 交叉验证模式
默认只使用本地检索，不触发网络抓取：
```bash
export CROSS_VALIDATE_MODE="local"
```
如需允许交叉验证阶段进行抓取（仅复抓原 URL），设置：
```bash
export CROSS_VALIDATE_MODE="web"
```

## API
- 只用轻量打分接口 `/api/basic/score` 时，不强依赖 Postgres（未启动也能跑，但相关接口会不可用）。
- 目前没有 Worker 模式（异步任务队列），后续如果加了再更新文档。

## 工具（MVP）
默认提供以下工具：
- 新闻检索（`news_search`，免费源：GDELT；可选 SEC filings，需要设置 `SEC_USER_AGENT`）
  - 学术检索（`scholar_search`，免费源：Semantic Scholar）
- Canonical refs（`canonical_refs`，物理/数学/化学/医学/生物）
  - 本地检索（`search_articles`）不需要存经典论文或知识库，直接调用大模型因为模型已经经过这些经典知识训练融入参数中，唯一需要的是把相关文章论文名记录在数据库（甚至不用数据库，直接在代码里写死哈希表，映射标签与关键知识的关系）中按针对验证的信息标签来调用并作为提示词询问大模型（如果大模型没有用相关文章论文训练过则需要微调）。
- URL 抓取（`fetch_url`，受 allowlist 限制，见 `internal/service/support/external/allowlist.go`）

TODO：后续再接入财经数据源抓取与结构化（如 SEC、Yahoo、Bloomberg）。

### SEC_USER_AGENT
如果启用 `news_search` 的 `ticker` 参数（会抓取 SEC filings），需要提供 `SEC_USER_AGENT`（建议包含联系方式）：
```bash
export SEC_USER_AGENT="infoverify/0.1 (contact: you@example.com)"
```

说明：`/api/basic/score` 的 URL 模式为了便于插件使用，不走 allowlist（仅校验 http/https）。

## Cloudflare Browser Rendering（可选）
如需使用 Cloudflare Browser Rendering 作为抓取主路径，配置：
```bash
export CF_BR_ACCOUNT_ID="your_account_id"
export CF_BR_API_TOKEN="your_api_token"
export CF_BR_BASE_URL="https://api.cloudflare.com/client/v4"
```
未配置时会自动回退到本地爬虫。

## 客户端
Chrome 插件（开发者模式加载）在这里：
`apps/infoverify-chrome-extension`

轻量打分（不入库、不抓取）：输入文本 -> 三大原则分项分数 + 总分：
```bash
curl -X POST http://localhost:8080/api/basic/score \
  -H "Content-Type: application/json" \
  -d '{"text":"According to https://example.com/report revenue grew 20% YoY.","url":"https://news.example.com"}'
```

URL 模式（先抓取 URL 正文，再打分；受 allowlist 限制）：
```bash
curl -X POST http://localhost:8080/api/basic/score \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/article"}'
```

可选：让 Gemini 额外输出一个“独立可信度评估”（与三原则分开），在请求体加 `llm=true`：
```bash
curl -X POST http://localhost:8080/api/basic/score \
  -H "Content-Type: application/json" \
  -d '{"text":"...","llm":true}'
```
需要先配置 `GEMINI_API_KEY`（见上面的 Gemini 配置段落）。

## Milestone
* [ ] Article
* [ ] Audio / Video

## 架构
![](./arch.png)  

* 前后矛盾检查（逻辑匹配）功能
* 先用协程实现异步推理
