# 文案预制作台 — 可执行落地文档

> 状态：P0 / P1 / P2 均已落地。口播按整句、一句可多图（S3）已落地。
> 原则：先选题后写字，先定时长后写稿，先定节奏后拆镜。口播是时间主人（方案 B：镜头 = 口播时长 + 停留）。

---

## 1. 这轮做什么、不做什么

### 做（P0）

- 文案页改成和设置页一样的**全宽工作台**：进入文案后隐藏预览播放器、时间线、顶栏，左侧主导航保留。
- 左栏阶段轨：意图 → 选题 → 调研 → 时长 → 节拍 → 口播 → 节奏。
- 五种入口、选题卡点选、时长预算环、节拍表、整段口播、节奏带、导演批注。
- **快闸**两条主路径（见 §3），深闸可逐步走完七个阶段。
- 字数 / 秒数 / 镜数 / 停留用**本地代码**算，不让模型估秒数。
- 「写入分镜」把预测镜写成 `clips`（`speechDuration + holdDuration`），不自动跳走。
- 调研阶段 P0 只收四条手写笔记，不跑联网搜索。

### 不做（更后）

- 深度 15+ 次搜索、付费搜索引擎、体裁包市场上架。
- 等长切片的旧「一键生成文案并自动分镜」入口（已替换，旧 `/api/script/generate` 保留但不被文案页调用）。

---

## 2. 布局（和设置页对齐）

```
┌────┬─────────────────────────────────────────────────────────┐
│主导│  文案预制作台                                      快闸  │
│航  ├────────┬──────────────────────────────┬─────────────────┤
│文案│ 阶段轨  │  当前阶段画布                 │ 导演批注 + 预算环│
│分镜│ 意图    │                              │ 字数 / 停留 / 概念│
│... │ 选题    │                              │                 │
│设置│ ...     │                              │                 │
│    ├────────┴──────────────────────────────┴─────────────────┤
│    │  写入分镜（主）          进入分镜台（次）                 │
└────┴─────────────────────────────────────────────────────────┘
```

- `activeTab === 'script'` 时：不渲染 `TopHeader` / `VideoPlayerStage` / `TimelineBar`，`ScriptPanel` 使用 `flex-1` 铺满，结构复用设置页的 `section + header + 左 nav + 右内容`。
- 进入文案时暂停播放；空格/J/K/L 等时间线快捷键与设置页一样不生效。
- `id="script-workspace"`。阶段按钮 `id="script-nav-{stage}"`。
- ≥1280px 显示右侧导演栏（约 288px）；窄屏导演栏改到画布下方。
- 阶段未满足进入条件时仍可点击查看，但主操作按钮禁用并说明缺什么。

---

## 3. 钉死的交互（先于字段）

### 3.1 五种入口（意图页）

用户一进文案先看五张入口卡，不是一个大输入框。

| 入口 id | 用户点的 | 点完去哪 | 还要填什么 |
|---|---|---|---|
| `blank` | 今天不知道拍什么 | 选题 | 可选关键词、平台、节奏，点「给我选题」 |
| `direction` | 有方向没题目 | 选题 | 必填方向一句话，点「给我选题」出 3 张角度卡 |
| `product` | 有产品/账号 | 选题 | 必填产品/卖点，出 3 张可拍卡 |
| `reference` | 有对标 | 选题 | 必填对标描述（P0 不解析 URL），出 3 张「保留节奏、换角度」卡 |
| `have-script` | 已有文案 | 口播 | 必填粘贴口播，点「诊断并拆分」：跳过选题，按字数反推定时长并出节拍/节奏带 |

每张卡 `id="intent-{id}"`。点卡只切换意图，不立刻调模型。

### 3.2 快闸（默认要能用的路）

**路径 A · 从零到稿（目标 ≤ 5 次有效点击）**

1. 点「今天不知道拍什么」或「有方向没题目」
2. 点「给我选题」→ 出 3 张选题卡，停在选题
3. 点一张卡 → **自动锁题、写入 `project.topic`、跳到时长**，预算按平台/节奏/体裁填好
4. 点「按预算写稿」→ 一次生成节拍 + 整段口播 + 节奏带，跳到口播
5. 点「写入分镜」→ 更新 `clips`，留在文案页，提示「已写入 N 镜」

