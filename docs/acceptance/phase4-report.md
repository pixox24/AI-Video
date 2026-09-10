# Phase 4 完成报告：TTS 语速校准

日期：2026-09-10；分支：longform；基线：Phase 3 / 75a60f6。

## 实现

新增 `src-server/duration/calibration.ts`，按 `(provider, voice, pace)` 分桶，平均最近 20 次有效合成的归一化速率倍率。基准估算、速度倍率应用和实测区间求和由 `engine.ts` 计算；未更改五档默认速率或现有预算测试。

桶中保存每次样本的 `scale`，使用时取滑动平均。先用历史样本作本次估算，再登记本次实测，避免把本次答案用于本次估算。归一化考虑语言基准和 TTS speechRate，不直接混合中文“字/秒”与英文“词/秒”。Edge 使用现有声音 ID（如 magnetic-male），百炼使用现有 resolveTtsVoiceId 的结果。输入不携带密钥。

`POST /api/script/calibration` 使用严格 Zod 输入，默认写入 `data/rate-table.json`。采用同步读取/更新和临时文件原子替换，适用于现有单进程 Express 服务；损坏的文件返回 503，不覆盖原文件。样本指纹账本保留原估算，重复回写以及已经移出 20 次窗口的旧合成重放都不会重复训练。

App 仅新增一个旁路 hook：读取现有 freshness 判定和 narrationTrack 对齐结果，提交校准，将每段 `actualSec` 及对比报告写回工作区。hook 不修改 clips、audio 或 alignment；异步旧响应不会覆盖新内容。锁定章仅增加实测元数据，正文、状态及 beats 不变。内容或音色等输入变更时清理过期实测。

## 验收

| 项目 | 结果 / 证据 |
|---|---|
| 完整测试回归 | ✅ `LLM_MOCK=true PHASE4_EVIDENCE=true npm test`：130 tests、130 pass、0 fail；基线 103 → Phase 3 126 → Phase 4 130。完整输出：phase4-tests.txt。 |
| lint | ✅ `npm run lint` → `tsc --noEmit`，退出码 0；phase4-lint.txt。无新增 any/ts-nocheck。 |
| build | ✅ `npm run build`，退出码 0；Vite built in 10.19s，server bundle Done in 22ms；phase4-build.txt。 |
| 按桶滑动平均 | ✅ provider、voice、pace 分别隔离；窗口超过 20 次时移除旧样本；速度归一化和重复/旧事件去重通过。见 calibration.test.ts 与测试日志。 |
| 持久化 | ✅ HTTP 测试读取落盘文件核对两个样本；默认 data/rate-table.json 也在隔离 UI 目录实际生成。phase4-rate-table.json 为测试落盘副本。 |
| 同 voice 第二次误差更小 | ✅ 首次估算 20s / 实测 40s，绝对误差 20s；第二次估算 40s / 实测 40s，误差 0s。phase4-http.json 包含两次完整请求、响应及误差。 |
| 合成后 actualSec 可见 | ✅ 浏览器使用 20 秒 PCM fixture，执行原有解码、拼接、对齐链路；两个章节分别显示实测 20.0s，落盘 actualSec 为 20 和 20.000000000000004（浮点误差）。phase4-persisted.json 保留章节和 alignment 证据。 |
| 预算环对比 | ✅ “口播：估算 vs 实测”及逐章明细显示首次 20/40、第二次 40/40；phase4-ui-before.png、phase4-ui-first.png、phase4-ui-second.png、phase4-ui.json。 |
| 旁路 / 锁定不变量 | ✅ 单测对比对象：audio、clips 引用不变，剔除 actualSec 后锁定章节深度相等；源输入未被修改。浏览器两个锁定章节状态保留。 |
| 音频复用回归 | ✅ 原 ttsReuse.test.ts 两条测试原样通过；浏览器第二次“重新生成整段旁白”复用两句，新增 TTS 请求数为 0。 |
| 音频与对齐实现不改 | ✅ narrationTrack.ts、narrationAlignClient.ts、ttsReuse.ts、ttsReuse.test.ts、audioEngine.ts、routes/audio.ts 的 Git blob 与 75a60f6 完全相同，见 phase4-invariants.txt。App 的合成/对齐回调零改动。当前仓库没有独立 audioEngine 测试文件，不虚报该测试；浏览器验收经过现有音频生成流程。 |
| 系统提示词 | ✅ scriptPrompts.ts 整文件与 Phase 3 相同，见 phase4-invariants.txt。 |
| 无真实调用 | ✅ LLM_MOCK=true；隔离 host 在现有音频路由前提供 PCM fixture，未调用真实 TTS 服务。 |

