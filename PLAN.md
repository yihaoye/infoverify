# Infoverify 开发计划

本文档描述 `infoverify` 项目的开发计划与架构决策，当前以 MVP 为目标。

## 1. 核心原则

系统基于 `README.md` 中的三条原则：

1. **可重复性、可执行性、较高概率重现**
2. **详细内容或数据（多细节、多证据、多量化）**
3. **交叉验证（多来源、多引用、跨域相证）**

### 补充功能
加上内容价值程度判断（高中低，按领域标签）

## 2. 系统架构（MVP）

采用“单库优先”的简化架构：

- **主存储（Postgres）**：文章内容、元数据、验证任务、来源画像等全部落在 Postgres。
- **任务队列（Redis）**：只负责 URL 任务入队与 Worker 消费。
- **动态查询（可选）**：仅在本地数据不足时触发（后续扩展）。
- **内容获取（Cloudflare Browser Rendering）**：以 Cloudflare Browser Rendering 作为“按需渲染/抽取”的主路径，本地爬虫仅作为兜底。  
  *注意：Browser Rendering 主要用于抓取/渲染/抽取，本身不负责“发现内容”。*
- **搜索能力（Postgres）**：通过 `tsvector + GIN` 实现全文检索，`pg_trgm` 支持相似度匹配。
- **Agent 调度（MVP 轻量版）**：固定流程 + Skills 调度，保证可解释与可控。

说明：MVP 阶段不引入 Cache 层，不强制使用 Elasticsearch。若后续遇到检索质量或性能瓶颈，再引入 ES/向量检索与缓存。

## 3. 开发路线图

- [x] **阶段 1：网页抓取服务**
  - 说明：实现单 URL 的正文抽取，用于链接输入的最小能力。
  - 计划调整：后续改为 Cloudflare Browser Rendering 主路径，本地爬虫降级为 fallback。

- [x] **阶段 2：异步任务与队列**
  - 说明：Server 入队、Worker 消费并抓取内容。

- [x] **阶段 3：数据持久化（Postgres）**
  - 目标：落地最小数据模型与迁移脚本。
  - 内容：
    - `articles`（url、title、author、content）
    - `reports`（article_id、report JSON）

- [ ] **阶段 4：基础检索与查询**
  - 目标：在 Postgres 中完成全文检索与相似度检索。
  - 内容：
    - `tsvector + GIN` 全文检索
    - `pg_trgm` 模糊/相似度

- [ ] **阶段 5：基础分析引擎（轻量版）**
  - 目标：先做低成本规则与结构化分析。
  - 内容：
    - 固定流程输出 + Skills 评分与证据结构
    - 内容结构分析（标题/作者/发布时间/引用数量/段落结构）
    - 初步的内部一致性检查（字段缺失/异常）

- [ ] **阶段 6：高级分析与外部检索（可选）**
  - 目标：当 MVP 验证有效后再引入。
  - 内容：
    - ES 或向量检索
    - NLP/NLI 模型
    - 更完整的交叉验证流程（动态调度）
    - 可选接入 Cloudflare Browser Rendering 的 /crawl 规模化抓取能力（受限额度与速率）
    - 外部搜索 API 与公开数据源的规模化接入（MVP 可先不做）
