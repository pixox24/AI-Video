# 全片机位层 — 落地文档

> 状态：按此文档落地。口播时钟、画面圣经、风格编译、GPT Image 2 五段简报均已存在。
> 原则：先锁口播，再切槽位，再设计机位，最后编译生图。机位不能改刀、不能换角、不能改画风。

---

## 1. 要解决什么

现在的「分镜」其实是配图槽位：一句一图（对照句两图），风格很像，景别几乎一样。`cameraMotion` 是按 energy 轮换的 Ken Burns，不是摄影景别。

专业短片缺的是 **coverage**：这一刀用多大、从哪拍、在全片里干什么、和上一镜什么关系。

目标：有连续性、有故事（或有论证）的专业级短片，而不是 12 张互不认识的海报。

---

## 2. 分层（各管各的）

| 层 | 管什么 | 不管什么 |
|---|---|---|
| 口播 / spans | 念什么、一句几图、气口 | 景别 |
| 画面圣经 | 谁、哪、什么会回来 | 每镜新动作、画法 |
| **机位表 Coverage** | **景别、角度、构图、镜头职责、镜间关系** | 口播、角色、色板、生图长文 |
| 风格 DNA | 介质、色、光、材质 | 本片角色、本镜故事 |
| `compileImagePrompt` | 编成 GPT Image 2 五段简报 | 不再用口播原文当 Subject |
| Ken Burns | 按景别选后期推镜 | 禁止按 energy 轮换 |

---

## 3. 调用顺序（必须二次，禁止和文案一次出）

```
① draft：只写口播和节拍
② 人改口播（检查点）
③ 圣经
④ split-spans：锁槽位，一句两图
⑤ coverage：只给这 N 格填机位     ← 新的一枪 LLM
⑥ 写入分镜时 compileImagePrompt（本地，不再为每镜打模型）
```

- ① 和 ⑤ 不合：口播还在变，槽位还没有。
- ④ 和 ⑤ 不合：切句是语言学，机位是摄影。
- 「已有文案」没有 ①，从 ③④⑤ 走。
- 口播没改、槽位数没变：不要重跑 ⑤。
- 只改风格：不重跑 ⑤，只重编译。
- 改圣经角色：叙事片重跑 ⑤。

钱：相对 GPT Image 2 生图可忽略。贵的是串行等待。⑤ 失败用规则表兜底，不挡写入分镜。

---

## 4. 机位字段

每格 `ForecastShot` / `StoryboardClip`：

| 字段 | 取值 | 中文 |
|---|---|---|
| `shotSize` | ecu / cu / ms / ws / insert | 大特写 / 特写 / 中景 / 全景 / 插入 |
| `cameraAngle` | eye / low / high | 平视 / 微仰 / 俯 |
| `shotComposition` | center / thirds / silhouette / negative-left / negative-right | 居中 / 三分 / 轮廓 / 左留白 / 右留白 |
| `coverageJob` | hook / establish / evidence / insert / contrast / callback | 钩子 / 建立 / 证据 / 插入 / 对照 / 回收 |
| `coverageLink` | advance / contrast-cut / callback / same-axis | 同轴推进 / 跳切对照 / 回到开场 / 同轴 |
| `coverageSource` | rule / llm / pinned | 规则 / 模型 / 手钉 |

硬规则（规则表和 LLM 结果都要过）：

- 相邻两格禁止同一 `shotSize`
- 第一格 job = hook；最后一格 job = callback，构图家族尽量贴近第一格
- 对照句两图（`voRole=continue` 或 continuity=contrast）：job=contrast，link=contrast-cut，景别可近但构图可左右对翻
- 科普：禁止无口播依据的「男主走来走去」；第二格优先 insert
- 叙事：非对照格同一空间、默认平视；不要每格换世界

---

## 5. 规则表（无 LLM 也能用）

科普 / 说明：

1. 钩子：ecu + thirds  
2. 机制：insert  
3. 中间：cu / ms 交替，禁止与上一格相同  
4. 对照：ms 对切  
5. 收束：回到第一格景别家族（多为 cu/ecu）+ callback

故事 / 情绪：

1. 钩子：cu 人物  
2. 建立：ms 同空间  
3. 细节：insert 或 ecu  
4. 对照才换主体  
5. 收束：callback，构图贴近开场

---

## 6. LLM 作业单（⑤）

输入：已切槽位（id、口播切片、function、是否对照、是否首尾）、圣经摘要、体裁、风格禁令（不要改色/介质）。

禁止：增删槽位、改口播、发明新角色、写生图英文长 prompt、给每格都写特写。

输出：与输入 **同 id、同数量** 的机位字段。本地再跑相邻景别修正。

---

## 7. 编进提示词

`compileImagePrompt` 的 Scene/Subject 增加一帧语言，例如：

`大特写，平视，三分构图，主体偏左，右下为手机冷光。`

Details 仍只放风格 DNA。Constraints 仍禁止字幕、禁止抄参考图人物街道。

---

## 8. Ken Burns

| 景别 | 默认运镜 |
|---|---|
| ecu / cu / insert | static |
| ms | zoom-in |
| ws + establish | zoom-out |
| ws 其他 | zoom-in |
| callback | static |

禁止再按 energy 轮换 orbit。

---

## 9. 界面

节奏带每格副行显示：`特写 · 平视 · 钩子`。不另开复杂编辑器。手改以后再加 `coverageSource=pinned`。

分镜卡「将发送给生图模型」应能看到景别写进简报。

---

## 10. 验收

护眼科普第一镜：大特写干涩眼睛，不是口播原文，不是参考图雨夜街道。  
第二镜与第一镜景别不同（优先插入/机制）。  
最后一镜能认成开场构图家族。  
对照句两图对切，不在中间断开口播。
