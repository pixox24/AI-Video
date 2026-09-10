# Phase 3 完成报告：质量评估闭环

日期：2026-09-10；分支：longform；前序提交：7f59ad2。

新增质量检查端点与面板；修订抽取并复用现有 section-revise 执行器及 buildRevisionPlan。Issue 按 sectionId 合并成章节动作，服务端每次修复最多两轮。无 sectionId 的全局问题保留展示，不触发全文重写。

## 验收结果

| 项目 | 结果与证据 |
|---|---|
| 全量回归 | ✅ `LLM_MOCK=true PHASE3_EVIDENCE=true npm test`：126 tests / 126 pass / 0 fail。最初基线 103 → Phase 2 121 → Phase 3 126；见 phase3-tests.txt。 |
| 类型检查 | ✅ `npm run lint`：`tsc --noEmit`，退出码 0；见 phase3-lint.txt。无新增 any 或 ts-nocheck；旧 script.ts 首行抑制保持原样。 |
| 构建 | ✅ `npm run build`：Vite built in 10.27s；server bundle Done in 21ms；退出码 0；见 phase3-build.txt。 |
| 删短 40% → 修复 | ✅ HTTP 基准 s2：240 字 → 144 字；quality-check 返回 duration/too_short；修复 1 轮后 in_range。HTTP 请求、响应、history 完整记录于 phase3-http.json。 |
| 界面一键修复 | ✅ 实际浏览器点击检查与修复：s2 33.488s → 51.860s，预算 50.233–58.605s，最终 0 个问题。其他章节完整对象深度相等；见 phase3-ui.json 与 phase3-ui-before.png、phase3-ui-after.png。 |
| 伪造数据风险 | ✅ “研究证明，这款产品使记忆力提升98.7%。”被标 fact/high/needsSource，并产生 fact_risk Issue；HTTP 记录与 phase3-ui-risk.png 为证。界面可填来源 URL、来源说明。 |
| 锁定保护 | ✅ 分别对章节锁与大纲锁，各连续 3 次调用 section-revise 和定向 quality repair，全部 409（共 12 次）。修复全部时跳过锁定章、0 轮，内容深度相等。见 phase3-http.json 和测试断言。只检查锁定章仍允许返回报告。 |
| 分组与轮数 | ✅ 同一章 duration+pacing 合并一个动作；持续问题 fixture 恰好修复 2 轮、评估 3 次，返回 round_limit。客户端 rounds:99 被严格 schema 拒绝（400）。 |
| Schema/失败处理 | ✅ evaluator、quality 请求/响应、质量修订输出使用严格 Zod；未知章节 400，无效 evaluator 输出经 gateway 重试后 503。 |
| Prompt 不变量 | ✅ 三段系统提示词相对 prompt-baseline 原文均逐字前缀匹配（166/241/145 字符，归一 CRLF）。本阶段仅追加 SECTION_REVISE_SYSTEM；phase3-prompt-diff.txt 和 phase3-prompt-git-diff.txt 附完整证据。 |
| Mock / 日志 | ✅ HTTP 测试阻断所有外部 fetch，externalCalls=0；phase3-generation-runs.jsonl 记录 gateway 调用，不包含 apiKey。 |
| 差异检查 | ✅ `git diff --check` 无空白错误。 |

## 变更文件

- `src/shared/quality.ts`、`src/types.ts`：Claim/Issue/报告、严格 schema、输入内容指纹及工作区持久化类型。
- `src-server/llm/prompts/quality.ts`：评估器提示词。
- `src-server/duration/engine.ts`：章节预算判定纯函数，沿用五档速率。
- `src-server/pipeline/quality.ts`：事实风险、问题分组、评估及两轮修订闭环。
- `src-server/pipeline/section-revise.ts`、`src-server/routes/script.ts`：抽取共享修订执行器，保留旧端点响应及 409。
- `src-server/routes/quality.ts`、`src-server/app.ts`：注册新端点。
- `src/utils/scriptPrompts.ts`：只追加修订系统约束，用户提示明确章节字数范围。
- `src/components/QualityPanel.tsx`、`src/components/ScriptPanel.tsx`：检查、定向/批量修复、问题定位、风险高亮和来源输入。
- `src-server/pipeline/quality.test.ts`、`tests/fixtures/quality.json`、`package.json`：新增 5 项测试及 Mock fixture。
- `scripts/phase3-ui.mts`：在空临时目录启动隔离验收项目，不写用户项目数据。
- `docs/acceptance/phase3-*`：本报告、命令日志、HTTP/浏览器证据、提示词差异与截图。

## 手动复验

1. 在空临时目录运行仓库的 tsx 和 scripts/phase3-ui.mts；该脚本固定 LLM_MOCK=true，加载 phase3-http.json 中删短后的测试项目，在 3006 端口服务构建产物。先执行 npm run build。
2. 打开 http://localhost:3006，进入“文案 / 口播”，点击“检查质量”，看到 s2 的 duration/too_short。
3. 点击“一键修复未锁定问题”，确认“已修订 1 轮 · in_range”、0 个问题；截图和实际网络请求见 UI 证据。
4. 在口播末尾追加上述伪造数据句，重新检查，确认黄色风险高亮与 fact/high/needsSource；填入来源后需重新检查。
5. 运行带 PHASE3_EVIDENCE=true 的 npm test，复验两种锁定状态的 409、不变性、严格 schema 失败和两轮上限。

界面验收中发现字段顺序造成输入过期误判，已用 schema 规范化输入修复，并加入字段顺序/密钥/内容/锁定变化的回归测试。异步期间内容变更会丢弃旧结果，修复后保留服务端返回的章节对象，避免预测重建改写其他章节。

## 遗留与边界

- 本轮全程 Mock：证明控制流、数据契约、预算与锁定约束，不宣称已验证真实模型的修订质量。风险标记表示需要来源，不是事实真伪的最终裁定；来源由用户或既有证据提供，不采用模型自造 URL。
- in_range 是按已确认大纲各章字数区间及既有速率作出的预算判定，不是 TTS 实测；TTS 校准留至 Phase 4。
- 全局问题、锁定章问题或两轮后仍未解决的问题继续展示，需人工处理。用户可主动开始新的修复运行，每次运行上限两轮。
- 真实 token/cost 仍为占位 0；按 ERRATA E007 留待 Phase 6 验收。ERRATA.md 本轮无新增条目。
- 构建保留现有大 chunk 警告，不影响成功；未做规格外拆包。

本阶段完成后提交并推送 origin longform，停止等待人工确认，不进入 Phase 4。
