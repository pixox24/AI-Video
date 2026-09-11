# AI-Video 长视频内容层 — 重构与增建规格书（v2）

> **本文档取代《ai-video-content-mvp-spec》（v1）。** v1 编写时未审查现有项目，其中技术栈、渲染、TTS、持久化等决策与 `pixox24/AI-Video` 现状冲突，v2 已逐项纠正（见第 1 节「相对 v1 的纠正清单」）。
> 本文档与《迁移边界书》（MIGRATION.md）配合使用；两者冲突处以本文档为准。
> 使用方式：将本文档 + MIGRATION.md + AGENTS.md 交给 AI 编程工具执行。

---

## 0. 项目定位（一句话）

在现有 AI-Video 工作台（文案 → 分镜 → 视觉 → 配音 → 字幕 → 时间线 → 导出全链路已存在）之上，**增建"长视频内容层"**：把文案模块从"表单驱动的分段生成器"升级为"观点承诺驱动、时长受预算约束、质量有评估闭环、成本可观测"的内容生产系统，目标场景为 YouTube 长视频（5–25 分钟）。

**核心原则（不可违反）：**
1. 观点决定讲什么，时长是工程预算不是创作主人。
2. 扩写只允许六类手段：证据、案例、推导、演示、反例、可执行步骤；禁止凑字数。
3. LLM 负责感知/规划/草稿/软评估；时长计算、Schema 校验、状态流转、成本控制由确定性代码完成。
4. 复用优先：凡现有代码已实现的能力，只扩展、不重建（见第 2 节资产清单）。

---

## 1. 相对 v1 的纠正清单（v1 已作废的部分）

| v1 决策 | 项目现实 | v2 纠正 |
|---|---|---|
| 迁移到 Next.js 15 + App Router | 现有 Vite + React SPA 含 133KB ScriptPanel、51KB TimelineBar、37KB mp4Exporter 等大量可用前端资产 | **保留 Vite + React**。不做框架迁移 |
| Prisma + SQLite 数据模型 | 现有 types.ts（25KB）类型体系完整，projectPersist/projectLibrary 本地项目库已工作 | **扩展 types.ts 与现有持久化**；DB 后置到 backlog |
| Remotion 服务端渲染 | mp4Exporter.ts 已实现客户端 MP4 导出（含音轨混合、进度回调、旁白轨道 stale 检测） | **复用 mp4Exporter**。删除 Remotion 方案 |
| 新建 TTS Provider 层（Edge-TTS） | ttsCatalog.ts 已有 Qwen/DashScope 等多供应商端点、voiceLibrary、ttsReuse 缓存、VoiceDesignWorkshop 声音设计 | **复用现有 TTS 层**，只加校准回写 |
| 新建 Scene 模型 + 分镜人物护栏 | StoryboardClip 已有 speechDuration+holdDuration 拆分；castStrategy/castCandidates 已实现实体分析驱动的出场决策 | **扩展现有模型与 castStrategy** |
| 新建字幕系统 | subtitleFormatter/Renderer/Fonts + secondaryText（LLM 双语字幕）已存在 | 不动 |
| 新建六页 UI | 现有工作台已有 SidebarNav 分阶段导航与文案阶段轨（intent→topic→research→duration→beats→copy→rhythm） | **在现有工作台内改造**，新增 Brief 阶段与质量面板 |
| 段落状态机新建 | types.ts 已有 SectionStatus（planned/drafting/ready/locked/needs-revision/failed）含锁定 | 直接复用 |
| ScriptForm 档位新建 | 已有 short/medium/long/extended 四形态 | 复用并叠加 DurationSpec 预算层 |

---

## 2. 现状资产清单（已核实存在，禁止重建）

