# Phase 0 完成报告（验收补正）

- 分支/提交：longform @ d25c786
- 测试：`npm test`，111/111 通过；基线 103，新增 gateway/mock 8 条全部通过。
- 构建：`npm run build` 通过（Vite 与 esbuild 均成功）。
- 端点冒烟：`npx tsx scripts/accept-phase0.mts` 启动临时端口后执行 curl。draft/outline/section-revise/split-text 为 200，visual 空 prompt 为 400。此前“空请求均为 4xx”不准确，已纠正。
- main 对照：验收脚本解析 main:server.ts 与拆分路由，比较响应状态码/字段集合，并逐字核对 stampDraft、pinDraftTitle、splitFallback 的函数体。完整证据见 docs/acceptance/phase0-evidence.txt。
- Mock：draft 响应包含 script_draft.json 的“模拟口播”；验收进程拦截外部 fetch，计数为 0；原有长稿集成测试覆盖确认大纲→分章 fixture 流程。
- 成本日志：实际读取 data/phase0-acceptance.jsonl，逐行断言 stage/model/inputTokens/outputTokens/costUsd/promptHash 齐全且无 apiKey。
- ERRATA：本轮无新增；沿用 E001–E003。`docs/ERRATA.md` 不存在，仓库根目录 `ERRATA.md` 为实际文件。

| curl 请求 | HTTP | 响应字段 |
|---|---|---|
| draft，30 秒主题 | 200 | beats,budgetStatus,fillRatio,fullNarration,longForm,overByChars,source,title,warnings |
| outline，240 秒主题 | 200 | brief,ok,outline,scriptForm,warnings |
| section-revise，未锁定章节 | 200 | ok,section,sections |
| visual/generate，空 prompt | 400 | error |
| split-text，两句中文 | 200 | shots,title |

边界：visual 仅执行参数拒绝路径，成功字段按 main 构造代码核对，未付费生图。split_text 缺少 fixture，gateway 记录 failed 后返回规则拆分；不能声称所有 script stage 都有 fixture。Mock 成本为 0，未验证真实供应商 token 计费准确性。无模型调用的参数拒绝不产生成本记录。

补验在 Phase 1 开始编码前完成，之后再次回归。补正文件：本报告、scripts/accept-phase0.mts、docs/acceptance/phase0-evidence.txt。手动复核：运行上述验收脚本即可，无需真实 key。后续 E004–E005 属于 Phase 1。
