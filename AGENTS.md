# AGENTS.md

## 项目
AI-Video 长视频内容层重构与增建。权威文档：SPEC-v2.md（本规格书）+
MIGRATION.md（历史资产与提示词基准）；已确认差异见 ERRATA.md。
用户当前指令优先；MIGRATION 的 v1 框架迁移规则不覆盖 SPEC-v2。
未获用户授权的新规格冲突应报告，不自行改变规格。

## 命令
- 开发: npm run dev（LLM_MOCK=true）
- 测试: npm test
- 类型检查: npm run lint
- 构建: npm run build

## 硬性规则
1. 严格按 SPEC-v2 第 10 节 Phase 顺序执行；完成一个 Phase 跑完其全部验收
   （含现有测试回归）后停止，等待人工确认再进入下一 Phase。
2. 禁止框架迁移（不引入 Next.js/Prisma/Remotion）；保留 Vite+React+Express。
3. 所有 LLM 调用必须经过 src-server/llm/gateway.ts；禁止端点内自行拼装请求。
   开发全程 LLM_MOCK=true，除非用户明确要求真实调用。
4. 时长计算只能由 src-server/duration/engine.ts 完成；禁止采信模型自报时长。
5. scriptPrompts.ts 三段系统提示词的原句必须保留，增强只能追加。
6. 复用第 2 节资产清单中的现有模块；禁止重建已存在的能力
   （TTS/字幕/导出/时间线/视觉圣经/分镜）。
7. 不实现 Non-Goals；不引入规格外依赖（确有必要先申请）。
8. locked 段落与锁定的大纲在任何生成/修订路径中禁止改动。
9. 不新增 any / ts-nocheck；新增纯函数必须配单测。全局 strict 尚未获批，
   按 ERRATA E006 保持现有 tsconfig，不把历史债务扩大到本轮。
10. 每个 Phase 完成后输出：变更文件清单、验收逐项结果（附命令输出证据）、
    手动验证步骤、遗留问题。

## Phase 6 收尾边界
- ScriptPanel 约 115 KB 已列 README backlog，不阻塞收尾，勿扩大为重构任务。
- 回归必须包含 visualBible.contract / acceptance / workflow 三个测试文件。
- 真实验收必须保留完整流程证据和 GenerationRun JSONL；token 来自供应商，
  cost 注明供应商报告或已核实价格来源，不得用 0 冒充未知值。
- 报告不得把 Mock / 传输桩测试称为真实运行。凭据不进入日志、截图或提交。
- 证据存 docs/acceptance/phase6-*；完成报告及获授权提交推送后停止。
