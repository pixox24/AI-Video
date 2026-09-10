# Phase 1 完成报告 — ContentBrief + DurationSpec

2026-09-10，longform 分支。用户“继续”后实施，仅完成 SPEC-v2 §10 Phase 1，未进入 Phase 2。Phase 0 原报告的证据不足已补正并单独提交 fcbe108。

## 实现

- `scriptWorkspace.contentBrief` 保存观众承诺、受众、内容目标、类型、必须覆盖/避免与七类字段锁；`brief: ScriptBrief` 保持原用途。
- 观众承诺阶段位于意图之后。空承诺不能进入大纲或触发写稿；新字段已透传到 outline/draft 请求。旧 API 客户端未传新字段时仍走原契约。
- 三档时长：insight 300–480 秒，默认 420、long；deep_dive 600–900 秒，默认 750、extended（600 秒可为 long）；tutorial 900–1500 秒，默认 1200、extended。
- DurationSpec.pace 直接使用五档 ScriptPace；zh medium=4.3 字/秒，en medium=2.5 词/秒。新时长预算由 `src-server/duration/engine.ts` 叠加在原预算上，未改原预算测试；教程口播占比 0.65，其他类型默认 0.8。
- YouTube 预设 max 从 90 扩到 MAX_VIDEO_SECONDS=1800；其他平台不动。时长页在当前 preset 范围内修改会同步 DurationSpec；改到范围外则退出该 preset，恢复既有自定义时长模式。
- 新增 `/api/script/brief`，严格请求/响应 Zod schema。gateway 对 opt-in schema 校验，错误回传重试最多两次；每次失败尝试也记录 JSONL；Mock 同样校验；失败不会把新 schema 请求永久缓存为失败。
- 启用 TypeScript strict；为既有 nullable/可选值补类型收窄，不增加 any 或 ts-nocheck。

## 验收

| 项目 | 结果与证据 |
|---|---|
| 测试回归 | ✅ `npm test`：120 tests / 120 pass / 0 fail；103 基线 → Phase 0 111 → 本轮 120（+9 顶层测试，含多项集成断言）。完整 TAP：docs/acceptance/phase1-tests.txt |
| 构建 | ✅ `npm run build`：Vite built in 10.25s；esbuild Done in 19ms。docs/acceptance/phase1-build.txt |
| TypeScript strict | ✅ `npm run lint`：tsc --noEmit，退出码 0；tsconfig strict=true。docs/acceptance/phase1-lint.txt |
| 空承诺门禁 | ✅ 单测及浏览器：空值/空白拒绝；点击节拍跳到观众承诺，确认按钮 disabled；带空新字段的 outline/draft 返回 409 |
| deep_dive 请求 | ✅ 浏览器实际 POST /api/script/outline 返回 200；携带 `{preset:deep_dive,minSeconds:600,targetSeconds:750,maxSeconds:900,pace:medium,narrationRatio:0.8}`；旧 brief 同时保留。请求存根见 docs/acceptance/phase1-ui-requests.jsonl |
| 预算预览 | ✅ 浏览器：750 秒总预算、600 秒口播、150 秒画面停留、2580 字；见 docs/acceptance/phase1-brief.png |
| Brief Mock | ✅ fixture 输出通过严格 schema；非法请求 400、锁定必填空字段 409、坏 fixture 生成失败；外部模型 fetch 被拦截；日志 mock/零成本/无 apiKey |
| 锁定与恢复 | ✅ 七类锁单测；浏览器将承诺改为“看完能制定自己的休息计划。”并锁定，重生成后不变，刷新后承诺/锁/预算仍保留 |
| Schema 重试 | ✅ 纯内存替代 fetch（不联网）：第三次有效则成功；连续错误恰好三次后失败；错误信息反馈下一次；重试各记日志；失败后可重新请求 |
| locked 段 | ✅ 原 section-revise 返回 409，未改动旧 handler |
| 提示词基准 | ✅ src/utils/scriptPrompts.ts 无 diff，三段原句未修改 |

## 变更文件

- 类型/schema/预算：src/types.ts、src/shared/contentBrief.ts、src-server/duration/engine.ts、src/utils/contentBrief.ts、src/utils/scriptBudget.ts、src/utils/scriptWorkspace.ts。
- 服务端：src-server/app.ts、src-server/routes/brief.ts、src-server/routes/content-input.ts、src-server/llm/gateway.ts、src-server/llm/types.ts。
- 界面：src/components/BriefStage.tsx、src/components/ScriptPanel.tsx、src/components/ScriptOutlineStage.tsx。
- 测试/fixture：src/utils/contentBrief.test.ts、src-server/routes/brief.test.ts、src-server/llm/gateway.schema.test.ts、tests/fixtures/brief.json、scripts/phase1-ui.mts、package.json。
- strict 所需既有类型修正：tsconfig.json、src/utils/imagePrompt.ts、src/utils/projectPersist.ts、src/utils/scriptDraft.ts、src/utils/visualBible.ts（另含上述 workspace/组件中的收窄）。
- 文档：本报告、ERRATA.md、docs/acceptance/phase1-*。

## 手动复核

1. PowerShell：`$env:LLM_MOCK='true'; npm run dev`。打开工作台，点击大纲/节拍，空承诺应跳到承诺页。
2. 填主题，生成承诺；编辑承诺并勾选锁定，再生成，锁定文本应保留。
3. 选择深度剖析，核对 750/600/150 秒和 2580 字。进入大纲并生成，在网络请求中查看 contentBrief 和 durationSpec。
4. 刷新，回承诺页核对字段、锁与预算。切换英文与五档语速，预算应按现有速率表变化。
5. 自动复核：`npm test`、`npm run lint`、`npm run build`。浏览器验收使用 scripts/phase1-ui.mts 和临时 cwd，未操作用户项目目录。

## ERRATA 与遗留

本轮新增 E004（ContentBrief 命名/落点）、E005（严格 schema 从 Phase 1 起启用），依据用户已确认决定；没有改动规格原文。

- 既有服务端机械拆分文件仍有 Phase 0 遗留 ts-nocheck；新增代码均受 strict 检查，不能将全仓 strict 配置等同于所有旧文件均消除 ts-nocheck。
- 构建仍有大 chunk 与 Zod 注释警告，不影响产物生成。使用已声明的 Zod，无新增依赖；未引入第二种锁文件。
- gateway 真实 token/cost 仍沿用 Phase 0 占位值 0；本次只验收 Mock 零成本。真实供应商计费统计未验收。
- split_text 等旧 stage fixture 覆盖不足见 Phase 0 补正报告。
- Phase 2 的段级预算/留存字段、prompt 内容承诺注入和锁定大纲全路径增强尚未开始；本阶段完成的是新字段录入、门禁、预算、校验与透传。

提交后停止，等待用户再次确认再进入 Phase 2。
