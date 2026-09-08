# 画面圣经优化实施方案：从 7.0 分到可验收的优秀版本

日期：2026-09-08。用途：交给 AI 编程模型直接实施、测试和交付。

本文约定目标行为、数据职责和验收方式。字段名、模块拆分方式可结合代码调整，但必须保持语义与验收不变量。本文中的新接口是建议契约，不表示仓库已经实现。

## 1. 执行目标与依据

把画面圣经改造成一个结果可追溯、用户决定可保留、跨版本不串角色、跨镜头能延续主体的模块。重点完成以下完整链路：

```text
输入文案与创作意图
→ 提取和校验事实
→ 保存完整分析快照与实体台账
→ 结合用户选择决定角色／实物／表现形式
→ 生成并校验外形和场景约束
→ 合并用户锁定字段
→ 按句与分镜决定上镜主体
→ 编译提示词并选择参考图
→ 保存工程
→ 重新打开工程，得到相同语义结果
```

本方案的事实依据：

- [优化后验收报告](F:/office_share/AI-Video/docs/visual-bible-acceptance-2026-09-08.md)。
- [10 个定向复现检查](F:/office_share/AI-Video/scripts/audit-visual-bible-2026-09-08.mts)。
- 当前未提交的工作区代码。开始实施时再次检查文件现状，使用函数名定位；验收报告中的行号可能随其他开发发生变化。

此前验收结果：工程评分 7.0/10，39 项现有测试、角色专项检查、类型检查和构建通过，但 10 个定向复现检查暴露了 8 类问题。这个数字是历史基线，不应写死为新版本的测试数量。

**实施要求：**

1. 在现有优化上修复，不回退或覆盖他人的未提交修改。
2. 本地代码、迁移和测试按下文依赖顺序推进，完成一个阶段就验证一个阶段，无需逐阶段等待确认。
3. 保持 React + TypeScript + Express 架构，优先使用已有 `node:test`、`assert`、`tsx`；无需引入新数据库或大型工作流框架。
4. 不顺带改写文案时长、TTS、字幕、视频导出等无关功能。共享类型或分镜字段必须修改时，核对所有调用方。
5. 不能通过删除测试、放宽断言、默认上锁所有卡、关闭生图检查来获得通过。
6. 真实模型与生图抽检结果和确定性测试结果分别记录。缺少真实评测数据时交付“工程修复完成，真实效果待验收”，不能自行宣称已达到 9.5 分。

## 2. 必须解决的问题及交付对应

| 编号 | 必须解决的问题 | 当前主要入口 | 完成标志 |
|---|---|---|---|
| B01 | 刚生成误报过期、分析缓存失效 | `bibleSourceFingerprint`、路由 `stamp`、`visualBibleSourceShift` | 相同输入刚生成不 stale；新增分析实体不改变输入指纹；缓存真实命中 |
| B02 | 确认／拒绝匿名角色被撤销 | `confirmPendingCharacter`、`rejectPendingCharacter`、`patchBible` | 用户决定经过校验、重编、保存重载仍有效 |
| B03 | 前端重新推断并覆盖服务端决定 | `ensureVisualBible`、`groundVisualBible`、`normalizeScriptWorkspace` | 服务端、前端、工程重载共享同一份事实与选择规则 |
| B04 | 真实句子被用来证明不存在的人 | `parseScriptAnalysis`、`toRecordFromAnalysis` | 每个实体都有属于自己的有效 mention 或可验证共指 |
| B05 | 同卡 ID 的不同人物继承对方外形 | `mergeVisualBible`、`carryCharacter` | 跨版本只按实体身份搬运外形和参考图 |
| B06 | 关闭参考图锁后重编又被开启 | `normalizeLockFlags`、`carryCharacter` | 三种锁的 8 种组合在完整链路下均符合约定 |
| B07 | 代词和省略主语导致上镜人物消失 | `planShotOccupancy`、`assignShotContinuity`、`withCoverage` | 人物动作正确关联前文主体，环境／实物镜仍可无人 |
| B08 | 实物 subjects 没有证据约束 | `groundVisualBible`、`shotCharacterLockEnglish` | 实物与角色同样验证 ID、类型、证据；错误实物不进入硬约束 |

除此之外，补充检查三个相邻风险：旧项目迁移丢图、异步旧结果覆盖新文案、多角色提示词与实际参考图数量不一致。这些是为完整交付增加的验收项，不把未验证风险写成已复现事实。

## 3. 先固定职责，避免继续叠加补丁

### 3.1 三类数据分开保存

| 数据 | 内容 | 谁可以改变 | 谁不应改变 |
|---|---|---|---|
| 分析事实 | 原文、内容类型、实体、mentions、证据、共指、动作关系、置信度 | 显式分析流程；用户明确修正事实 | normalize、保存、加载、普通卡片编辑 |
| 用户决定 | 纳入／排除／自动、旁白方式、外形设计、三种锁、参考图、手动上镜 | 对应用户操作 | fallback、LLM 自动输出、重载 |
| 派生结果 | 当前角色卡、实物卡、待确认列表、occupancy、提示词 | 使用事实和用户决定的共享纯函数 | 模型自由创建实体、前端独立再猜角色 |

完整分析快照必须保留。禁止先将其降成 `candidates`，再由候选反推 `contentType`、`isNamed`、置信度或角色决策。

### 3.2 模块安排

推荐职责如下；可以合并小模块，但不要把所有逻辑继续塞进 `visualBible.ts`。

| 文件／模块 | 工作内容 |
|---|---|
| `src/utils/scriptAnalysis.ts` | LLM 请求契约、结果解析；不决定用户是否出镜 |
| `src/utils/scriptEntity.ts` | 台账、mention、证据校验、实体身份匹配 |
| 建议 `src/utils/visualBibleSource.ts` | 统一输入构造、指纹和依赖失效判定 |
| 建议 `src/utils/visualBibleState.ts` | 用户动作 reducer、台账决策覆盖、卡片派生 |
| 建议 `src/utils/visualBibleMigration.ts` | V1→V2 迁移、旧字段兼容、资产保留 |
| `src/utils/castStrategy.ts` | 从完整事实及用户决定产生表现形式和自动建卡建议 |
| 建议 `src/utils/shotOccupancy.ts` | 从 mention／动作／镜头意图计算上镜主体 |
| 建议 `src/services/visualBibleService.ts` | 可测试的分析与编译编排；通过依赖注入调用 LLM |
| `src/utils/visualBible.ts` | 对外兼容接口和必要编译辅助；逐步调用新纯函数 |
| `server.ts` 对应路由 | 校验请求、调用 service、返回版本化结果，不重复领域决策 |

服务端负责新增分析事实。前端处理用户操作时调用相同的纯函数，基于现有完整快照重新派生；不必每次点锁或改外形都请求 LLM。

### 3.3 必须保持的不变量