**路径 B · 已有口播**

1. 点「已有文案」
2. 粘贴
3. 点「诊断并拆分」→ 时长环变色、节拍/节奏带出现，停在口播
4. 点「写入分镜」

**顶栏「快闸」按钮 `id="btn-script-fast-gate"`**

- 还没选定选题，且不是「已有文案」：等价于当前入口的「给我选题」
- 已选定选题，或「已有文案」已有正文：等价于「按预算写稿」/「诊断并拆分」
- 进行中按钮转圈，禁止连点

**深闸**：用户自己点阶段轨往下走。调研可空。时长可改平台/节奏/目标秒数后再写稿。

### 3.3 选题卡

- 一次只出 3 张，横排。`id="topic-card-{id}"`
- 点卡 = 选中（描边高亮）。不在这一步写全文。
- 点卡后主按钮变成「用这张卡定时长」。
- 不允许在选题页出现「一键出成片」。

### 3.4 时长页

顺序固定：

1. 展示推荐：「建议 {n} 秒，因为体裁 {genre}、平台 {platform}、概念 {k} 个」
2. 用户可改：平台、节奏档、目标秒数（15/21/30/45/60/90，或自定义 8–180）
3. 三个环即时重算：**口播字数 / 停留配额 / 概念上限**
4. 可选「锁镜数」：填了则预测按该镜数切，并警告节奏档可能被带偏
5. 主按钮「按预算写稿」`id="btn-draft-from-budget"`（无选题且不是已有文案时禁用）

改预算后若已有口播：字数环变红/绿，**不自动改字**，导演栏提示「超了 N 字，删哪类句能回来」。点「按预算写稿」才会重写。

### 3.5 节拍 / 口播 / 节奏

- 节拍：一行一拍，可改口播、画面意图、能量（快/中/慢/停）、是否需要停留。改口播后本地重算节奏带。
- 口播：一个大编辑器，整段连续旁白。字数对着预算实时变色。`id="input-full-narration"`
- 口播与节拍双向：改整段后按句/拍重新对齐；改某一拍只替换该拍对应片段。
- 节奏带：一格一镜，宽度 ∝ 秒数，颜色 = 能量。点击高亮对应口播。`id="rhythm-tape"`
- 节奏带**不能**把一镜拖短到小于该镜口播秒数（方案 B：拖的是停留。P1 已做：右缘拖拽只改 hold，0–8 秒）。

### 3.6 写入分镜

- 主按钮 `id="btn-apply-storyboard"`：无预测镜时禁用。
- 写入后：`clips` 被预测镜替换；旧画面作废，用程序占位图；`speechDuration`/`holdDuration`/`duration`/`narration`/`visualPrompt` 一并写入。
- 不自动跳到分镜页。次按钮「进入分镜台」才跳。
- 成功条：「已写入 N 镜，总长 Xs（口播 Ys + 停留 Zs）」

### 3.7 阶段什么时候算「过了」

| 阶段 | 完成条件 | 绿点 |
|---|---|---|
| 意图 | 选了入口 | 是 |
| 选题 | 有 `selectedTopicId`，或入口是已有文案 | 已有文案可灰标「已跳过」 |
| 调研 | 四条笔记任一条有字 | 可空，不挡快闸 |
| 时长 | `targetSeconds` > 0 | 选卡后自动完成 |
| 节拍 | `beats.length >= 2` | 写稿后完成 |
| 口播 | 去掉空白后字数 ≥ 8 | 写稿/粘贴后完成 |
| 节奏 | `forecastShots.length >= 2` | 写稿/诊断后完成 |

---

## 4. 字段契约（跟交互一起锁）

全部挂在 `VideoProject.scriptWorkspace`。老工程没有该字段时，打开即从 `topic + clips` 水合，不丢已有旁白。

