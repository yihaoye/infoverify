# InfoVerify (Mock) — Chrome 扩展骨架

## 功能
- 在网页上右键 → `核实 (文本优先/否则URL)`
- 自动打开 Side Panel 展示核验结果（调用本地后端 `infoverify`）

## 安装（开发者模式）
1. 打开 Chrome → `chrome://extensions`
2. 右上角开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本目录：
   - `./apps/infoverify-chrome-extension`

## 使用
1. 打开任意网页
2. 右键 → `核实 (文本优先/否则URL)`
3. 如果你已选中文本：会核实选中文本；否则会只发送当前页面 URL（后端将抓取正文再打分）
4. 在右侧 Side Panel 查看“结论/证据/详情”

## 后端联调
默认调用：
- `POST http://localhost:8080/api/basic/score`

先启动后端（在 `infoverify` 仓库内）：
```bash
go run ./cmd/infoverify -mode server
```

然后在插件选项里设置 `后端 API Base URL`（默认就是 `http://localhost:8080`）。

可选：勾选「启用 Gemini 可信度评估」后，会在请求体附带 `llm=true`，需要后端配置 `GEMINI_API_KEY`。

## 设置
- 扩展详情页 →「扩展程序选项」
- 可调整模拟延迟：`Mock 延迟 (ms)`（0 表示不延迟）
