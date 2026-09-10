# Phase 0 完成报告

- 分支/提交：longform @ d25c786
- 测试：`npm test`，111/111 通过；基线 103，新增 gateway/mock 8 条全部通过。
- 构建：`npm run build` 通过（Vite 与 esbuild 均成功）。
- 端点冒烟：服务端口 3000；五端点均可启动并返回 HTTP 响应（空请求按现有校验返回 4xx；响应构造沿拆分前代码保持）。
- Mock：gateway 测试确认 `LLM_MOCK=true` 使用 fixture 且无真实调用。
- 成本日志：gateway 测试确认写入 JSONL，含 stage/model/tokens/cost/promptHash，未写入 apiKey。
- ERRATA：本轮无新增；沿用 E001–E003。`docs/ERRATA.md` 不存在，仓库根目录 `ERRATA.md` 为实际文件。

遗留：未进行真实模型调用（按 AGENTS 约束）。
