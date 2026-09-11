# Phase 7 规格增量 — Writing Style Pack（文案风格包）

> 本文档是 SPEC-v2 的增量，必须与 SPEC-v2、MIGRATION.md、AGENTS.md、ERRATA.md 一起使用。
> 冲突时以本文档对 Phase 7 的定义为准；其余章节沿用 SPEC-v2。
> 前置条件：Phase 0–6 全部通过验收（尤其 Phase 1 ContentBrief、Phase 2 段级预算、Phase 3 质检闭环）。

---

## 1. 立项依据（为什么是正向优化）

LLM 无风格约束时输出回归到该模型的"统计平均嗓音"——通顺、平庸、安全；换模型即换嗓音。
现有项目的三个事实：

1. **视觉侧已有同款解法并被验证**：`src/utils/presets.ts` 的 `STYLE_DEFINITIONS` 用"结构化定义 + promptSuffix 指令片段"约束了画面风格；文案侧是空白。
2. **类型系统无风格轴**：`types.ts` 中不存在 writingStyle/tone/voice 任何字段；`ScriptGenre`（题材）与 `ScriptPace`（节奏）是两个正交轴，风格（"怎么说话"）是缺失的第三轴。
3. **接入点全部就绪**：ContentBrief 字段锁体系、prompt"只追加"铁律、Phase 3 的 evaluator–optimizer 循环、`styleInferClient` 的"从样例反推"UX 模式。

有效性原则（写入本规格，执行时不得违背）：
- 规则必须具体可执行（"每 3–5 句出现一个具体数字或具名案例"），禁止形容词汤（"犀利一点"）。
- 样例优于描述：每档风格配 1 段 few-shot 范例 + 1 段反例。
- 评估闭环：风格符合度由 Phase 3 evaluator 的第五类检查 `style` 评分，不靠生成时自觉。

## 2. 范围

### 2.1 做（In Scope）
- `WritingStyleProfile` 类型 + 内置风格档案 + 自定义档案（从样例反推）
- ContentBrief 增加 `writingStyleId`（进字段锁体系）
- SECTION_DRAFT_SYSTEM / SECTION_REVISE_SYSTEM 的风格约束**追加块**（原句保留铁律不变）
- `styleLint` 纯函数（确定性机械规则检查：禁用词、句长分布、抽象占位词）
- Evaluator 新增 `style` 检查类（rubric 评分 + Issue 输出）
- BriefStage UI：风格选择卡片；QualityPanel：风格 Issue 展示
- 风格样例反推端点（复用 styleInferClient 模式）

### 2.2 不做（Non-Goals）
- 不改 SECTION_DRAFT/REVISE 原句；不动 OUTLINE_SYSTEM
- 不做风格微调（fine-tuning）；不做跨项目风格继承/共享
- 不引入新依赖；不动 visualBible、分镜、TTS、导出任何下游模块
- 风格 Issue 不做硬阻断（severity 上限 medium，永不 block 导出）

## 3. 数据模型扩展（types.ts 增量）

```ts
// 【新增】写作风格档案
export interface WritingStyleProfile {
  id: string;                    // builtin: 'analyst'|'narrator'|'pundit'；custom: 'custom-<ts>'
  kind: 'builtin' | 'custom';
  label: string;                 // 显示名，如「冷静拆解」
  description: string;           // 一句话说明，用于选择卡片
  // —— 以下为注入 prompt 的内容 ——
  rules: string[];               // 5–8 条具体可执行规则（正例句式/密度/视角约束）
  bannedPatterns: string[];      // 禁用表达（喂 styleLint 与 prompt 双重使用）
  exemplar: string;              // 1 段范例文案（few-shot）
  counterExemplar: string;       // 1 段反例（"不要写成这样"）
  // —— 元信息 ——
  derivedFromSamples: boolean;   // custom 且从用户样例反推时为 true
  locked: boolean;               // 用户确认后锁定，反推/编辑时禁止改动
}

// 【扩展】ContentBrief 增加：
//   writingStyleId?: string;   // 未选 = 不加风格约束（保持现状行为，向后兼容）
//   writingStyleId 纳入七类字段锁体系
```

## 4. 内置风格档案（src/utils/writingStylePresets.ts）

三档内置档案，规则用中文书写，每档 5–8 条 + 范例/反例各一段。**档案内容必须基于真实优质文案归纳，禁止凭空堆砌形容词。**（首版档案可由用户本人提供的历史文案反推生成，再人工审定入库。）

| id | label | 风格内核（规则方向） |
|---|---|---|
| `analyst` | 冷静拆解 | 先结论后论证；每段一个明确判断；数字与机制优先于感受；拒绝煽情词 |
| `narrator` | 故事叙事 | 场景化开场；细节驱动；悬念延迟释放；段落以画面/动作收束 |
| `pundit` | 犀利观点 | 短句为主；立场先行；敢于下判断；反问与对比作为主要修辞 |