### 2.1 文案链路（src/utils/）
- `scriptWorkspace.ts`（52KB）：七阶段阶段轨 ScriptStage（intent/topic/research/duration/beats/copy/rhythm）、意图入口（have-script/have-title/选题卡）、锁定标题、导演批注、预算环
- `scriptOutline.ts` / `scriptSections.ts`：大纲与章节规划（outlineFromPlans / planScriptSections）
- `scriptDraftEngine.ts`：`draftGate` 门禁（无大纲拒绝写稿）、`runSectionedDraft` 分段生成
- `scriptPrompts.ts`：OUTLINE_SYSTEM / SECTION_DRAFT_SYSTEM / SECTION_REVISE_SYSTEM 三段系统提示词（含 promise、evidenceIds、bridgeFromPrevious、禁止凑时长、禁止伪造来源）
- `scriptBudget.ts`（40KB）：DurationBudget（speechSeconds/maxChars/usedChars）、停留重分配
- `scriptEntity.ts`：实体/共指/证据跨度（ScriptEvidenceSpan）
- `scriptLanguage.ts`、`scriptSplit.ts`、`scriptAnalysis.ts`
- 测试资产：scriptLongform.test.ts（25KB）、scriptDraftEngine.test.ts 等

### 2.2 下游生产链路
- 分镜：StoryboardPanel、StoryboardClipCard、shotCoverage、`/api/script/split-text`（自由文本→结构化分镜）
- 角色：castStrategy / castCandidates（CastDecisionAllowed 等，实体分析→出场决策，非主角开关）
- 视觉：visualBible 体系（95KB+，实体 ID/证据引用/用户确认/锁定不变量）、stylePack/styleLibrary、`/api/visual/generate`、`/api/image-proxy`
- 配音：ttsCatalog（Qwen/DashScope 等）、voiceLibrary、ttsReuse、narrationTrack（timingsFromAlignment 实测对齐）、narrationAlignClient
- 字幕：subtitleFormatter/Renderer/Fonts、secondaryText（双语）
- 音频/音乐：audioEngine（29KB）、audioConcat、MusicPanel、sentenceGap
- 时间线与导出：TimelineBar、VideoPlayerStage、mp4Exporter、ExportModal、exportChecklist
- 设置：SettingsPanel（自定义 LLM 端点/key、图像 API）、ImageApiSettings、presets（34KB）、openAiModels、geminiNative

### 2.3 服务端（server.ts，Express，222KB 单体）
- 长视频链路：`/api/script/draft`、`/api/script/section-revise`
- `/api/script/generate` 已返回 410（短视频入口官方弃用）
- LLM 配置模式：前端按请求透传 `llmApi`（ClientLlmApi：endpoint+key+model），`provider==="builtin"` 时回落到内置 Gemini（@google/genai）

---

## 3. 差距分析：真正要新建的只有这些

| # | 缺失能力 | 现状差距 | 新建内容 |
|---|---|---|---|
| 1 | Brief 层（观众承诺） | 现有 intent/topic 阶段只有主题与素材，没有"观众看完能带走什么"的显式承诺 | `Brief` 类型 + workspace 新增 brief 阶段 + `/api/script/brief` |
| 2 | 长视频时长预算规格 | ScriptForm 有 long/extended 但只有档位标签，缺 target/min/max/容差/口播占比的形式化 | `DurationSpec` 类型 + preset 表 + 与 DurationBudget 打通 |
| 3 | 段级时长预算强约束 | 大纲章节有 promise/evidenceIds，无逐段口播/停留预算字段与校验 | OutlineSection 增加 `narrationBudgetSec/visualHoldBudgetSec` + 预算校验纯函数 |
| 4 | 留存设计字段 | 有 bridgeFromPrevious 承接，无显式 retentionDevice / transitionOut | OutlineSection 增加两字段 + prompt 增强（原句保留，只追加） |
| 5 | 主动质量评估闭环 | section-revise 是用户触发的被动修订；无架构/密度/事实/节奏四类主动检查 | evaluator 提示词 + `/api/script/quality-check` + QualityReport + 质量面板 + 一键修复 |
| 6 | 事实风险分级 | scriptEntity 有证据跨度，无 needsSource 标记与高风险声明管理 | `Claim` 类型（fact/opinion/prediction × low/high risk）+ 风险面板 |
| 7 | LLM 成本可观测 | 无任何调用记录 | `GenerationRun` 日志（stage/model/tokens/cost/耗时/promptHash），先 JSONL 文件落盘 |
| 8 | LLM Mock 模式 | 开发联调真实烧钱 | `LLM_MOCK=true` 时从 tests/fixtures 返回，覆盖所有 script 端点 |
| 9 | TTS 语速自校准 | narrationTrack 有实测时长，但未回写改进估算 | 速率表（provider+voice+pace 分桶滑动平均）→ 预算环显示估算 vs 实测 |
| 10 | server.ts 模块化 | 222KB 单体，无法安全扩展 | 拆分 `src-server/`（routes/services/llm/pipeline），API 行为不变的纯重构 |
| 11 | 巨型组件拆分 | ScriptPanel 133KB / SettingsPanel 83KB / App.tsx 80KB | 按阶段轨拆分为阶段画布组件（伴随 Phase 5 渐进进行） |