## 变更文件

- `src-server/duration/calibration.ts`：滑动平均、对齐测量、去重和文件存储。
- `src-server/duration/engine.ts`：可选校准倍率/播放速度参数、实测区间求和。
- `src-server/routes/calibration.ts`、`src-server/app.ts`：校准端点。
- `src/shared/calibration.ts`：严格请求/响应 schema。
- `src/utils/durationCalibration.ts`：只读旁路投影及实测元数据回写。
- `src/components/useDurationCalibration.ts`、`src/App.tsx`：旁路生命周期和过期结果保护。
- `src/components/ScriptPanel.tsx`：预算环及每章估算/实测对比。
- `src/types.ts`、`src/shared/quality.ts`：actualSec 元数据类型及后续质检兼容。
- `src-server/duration/calibration.test.ts`、`tests/fixtures/calibration.json`、`package.json`：4 个新增测试及 fixture。
- `scripts/phase4-ui.mts`：隔离的浏览器验收 host，仅在空临时目录运行。
- `docs/acceptance/phase4-*`：完整验收证据及本报告。

## 手动复验步骤

1. 在仓库运行 `npm run build`。新建空临时目录，切换到该目录后运行 `F:/office_share/AI-Video/node_modules/.bin/tsx.cmd F:/office_share/AI-Video/scripts/phase4-ui.mts`。不能从仓库或已有 data 的目录运行此验收脚本。
2. 打开 http://localhost:3007，进入“文案 → 时长”，确认估算 20.0s、实测待合成。
3. 进入“旁白”，点击“生成整段旁白”，再回到“文案 → 时长”：两章实测各 20.0s，总估算 20.0s / 实测 40.0s。
4. 再点击“重新生成整段旁白”：复用两句音频，估算 40.0s / 实测 40.0s，样本数 2。检查临时目录 data/rate-table.json 及 data/current-project.json 的 actualSec。
5. 运行 `LLM_MOCK=true PHASE4_EVIDENCE=true npm test`（PowerShell 用 `$env:` 设置变量），复验分桶、窗口、重复回写、无效数据、锁定元数据、HTTP 错误和误差改善。

## 遗留与边界

- 本轮使用合成音频 fixture，不宣称真实 provider 的语速精度已完成验收；新 voice 无历史样本时回落既有五档速率。
- 只接收与全文章节文本相符、章节边界可由完整 utterance 确认的对齐。过期音轨、char-fallback、重叠/越界时间或跨章无法确认的边界不写实测、不训练，显示“待合成 / 对齐”；不按字数分摊伪造实测。实测包含原 utterance 音频自身时长，排除句间/尾部额外停留。
- 滑动窗口固定 20 条；为防止旧项目重开重复训练，指纹账本随合成次数增长。当前采用单进程文件存储，未引入数据库或多进程写锁。
- 构建仍有既有 bundle 大小警告，未做规格外拆包。
- 真实 token/cost 占位问题仍按 ERRATA E007 留到 Phase 6；ERRATA.md 本轮无新增条目。

完成后 commit 并 push origin longform，停止等待人工确认，不进入 Phase 5。