- 一个角色或实物只能绑定一个真实的实体身份；展示卡 ID 不代表实体身份。
- 自动硬约束必须有有效事实依据；用户手动指定的创作角色必须明确标为用户来源。
- `normalize` 只做迁移、类型和引用检查，不抽实体，不调用 LLM，不添加角色。
- `serialize → deserialize → migrate → validate` 不应改变有效工程的角色选择、外形、引用和锁。
- 相同事实与相同用户决定得到相同派生语义；时间戳不改变结果版本。
- 用户明确 `include/exclude` 优先于自动推荐；用户决定不等于允许错误 ID 或伪造证据通过校验。
- 锁只控制重编时的保留范围，不能豁免数据有效性检查。
- 显式空上镜集合有意义，不能被默认主角覆盖。
- 已淘汰的错误条目不能重新进入 active 列表；诊断信息必须保留原因。

## 4. 建议 V2 数据契约

以下为领域核心的示意。实现时复用项目现有类型；不能仅新增这些字段而不接通读写链路。

```ts
type EntityId = string; // 工程级稳定 ID，由程序分配，不使用 char-lead/an-1 代表身份
type UserDecision = 'auto' | 'include' | 'exclude';

interface AnalysisInput {
  inputSchemaVersion: 2;
  narration: string;
  title: string;
  intentNotes: string;
  language: 'zh' | 'en';
  genreHint: string | null;
}

interface EntityMention {
  id: string;
  entityId: EntityId;
  source: 'narration' | 'title' | 'intentNotes';
  sentenceId: string;
  start: number; // [start, end)，规范化原文的 JS UTF-16 索引
  end: number;
  text: string;
  form: 'name' | 'alias' | 'description' | 'pronoun';
  refersToMentionIds?: string[]; // 代词／别名的已验证前置提及
}

interface EntityRecordV2 {
  id: EntityId;
  canonicalName: string;
  kind: 'person' | 'animal' | 'object' | 'product' | 'concept';
  anthropomorphized: boolean; // 动物不是天然拟人角色
  identityForm: 'named' | 'anonymous' | 'narrator';
  aliases: string[];
  mentionIds: string[];
  confidence: number;
  verification: 'verified' | 'uncertain' | 'invalid';
  origin: 'rule' | 'llm' | 'user';
  // 明确的年龄、性别、职业等事实应按实体存储，并逐条引用证据。
}

interface AnalysisSnapshotV2 {
  schemaVersion: 2;
  sourceKey: string;
  cacheKey: string;
  analysisRevision: string;
  input: AnalysisInput;
  extractor: { version: string; model?: string; promptVersion: string };
  provenance: 'llm' | 'rule_fallback';
  contentType: string;
  contentConfidence: number;
  perspective: string;
  hasDialogue: boolean;
  hasNarrativeArc: boolean;
  entities: EntityRecordV2[];
  mentions: EntityMention[];
  events: SentenceEvent[];
  generatedAt: number;
}

interface SentenceEvent {
  sentenceId: string;
  start: number;
  end: number;
  agentIds: EntityId[];
  patientIds: EntityId[];
  speakerIds: EntityId[];
  evidenceMentionIds: string[];
  resolution: 'resolved' | 'ambiguous';
}

interface CharacterLocksV2 {
  identity: boolean;
  appearance: boolean;
  refs: boolean;
}

interface EntityUserOverride {
  entityId: EntityId;
  decision: UserDecision;
  displayName?: string;
  role?: 'lead' | 'support' | 'extra';
  locks: CharacterLocksV2;
  appearance?: {
    look: string;
    wardrobe: string;
    ageBand?: string;
    signature?: string;
    source: 'user' | 'accepted_design';
  };
  // refs 保存稳定 assetId/entityId/用途；实际 URL 由资产层解析。
}

interface VisualBibleV2 {
  version: 2;
  sourceKey: string;
  bibleRevision: string;
  analysis: AnalysisSnapshotV2;
  overrides: Record<EntityId, EntityUserOverride>;
  narratorMode: 'voiceover' | 'on_camera' | 'story_character';
  pinned: boolean;
  characters: VisualCharacter[]; // 保留现有前端卡面投影或相应 V2 类型
  subjects: VisualSubject[];
  pendingCharacters: VisualCharacter[];
  retiredEntities: RetiredEntity[]; // 保存离开当前文案的用户卡与引用
  issues: ValidationIssue[];
  // 当前场景、母题、色板字段按原有能力保留。
}
```

`RetiredEntity`、`ValidationIssue` 及资产绑定类型由实施者补全。卡面不应再独立保存一份可反向覆盖台账的事实判断。

**几个重要约定：**

1. `displayName` 用于 UI 改名，不修改 canonicalName 和原文证据，不将“出镜讲解员”的显示文案误认为原文实体名。
2. `verification` 是证据有效性，`decision` 是用户是否采用，`appearanceUnknown` 是外形设计状态，三者分别处理。
3. 匿名人物的存在可以有充分证据，而外形仍未知；确认其出镜不需要编造姓名、年龄或五官。
4. 原文未写的衣服、外形允许进入用户确认的美术设计层；不要冒充原文事实，也不要因为未知而让整个制片流程无解。
5. 每个字段只有一个权威位置；兼容字段如 `candidateId`、`locked`、旧 `sourceHash` 仅由适配器生成，不能作为第二份可写状态。

## 5. 输入指纹、缓存与结果版本：修复 B01

### 5.1 先统一输入构造

新增单一 `buildAnalysisInput(workspace, explicitInput?)`。`ensureVisualBible`、服务端请求解析、过期检查和重编都使用它。

- 标题使用同一个优先级，例如显式请求标题 → 锁定标题 → 选中选题标题 → 已生成标题 → 空字符串。保存本次真正使用的标题，UI 不得用另一种优先级重算。
- 区分原始 `intentNotes` 与粘贴的口播。现有 `handleDiagnose` 会把全文写进 intentNotes，迁移时保留原数据，新的分析输入避免把这当作独立用户指令；不要为了修本模块破坏现有已有文案流程。
- 统一换行为 LF，移除可选文件 BOM；保留词间空格和原句标点。禁止使用 `replace(/\s+/g, '')` 作为中英文共用内容指纹规范。
- 证据索引建立在快照保存的规范化原文上，界面高亮同一文本；不要混用原始 CRLF 索引和规范化后的 LF 索引。
- 稳定序列化使用有字段名的 JSON；对象键排序，保留有语义的数组顺序，避免用简单 `|` 拼接造成字段边界歧义。

### 5.2 四种版本各司其职

| 标识 | 输入 | 用途 | 不应包含 |
|---|---|---|---|
| `sourceKey` | 规范化 AnalysisInput | 判断当前文案和上下文是否变化 | 生成的实体、候选 ID、时间戳、参考图 |
| `analysisCacheKey` | sourceKey + 提取器／规则／解析器／提示词版本 + 实际模型标识 | 分析缓存与同请求去重 | API Key、卡片锁、随机实体排序 |
| `analysisRevision` | 经验证的完整分析语义 | 判断事实结果是否变化 | generatedAt、调用耗时 |
| `bibleRevision` | analysisRevision + 用户选择 + 卡面／场景／实物／资产绑定等画面约束 | 提示词、分镜约束失效 | 展开折叠、进度、提示消息时间戳 |