**明确不做（Non-Goals）**：框架迁移、数据库、Remotion、新 TTS 供应商、多用户、自动发布 YouTube、visualBible 本体重构、移动端。

---

## 4. 目标架构（最小改动原则）

```
AI-Video/
  server.ts                  # 瘦身为入口：只挂载路由（< 200 行）
  src-server/                # 【新建】服务端模块
    routes/                  # script.ts / visual.ts / quality.ts …按域拆分，handler 签名不变
    llm/
      gateway.ts             # 【新建】统一 LLM 出口：llmApi 透传解析、builtin 回落、
                             #   Mock 模式、GenerationRun 成本日志、schema 校验重试、幂等
      models.ts              # planner/drafter/evaluator 三角色 → 具体模型映射（可在设置中覆盖）
      prompts/               # 【从 src/utils/scriptPrompts.ts 迁入并增强】
    pipeline/
      brief.ts  blueprint.ts  script.ts  quality.ts   # 编排逻辑从 server.ts 剥离
    duration/
      engine.ts              # 【新建】时长估算/预算校验纯函数（吸收 scriptBudget 概念）
      calibration.ts         # 【新建】TTS 实测回写速率表
  src/
    types.ts                 # 【扩展】Brief / DurationSpec / Claim / QualityReport / OutlineSection 新字段
    utils/                   # 现有资产，按 MIGRATION.md 的 PORT/ADAPT 判定处理
    components/              # 现有工作台 + 【新增】BriefStage.tsx / QualityPanel.tsx
  data/
    generation-runs.jsonl    # 【新建】成本日志
    rate-table.json          # 【新建】TTS 校准速率表
  tests/fixtures/            # 【新建】LLM Mock 数据（每 stage 一份）
```

**LLM 调用新规**：所有端点禁止自行拼装 fetch/OpenAI 客户端，必须经 `src-server/llm/gateway.ts`：
```ts
generateStructured<T>({
  stage,              // 'brief' | 'blueprint' | 'script_section' | 'section_revise' | 'quality' | …
  role,               // 'planner' | 'drafter' | 'evaluator'
  clientLlmApi,       // 保留现有前端透传模式；role 映射可覆盖默认模型
  schema,             // Zod schema → JSON schema 约束输出；校验失败把错误喂回重试 ≤2 次
  system, buildUser,  // prompt 构造
  idempotencyKey,     // projectId+stage+输入hash，防重复点击
}): Promise<{ data: T; run: GenerationRun }>
```
Mock 模式：`LLM_MOCK=true` 时读 `tests/fixtures/{stage}.json`，UI/流水线联调零成本。

---

## 5. 数据模型扩展（在 types.ts 上增量添加，不新建 ORM）

