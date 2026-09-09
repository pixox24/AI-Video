# AI-Video 文案模块盘点与迁移边界书

> **本文档必须配合《AI 长视频内容生成器 — MVP 产品与技术规格书》（SPEC.md）一起使用。**
> SPEC.md 定义目标架构；本文档定义旧仓库 `https://github.com/pixox24/AI-Video` 中文案（Script）模块的去留、移植映射与提示词资产。
> 使用方式：将 SPEC.md + 本文档一起交给 AI 编程工具。旧仓库设为**只读参考**，禁止在其上直接修改。

---

## 0. 盘点范围与可信度声明

本盘点基于：仓库目录结构、GitHub 代码搜索返回的关键代码片段、`docs/` 下的设计文档片段、类型定义片段。
**未做全量逐行审查。** 凡本文档标记为 PORT（原样移植）的文件，执行工具在迁移时必须先完整阅读该文件全文再动手；如发现实现与本文档描述冲突，以代码实际行为为准并停下来报告。

旧项目技术形态：Vite + React SPA 前端 + 单一 222KB `server.ts` 后端。SPEC 目标形态：Next.js 15 + Prisma/SQLite + 分层 server。因此**不存在"直接接入"，只存在"移植"与"重写"**。

---

## 1. 去留判定总表

判定含义：
- **PORT**：原样移植，连同其 `.test.ts` 一起搬进新仓库，跑绿即完成。
- **ADAPT**：核心概念与算法保留，接口按 SPEC 改造（主要是数据源从"前端状态/localStorage"改为"Prisma 模型"，调用从"直连 LLM"改为"走 gateway"）。
- **REWRITE**：概念保留，代码废弃重写（通常是逻辑缠在巨型组件/单体文件里，无法干净剥离）。
- **DROP**：删除，不再需要（短视频遗留或已被 SPEC 方案取代）。

### 1.1 文案生成核心（src/utils/script*.ts）

| 旧文件 | 职责 | 判定 | 映射到 SPEC 的位置 |
|---|---|---|---|
| `scriptPrompts.ts` | 三段系统提示词：OUTLINE_SYSTEM / SECTION_DRAFT_SYSTEM / SECTION_REVISE_SYSTEM | **ADAPT**（原文质量高，需注入 SPEC 的时长预算与锁定字段变量） | `server/llm/prompts/` |
| `scriptDraftEngine.ts` + 测试 | `draftGate`（outline_required → write-sections 门禁）、`runSectionedDraft` 分段生成、`seedSectionsFromOutline` | **ADAPT** | `server/pipeline/script.ts` |
| `scriptOutline.ts` | `outlineFromPlans` 大纲生成 | **ADAPT** | `server/pipeline/blueprint.ts` |
| `scriptSections.ts` | `planScriptSections` 章节规划 | **ADAPT** | 并入 blueprint.ts |
| `scriptBudget.ts` | DurationBudget（speechSeconds / maxChars / usedChars）、`redistributeHolds` 停留重分配 | **ADAPT**（保留预算概念；镜头停留重分配逻辑降级为分镜阶段参考） | `server/duration/engine.ts` |
| `scriptDuration.ts` | 时长→镜头数预估（0.8s 粒度 ForecastShot） | **DROP**（短视频镜头预测逻辑；长视频由 SPEC Storyboard 阶段 + 场景时长护栏取代） | — |
| `scriptEntity.ts` | 实体/共指/动作主体抽取，`ScriptEvidenceSpan`、`evidenceInNarration` | **PORT**（这是现成的事实证据追踪，正是 SPEC 的 Claim/needsSource 雏形） | `server/pipeline/claims.ts` |
| `scriptLanguage.ts` | 中英文归一化 | **PORT** | `server/duration/` 共用 |
| `scriptSplit.ts` | 文案切分 | **PORT**（TTS 分段与字幕切分复用） | `server/tts/` |
| `scriptAnalysis.ts` | 文案分析 | **ADAPT**（并入 evaluator 评估器） | `server/pipeline/quality.ts` |
| `scriptDraft.ts` | 草稿逻辑 | **REWRITE**（与旧表单状态耦合） | script.ts 内部 |
| `scriptWorkspace.ts` (52KB) | 文案预制作台：意图轨、选题卡、锁标题、导演批注、预算环 | **REWRITE**（概念极有价值——意图入口/导演批注/预算环都保留进 SPEC；但这团状态机必须按 SPEC 的 Brief/Blueprint 两页重设计） | SPEC Brief 页 + Outline 页 |
| `scriptLongform.test.ts` 等测试 | 长文生成回归测试 | **PORT**（作为迁移验收的测试资产） | `tests/` |

### 1.2 与文案强耦合的周边模块