另外为 occupancy/prompt 派生缓存定义明确依赖，不必新增数据库字段；可以是纯函数计算的 key。

- 改外形、排除角色、换参考图：sourceKey 不变，bibleRevision 变。
- 只改风格：事实分析不重跑；依赖风格的画面提示词重编。若生成外形时读过风格，外形设计缓存必须包含风格版本。
- 改内容、标题、分析上下文：sourceKey 变，分析重新计算。
- 切换 LLM 模型：后续分析 cacheKey 变化；已接受圣经不能仅因设置变更立即丢失。
- 同一输入新增了模型识别出的实体：sourceKey 不变。
- 保存、重载、改时间戳：所有语义 key 不变。

现有 `clip.visualBibleHash` 与 `compileImagePrompt` 使用 sourceHash 判断旧提示词能否复用，必须一起迁移到 bibleRevision。只修过期检查、继续让改外形后的旧提示词复用，不算完成。

### 5.3 缓存行为

1. 默认“按口播重编”可以重生成卡面，但复用相同输入的有效分析快照。
2. 提供明确的 `forceReanalyse` 参数用于主动重跑事实分析；不要把“重生成外形”和“重新分析全文”混成同一开关。
3. 缓存不依赖 `lockedCastOnly`。即使没有上锁卡，完整 analysis 也应保留并传递。
4. 最小实现可在工程中保存分析快照，并在 service 维护有容量限制的内存缓存和 in-flight promise 去重。若增加磁盘缓存，单独版本化并验证来源；不缓存凭证。
5. 缓存命中后仍对结构、sourceKey、schemaVersion、引用一致性做验证。模型原始 JSON 不能直接作为已验证快照。
6. 失败 fallback 标记为 `rule_fallback`。不能让一次网络失败产生的降级结果永久替代后续可用的 LLM 分析；重试／forceReanalyse 能升级它。

### 5.4 pinned 的语义

来源是否变化与是否允许继续使用已钉版本是两个判断：

- `sourceChanged=true` 时，pinned 卡仍展示来源变化提示。
- 不能仅更新 sourceKey 就把旧 pinned 内容伪装成新文案分析结果。
- 保留用户钉住的版本；需要分析新稿时新建快照并明确合并，旧资产可追溯。
- 生图拦截依据结构化 issue 和本次实际使用的约束。来源变化提醒、无外形设计、无参考图与损坏 ID 分别处理，不要统称“角色冲突”。

**B01 完成条件：**第一人称、匿名人物、纯实物、具名人物、LLM 才识别到的实体刚生成均不误报；冷缓存、热缓存、重载复用、主动重分析都有请求计数断言。

## 6. 证据、实体身份与事实校验：修复 B04、B08

### 6.1 证据分三层验证

1. **位置有效**：source 存在，索引合法，`source.slice(start, end) === text`，拒绝越界、空证据及伪造索引。
2. **实体相关**：具名实体的准确 mention 位于证据中，或可沿经过验证的别名／代词关系找到该实体。原文里出现了另一人的名字不能放行。
3. **事实相关**：年龄、职业、动作主语等事实必须属于该实体。禁止将全文的“女孩”“医生”等标签复制给所有人物。

例：原文“王小明走进教室。”，输出实体李小红、证据仍为此句，应拒绝李小红；不能通过添加同句中王小明的正确卡让整体检查通过。

标题与备注可提供创作意图，但不能自动证明人物在口播中出现。用户明确要求添加原文外角色时，建立 `origin=user` 的创作角色，单独保存说明，不伪造 narration evidence。

### 6.2 名称、别名与匿名实体

- 具名人物验证准确 mention，不用名称相互包含关系代替身份匹配，例如“李明”和“李明哲”不能合并。
- 英文姓名按词边界处理；大小写、别名的标准化必须独立于原文证据文本，不得破坏原文索引。
- “一个女孩”和“她”的身份关联使用 mention 链；匿名女孩是展示名，不要求原文逐字出现“匿名女孩”。
- 两个不同的匿名女孩必须允许两个不同实体；不能仅用 `匿名女孩` 作为去重键。
- 实体表和 mention 表验证 ID 唯一性。无效外部 ID 的修复必须同步 remap 所有引用，不能只改角色卡。
- 数量上限用于控制自动采用数量，不能悄悄截断事实台账。自动激活默认可沿用 3 个角色，其余留在候选／待确认；用户操作达到上限时明确提示，不能把旧卡静默挤掉。

### 6.3 置信度与规则融合

不要 `max(规则置信度, LLM 置信度)` 后无条件激活，这会把模型认为不可靠的候选重新抬为 confirmed。

- 证据不存在／错实体：invalid，不由高置信度补救。
- 证据有效但身份／共指有歧义：uncertain，进入待确认。
- 高置信的内容分析优先于用户所选体裁的默认先验；“故事”体裁不等于必须有主角。
- 规则负责明确的格式与证据检查，语义冲突保留 reason code；不要不断增加人名、产品和禁用词列表代替整段理解。
- 使用规则快速路径时也构造同一种完整快照，标记来源。只有真正无歧义才跳过 LLM；一个候选出现两次不能证明全篇不存在其他歧义。
- 阈值集中配置并用标注样本校准，不能将整体文案 confidence 直接显示成每张卡的“匹配准确率”。

### 6.4 角色和实物共用验证器

新增或整理 `validateEntityBinding(binding, snapshot)`：同时验证 entityId、kind、证据关系、实体有效性。

- characters 只投影人物／动物／拟人主体等可扮演角色的实体。
- subjects 投影普通物体／产品；动物作为食材或实际动物须按语境区分，不能一看到对白就把全文所有食材拟人化。
- 对 model 返回的 subjects 逐条校验，错误 ID、错名、无原文依据的未锁实物不进入 active subjects。
- 从 characters 迁移到 subjects 的旧 object 卡也经过同样验证，并保留其参考资产。
- 实物“身份不变”与“状态可变”分开：咖啡可由热变凉、食材可由生变熟、手机可开关屏；不能把“保持实物状态”解释成所有镜头状态冻结。
- 换稿后旧实物退出 active 集合；用户锁定的旧实物保存在 retired 区，不自动画进新稿。

**B04/B08 完成条件：**不存在的名字借真实句子、伪造句子、错误 ID、错误 kind、标题独有人物、实物残留、同名歧义均有独立负例；正常人物和实物正例同时通过。

## 7. 用户决定与统一状态流：修复 B02、B03

### 7.1 统一用户动作入口

建议实现以下动作，名称可调整：

```ts
type BibleAction =
  | { type: 'set_entity_decision'; entityId: EntityId; decision: UserDecision }
  | { type: 'set_narrator_mode'; mode: 'voiceover' | 'on_camera' | 'story_character' }
  | { type: 'set_entity_display_name'; entityId: EntityId; displayName: string }
  | { type: 'set_entity_appearance'; entityId: EntityId; patch: AppearancePatch }
  | { type: 'set_entity_lock'; entityId: EntityId; field: 'identity' | 'appearance' | 'refs'; value: boolean }
  | { type: 'set_entity_refs'; entityId: EntityId; refs: AssetBinding[] }
  | { type: 'set_shot_occupancy'; shotId: string; value: UserShotSelection }
  | { type: 'reset_shot_occupancy'; shotId: string };

// AppearancePatch/AssetBinding/UserShotSelection 根据现有资产与分镜类型实现。
// 用户动作只修改 overrides，再根据现有 analysis 派生。
function reduceBibleAction(state: VisualBibleV2, action: BibleAction): VisualBibleV2;
```

