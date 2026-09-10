# Phase 6 阶段报告（未完成，不是验收通过报告）

日期：2026-09-10；基线：origin/longform 26ce9ae。

## 已完成

- 本地从 Phase 0 快进到已验收 Phase 5，保留 longform 分支。
- 全量 npm test：131/131（原 130 项 + usage 检查），含 visualBible.contract、visualBible.acceptance、visualBible.workflow。
- npm run lint / npm run build：成功，完整输出见 phase6-lint.txt / phase6-build.txt。构建警告不是验收失败。
- E007 实现：OpenAI 兼容与 Gemini 原生响应透传 usage；统一网关记录实际 input/output token；Gemini 思考 token 计入输出。schema 重试的每条记录保留 token/cost。供应商返回 usage.cost 时直接记录，否则按 LLM_PRICING_JSON 中有来源的 USD 每百万 token 单价计算。未知值为 null，不能伪装为 0；面板提示不完整汇总。
- 传输桩测试验证三次 schema 尝试均保留 inputTokens=101、outputTokens=17、costUsd=0.00042。这是测试数据，不是真实供应商账单，不用于关闭 E007。
- Mock HTTP brief → 大纲 → 草稿 → 质检 → 修复：通过。将第 2 段口播删短 40%，repair=true 返回 rounds=1、stoppedReason=resolved。详情见 phase6-mock-http.json；Mock JSONL 见 phase6-mock-generation-runs.jsonl，包含本轮前后两次 Mock 检查。
- README 新建：启动、验收、真实配置、计费来源、持久化及 backlog。
- AGENTS.md 定稿现有执行边界：用户指令优先、SPEC-v2 与历史 MIGRATION 关系、E006 strict 范围、Phase 6 证据真实性。
- ERRATA E007 更新为实现已补齐、真实验收待完成；未擅自关闭。
- ScriptPanel 约 115 KB 记入 README backlog，不阻塞本阶段；没有继续组件拆分。

## 未完成 / 阻断

1. 尚未取得本轮可用于调用的 LLM 配置与可核实价格。本仓库没有 .env，当前进程无 GEMINI_API_KEY 或 LLM 凭据；浏览器已打开项目，但尚未确认其保存的模型凭据。已向用户请求可用供应商配置位置。
2. 尚未执行真实 brief → 大纲 → 草稿 → 质检 → 修复 → TTS → MP4；没有真实调用 JSONL 和新导出 MP4，因此 E007 真实验收未通过。
3. Mock 完成至修复，TTS / MP4 未执行。LLM_MOCK 不替代现有 TTS 或浏览器编码器，不能把 API 回归称为完整视频流程验收。
4. 当前计费支持 usage.cost（USD）或已核实费率计算；未配置价格的供应商显示未知。日志不等同于含赠金/折扣/税费的最终结算账单。历史零占位记录不追溯伪造。

## 变更文件

README.md、AGENTS.md、ERRATA.md、package.json；src-server/llm 下 gateway.ts、gateway.schema.test.ts、openai-compatible.ts、types.ts、新增 usage.ts / usage.test.ts；src/types.ts、src/components/UsagePanel.tsx、src/utils/geminiNative.ts（只增加响应 usage 透传；不改其纯函数）；docs/acceptance/phase6-*。

## 后续复验步骤

1. 注入供应商凭据，以 LLM_MOCK=false 启动；入口会加载仓库根目录 .env。核实最低成本可用模型与该接口实际报价，配置价格来源。
2. 在新验收工程中选择小体量主题，生成 brief、大纲并确认，再生成章节。检查质量，定向修复未锁定段。
3. 用现有 TTS 合成全部新口播，检查实测秒数；现有分镜/导出面板导出 MP4，检查音视频时长及可播放性。
4. 按项目 ID 导出真实 GenerationRun JSONL；对照供应商 usage 和费用来源，报告逐行展示本次真实记录及总额。
5. 补齐 Mock TTS / MP4 端到端证据；更新本报告为完成报告后提交推送并停止。