```ts
type ScriptStage = 'intent' | 'topic' | 'research' | 'duration' | 'beats' | 'copy' | 'rhythm';
type ScriptIntent = 'blank' | 'direction' | 'product' | 'reference' | 'have-script';
type ScriptGenre = '科普' | '反常识' | '故事' | '教程' | '带货' | '情绪' | '热点解读' | '口播金句';
type ScriptPace = 'ultrafast' | 'fast' | 'medium' | 'slow' | 'cinematic';
type ScriptPlatform = 'douyin' | 'shipinhao' | 'reels' | 'bilibili' | 'youtube';
type BeatFunction = 'hook' | 'setup' | 'turn' | 'proof' | 'reveal' | 'cta';
type ShotEnergy = 'fast' | 'medium' | 'slow' | 'hold';
type DirectorNoteLevel = 'info' | 'warn' | 'block';
```

`TopicCard`：`id, title, hook, insight, genre, whyNow, durationHint, paceHint, conceptCount, risk, completionFit, hookType`

`DurationBudget`：`targetSeconds, platform, pace, charsPerSecond, speechSeconds, holdSeconds, maxChars, usedChars, conceptMax, conceptUsed, lockedShotCount`

`ScriptBeat`：`id, order, function, intent, narration, targetSeconds, energy, visualIntent, needsHold`

`ForecastShot`：`id, order, start, speechDuration, holdDuration, energy, function, visualIntent, narration, splitReason`

`DirectorNote`：`id, level, message, target`

`ResearchNotes`：`competitor, audienceQuestion, fact, visualRef`

`ScriptWorkspace`：`stage, gate, intent, intentNotes, topicCards, selectedTopicId, researchNotes, durationBudget, beats, fullNarration, forecastShots, directorNotes, appliedShotCount, appliedAt`

---

## 5. 本地规则（代码门，模型不准改）

实现文件：`src/utils/scriptBudget.ts`。

### 5.1 节奏档

| pace | 字/秒 | ASL | 停留占比 | 单镜区间 |
|---|---|---|---|---|
| ultrafast | 5.3 | 1.6s | 9% | 0.8–2.5s |
| fast | 5.0 | 2.5s | 10% | 1.5–3.5s |
| medium | 4.3 | 3.7s | 15% | 2.5–5.5s |
| slow | 3.5 | 6.5s | 22% | 4–10s |
| cinematic | 3.6 | 5.0s | 20% | 2–10s |

口播秒数 = `target × (1 - 停留占比)`。字数上限 = `round(口播秒数 × 字/秒)`。字数统计与旁白轨一致：去掉空白后的字符数。

### 5.2 概念上限

| 时长 | 最多新概念 |
|---|---|
| ≤18s | 1 |
| ≤35s | 2 |
| ≤50s | 2 |
| ≤75s | 3 |
| 更长 | 4 |

### 5.3 平台建议时长

| 平台 | 默认秒 | 建议区间 |
|---|---|---|
| douyin / shipinhao | 30 | 15–30 |
| reels | 30 | 21–45 |
| bilibili | 60 | 45–90 |
| youtube | 60 | 60–90 |

体裁修正：情绪/故事偏慢并 +10s（不超过平台上限）；带货/热点/口播金句偏快，口播金句默认 15s。

### 5.4 分镜预测

```
N0 = round(target / ASL)
若 lockedShotCount：N = clamp(lockedShotCount, 2, 24)
否则 N = clamp(N0, 2, 24)

能量曲线（按时间位置）：
  0–12%   钩子   能量 fast，ASL × 0.6
  12–55%  展开   跟随节奏档
  55–82%  高潮   能量 fast，ASL × 0.75
  82–100% 落地   能量 slow/hold，把剩余 hold 配额堆在最后 1–2 镜
```

切割顺序：

1. 若节拍带口播：一拍起一镜，超单镜上限则按句号/问叹号再切。
2. 若只有整段口播：按画面动机标点切（。！？；换行），过短合并（< 6 字），过长再切。
3. 每镜 `speech = 字数 / 字每秒`；`hold` 从配额按能量分配（hold/slow 多给，fast 少给）。
4. `duration = speech + hold`；禁止 `duration < speech`。
5. 总和缩放到 `targetSeconds`（优先缩放 hold，hold 不够再均分 speech，但每镜 speech 不得低于该镜字数所需）。