选中、拒绝和恢复自动的语义：

| 原状态／操作 | 保存的决定 | 派生结果 |
|---|---|---|
| 自动建议待确认 → 确认为角色 | include | 实体结构有效时进入角色列表；外形未知仍单独标示 |
| 待确认／已选角色 → 不建卡 | exclude | 从 active 和 pending 中移除，保留排除记录 |
| 已排除 → 恢复自动 | auto | 重新使用已有事实计算自动建议 |
| 已排除 → 明确重新纳入 | include | 清除排除效果并保留审计原因 |
| 新稿中找不到原实体 | 保留旧决定并标记 retired | 不自动迁移给同名或同卡 ID 的新实体 |
| 实体证据无效 → 点击纳入 | 不伪造“原文已验证” | 显示具体错误，提供修正绑定或明确创建用户来源角色的操作 |

`confirmed/pending` 不能作为用户意图的唯一存储；它们会随派生变更。`rejectedCast` 可作为 UI 投影，但不能是规则引擎不读取的孤立数组。

### 7.2 第一人称模式必须双向有效

- voiceover：第一人称实体保留在事实中，默认不生成出镜角色约束。
- on_camera：同一个 narrator entityId 进入可出镜选择，显示名可为“出镜讲解员”，原文绑定不变。
- story_character：同一实体作为剧情角色参与动作和上镜。
- 从 on_camera/story_character 切回 voiceover：去除由该模式自动创建的出镜选择，保留资产供以后使用。
- 如果该实体另有显式 include 或手动镜头选择，定义并展示冲突优先级；不能静默保留一个 UI 看似已经关闭的角色。推荐显式实体决定优先，并在模式切换时提示存在该决定。
- 如需 AI 外形参考图，匿名／第一人称的实体种类不能导致入口永久不可用。可以先让用户填写外形或接受一次设计，再进入参考图生成；原文事实和设计仍分开记录。

### 7.3 更新所有入口，不只修 patchBible

1. `ensureVisualBible`：传入完整前版 analysis、overrides、卡面约束与资产引用。不要先 `lockedCastOnly` 丢掉未锁分析快照或用户排除记录。
2. `handleDiagnose`：新文案让旧分析变为待更新，不直接将整个 bible 置空而丢失锁卡和用户决定。保留前版供身份对齐及退休资产管理。
3. `handleRebuildBible`：明确这是重编操作；重新提取事实、合并决定、合并字段的边界可见且可测试。
4. `patchBible`：改为提交类型明确的动作，不能对每次点击再调用重新识别实体的 ground。
5. `normalizeScriptWorkspace`：读取 V2 快照时仅迁移／验证／派生，不能像当前路径一样重新执行原文实体挖掘。
6. `previewBibleDiff`：比较当前完整台账和基于新输入的分析结果；新分析尚未完成时显示“尚待分析”，不能用旧 candidates 伪造新增／删除结果。
7. `App.visualBibleGenerationBlocked`：读取真实版本与结构化诊断，不依赖中文警告字符串匹配。

### 7.4 API 与领域服务

推荐保留 `/api/script/visual-bible` 路径，调整内部 service 与版本化请求／响应：

```ts
// 语义示意，不要求复制所有字段。
request = {
  schemaVersion: 2,
  requestId,
  projectId,
  source: analysisInput,
  previousSnapshot,
  userState,
  forceReanalyse: false,
  baseUserRevision,
  stylePack
};

response = {
  schemaVersion: 2,
  requestId,
  sourceKey,
  baseUserRevision,
  analysisSnapshot,
  bible,
  issues,
  diagnostics: { analysisCacheHit, analysisSource, analysisCalls, compileCalls }
};
```

service 顺序固定：

1. 构造并校验输入，计算 sourceKey/cacheKey。
2. 复用有效分析或获取新分析；新模型输出通过解析与证据验证。
3. 对齐实体身份，产生新实体与 retired 实体，不先合并外形。
4. 合并用户决定，从同一份快照执行 `deriveCastDecision`。
5. 让模型仅为允许的实体补充画面设计；禁止生成新的未验证实体。
6. 验证 characters、subjects、locations 引用；按各自锁合并字段。
7. 派生有效状态、诊断和版本，返回。

原来的 `analysisApplied` 可在过渡期保留，但不能再控制“前端是否重新猜一遍”。服务端决定的正确传递由完整快照保证。

### 7.5 处理异步旧结果

每次请求记录 requestId、sourceKey 和用户状态 revision。响应回来时：

- 输入已变：旧响应不能覆盖新文案／新圣经。
- 期间用户只改了锁或选择：保留最新用户决定，按明确规则 rebase；不要拿旧 workspace 整体覆盖。
- 生成参考图期间角色被替换：结果按 entityId 和生成时设计版本绑定；找不到同实体时保存为未采用资产，不写到同位置的新角色。
- 普通 UI 编辑和重编共享更新入口，减少旧 React 闭包覆盖现有状态的可能。

**B02/B03 完成条件：**确认、拒绝、恢复自动、模式切换、重编、加载都遵守同一个 reducer/派生逻辑；服务端 no-cast 结果在不改变用户决定时不会被前端和加载过程推翻。

## 8. 稳定身份、三种锁与迁移：修复 B05、B06

### 8.1 稳定身份与卡片 ID 分离

- 新实体 ID 由程序在工程实体注册表中分配，使用不可复用 ID；LLM 的 `an-1` 只能当本次响应临时引用。
- 相同输入重编复用已有分析快照，实体 ID 不重新生成。
- 新输入的身份对齐优先使用已验证的旧 entityId/别名关系和可追溯提及。唯一的同名且类型／上下文兼容可作为匹配依据，但同名歧义时不自动搬图。
- `char-lead`、数组索引、角色排序、名称子串不能作为跨版本身份依据。
- 改显示名保持 entityId；明确“替换为另一个角色”才建立新实体。
- ID 对齐在外形与参考图 merge 之前完成；所有卡片、occupancy、clip、参考图绑定同步更新。

旧人物离开文案时：没有用户编辑／资产的自动条目可从活动集合移除；有用户决定、锁或资产的条目保存在 retired 区。不能把旧人的脸借给占用同一个卡 ID 的新人，也不能为了不丢图强制旧人继续出镜。

### 8.2 明确三种锁的行为

| 字段组 | identity 锁 | appearance 锁 | refs 锁 |
|---|---|---|---|
| 用户指定显示名、角色职责等身份设定 | 保留 | 不额外冻结 | 不额外冻结 |
| look、wardrobe、ageBand、signature 等设计 | 不额外冻结 | 保留 | 不额外冻结 |
| 参考图列表及其用途 | 不额外冻结 | 不额外冻结 | 保留 |

