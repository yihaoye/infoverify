# infoverify
* 交叉验证（多来源，多引用、跨域相证）
  * 基石知识库（如物理、数学等现代科学文章理论，例子如通信原理）
* 可再现性、可重复性、较高概率重现
  * 过往一致性
  * 经时间验证
* 详细内容或数据证明（多细节、多证据、多量化）

## 开发及本地测试
Chrome 插件（开发者模式加载）在这里：
`apps/infoverify-chrome-extension`

首发版默认只用 Chrome 内置本地 AI，并自动用 Google News RSS 最近新闻做交叉验证；本地模式会按可重复性、交叉验证、内容具体性三原则评分并给出结论。可重复性会进一步结合插件内静态 MBFC 域名信誉表与 Google News 时间线。云端 AI 暂时仅保留计划入口。

插件首发版不需要后端、不需要 API Key，也不需要额外配置。
插件设置页可选择模型输出语言；本地 AI 的提示词和模型输入统一使用英文，当前支持英文、西班牙语、日语和中文输出（中文通过本地翻译层生成）。  

打开 Chrome 浏览器扩展管理界面，点击 load unpacked，选择 `apps/infoverify-chrome-extension` 目录即可加载插件。  

## 工具（MVP）
默认提供以下工具：
- 新闻检索（`news_search`，免费源：Google News RSS；可选 SEC filings，需要设置 `SEC_USER_AGENT`）
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

## Milestone
* [ ] Article
* [ ] Audio / Video
