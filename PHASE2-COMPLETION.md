# Phase 2 完成报告

本阶段完成 SPEC-v2 §10 Phase 2，提交前停止，不进入 Phase 3。

| 验收项 | 结果 |
|---|---|
| prompt 原句与追加 | ✅ `docs/acceptance/phase2-prompt-diff.txt` 逐行核对 baseline 的 18 个原句均 `UNCHANGED`；`git diff -- src/utils/scriptPrompts.ts` 显示只在 OUTLINE_SYSTEM 末尾追加约束、outline user prompt 追加 viewerPromise 和新输出字段；SECTION_DRAFT_SYSTEM/SECTION_REVISE_SYSTEM 零 diff。 |
| viewerPromise 注入 | ✅ `/api/script/outline` 传入 `viewerPromise`，生成 prompt 包含【观众承诺】；浏览器请求证据见 phase1-ui-requests.jsonl。 |
| 段级预算 | ✅ `src-server/duration/engine.ts` 新增 `budgetOutlineSections`；字段为 narrationBudgetSec/visualHoldBudgetSec。 |
| 预算校验 | ✅ `validateOutline` 强制口播预算及总预算均 ±10%，hook 总预算 ≤35 秒；新增 phase2 单测覆盖。 |
| retention/transition | ✅ ScriptOutlineStage 增加可编辑 retentionDevice、transitionOut 输入；锁定段编辑仍保留 locked 状态。 |
| 严格大纲 schema | ✅ outlineSchema 严格校验响应；不通过返回 outline_schema_invalid；旧 ScriptBrief 不变。 |
| locked 全路径 | ✅ outline 重生成按 section id 恢复 locked 段完整旧对象；section-revise 原 409 行为未改；既有 locked merge/revision 测试全绿。 |
| 回归 | ✅ `npm test`：121/121；`npm run lint`：tsc --noEmit 0；`npm run build`：Vite/esbuild 成功。证据：docs/acceptance/phase2-tests.txt、phase2-lint.txt、phase2-build.txt。 |

变更文件：src/types.ts、src/shared/contentBrief.ts、src-server/duration/engine.ts、src-server/routes/script.ts、src/utils/scriptOutline.ts、src/utils/scriptPrompts.ts、src/components/ScriptOutlineStage.tsx、src/utils/scriptOutline.phase2.test.ts、ERRATA.md，以及 docs/acceptance/phase2-*。

遗留：push 仍受网络限制（github.com:443 无法连接）；真实 token/cost 仍为占位 0，已记录 E007 并加入 Phase 6 门禁。prompt diff 脚本把 baseline 元数据标题标为 BASELINE MISSING，但 18 条系统提示原句均为 UNCHANGED；该元数据行不属于提示词原句。