实体本身的稳定 ID 不因任何锁开关变化。identity=false 也不允许自动把同一张卡改绑到另一个人。

“不额外冻结”表示可以接受本次合法重编结果，不表示普通 normalize/保存时就清空字段。对明确执行的重编：refs=false 且新结果无参考图时，清除活动引用，资产文件仍由已有资产管理规则保留；refs=true 只保留同一实体的引用。

外形改变而参考图仍锁定时，记录图与当前设计的版本差异，允许用户更新设计或解除图锁；不能静默改绑，不要自动修改用户明确的锁值。

### 8.3 旧 locked 字段只迁移一次

| 旧数据形态 | 迁移原则 |
|---|---|
| 没有任何新锁字段，只有 `locked=true` | 根据旧版本“整卡保留”语义迁移为三锁 true，尽量保留旧行为和资产 |
| 没有任何新锁字段，`locked=false` | 三锁 false |
| 已存在任一新锁字段 | 尊重每个显式布尔值，未定义项默认 false；不再从聚合 locked 反推 |
| 新锁全部为 false，但旧 locked 仍为 true | 以明确的新值为准，聚合 locked 重算为 false |
| 不完整／损坏字段 | 产生迁移 issue，保留原始资产，不用强制上锁掩盖问题 |

迁移通过 `hasOwnProperty` 或等价方式区分“字段不存在”和“明确 false”。V2 的 `locked` 若暂时保留，仅是三锁 OR 的只读兼容投影。

### 8.4 工程迁移步骤

1. 读入 V1，先保留原始数据快照；正常加载不立即覆盖唯一持久化副本。
2. 迁移锁字段、object 卡、实体与引用。旧证据无法验证的卡标为待核对或用户历史资产，不伪造 confirmed。
3. 对重复旧卡 ID 建立映射。若旧 clip 只保存了重复 ID 而无法区分实体，标记引用歧义并让用户重新指定；禁止猜测后静默写盘。
4. 保留 source provenance；旧 sourceHash 无法证明 V2 来源时标记“需更新分析”，不要简单 stamp 成 current。
5. 本次使用迁移后的内存状态；通过校验后随正常保存写入 V2，并沿用项目备份机制。
6. 再次加载 V2 不重新迁移；迁移函数满足 `migrate(migrate(x)) == migrate(x)` 的语义幂等。
7. `projectForPersist`、`slimBible`、`collectReferencedAssetUrls` 必须包含新 active/retired/pending 用户资产，防止被资产清理遗漏。

**B05/B06 完成条件：**不同实体复用 char-lead 不串脸；三种锁的所有组合经过 normalize→merge→derive→save→load 后均正确；有效旧参考图不丢失；显式 false 永不被聚合 locked 改回 true。

## 9. 句级共指、上镜计划与提示词：修复 B07

### 9.1 先明确“被提到”和“需要上镜”不同

一句提到人物可能只是引用、举例、否定或旁白说话人。实体提及表解决“指的是谁”，occupancy 再解决“这一镜拍谁”。

推荐决策顺序：

1. 用户已锁定的镜头主体选择，先校验其 entityId 与当前快照的对应关系。
2. 镜头的明确视觉意图／动作主体与已验证的句级关系。
3. 具名、别名、代词、群体共指解析结果。
4. 明确的环境镜／实物 insert 规则。
5. 无足够信息时使用无人图解或待核对，不随意绑定第一个 lead/support。

实体有明显动作且镜头为叙事／证据镜时，不能仅因没有重复姓名就判无人；如果镜头意图明确为手部、物件或声音画外，则可以不显示人物全身，但仍要保留动作／道具的实体关联。

### 9.2 共指落地方式

- 在完整分析快照里保存 mentions 和 sentence events，再以源文字符范围映射到 `speechSpans`、`ForecastShot`。
- 一个句子拆成两图，两图共享源句语义，分别执行各自镜头意图。`voRole=continue` 只表示口播延续，不能自动等于“换配角”。
- 本地规则只解析明确情况：单一可兼容的前置主体、已明确的二人群体、连续同主体动作。
- 多个可能 antecedent、引语内外切换、跨段落换场景时，使用分析中的已验证共指；不足时标为 ambiguous，避免“就近姓名”强配。
- 英文 he/she/they/I 和中文他／她／它／两人均有样例；昵称、小名需要验证过的 alias。
- 纯词典无法覆盖的新实体允许由分析模型识别，不能通过新增一个正则只让示例过关。

### 9.3 Occupancy 建议输出

在现有 `OccupancyPlan` 上补齐来源和依赖信息，类型可按最小实现调整：

```ts
interface OccupancyPlanV2 {
  source: 'auto' | 'user';
  dependencyKey: string;
  characterEntityIds: EntityId[];
  subjectEntityIds: EntityId[];
  depiction: 'characters' | 'hands_only' | 'objects_only' | 'environment';
  reasonCode: string;
  evidenceMentionIds: string[];
}
```

若继续保留 `onCamera`，明确它是“人物可见”而非“画面存在任意主体”，并由实际集合/depiction 派生，避免 `onCamera=false` 但 characterIds 非空等矛盾。

编排顺序：固定口播和源句范围 → 准备句级主体关系 → 设计 coverage → 应用镜头意图和手动选择产生最终 occupancy → 编译提示词。coverage 更新后只重算依赖它的上镜规则，不重新抽取全片人物。

### 9.4 特别检查现有调用链

- `rebuildForecast` 的 `stampShotsWithBible → withCoverage` 必须保持同一分析快照和手动选择；不能每次 rebuild 抹去之前确认的 occupancy。
- `applyLlmCoverage` 只能改机位字段。用 ID 对齐输入输出，错 ID／缺项时保守处理，不用数组位置把一个镜头的选择贴给另一个。
- `composeShotVisualIntent`、`shotCharacterLockEnglish`、`characterForShot`、`resolveShotCharacter` 读取同一份最终 occupancy。
- 当前中文画面意图部分路径只找第一张匹配角色卡，英文路径可拼多张；统一多角色语义和排序。
- `forecastToClips` 原样传递最终角色／实物引用及 occupancy，不重新根据旁白猜人。
- 最终 prompt 中只注入本镜有效主体。手动空集合必须抑制默认角色锁；对照不能自动塞入 support；无效 subjects 不能进入 OBJECT LOCK。
- 风格约束与本片主体分离，保留现有风格能力；unknown appearance 不作为确定事实重复写进硬身份约束。

### 9.5 多角色与参考图的实际边界

当前 `App.characterRefPayload` 和生图路由主要使用单个 characterRef，而上镜集合可能包含多个人。需要检查实际供应商能力：

- 支持多参考图时，逐个携带 entityId、assetId、用途及对应名字，并在最终 prompt 中明确绑定。
- 只支持一张图时，明确采用用户选择的主参考／可支持的联合参考方案，保留其他人物的文本约束并显示实际能力限制。
- 不得在 UI 宣称“已锁两人的脸”，实际却只发送第一人的图；也不能未经用户决定把双人叙事悄悄删成单人镜。
- 参考图读取失败继续沿用当前明确失败提示，不能静默无参考降级后报告成功。