| 旧文件 | 职责 | 判定 | 说明 |
|---|---|---|---|
| `narrationTrack.ts` (32KB) + `narrationAlignClient.ts` | 旁白对齐：`timingsFromAlignment`、`SpeechClip`、`NarrationAlignment`、真实 audioDuration | **ADAPT** | 这是 SPEC「TTS 实测时长回写校准」的现成实现，接 `Section.actualSec` |
| `castStrategy.ts` + `castCandidates.ts` + 测试 | 角色出场决策（CastDecisionAllowed 等） | **ADAPT** | 即 SPEC 分镜 `requiresCharacter` 护栏的已实现思路：实体分析 → occupancy → 出场决策，不是简单主角开关 |
| `visualBible*.ts` (95KB+) | 视觉圣经：实体 ID、证据引用、用户确认与锁定作为强不变量 | **不在本 MVP 范围** | 体量独立，按 SPEC Non-Goals 后置；但其「实体 ID + 用户确认 + 锁定不变量」三原则必须写进 SPEC 分镜阶段 |
| `ttsCatalog.ts` / `voiceLibrary.ts` / `VoiceDesignWorkshop.tsx` | TTS 声音目录与试听 | **ADAPT** | SPEC Settings 页的 TTS 配置数据来源 |
| `projectPersist.ts` / `projectLibrary.ts` | localStorage 项目持久化 | **DROP** | 由 Prisma/SQLite 取代 |
| `server.ts` (222KB 单体) | 全部 API | **REWRITE** | 拆为 SPEC 第 9 节的 Route Handlers；其中 `/api/script/generate` 已返回 410（官方弃用短视频入口），确认长视频链路是 `/api/script/draft` + `/api/script/section-revise` |
| `ScriptPanel.tsx` (133KB) / `ScriptOutlineStage.tsx` / `App.tsx` (80KB) | 前端巨型组件 | **REWRITE** | 按 SPEC 六页（Brief/Outline/Script/Storyboard/Quality/Render）重新设计，禁止搬运 |

### 1.3 docs/ 资产

| 文档 | 判定 |
|---|---|
| `docs/longform-script-generation-plan.md` | **保留参考**：已包含「目标口播 X 字/词，允许 Y–Z；预计口播 A 秒、画面停留 B 秒」与短视频/段落视频/章节视频/深度长视频分档——与 SPEC DurationSpec 一致，作为需求出处 |
| `docs/script-workspace.md` | **保留参考**：意图轨/预算环/导演批注的交互出处 |
| `docs/visual-bible-*.md`（多份验收文档） | **保留参考**：后置；其中「实体 ID、证据引用、用户确认和锁定行为作为强不变量校验」「不要通过全局默认主角补回」等验收原则抄入 SPEC 分镜阶段 |
| `docs/visual-style-pack.md` / `shot-coverage.md` | 后置参考 |

---

## 2. 数据模型映射（types.ts → SPEC Prisma）

| 旧类型（types.ts） | SPEC 模型 | 映射说明 |
|---|---|---|
| `ScriptGenre`（科普/反常识/故事/教程/带货/情绪/热点解读/口播金句） | `Brief.contentType` | 保留中文枚举值，归并为 analysis/tutorial/commentary/story 四类， genre 作为子标签存入 JSON |
| `ScriptPace`（ultrafast…cinematic 五档） | `DurationSpec.pace` | 归并三档：fast/standard/deep；cinematic ≈ deep + 更高 visualHold 占比 |
| `ScriptPlatform`（douyin/shipinhao/reels/bilibili/youtube） | 删除 | MVP 只服务 YouTube 长视频；platform 字段保留但固定 `youtube_long_form` |
| `BeatFunction` / `ScriptSectionRole`（hook/setup/body/turn/proof/reveal/cta） | `Section.role` | 映射为 SPEC 六枚举：hook→hook、setup→context、body/proof→core_argument、turn→counter、reveal→framework、cta→conclusion |
| `ScriptOutlineSection`（id/order/title/promise/…） | `Section`（蓝图态字段） | `promise` → `viewerQuestion` + `claim`；保留 evidenceIds 概念 → `evidenceNeeds` |
| `ScriptEvidenceSpan` | `Claim` | `source='narration'` 等来源标记 → `Claim.kind/needsSource` |
| `DurationBudget`（speechSeconds/maxChars） | `DurationSpec` + engine 计算结果 | 概念同构，存储进 Project.durationSpec JSON |
| `NarrationAlignment` / 实测 audioDuration | `Section.actualSec` + 校准速率表 | 见 SPEC 5.2 校准闭环 |
| CastDecision（castStrategy） | `Scene.requiresCharacter/characterRef` | 决策逻辑保留，输出落 Scene |
| ScriptWorkspace 的 intent（have-script / have-title / 选题卡） | Brief 页三入口 | 保留「有文案」「有标题」两个直接入口；选题卡简化为 planner 模型生成 3 个角度供选择 |

---

## 3. 提示词资产迁移（重点）

以下三段系统提示词是旧项目最有价值的资产之一，其理念与 SPEC 完全一致（分段职责、证据约束、禁止凑时长、禁止伪造）。**已核实的原文摘录如下，迁移时以仓库文件全文为准。**

### 3.1 OUTLINE_SYSTEM（已核实片段）

> 你是长视频编导与结构编辑，不是一次性文案续写器。
> 先规划观众获得信息的顺序，再写章节。
> 不得把用户未提供或未确认的事实写成事实；不确定的内容标为观点或待核实。
> 每章只完成一个明确任务，并且必须给观众带来新的信息、证据、步骤或因果推进。
> …不得为了填满时长重复题目、重复结论或写空泛过渡。只输出指定 JSON，禁止 Markdown。

