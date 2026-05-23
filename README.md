# infoverify
* 交叉验证（多来源，多引用、跨域相证）
  * 基石知识库（如物理、数学等现代科学文章理论，例子如通信原理）
* 可再现性、可重复性、较高概率重现
  * 过往一致性
  * 经时间验证
* 详细内容或数据证明（多细节、多证据、多量化）

## 运行服务
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

### 上线（临时公网访问 cloudflared 内网穿透）
让 Chrome 插件通过一个临时公网域名访问本地后端，可以使用 `cloudflared`：

1. 启动本地服务：`docker-compose up -d`
2. `cloudflared tunnel create infoverify` （只需执行一次，创建后会生成一个 `infoverify` 的 tunnel 配置文件）
3. `cloudflared tunnel route dns infoverify infoverify.dpdns.org` （只需执行一次，将 `infoverify` tunnel 绑定到一个子域名上，这里使用 `infoverify.dpdns.org`，需要先在 DNS 提供商处添加对应的 CNAME 记录）
4. 运行内网穿透：`cloudflared tunnel run --url http://localhost:8080 infoverify`
5. Chrome 插件即可通过域名 `infoverify.dpdns.org` 访问本地后端服务

> 该方案适合 MVP 开发和测试，通常会在本地后端服务停止运行或 `cloudflared` 会话结束后失效。

## 停止服务
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

首发版默认只用 Chrome 内置本地 AI，并自动用 GDELT 最近新闻做交叉验证；本地模式会按可重复性、交叉验证、内容具体性三原则评分并给出结论。可重复性会进一步结合插件内静态 MBFC 域名信誉表与 GDELT 时间线。云端 AI 暂时仅保留计划入口。

插件首发版不需要后端、不需要 API Key，也不需要额外配置。
插件设置页可选择模型输出语言；本地 AI 的提示词和模型输入统一使用英文，当前支持英文、西班牙语、日语和中文输出（中文通过本地翻译层生成）。

## Milestone
* [ ] Article
* [ ] Audio / Video