### 5.5 导演批注门

| 条件 | 级别 | 文案 |
|---|---|---|
| 口播字数 > 上限 | warn | 超了 N 字，中速大约多 X 秒；要卡住时长请删一句论据或钩子复述 |
| 口播字数 < 上限 × 0.55 | info | 字偏少，画面会停较久 |
| 第一镜结束 > 3s 且节奏不是 slow/cinematic | warn | 钩子超过 3 秒，快/中档容易被划走 |
| 连续 ≥3 镜能量相同 | warn | 节奏带是平的，拉开一处快切或一处停留 |
| 单镜 duration > 档位 max × 1.25 | warn | 第 N 镜偏长，拆动作或加快口播 |
| 一镜口播里出现两个主动词且时长允许拆 | info | 建议一镜一个动作 |
| 总 hold 偏离配额 ±20% | warn | 停留配额没用完/超了 |
| 概念数 > 上限 | warn | 这条时长装不下这么多点，砍点或加长 |
| 无钩子职能镜 | warn | 前 3 秒没有钩子镜 |
| 字数 > 上限 × 1.25 | block | 禁止写入分镜，先砍字或加长目标 |

---

## 6. API（P0）

文案页不再调用 `/api/script/generate`。

### `POST /api/script/topics`

请求：`{ intent, intentNotes, platform, pace, llmApi }`

响应：`{ cards: TopicCard[] }` 固定 3 张。钩子结构必须不同；`whyNow` 禁止「这个话题很火」这种空话。失败则服务端返回本地兜底卡，HTTP 仍 200。

### `POST /api/script/draft`

请求：`{ topicCard | topic, intent, intentNotes, researchNotes, budget, llmApi }`

响应：`{ title, fullNarration, beats: ScriptBeat[] }`

硬约束写进 prompt：**旁白总字数 ≤ `budget.maxChars`**；节拍 4–10 个；第一拍必须是 hook；最后一拍 cta 或 reveal；`visualIntent` 写看得见的因果，禁止「很有氛围」。

秒数、hold、镜数**不**由模型返回。客户端拿 `fullNarration + beats` 跑 `predictShots`。

### 已有文案的「诊断并拆分」

纯前端：`buildDurationBudget`（用字数反推秒数，若用户已锁时长则只标红）+ 按标点出节拍 + `predictShots`。不打 draft 接口。

---

## 7. 文件

| 文件 | 职责 |
|---|---|
| `docs/script-workspace.md` | 本文档 |
| `src/types.ts` | 上述类型；`VideoProject.scriptWorkspace?`；删除无用的 `ScriptSubTab` |
| `src/utils/scriptBudget.ts` | 节奏表、预算、预测、校验 |
| `src/utils/scriptWorkspace.ts` | 默认值、从 clips 水合、预测镜 → clips |
| `src/components/ScriptPanel.tsx` | 全宽工作台 UI |
| `src/App.tsx` | 文案 tab 隐藏预览；暂停播放；快捷键；把 workspace 写入工程 |
| `src/utils/presets.ts` | 水合时不强制改示例数据 |
| `server.ts` | `/api/script/topics`、`/api/script/draft` |

---

## 8. 写入分镜的 clip 字段

| clip 字段 | 来自 |
|---|---|
| narration | 该镜口播 |
| speechDuration | 预测 speech |
| holdDuration | 预测 hold |
| duration | speech + hold |
| visualPrompt / chineseVisualPrompt | 画面意图（中英） |
| cameraMotion | fast→zoom-in，medium→pan-left/cinematic-orbit，slow/hold→static |
| transition | 镜间 crossfade，最后一镜 fade-black |
| imageUrl | `generateProceduralArtwork` 占位 |
| order / id | 新 id |

---

## 9. P0 验收