**B07 完成条件：**“王小明走进教室。他拿起课本。随后他坐下读书。”在三镜均为人物动作镜时全部关联王小明；加一个窗外树木 insert 时该镜无人；同镜两人和各自参考图的投递情况可核对。

## 10. 结构化诊断与用户界面

建议增加结构化 `ValidationIssue`，中文 message 只用于显示：

```ts
interface ValidationIssue {
  code: string;
  severity: 'info' | 'warning' | 'error';
  targetType: 'source' | 'entity' | 'character' | 'subject' | 'shot' | 'asset';
  targetId?: string;
  message: string;
  blocks: Array<'compile_prompt' | 'generate_image' | 'accept_entity'>;
  resolution?: string;
}
```

至少覆盖：`SOURCE_CHANGED`、`ENTITY_ID_MISMATCH`、`ENTITY_REFERENCE_MISSING`、`EVIDENCE_NOT_FOUND`、`EVIDENCE_ENTITY_MISMATCH`、`COREFERENCE_AMBIGUOUS`、`SUBJECT_BINDING_INVALID`、`REFERENCE_ENTITY_MISMATCH`、`LEGACY_BINDING_AMBIGUOUS`。

不要继续通过 `warnings.some(/某句中文/)` 决定是否生图。已移除坏卡后的修复说明不应继续阻止干净结果；未解决的真实引用冲突也不能因为模型换了一种措辞而漏拦。

UI 最小改动范围：

- 展示 active/pending/excluded/retired，不把“无角色”“没识别出来”“用户排除了角色”混成同一句提示。
- 每张卡显示原文提及、来源、确认方式、设计未知状态；证据可以定位到原文。
- 第一人称切换立即反映可出镜选择，保留源实体与资产。
- 三种锁有清楚的字段级含义；切换后重编结果符合提示。
- 角色显示名可改而不破坏证据；替换角色与改显示名区分。
- 过期提示说明变化的是文案、标题还是创作意图；旧分析未完成时不要显示猜测的新增／删除清单。
- 手动上镜选择允许“无人”“只拍实物”，并提供恢复自动；只影响当前镜头。
- 对用户展示简明原因；sourceKey、内部实体 ID、schemaVersion 等用于调试详情，不堆到普通创作流程。

## 11. 分阶段实施任务

必须按依赖顺序完成；阶段内部如何组织提交由实施者决定。总目标是修复整个模块，不能只完成第一阶段后报告总体完成。

### 阶段 0：保留基线，建立可测试入口

**任务：**

1. 查看 git status 和当前工作区实现，保存已有测试结果。
2. 运行验收复现脚本，记录实际失败；如果其他人已修复其中某项，保留证明而不是重复重写。
3. 将路由业务逻辑提取为可依赖注入的 service，至少注入分析器、卡面编译器、缓存、时钟和 ID 分配器。
4. 为 API→前端接收→本地用户动作→保存重载提供可调用测试入口。

**交付：**基线记录、依赖注入边界、原 10 项复现的独立测试用例。业务行为暂不靠这个阶段宣称修复。

**通过条件：**现有正例保持通过；新负例能稳定复现问题；测试不调用外部模型、不读写实际用户工程。

### 阶段 1：V2 数据与一次性迁移

**任务：**落实第 4 节类型，分离事实／用户决定／派生；完成稳定 ID、证据类型、三锁字段、退休资产和 issue 的序列化方案。

**主要文件：**`src/types.ts`、`scriptEntity.ts`、新 migration 模块、`normalizeVisualBible`、`normalizeScriptWorkspace`、`projectPersist.ts`。

**通过条件：**迁移幂等、有效旧资产不丢、显式 false 被保留；V2 serialize/load 不重新识别人名。

### 阶段 2：统一来源、缓存和权威分析

**任务：**落实第 5 节及 7.4 节，修复 B01/B03；所有来源构造采用相同函数，缓存完整 analysis，前端接收已验证快照。

**主要文件：**source 模块、service、`server.ts`、`ensureVisualBible`、`visualBibleSourceShift`、`normalizeScriptWorkspace`、`compileImagePrompt`。

**通过条件：**新增模型实体不误报过期；缓存请求数正确；服务端 no-cast 前端仍 no-cast；改外形能使旧 prompt 失效而不重跑分析。

### 阶段 3：实体／实物验证与身份合并

**任务：**落实第 6 节和 8.1 节，修复 B04/B05/B08；共用证据绑定验证器；先对齐实体身份再合并卡面。

**主要文件：**`scriptAnalysis.ts`、`scriptEntity.ts`、`castStrategy.ts`、`groundVisualBible`、`mergeVisualBible`、service。

**通过条件：**错误人名借证据、虚构产品、相同卡 ID 的不同实体都被正确处理；锁卡也不绕过引用验证；正常人物／实物不被过度删除。

### 阶段 4：用户选择与锁定闭环

**任务：**落实第 7 节、8.2/8.3 节，修复 B02/B06；接通 reducer、模式切换、改名、改外形、参考图更新和加载。

**主要文件：**state 模块、`ScriptPanel.tsx`、`App.tsx`、`handleDiagnose`、`handleRebuildBible`、持久化模块。

**通过条件：**确认／拒绝／恢复自动在完整链路下保持；8 种锁组合通过；异步旧响应不覆盖新决定。

### 阶段 5：共指、上镜与编译闭环

**任务：**落实第 9 节，修复 B07；句级语义映射到镜头；统一中英文提示词与资产选择，保留用户手动空集合。

**主要文件：**analysis schema、occupancy 模块、`shotCoverage.ts`、`scriptWorkspace.ts`、`imagePrompt.ts`、`App.characterRefPayload` 及实际生图请求适配。

**通过条件：**连续代词、双人动作、对话、物件／环境镜表现正确；镜头 ID 对齐，不靠数组位置串镜；实际参考图投递与 UI 说明一致。

### 阶段 6：系统回归与验收材料

**任务：**把第 12 节矩阵落地，完成类型、构建、旧模块回归；整理第 13 节标注评测与真实项目抽检。

**交付：**测试清单、失败样例、指标计算、迁移说明、已知限制、下一轮验收报告。

**通过条件：**工程门槛全部满足后再进入实际效果评分；真实评测不足时注明尚未评估的范围。

## 12. 测试矩阵与具体断言

### 12.1 必须保留的 10 个复现语义

