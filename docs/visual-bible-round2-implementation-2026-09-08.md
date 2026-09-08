# 画面圣经二次验收修复报告（2026-09-08）

对照 `docs/visual-bible-reacceptance-2026-09-08.md` 与 `scripts/audit-visual-bible-round2-2026-09-08.mts`。

## 结论

**R01–R14 全部通过。** 二次验收列出的 F01–F10 工程缺陷已按生产链路修复。

**不能评为 9.5 分。** 方案硬门槛仍要求 100 篇人工标注和 20 个真实项目抽检；本轮未执行，真实效果待验收。工程层从 7.3 提升到可进入独立验收的状态，自评不代替评分。

## F01–F10 对应修复

| 编号 | 修复 |
|---|---|
| F01 / R01 / R11 | `/api/script/visual-bible` 委托 `compileVisualBible`。规则降级 `provenance=rule_fallback` 不阻止后续正式分析。 |
| F02 / R02 / T26 | `updateCharacterField` / 锁 / 参考图走 reducer 并重算 `bibleRevision`。提示词读写 `bibleRevision \|\| sourceHash`。 |
| F03 / R03 / R04 | 切锁读取卡面+override 现有三锁，只改目标字段。normalize 为已有锁补 override。上传图走 `set_entity_refs`。 |
| F04 / R05 / R10 | 显示名写入 override；ground 允许显示名与 canonical 不同。`applyAnalysisToBible` 应用 include/exclude。 |
| F05 / R09 | pinned 圣经重载不 ground、不改 sourceKey。 |
| F06 / R06–R08 | 代词按性别过滤；「他看向窗外」仍是人物动作；英文 He/She 继承主语。 |
| F07 / R14 | 实物 entityId 必须与台账名称对应。 |
| F08 | `receiveVisualBibleResponse` 接入 `ensureVisualBible`；角色参考图写回读取最新 project。 |
| F09 / R13 | 当前口播中消失的锁定角色进入 `retiredEntities`，不留在 active。 |
| F10 / R12 | `visualBibleHasBlockingWarnings` 读取 `issues.blocks`。 |

## 验证命令与结果

```
npm test                 # 通过
npm run lint             # 通过
npm run test:cast        # 通过
npm run test:bible       # 含 round1 + round2 审计
npx tsx scripts/audit-visual-bible-round2-2026-09-08.mts  # 14/14
```

## 仍未验收（阻止 9.5）

- 100 篇人工标注及精确率/召回率/误建率分子分母
- 20 个完整项目真实生图抽检
- T11–T32 中手动 occupancy 持久化、双人参考图供应商边界、容量上限等部分场景
- 浏览器端到端点击竞态

**工程修复完成，真实效果待验收。**