`bannedPatterns` 首批内置通用项（所有档案共享的基础禁令，各档案可追加）：
`["众所周知", "显而易见", "毋庸置疑", "不得不说", "总的来说", "总的来说呢"]`
——与 SECTION_DRAFT_SYSTEM 既有禁令（"很有氛围""电影感"类）同一思路，从 prompt 自觉升级为 prompt + 代码双重约束。

## 5. Prompt 追加块（严格"只追加"）

### 5.1 SECTION_DRAFT_SYSTEM 追加（仅当选中风格时注入）

```
【写作风格】按「{{styleLabel}}」执行：
{{rules 逐条列出}}
禁止表达：{{bannedPatterns}}
范例（就照这个语感写）：「{{exemplar}}」
反例（不要写成这样）：「{{counterExemplar}}」
风格约束不改变本章 promise、证据约束与时长预算；冲突时内容与时长优先。
```

### 5.2 SECTION_REVISE_SYSTEM 追加（风格 Issue 修复时）

```
【风格修复】本次修订需使本章符合「{{styleLabel}}」：{{violatedRules}}
只调整表达方式，不改变事实、论证结构与时长预算。
```

### 5.3 反推提示词（planner 角色，新增）

输入 2–3 篇用户历史文案，输出 WritingStyleProfile 草稿（rules/bannedPatterns/exemplar 从样例中摘录而非编造）。走 gateway，Zod 严格 schema。

## 6. 确定性风格检查（src-server/style/lint.ts，纯函数）

```ts
export function styleLint(narration: string, profile: WritingStyleProfile): StyleViolation[]
// 检查项（全部确定性，不调 LLM）：
// 1. bannedPatterns 命中
// 2. 句长分布偏离档案阈值（档案 rules 中声明的句长上限，如 pundit 档「单句 ≤ 25 字占比 ≥ 60%」）
// 3. 抽象占位词表（与既有禁令同源扩展）
```

风格 Lint 结果并入 QualityIssue（kind: 'style'），severity 上限 medium。

## 7. Evaluator 扩展（Phase 3 闭环的第五类检查）

在现有四类检查（architecture/duration/fact_risk/pacing）后追加 `style` 类评估条款（追加进评估器 prompt，位于 src-server/llm/prompts/）：
- 逐段对照所选档案 rules，输出符合/违反及证据句
- 风格 Issue 在修复循环中的优先级低于 fact_risk 与 duration；两轮上限不变
- 未选中风格（writingStyleId 为空）时跳过 style 检查——零行为变化

## 8. API 变更（增量）

| 端点 | 说明 |
|---|---|
| `GET /api/writing-styles` | 列出内置 + 当前项目自定义档案 |
| `POST /api/writing-styles/infer` | 【新】从用户样例反推档案草稿（planner + Zod schema） |
| `POST /api/writing-styles` | 【新】保存自定义档案（锁定后不可改，只可另存） |
| 现有 outline/draft/revise | 请求体增加可选 `writingStyleId`；为空时行为与现状完全一致（向后兼容验收项） |

## 9. 前端变更

- **BriefStage**：风格选择卡片（三档内置 + 自定义），附 description 与 exemplar 预览；未选择 = 默认无约束
- **设置页**：自定义档案管理（粘贴样例 → 反推 → 预览 → 确认锁定）
- **QualityPanel**：style 类 Issue 分组展示，一键修复走既有 section-revise 链路
- **文案画布**：句级禁用词命中高亮（由 styleLint 驱动，纯前端调用共享 lint 逻辑）

## 10. 验收标准

| # | 验收项 | 证据要求 |
|---|---|---|
| 1 | 未选风格时全流程行为与 Phase 6 完全一致 | 对照测试：同一 fixture 主题两次运行输出一致 |
| 2 | 选中 `pundit` 档后，Mock 模式下草稿 prompt 含完整风格追加块 | fixture 断言 prompt 快照 |
| 3 | styleLint 对含"众所周知"的句子输出 violation | 单测 |
| 4 | evaluator 对不符合档案的段落输出 kind=style 的 Issue | 单测 + Mock 全流程 |
| 5 | 风格修复后该段符合档案且 promise/时长不变 | 修复前后对照证据 |
| 6 | 三段系统提示词原句零改动 | git diff 核验（删除行仅闭合符 artifact） |
| 7 | 反推端点输出通过 Zod schema，exemplar 必须为用户样例原文片段 | 单测断言 exemplar ⊆ 输入样例 |
| 8 | npm test / lint / build 全绿；既有测试语义零改动 | 测试数阶梯增长，基线文件字节不变 |

## 11. 执行协议

沿用 AGENTS.md 既有协议：本阶段一次完成；完成后输出《Phase 7 完成报告》（变更清单 / 验收逐项 ✅❌ 附证据 / 手动验证步骤 / ERRATA 新增），commit 并 `push origin longform`，停止等待确认。
全程 `LLM_MOCK=true` 开发与自验；真实模型风格效果留待用户手动体验反馈，不作为本阶段验收门禁。