| 测试 ID | 对应问题 | 输入／操作 | 必须断言 |
|---|---|---|---|
| T01 | B01 | “我走进房间，然后我看向窗外。”，情绪／独白，分析增加讲述者实体 | 刚生成 sourceKey 与当前输入一致，stale=false |
| T02 | B01 | 相同输入重复生成，完整传回旧状态；再测试无锁角色的情况 | 分析器只调用一次；重编卡面可以再次调用编译器；forceReanalyse 才新增分析调用 |
| T03 | B02 | “一个女孩走进房间，她拿起书本。”，点击确认后执行实际更新链 | 用户 include 保持；同一实体成为 active；不会回 pending |
| T04 | B02 | 同上，点击“不建卡”后校验和重编 | 排除记录保持；active/pending 均无该实体；点击恢复自动才重新参与建议 |
| T05 | B03 | 王小明说细胞分裂的三个阶段；genreHint=故事，分析为高置信科普 | 服务端、前端、加载后的自动 no-cast 结果一致 |
| T06 | B04 | 原文只有王小明，模型李小红借用王小明的真实句子 | 李小红不进入 verified/active；有实体证据不匹配诊断；王小明正例保持 |
| T07 | B05 | 旧王小明和新李小红都用 char-lead，旧卡锁外形 | 李小红不继承王小明外形或图；旧资产仍可追溯 |
| T08 | B06 | identity=true、refs=false、已有旧图，执行明确重编 | refs 锁仍为 false；活动引用按新编译结果处理，不被 legacy locked 恢复 |
| T09 | B07 | 三镜：王小明进教室／他拿课本／随后他坐下读书，均为人物动作镜 | 三镜关联同一实体；不能只断言第一镜有人 |
| T10 | B08 | 咖啡原文，模型 subjects 放入 entityId=missing 的虚构产品 | 虚构产品不进入 active subjects 或最终 OBJECT LOCK；产生诊断 |

现有审查脚本通过读取 `server.ts` 文本定位路由并替换 LLM。完成 service 提取后可把它迁移成正常 integration test，移除其对路由字符串位置的依赖；保留以上场景及等价或更强的断言，并在验收报告说明迁移映射。

### 12.2 必须补充的回归

| 测试 ID | 场景 | 必须断言 |
|---|---|---|
| T11 | 标题、备注、语言变化；同输入只改 generatedAt | 真正依赖变化才失效；时间戳不改变语义版本 |
| T12 | 英文 “a part” 与 “apart”，以及 CRLF/LF、emoji | 有意义空格不被删除；规范化换行一致；UTF-16 证据索引准确 |
| T13 | 中文别名、英文全名/昵称、李明/李明哲 | 已验证别名归同实体；子串同名不合并 |
| T14 | 两个匿名女孩、含两个同名人物 | 台账可区分；歧义不自动合并参考图 |
| T15 | 男孩与成年老师同场、多职业人物 | 年龄／职业按实体关联，不给所有角色复制全局 hints |
| T16 | 普通动物、拟人动物、菜谱食材、拟人科普 | 身份与拟人属性正确；普通动物不被强制服装化；食材不变人物 |
| T17 | 第一人称 voiceover→on_camera→story_character→voiceover | 选择双向有效，entityId 稳定，资产保留且未误称原文有显示名 |
| T18 | 三种锁的全部 8 种组合 | 逐字段比较重编前后值，不只检查 toggle 布尔值 |
| T19 | 仅旧 locked=true，已有图；已有新字段且 refs=false | 旧整卡语义保留，新显式 false 不被覆盖，迁移幂等 |
| T20 | 旧 object 卡迁移；带 active/pending/retired 图的工程 | 类型迁移正确，所有有效资产进入引用收集并在重载后存在 |
| T21 | 双人同镜、两人代词、对话换人、引用他人一句话 | 上镜集合与句级语义一致；speaker 不必等于所有被拍人物 |
| T22 | 对照产品参数，故事里另有 support | 不因 contrast/continue 自动把配角画进产品对比 |
| T23 | 人物动作后的窗外树木 insert | 环境镜无人，不能为修 T09 全局默认 lead |
| T24 | 用户指定无人或只拍实物，改 coverage/风格并重载 | 手动选择保持；恢复自动后才重新规划 |
| T25 | 新镜头插到中间、删除一镜、LLM 返回错误 shotId | 不按数组位置继承旧角色或机位；引用准确 |
| T26 | 改外形、换图、排除角色，但文案不变 | bibleRevision/prompt 变化；analysisCache 不失效 |
| T27 | 用户改文案或锁，旧分析／参考图请求随后完成 | 旧响应不覆盖新状态，新角色不接收旧人生成图 |
| T28 | API 超时、空 JSON、缺字段、缓存损坏 | 有明确降级 provenance；有效用户状态保留；失败不被当成功分析永久缓存 |
| T29 | 两角色两图，供应商支持／不支持多图 | 实际请求与界面承诺一致；不静默只传第一张又宣称双人锁脸 |
| T30 | 模块来源 pinned，随后改稿 | 来源差异可见，旧快照 sourceKey 不伪装成新稿，资产和决定可追溯 |
| T31 | 用户纳入第四个角色或超过自动选择数量 | 不静默截断旧 active/locked 卡；容量策略清楚，候选台账完整 |
| T32 | 错卡被移除后的干净结果与仍在用的坏引用 | 前者不被历史提示永久拦截；后者用结构化 issue 拦截相关动作 |

### 12.3 测试分层

**单元层：**输入规范化、稳定序列化、证据索引、ID 匹配、纯 reducer、锁矩阵和 migration。

**流程层：**注入确定性分析／编译结果，走真实 service、响应接收函数、用户动作、分镜重建、`projectForPersist`、JSON roundtrip、`normalizeScriptWorkspace` 和提示词编译。关键状态使用同一个工程 fixture，不能各个函数用一份互不关联的新对象。

**界面层：**通过真实组件交互验证确认／拒绝／模式切换／锁开关；状态更新、重新渲染和保存必须实际发生。可以使用项目已有浏览器测试方式，最小新增依赖即可。

**真实效果层：**第 13 节的人工标注与实际生成项目，不与本地 mock 测试混报。

建议将专项单元与流程测试加入 `npm test`，另提供 `test:bible` 专项入口。当前 npm test 是显式枚举文件，新测试不能只是新建文件却没有被命令执行。新增脚本后才在文档声明该命令可用。

### 12.4 防止“假通过”的断言规则

- 正例先断言期望实体确实存在，再断言其字段正确；空 characters 不算年龄／身份测试通过。
- 比较完整预期集合和稳定身份；不能以“咖啡或药片抽出一个即可”代替两个实体都应保留的用例。
- no-cast 用例同时断言排除理由与实物处理正确，不能通过删光全部实体获得绿色结果。
- 低置信用例需要走生产使用的 ledger 路径和保存重载路径；只测试旧兼容函数不足。
- 阈值、预期实体和人工标签独立于实现生成；不能调用被测函数生成自己的期望结果。
- 错误消息匹配 code，展示文案变更不改变业务逻辑测试。
- 性能和请求数断言使用注入计数器，避免用不稳定的真实网络耗时当单元测试门槛。

### 12.5 执行命令

阶段 0 基线及最终回归可使用：

```powershell
npm test
npm run test:cast
npm run lint
npm run build
npx tsx scripts/audit-visual-bible-2026-09-08.mts
```

如果原审查脚本已迁移到正式 integration tests，在交付报告提供新命令及 T01–T10 对应的测试名。原脚本可以改为新测试入口；不能留一个永远因内部文件位置变化报错的假失败脚本。

测试在临时 fixture/目录进行，业务项目和用户参考图不作为可覆写测试数据。

## 13. 9.5 分验收门槛与效果评测