1. 点左侧「文案」：预览和时间线消失，工作台铺满，设置页布局神似（顶栏 + 左阶段轨 + 画布）。
2. 路径 A：空白灵感 → 给我选题 → 点第一张卡 → 按时长写稿 → 写入分镜。全程不出现等长 5 秒切片。节奏带格子宽度不一样。
3. 路径 B：已有文案粘贴约 80 字 → 诊断并拆分 → 字数环有数字 → 写入分镜后 clips 条数 = 节奏带格数。
4. 把目标改成 15 秒、口播仍是 200 字：字数环变红，出现 block 批注，写入分镜禁用。
5. 写入后仍停在文案；点「进入分镜台」才看到新 clips。
6. 刷新后选题、口播、预算还在（localStorage）。
7. 无 LLM key 时选题/写稿仍能出兜底结果，不转圈卡死。

---

## 10. P1（本轮落地）

1. **节奏带拖停留**  
   每格右缘可拖。`holdDuration` 最低 0、最高 8 秒，**不能短于口播**。拖动不改字、不改 speech。总长可以超过目标，导演栏提示「多出来的都是画面停留」。钉过的停留在「按预算写稿」之后按口播文本对齐保留。

2. **锁镜数反推 ASL**  
   时长页填锁镜数后，展示 `目标秒 / 镜数 = 平均一刀秒数`，并标最近节奏档。若和当前档不一致，可一键「改用×档再预测」。导演栏同步警告。

3. **一镜一个动作**  
   一镜 2 个主动作 → warn；3 个及以上 → block，禁止写入分镜。

4. **调研笔记进钩子**  
   笔记卡可拖到钩子槽 / 钩子节拍 / 选题卡钩子，或点「填进钩子」。事实、真问题、对标写入钩子口播；画面写入钩子镜的画面意图。

### P1 验收

1. 节奏页拖某一格右缘：该格变宽，口播秒数不变，停留增加；往左拖不能小于口播。
2. 时长页锁 6 镜、目标 30 秒：出现 ASL ≈ 5.0s、建议改用慢档。
3. 某镜口播写成「他开门，看见妈妈，眼睛红了」：导演栏 block，写入分镜禁用。
4. 调研里写一条事实，点「填进钩子」或拖进钩子槽：钩子节拍/口播开头变成这条事实。

## 11. P2（本轮落地）

1. **浅调研四刀联网**  
   `POST /api/script/research`：并行搜对标 / 受众 / 事实 / 画面（维基 + DuckDuckGo，失败则模型归纳）。结果写入 `researchBrief` 并填进四条笔记。调研页按钮「开始浅调研」。

2. **对标 URL 反拆**  
   `POST /api/script/reference`：抓标题/摘要（YouTube 走 oEmbed），产出 keep / change / whyBetter + 3 张差异化概念卡。意图页选「有对标」并贴链接，或调研页填链接。

3. **三概念提案 + 杂交**  
   `POST /api/script/concepts`：三张卡的 structure / hookType / insight 必须不同。选题页可「A 的钩子 + B 的结构」杂交后定时长。

4. **体裁包**  
   八个体裁包写死节奏、默认秒数、节拍骨架、写稿提示。意图页和时长页可选。写稿时把 `beatPlan` 传给 `/api/script/draft`。

5. **快闸 8 秒试听**  
   顶栏「试听钩子 8秒」：截钩子节拍约 `8 × 字/秒` 个字，走现有 `/api/audio/tts`，不合成整段旁白。再点一次停止。

### P2 验收

1. 调研页点「开始浅调研」：出现四刀结果或「没搜到」说明，笔记被填上。
2. 意图页贴一条 https 链接点「反拆对标」：选题页出现 keep/change 和 3 张卡。
3. 选题页选不同的钩子卡和结构卡，点「采用杂交」：跳到时长，题目标了 ×。
4. 时长页点「带货」：目标秒数靠近 21、节奏变快，写稿提示出现。
5. 有钩子口播时点「试听钩子 8秒」：开始出声；再点停止。

### 新接口

| 接口 | 作用 |
|---|---|
| `POST /api/script/research` | 四刀浅调研 |
| `POST /api/script/reference` | 对标反拆 |
| `POST /api/script/concepts` | 三概念（可在调研后） |