**SPEC 化增强**：原样保留全部句子；追加注入 `{{narrationBudgetSeconds}}`、`{{estimatedChars}}`、hook 段 ≤35s 约束、各段 `narrationBudgetSec/visualHoldBudgetSec` 分配要求（见 SPEC 7.1）。

### 3.2 SECTION_DRAFT_SYSTEM（已核实片段）

> 你只写指定章节，不能改题、不能改全片结论、不能改变其他章节。
> 本章必须兑现 promise，并且仅使用列出的 evidenceIds 对应事实；没有证据时使用"观点/经验"表达，禁止伪造来源、数据、人物和案例。
> 不要重复已讲内容。用 bridgeFromPrevious 自然承接，但不要重新复述上一章。
> 不要预告下一章的完整答案，只留下能推动观看的必要衔接。

**SPEC 化增强**：原样保留；追加「扩写白名单」（只允许证据/案例/推导/演示/反例/步骤六类扩写）、`{{lockedClaims}}` 不可改动清单、`charMin–charMax` 字数区间（见 SPEC 7.2）。旧版的 promise/evidenceIds/bridgeFromPrevious 直接对应 SPEC 的 claim/evidenceNeeds/transitionOut，字段名以 SPEC 为准做重命名映射。

### 3.3 SECTION_REVISE_SYSTEM

原文未能通过代码搜索完整核实（仅确认存在于 `scriptPrompts.ts` 并被 `server.ts` 的 `/api/script/section-revise` 使用）。**执行规则：迁移时先完整读取该常量全文，摘录进迁移 PR 描述，再按 SPEC 7.3 的 evaluator→patch 循环对齐；禁止凭记忆重写。**

### 3.4 server.ts 中的调用编排（已核实片段）

```ts
maxTokens: LLM_LONGFORM_MAX_TOKENS,
system: SECTION_DRAFT_SYSTEM,
buildPrompt: (section, planned, completed) => sectionDraftUserPrompt({ ... })
```

即：分段生成时已携带「当前章节 + 已规划章节 + 已完成章节」三层上下文——这正是 SPEC 7.2 要求的相邻上下文注入。**该编排思路保留**；`LLM_LONGFORM_MAX_TOKENS` 等常量迁移进 `llm/models.ts` 配置。

---

## 4. 给编程工具的执行边界规则（追加进 AGENTS.md）

```markdown
## 迁移边界（在 SPEC 硬性规则基础上追加）

8. 旧仓库 pixox24/AI-Video 为只读参考。禁止从旧仓库 import 任何前端组件、
   server.ts 代码或 localStorage 持久化逻辑。
9. 判定为 PORT 的文件：连同同名 .test.ts 一起复制进新仓库对应目录，
   测试跑绿即完成；禁止在移植过程中"顺手优化"。
10. 判定为 ADAPT 的文件：先写映射说明（旧函数签名 → 新接口），
    经人工确认后再改造；所有 LLM 调用必须改走 gateway（SPEC 第 6 节）。
11. 判定为 REWRITE/DROP 的文件：禁止复制其代码；只允许阅读以理解业务概念。
12. scriptPrompts.ts 的三段系统提示词原文句子必须原样保留，SPEC 增强变量
    只能追加、不能改写原句；SECTION_REVISE_SYSTEM 迁移前必须摘录全文到 PR 描述。
13. 迁移顺序：Phase 0 先搬 PORT 纯函数（scriptEntity / scriptLanguage /
    scriptSplit + 全部测试）→ Phase 1–2 做 prompt 与 draftEngine 的 ADAPT →
    Phase 3 做 castStrategy 的 ADAPT → Phase 4 做 narrationTrack 的 ADAPT。
14. visualBible 相关 95KB+ 代码本 MVP 一律不迁移；只把其实体不变量原则
    抄入分镜阶段注释与验收。
```

---

## 5. 迁移验收清单（每个 Phase 结束后逐项核对）

- [ ] `scriptEntity` / `scriptLanguage` / `scriptSplit` 及其测试在新仓库跑绿
- [ ] 新版 outline 生成输出通过 SPEC BlueprintSchema 校验，且 prompt 中包含 3.1 全部原句
- [ ] 分段草稿 prompt 中包含 3.2 全部原句 + 扩写白名单 + lockedClaims
- [ ] `draftGate` 等价逻辑存在：无锁定蓝图时拒绝进入脚本生成
- [ ] 时长引擎使用旧 `DurationBudget` 的 speechSeconds/maxChars 概念，且全部计算在新代码中为纯函数
- [ ] TTS 阶段复用 narrationTrack 的对齐能力写回 `Section.actualSec`
- [ ] 分镜 `requiresCharacter` 由 castStrategy 等价逻辑产出，且图表/屏录场景被代码护栏强制为 false
- [ ] 旧 `/api/script/generate`（短视频）不带入新仓库
- [ ] 新仓库中不存在任何从旧仓库复制的 `.tsx` 组件