达到 9.5 分不是预先保证的结果。先满足工程硬门槛，再对真实文案和生成结果评分。

### 13.1 工程硬门槛

- B01–B08 全部关闭，T01–T10 全部通过。
- T11–T32 按真实支持的能力落地；不支持的供应商能力有明确产品行为及对应验证。
- 确认／拒绝／锁定／保存重载不丢决定；刚生成来源一致率 100%。
- 稳定 ID、证据引用、角色／实物类型无未解决的 P0/P1 问题。
- 原有测试、lint、build 全部通过；应用正常启动，旧工程可加载。
- 迁移及资产引用检查通过，实际参考图请求可核对。

任一项不满足，不能仅依据架构看起来完整或测试数量增加就评为 9.5 分。

### 13.2 至少 100 篇标注文案

建议分布：

| 主分组 | 最少篇数 | 重点 |
|---|---:|---|
| 具名故事 | 15 | 多人、场景变化、代词、省略主语 |
| 匿名／第一人称／情绪 | 15 | 存在人物与是否选择出镜分离 |
| 科普／反常识 | 15 | 无角色、仅引用人名、拟人解释 |
| 教程 | 15 | 食材、物件、操作者、连续状态 |
| 带货／产品 | 10 | 同产品连续展示、真人讲解可选 |
| 新闻／热点 | 10 | 多人物提及、机构、报道对象 |
| 动物／拟人／寓言 | 10 | 真动物与拟人区分 |
| 混合结构／长文／困难负例 | 10 | 前后换主题、不同同名人、反例引用 |

总数 100。上述分组内至少 20 篇英文；至少 30 篇明确无需固定出镜角色；至少 20 篇含跨句共指，标签可以交叉。

每条保存：原文、标题／意图、语言、期望实体及证据、是否应自动建卡、哪些应待确认、句级动作主体、哪些镜头允许无人、理由。生成的候选标签可用于准备资料，但只有经过人工核对的标签才能称为验收真值。

评测自动决策时清空用户 overrides；评测用户控制时单独执行预设动作。不能把 pending 当作自动正确建卡，也不能把用户补建的成功算入自动召回。

### 13.3 建议指标

| 指标 | 计算与目标 |
|---|---|
| 具名角色自动建卡精确率 | 正确自动纳入角色数 / 自动纳入总数，≥98% |
| 具名角色自动建卡召回率 | 正确自动纳入角色数 / 标签中应自动纳入总数，≥95% |
| 无角色文案误建率 | 被自动创建固定出镜角色的无角色文案数 / 无角色文案总数，≤2% |
| 实体证据有效率 | 进入硬约束且所有证据绑定有效的实体数 / 硬约束实体总数，100% |
| 用户决定保持率 | 所有后续操作仍符合用户 include/exclude/锁值的检查数 / 总检查数，100% |
| 来源一致率 | 未改变输入的生成／重载不误报 stale 的次数 / 相同输入次数，100% |
| 共指动作主体准确率 | 标注为可明确解析的句子中，主体集合完全匹配比例，≥95% |

必须同时报分子、分母和按分组结果。若某组样本少，注明统计局限；总体平均不能掩盖教程误建角色或英文漏人等类别失败。阈值达成情况是实测结果，不在实施前虚构。

### 13.4 不少于 20 个完整项目抽检

覆盖：具名双人、匿名人物、第一人称三种模式、教程连续实物、纯图解、动物、含对照和环境镜的故事。

保存每个项目实际的：分析模型与版本、prompt 版本、sourceKey、角色／实物集合、逐镜 occupancy、最终提示词、实际发送的参考图绑定、生成图和人工检查意见。

逐项核对：有没有多出人、少人、串脸、错误道具、状态不连续、无人镜强塞人、UI 声称发送却未发送的参考图。必须区分模型生成失败和上游规划／请求错误。

如果真实模型配置或标注样本尚不具备，先交付可运行的评测脚本、样本格式和完整工程修复；将这部分明确列为待验收，不把它作为停止其他本地修复的理由。

### 13.5 评分建议

沿用上次权重：架构 20%、事实与判定 25%、跨层及用户操作 25%、分镜连续性 15%、验证覆盖 15%。

进入 9.5 分候选版本要求：所有硬门槛通过，各维度至少 9.0，按实际证据加权达到 9.5，并提供真实评测记录。编程模型可以提交自评及依据，最终评分由独立验收给出。

## 14. 交付清单

完成后在 `docs` 新增一份实施与验证报告，至少包括：

1. B01–B08 的最终根因、修复方式、涉及文件和对应测试名。
2. 实际采用的 V2 契约、各版本／缓存键依赖及单一权威数据位置。
3. 旧项目迁移规则、重复 ID 歧义处理、参考图和退休资产的保留行为。
4. T01–T32 的执行情况、命令、通过数量、任何未覆盖项及具体原因。
5. 真实文案评测的样本来源、标签核对情况、指标分子／分母、失败样例。
6. 真实生图抽检结果；尚未执行时明确写“未执行”，并保留可运行入口。
7. 本次真正支持的多参考图能力与供应商限制。
8. 剩余问题及下一步；说明是否具备进入 9.5 分独立验收的条件。

功能实现、测试迁移和文档同步应在同一次交付中完成。不要只交一个“字段已新增”的完成报告。

## 15. 可直接复制给 AI 编程模型的执行指令

```text
请在当前 AI-Video 仓库中实施 docs/visual-bible-optimization-plan.md。

先阅读该方案、docs/visual-bible-acceptance-2026-09-08.md，以及
scripts/audit-visual-bible-2026-09-08.mts。当前工作区含已有未提交优化，
请保留这些修改，并以现有代码为基线继续修复。

目标是解决 B01–B08 全部问题，接通分析、前端接收、用户操作、重编、
保存重载、上镜计划、提示词与参考图的完整链路。

请按方案阶段 0–6 顺序执行，实现和测试一起推进。每阶段完成后验证相关
行为，继续后续阶段；常规可逆的本地修改无需逐阶段确认。

重点约束：
- 完整分析快照、用户决定、派生卡面分别负责各自状态。
- 输入指纹不使用生成实体 ID；实际提示词依赖结果版本。
- 用户 include/exclude 和三种锁在重编及重载后保持。
- 外形和参考图按稳定实体身份合并。
- 人物和实物都验证证据确实属于该实体。
- 上镜计划处理代词、双人和无人镜，不靠默认主角或配角凑结果。
- 旧项目和参考资产按明确迁移规则保留。

保留原 10 个复现检查的语义，按方案补 T11–T32，并将新测试加入实际执行
入口。重构后可以迁移原审查脚本到正式测试，但不能删除负例或降低断言。

最终运行专项测试、npm test、npm run test:cast、npm run lint、npm run build，
并完成实际组件交互及工程保存重载验证。将根因、改动、测试结果和迁移说明
写入 docs 的实施验收报告。

真实模型/生图与人工标注评测按方案单独记录。没有完成的真实效果检查必须
如实列为待验收，继续完成其余已具备条件的工作。最终给出工程修复完成情况
与进入 9.5 分独立验收的证据，不以自评分代替验收。
```