```ts
// 【新增】时长预算规格 —— 叠加在 ScriptForm 之上
export type DurationPreset = 'insight' | 'deep_dive' | 'tutorial';
export interface DurationSpec {
  preset: DurationPreset;        // insight 5–8min → form:'long'
                                 // deep_dive 10–15min → form:'long'|'extended'
                                 // tutorial 15–25min → form:'extended'
  targetSeconds: number; minSeconds: number; maxSeconds: number;
  pace: ScriptPace;              // 复用现有五档
  narrationRatio: number;        // 口播占比：analysis 0.8 / tutorial 0.65
}

// 【新增】Brief —— 观众承诺层，落在 scriptWorkspace
export interface Brief {
  topic: string;                 // 复用 intent/topic 输入
  audience: { roles: string[]; knowledgeLevel: 'beginner'|'intermediate'|'advanced'; primaryNeed: string };
  objective: string;
  viewerPromise: string;         // 必填：看完能带走什么（一句话）
  contentType: 'analysis'|'tutorial'|'commentary'|'story';  // 映射现有 ScriptGenre
  mustCover: string[]; mustAvoid: string[];
  lockedFields: string[];        // 用户锁定字段，重生成禁止改动
}

// 【扩展】ScriptOutlineSection 增加：
//   narrationBudgetSec: number; visualHoldBudgetSec: number;
//   retentionDevice: string;     // 本段靠什么留住观众
//   transitionOut: string;       // 移交下一段的问题（现有 bridgeFromPrevious 的对偶）

// 【新增】Claim —— 事实风险（与 scriptEntity 的 ScriptEvidenceSpan 关联）
export interface Claim {
  id: string; sectionId: string; text: string;
  kind: 'fact'|'opinion'|'prediction';
  risk: 'low'|'high';            // 价格/性能/政策/人物/公司状态 = high
  needsSource: boolean; sourceUrl?: string; sourceNote?: string;
}

// 【新增】质量报告
export interface QualityIssue {
  sectionId?: string; severity: 'high'|'medium'|'low';
  kind: 'architecture'|'duration'|'fact_risk'|'pacing';
  message: string; suggestedFix: string;
}
export interface QualityReport { id: string; stage: string; issues: QualityIssue[]; createdAt: string; }

// 【新增】成本日志（JSONL 行）
export interface GenerationRun {
  id: string; projectId?: string; stage: string; model: string;
  inputTokens: number; outputTokens: number; costUsd: number;
  durationMs: number; status: 'success'|'failed'|'mocked'; promptHash: string; createdAt: string;
}
```

SectionStatus 现有五态（planned/drafting/ready/locked/needs-revision/failed）**原样复用**；locked 段在所有重生成与修订路径中禁止改动——此不变量写入 gateway 与每个修订端点。

---

## 6. 时长引擎（src-server/duration/engine.ts，纯函数，禁止 LLM）

```
estimateNarrationSeconds(text, lang, pace)   // 初始速率：zh standard ≈ 4.1 字/秒；en standard ≈ 2.35 词/秒
sectionEstimatedTotal(section)               // = 口播估算 + visualHoldBudgetSec
projectEstimate(sections)
checkDuration(spec, sections)                // → { pass, verdict: too_short|in_range|too_long, deltaToMin, deltaToMax }
```

**校准闭环**：TTS 合成后，从 narrationTrack 的对齐结果取每段实测秒数，`calibration.ts` 按 (provider, voice, pace) 分桶做滑动平均更新 `data/rate-table.json`；估算一律以代码为准，禁止采信模型自报时长。预算环 UI 增加"估算 vs 实测"对比显示。

**时长修复白名单（写进修订 prompt）**：过短时只允许六类扩写——证据/案例/推导/演示/反例/可执行步骤；过长时优先删除重复、背景噪音、无效转场、空洞修辞，禁止删除结论成立所需的论证。

---

## 7. Prompt 契约（在现有三段系统提示词上增强）

**铁律：OUTLINE_SYSTEM / SECTION_DRAFT_SYSTEM / SECTION_REVISE_SYSTEM 的原文句子原样保留，只允许追加新变量与条款。** 三段原文已在 MIGRATION.md 第 3 节摘录基准。

