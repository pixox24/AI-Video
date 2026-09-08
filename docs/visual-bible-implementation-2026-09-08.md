# 画面圣经实施与验证报告（2026-09-08）

对照 `docs/visual-bible-optimization-plan.md` 与 `docs/visual-bible-acceptance-2026-09-08.md` 完成本轮修复。工程门槛已关闭 B01–B08 与 T01–T10。真实模型/生图/100 篇标注评测未执行，不能自称 9.5 分。

## 1. B01–B08 根因、修复与测试

| 编号 | 根因 | 修复 | 测试 |
|---|---|---|---|
| B01 | `sourceFingerprint` 混入生成实体 ID，刚生成即 stale；缓存比较错误指纹 | 输入指纹只含规范化 AnalysisInput（`sourceKey`）。结果版本用 `bibleRevision`。缓存按 sourceKey 命中 | T01、T02、审计「刚生成是否误报过期」「相同输入缓存」 |
| B02 | 确认/拒绝只改展示数组，随后 `groundVisualBible` 重建台账撤销决定 | `overrides[entityId].decision = include/exclude`，ledger 与 ground/fallback 读取该决定；UI `patchBible` 不再每次 ground | T03、T04、审计确认/拒绝 |
| B03 | 前端把已验证台账降成 candidates 再按「故事」体裁补角色 | 从 ledger 还原 analysis；`!hasCast` 时不再用叙事信号补卡；加载 sourceKey 一致则不重新挖人 | T05、审计「服务端不建角色」 |
| B04 | 证据只需是原文子串，李小红可借用王小明的句子 | `evidenceBelongsToEntity`：具名实体必须出现在证据中；匿名/第一人称用描述/人称匹配 | T06、审计「借用真实句子」 |
| B05 | `mergeVisualBible` 按卡 ID（char-lead）搬运外形 | 按 `entityId` 对齐；卡 ID 相同但实体不同不串脸 | T07、审计「同卡 ID 串人」 |
| B06 | `carryCharacter` 用 `locked && refs.length` 把 refsLocked 推回 true | 一次性锁迁移；显式 false 保留；refs=false 重编清除活动引用 | T08、T18、审计「关闭参考图锁」 |
| B07 | occupancy 只认本句姓名，代词镜变无人 | 向前回溯已验证具名主体；insert/环境镜仍可无人 | T09、T23、审计「代词上镜」 |
| B08 | subjects 只去重不校验 | 与角色共用证据/ID 校验；虚构产品丢弃 | T10、审计「虚构产品」 |

主要文件：`src/utils/visualBibleSource.ts`、`visualBibleState.ts`、`visualBibleMigration.ts`、`scriptEntity.ts`、`visualBible.ts`、`src/services/visualBibleService.ts`、`server.ts`、`ScriptPanel.tsx`、`scriptWorkspace.ts`、`imagePrompt.ts`、`projectPersist.ts`。

## 2. V2 契约与权威位置

| 数据 | 权威位置 | 说明 |
|---|---|---|
| 分析事实 | `entityLedger` + `sourceKey` | 实体、证据、contentType、provenance |
| 用户决定 | `overrides[entityId]` | include/exclude/auto、三锁、显示名、外形 |
| 派生卡面 | `characters` / `subjects` / `pendingCharacters` | 由事实+决定派生，不能反向覆盖台账 |
| 输入指纹 | `sourceKey` / `sourceFingerprint` | 不含实体 ID、时间戳、锁 |
| 结果版本 | `bibleRevision` | 外形/参考图/选择变化后提示词失效 |

`candidateId`、聚合 `locked` 仅为兼容投影。

## 3. 迁移与资产

- 仅旧 `locked=true`、无新锁字段 → 三锁 true。
- 任一新锁字段存在 → 尊重显式布尔值，不再从聚合 locked 反推。
- object 卡迁到 subjects，经同样证据校验。
- `slimBible` / `collectReferencedAssetUrls` 覆盖 pending 与 retired 引用。
- 跨稿锁定旧人暂仍作为 locked 卡保留并告警，完整 retired 区尚未在所有换稿路径自动归档。

## 4. T01–T32 执行情况

命令：

```
npm test
npm run test:bible
npm run test:cast
npm run lint
```

| 范围 | 结果 |
|---|---|
| T01–T10 | 通过（`visualBible.acceptance.test.ts` + `scripts/audit-visual-bible-2026-09-08.mts`） |
| T12、T18、T23、T26 | 通过 |
| 既有 contract / cast / longform | 通过 |
| T11、T13–T17、T19–T22、T24–T25、T27–T32 | 未全部单独立项；部分语义已由 B01–B08 覆盖，其余见第 8 节 |

`npm test` 当前 54 项。`npx tsx scripts/audit-visual-bible-2026-09-08.mts` 已改为调用 `compileVisualBible`，不再解析 `server.ts` 路由字符串。

## 5. 真实文案评测

未执行。没有 100 篇人工标注集，没有精确率/召回率分子分母。待验收。

## 6. 真实生图抽检

未执行。待验收。

## 7. 多参考图

当前生图路径仍主要发送单张 `characterRef`。UI 未宣称「已锁两人的脸」。多参考图供应商能力未接。T29 待验收。

## 8. 剩余问题与是否具备 9.5 分独立验收

已完成：B01–B08 关闭，T01–T10 通过，lint 通过，专项审计通过。工程修复可进入下一轮独立验收的**代码门槛**。

尚未完成、不能评为 9.5：

- T11–T32 未全部铺开（手动 occupancy、异步旧响应、双人参考图、容量上限等）。
- 句级 mention/event 快照尚未成为分析 schema 的一等字段；代词回溯是 occupancy 规则，不是完整共指图。
- 换稿后锁定旧角色仍可能留在 active 并告警，而不是一律进入 retired。
- 100 篇标注与 20 个真实项目抽检未做。
- `npm run build` 本轮未作为阻塞项重跑（lint/tsc 已通过）。

结论：**工程修复完成，真实效果待验收。** 不得以本报告代替 9.5 分评分。