### 7.1 大纲（planner）追加
- 注入 `{{durationSpec}}`（target/min/max/pace/narrationRatio 与换算字数区间）
- 每段必须输出 `narrationBudgetSec / visualHoldBudgetSec / retentionDevice / transitionOut`，各段预算之和 ∈ 口播总预算 ±10%
- hook 段 ≤ 35s，30 秒内交付第一份实质信息，禁止频道介绍与长铺垫
- 注入 `{{brief.viewerPromise}}`，全片唯一核心命题须与其一致

### 7.2 分段草稿（drafter）追加
- 注入本段 `charMin–charMax`（由 engine 换算）、`lockedClaims`（禁止改动清单）
- 追加扩写白名单与"禁止伪造来源、数据、人物和案例"的强化表述（无来源事实必须标记 Claim.needsSource=true）
- 输出增加 `claims[]`（kind/risk/needsSource）

### 7.3 评估器（evaluator，新建）
按四类标准输出 `QualityIssue[]`：架构一致性（承诺/开头/结尾）、时长密度（水段与超密段）、事实风险（fact 且 needsSource）、节奏留存（前 30 秒价值、中段钩子、段间断裂、结尾拖延）。
**修订循环由代码控制**：Issue 按 sectionId 分组 → 仅对有问题的未锁定段调用 SECTION_REVISE → 最多 2 轮；禁止全文重写。

---

## 8. API 变更（增量，不破坏现有端点）

| 端点 | 说明 |
|---|---|
| `POST /api/script/brief` | 【新】由自由输入生成/重生成 Brief（planner） |
| `POST /api/script/outline`（现有链路增强） | 请求体增加 durationSpec + brief；响应增加段级预算与留存字段 |
| `POST /api/script/draft`（现有增强） | 逐段经 gateway；响应增加 claims[] 与 estimatedSec |
| `POST /api/script/section-revise`（现有增强） | 支持携带 QualityIssue.suggestedFix 的定向修复；locked 段 403 |
| `POST /api/script/quality-check` | 【新】运行四类评估，返回 QualityReport |
| `GET /api/usage?projectId=` | 【新】成本日志查询（读 JSONL） |
| `/api/script/generate` | 保持 410，不恢复 |

所有生成类端点：幂等键去重 + gateway 成本记录。前端 workspace 的 fetch 调用相应增加 durationSpec/brief 透传。

---

## 9. 前端变更（在现有工作台内，不新建应用）

1. **文案阶段轨新增 `brief` 阶段**（置于 intent 之后、duration 之前）：表单含 viewerPromise（必填，未填禁止进入大纲）、受众、mustCover/mustAvoid、时长 preset 三档卡（5–8 / 10–15 / 15–25 分钟，显示对应 form 与预算环预览）。
2. **预算环增强**：duration/beats/copy/rhythm 各阶段显示"预计口播 Xs / 预算 Ys"三态指示（超红/不足黄/达标绿）；TTS 后追加"实测 Zs"。
3. **QualityPanel.tsx（新增）**：按 severity 分组展示 Issue，点击跳转对应段落，未锁定段提供"一键修复"（携带 suggestedFix 调 section-revise）。
4. **Claims 风险标记**：copy/rhythm 阶段对 needsSource=true 的句子高亮，hover 显示来源填写入口。
5. **设置页**：新增 planner/drafter/evaluator 角色模型映射（默认沿用 customLlmApi，可单独覆盖）；速率表只读展示。
6. **组件拆分（渐进）**：ScriptPanel（133KB）按阶段轨拆为每阶段一个画布组件；拆分仅限 UI 组合层，禁止改动 utils 纯函数的签名与行为。

---

## 10. 分阶段落地计划（每阶段以"现有测试全绿 + 新增验收通过"为门禁）

### Phase 0 — 服务端拆分与 LLM 地基（1–2 天，纯重构）
任务：建 `src-server/`，把 server.ts 按域拆成 routes + 剥离 pipeline；实现 gateway（llmApi 透传兼容、builtin 回落、Mock 模式、GenerationRun JSONL、Zod 校验重试、幂等）；server.ts 瘦身为挂载入口。
✅ 验收：全部现有测试通过；`curl` 对照拆分前后 `/api/script/draft`、`/api/visual/generate` 等端点响应结构一致；`LLM_MOCK=true` 下 draft 全流程走 fixture 零真实调用；每次调用写入 generation-runs.jsonl。

### Phase 1 — Brief 层 + DurationSpec（1–2 天）
任务：types 扩展；brief 阶段 UI；`/api/script/brief`；preset→form 映射；预算环预览。
✅ 验收：viewerPromise 为空时无法进入大纲阶段；选 deep_dive 档后大纲请求携带正确 DurationSpec；Mock 下 Brief 生成符合 schema。

### Phase 2 — Blueprint 增强（1–2 天）
任务：大纲 prompt 增强（原句保留）；段级预算字段 + 校验纯函数；retentionDevice/transitionOut 落库并在 outline 画布可编辑。
✅ 验收：大纲响应通过 schema 且预算总和 ∈ 口播预算 ±10%；hook ≤35s；用户锁定的大纲段在重生成时内容不变；scriptLongform 测试全绿。

### Phase 3 — 质量评估闭环（2 天）
任务：evaluator prompt；`/api/script/quality-check`；QualityPanel；一键修复接 section-revise；Claim 风险标记。
✅ 验收：人为删短某段 40% → quality-check 报 duration 类 Issue → 一键修复后回到 in_range；伪造数据测试句被标 fact/high/needsSource；最多 2 轮修订由代码强制。

### Phase 4 — TTS 校准（1 天）
任务：calibration.ts；narrationTrack 实测写回；rate-table.json；预算环"估算 vs 实测"。
✅ 验收：合成后每段 actualSec 可见；同一 voice 第二次生成的估算误差小于第一次（用测试 fixture 模拟）。

### Phase 5 — 前端整合与拆分（1–2 天）
任务：BriefStage 打磨；ScriptPanel 按阶段拆分；App.tsx 减负；成本面板（读 /api/usage）。
✅ 验收：utils 纯函数零改动（git diff 仅 components/）；每个阶段画布可独立渲染；按项目/阶段聚合的成本视图可用。

### Phase 6 — 回归与文档（0.5–1 天）
任务：全量回归（含 visualBible 三个测试文件）；README 更新；AGENTS.md 定稿。
✅ 验收：从零走完「brief → 大纲 → 草稿 → 质检 → 修复 → TTS → 导出 MP4」全流程；Mock 模式与真实模式各跑通一次。

**Backlog（不实现，建 issue）**：DB 持久化、YouTube 留存数据回写形成频道规则、visualBible 与长视频内容层深度联动、词级字幕对齐。

---

## 11. 风险与对策

| 风险 | 对策 |
|---|---|
| 拆 server.ts 引入回归 | Phase 0 纯重构、端点签名冻结、响应结构 diff 对照、现有测试为门禁 |
| prompt 增强破坏现有生成质量 | 原句保留铁律；增强前后用同一 fixture 主题各跑一次对照，人工评审 |
| 预算约束过紧导致内容干瘪 | 校验只警告不硬阻断（locked 除外）；白名单引导扩写方向 |
| 客户端透传 llmApi 的安全面 | gateway 内保留该模式（产品特性），但 GenerationRun 不落 apiKey，只落 model/endpoint 域名 |
| 巨型组件拆分失控 | 只拆组合层；utils 签名冻结；每拆一块跑全量测试 |

---

## 12. AGENTS.md 执行规则（v2，覆盖 v1 版本）

```markdown
# AGENTS.md

## 项目
AI-Video 长视频内容层重构与增建。权威文档：SPEC-v2.md（本规格书）+
MIGRATION.md（旧代码去留与提示词基准）。冲突时停下报告，禁止自行修改文档。

## 命令
- 开发: npm run dev（LLM_MOCK=true）
- 测试: npm test
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
9. TypeScript strict，不允许 any；新增纯函数必须配单测。
10. 每个 Phase 完成后输出：变更文件清单、验收逐项结果（附命令输出证据）、
    手动验证步骤、遗留问题。
```
