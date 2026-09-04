# 美术世界契约 — 可执行落地文档

> 状态：P0 / P1 已落地。P2 垫图与混合未接。
> 原则：风格是一份可钉的 **StylePack 数据**，不是生图时拼在尾巴上的滤镜。预设和「上传图反推」走同一槽位。口播怎么说归体裁包，画面什么世界归风格包。

---

## 1. 这轮做什么、不做什么

### 做

- 把现在的 `promptSuffix` 拆成 **世界契约 `world` + 渲染契约 `render` + 当代落地策略 `contemporaryPolicy`**。
- 写节拍画面意图、写入分镜提示词时，就把当前 StylePack **写进画面**（服饰、时代、道具禁区），而不是等生图再叠加。
- 生成分镜画面时的 LLM：**system 固定导演契约**；**user 只注入当前这一份 StylePack**。
- 生图不再无脑拼接一整段 cinematic；最多补很短的 render 校准，并去掉写入分镜里写死的 `cinematic lighting`。
- 「应用到全部分镜」改为：按新包 **重写** `visualPrompt` / `chineseVisualPrompt`，再批量生图。
- **设置页新增「美术世界」分区**：配置百炼视觉理解 API + 上传图反推 StylePack + 确认/钉住。
- 反推模型：阿里云百炼 **`qwen3.7-plus`**（用户在设置里自己填 Key / 可改模型名）。

### 不做（本规划范围外）

- 用风格去改口播、体裁包、节拍字数。
- 把多模态散文直接塞进 system。
- 每一镜都重新看原图。
- 本轮不接 IP-Adapter / 图生图垫图（契约里预留 `reference` 字段，P2 再生图使用）。
- 不把八套预设的长英文 suffix 全部塞进 system。

---

## 2. 为什么要改

现状：

- 风格字段叫 `promptSuffix`，生图时 `最终词 = 镜头提示词 + ", " + 风格词`。
- 文案 draft **完全不读** `visualStyle`；写入分镜还硬编码 `cinematic lighting`。
- 旧接口只在用户提示里写一句「风格符合 cinematic」，system 仍是通用导演。

后果：选「东方水墨」也经常画出羽绒服和地铁——内容名词压过尾巴上的风格标签。

目标：水墨/古风在 **写画面提示词时** 就决定服饰和时代；电影/矢量可以只动画法。上传一张参考图反推出的世界，和点预设卡片，进的是 **同一份契约**。

---

## 3. 核心数据：StylePack

运行时「当前美术世界」是一份 JSON，不限于 8 个枚举。

```ts
type StyleSource = 'preset' | 'inferred' | 'hybrid';
type ContemporaryPolicy = 'adapt' | 'costume' | 'filter';

interface StyleWorld {
  era: string;                 // 例：写意东方、近未来夜城、当代写实
  wardrobe: string;            // 服饰语言
  space: string;               // 建筑 / 室内 / 材质
  must: string[];              // 必须看见的造型语言
  dont: string[];              // 禁止的时代穿帮
}

interface StyleRender {
  medium: string;              // 水墨 / 胶片 / 三维 / 矢量
  lighting: string;
  lens: string;
  quality: string;             // 短质量词，替代如今整段 promptSuffix
}

interface StyleReference {
  imageId: string;             // 本地引用，不把原图塞进 LLM 分镜
  thumbDataUrl?: string;       // 设置页缩略图
  notes?: string;              // 「笔触接近参考图」
}

interface StylePack {
  id: string;                  // preset:chinese-ink | inferred:<hash>
  source: StyleSource;
  label: string;               // 人读：东方水墨 / 来自上传图
  world: StyleWorld;
  render: StyleRender;
  contemporaryPolicy: ContemporaryPolicy;
  reference?: StyleReference;
  confidence?: number;         // 0–1，反推用
  pinned?: boolean;
  createdAt: number;
}
```

`contemporaryPolicy`：

| 值 | 含义 | 适用 |
|---|---|---|
| `adapt` | 保留口播语义，把场景/服饰译成该世界能成立的版本 | 水墨、国风（默认） |
| `costume` | 人仍是当代身份，只换画法 | 「现代人、水墨画」 |
| `filter` | 几乎只加渲染，不改时代 | 电影质感、真实摄影、矢量 |

预设 `VisualStyle` 八个 id 继续作为 **目录**。运行时 `project.settings.activeStylePack` 才是注入物。点「东方水墨」= 把对应预设拷进 `activeStylePack`。反推确认 = 换成 inferred 包。

---

## 4. 预设八包（world 必须手写，不能只靠旧 suffix）

落地时把 `STYLE_DEFINITIONS` 扩成完整 StylePack。下面是契约要点（render 沿用现有 suffix 压缩版）。

| 预设 id | policy | world 要点 | dont 举例 |
|---|---|---|---|
| `photorealistic` | filter | 当代真实世界，现代服饰 | 不要卡通五官、不要明显 CG 塑料感 |
| `cinematic` | filter | 当代或题材自带的时代，院线光影 | 不要插画扁平、不要过度霓虹 |
| `anime` | adapt | 日系动漫人物造型与场景 | 不要写实皮肤毛孔、不要实拍街景照片感 |
| `cyberpunk` | adapt | 近未来城市，机能服饰、义体、全息 | 不要田园水墨、不要乡村土坯 |
| `3d-render` | filter | 三维角色与场景，当代或题材时代 | 不要 2D 线稿、不要实拍噪点当主体 |
| `chinese-ink` | **adapt** | 写意东方：袍服或简化轮廓、屏风留白、山水/轩窗 | 禁止清晰品牌、运动鞋 LOGO、玻璃幕墙霓虹、写实地铁车厢广告 |
| `vintage-film` | filter | 当代或题材时代，90s 胶片色彩 | 不要 HDR 广告质感、不要纯矢量平涂 |
| `vector-art` | filter | 当代扁平几何 | 不要写实毛孔、不要水墨皴法 |

`chinese-ink` + 口播「地铁里抱怨」+ `adapt`：画面应是写意长廊/舆轿/简化当代轮廓在水墨城垣里抱怨，而不是优衣库乘客 + 水墨滤镜。

---

## 5. LLM 注入方式（system 级世界契约）

### 5.1 永远两段，不要第三种

**System（所有风格共用，短、稳定）：**

```
你是短视频画面导演。口播语义不能丢。
每一镜画面必须服从用户给出的「美术世界契约」：服饰、道具、建筑、材质不得出现契约禁止项。
禁止用空泛的「电影感」「很有氛围」代替具体可见物。
不要改口播用词，除非用户明确要求文案也换风。
只输出合法 JSON。
```

**User 中插入当前包（唯一注入槽）：**

```
【美术世界】{label}（来源：预设 / 上传反推）
【世界-时代】{era}
【世界-服饰】{wardrobe}
【世界-空间】{space}
【必须看见】{must}
【禁止出现】{dont}
【当代题材落地】adapt|costume|filter + 一句话解释
【渲染】{medium}; {lighting}; {lens}; {quality}
【参考图】有则写「笔触接近用户锁定的参考图，不要复述照片里的具体人脸」；无则省略

【本镜口播】...
请输出 visualIntent（中文、看得见的因果）和 visualPrompt（英文、已含世界+渲染，可直接生图）。
```

system **不**为反推单开一套。反推只改变注入的那一份 JSON。

### 5.2 必须注入的调用点

| 优先级 | 调用 | 现在 | 改后 |
|---|---|---|---|
| P0 | `/api/script/draft` 写 `visualIntent` | 无风格 | user 注入 StylePack |
| P0 | 写入分镜 `forecastToClips` | 写死 cinematic | 用 visualIntent 拼 visualPrompt，带 render，禁止硬编码 cinematic |
| P0 | `/api/visual/generate` | 再拼一整段 enhancer | 信任已写入的 prompt；可选追加 ≤8 词 render；去重 |
| P1 | 「应用此风格并重绘」 | 只换后缀 | LLM/模板重写各镜画面词 → 再生图 |
| P1 | `/api/script/polish-narration` 扩写画面 | 一句 style id | 同一契约块 |
| P2 | 旧 `/api/script/generate`、`split-text` | 一句 id | 同一契约块（文案台主链路不依赖它们） |

### 5.3 钉

- 钉 StylePack：换口播也保持同一美术世界。
- 钉某镜 `visualIntent`：换风格时只翻译到新世界，不丢掉钉子里的主体（「必须是这杯咖啡」→ 水墨里仍是这杯咖啡，器皿改瓷盏）。
- 钉参考图：P2 生图垫图用；P0/P1 只把 notes 写进 user。

---

## 6. 设置页：反推 + API 配置

风格的 **配置和反推** 放在设置工作台，与 LLM / 生图 / TTS 并列。日常「选用哪一包、应用到分镜」仍在左侧「风格」页。

### 6.1 信息架构

设置左栏增加一项（插在「生图」和「TTS」之间）：

| id | 文案 | hint |
|---|---|---|
| `style` | 美术世界 | 预设契约 / 上传反推 / 百炼视觉 |

`SettingsSection` 增加 `'style'`。

设置画布分三块，**同一屏从上到下**：

1. **当前生效包**（只读摘要 + 来源）
2. **上传图反推**（主操作）
3. **百炼视觉理解 API**（用户自己配 Key）

风格页（`StylePanel`）继续：点预设 → 写入 `activeStylePack`；列出「来自设置的反推包」；按钮「应用此风格并重绘所有分镜」。设置页不承担刷时间轴，避免和风格页抢日常选择。

### 6.2 百炼视觉理解 API（用户自配）

新增配置，挂在 `project.settings`，**不要和 TTS 的百炼 Key 强行绑死**（TTS 走 `qwen3-tts-flash`，反推走 `qwen3.7-plus`，允许同一把 Key，也允许分开填）。

```ts
interface CustomStyleVisionApiConfig {
  enabled: boolean;
  provider: 'bailian';
  endpoint: string;   // OpenAI 兼容
  apiKey: string;     // 仅本地
  model: string;      // 默认 qwen3.7-plus
}
```

默认值：

| 字段 | 默认 |
|---|---|
| `enabled` | `false`（没 Key 时反推按钮禁用） |
| `provider` | `bailian` |
| `endpoint` | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `apiKey` | `''` |
| `model` | `qwen3.7-plus` |

设置项 UI（对齐现有 TTS 卡）：

- `id="style-vision-endpoint"` 接口地址，占位符同上
- `id="style-vision-api-key"` API Key，密码框，文案「仅保存在本地」
- `id="style-vision-model"` 模型，默认芯片 `qwen3.7-plus`，可改成 `qwen3.7-plus-2026-05-26` / `qwen3.6-flash` 等
- `id="btn-test-style-vision"` 测试连通：发一张 1×1 或内置小图 + 「只回复 ok」，检查 HTTP 与 JSON
- 说明：北京地域 Key；兼容 OpenAI `chat/completions`；反推关思考链，只要结构化 JSON

调用约定（落地时写进 `server.ts`）：

```
POST {endpoint}/chat/completions
Authorization: Bearer {apiKey}
{
  "model": "qwen3.7-plus",
  "temperature": 0.2,
  "enable_thinking": false,
  "response_format": { "type": "json_object" },
  "messages": [
    { "role": "system", "content": "只输出合法 JSON，不要解释。" },
    { "role": "user", "content": [
        { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,..." } },
        { "type": "text", "text": "<反推说明书，见 §7>" }
    ]}
  ]
}
```

地域：用户可把 endpoint 改成新加坡 `https://dashscope.aliyuncs.com` 不可用时的 intl 地址。文档里写清楚，默认北京。

密钥：与现有 LLM/TTS 一样只存工程 `localStorage`，不进 git，日志禁止打印 Key。

### 6.3 上传与反推 UI

设置「美术世界」上半部分：

```
当前生效
  东方水墨 / 国风 · 预设 · 当代落地 adapt
  [在风格页更换]

从一张图反推美术世界
  [ 上传参考图 .jpg/.png/.webp ，≤ 4MB，最长边缩到 1280 ]
  缩略图预览
  [ 开始反推 ]   未配 Key 时禁用，文案「先在下方填写百炼 API Key」
  反推中：顶栏统一吐司「正在用 qwen3.7-plus 看图…」

反推结果卡（未确认前不生效）
  标签、时代、服饰、空间、必须/禁止、落地策略、渲染、置信度
  用户可改文本和策略
  [ 放弃 ]  [ 确认为当前美术世界 ]
```

确认后：

- `settings.activeStylePack` = 这份 inferred 包
- `settings.visualStyle` 仅当能匹配预设时回写（对不上就保持原枚举，**以 Pack 为准**）
- `reference.thumbDataUrl` 存缩略图；原图可只留在当次请求，不强制长期存 base64
- 同一图片 hash 命中缓存则不再打 API
- 顶栏吐司：「已锁定美术世界：来自上传图」

`id`：

- `input-style-reference-image`
- `btn-infer-style-pack`
- `style-infer-result-card`
- `btn-confirm-style-pack`
- `btn-discard-style-pack`

### 6.4 风格页怎么读设置

`StylePanel` 顶部一行：`当前：{pack.label} · {source}`，旁路「去设置反推」。

预设卡片点选：用预设 JSON 覆盖 `activeStylePack`（若旧包 `pinned`，先提示「将解开已钉的反推世界」）。

底部按钮文案改为：「按此世界重写画面并重绘」（P1）。P0 可先只改当前包、下一镜写入分镜时再生。

---

## 7. 反推：模型必须吐 StylePack，禁止影评

### 7.1 反推说明书（user 文本部分）

要求模型只输出与 §3 同构的 JSON，字段：`label, world, render, contemporaryPolicy, confidence, notes`。

额外规则写进说明书：

- 不要输出「很有艺术感」这类空词。
- `dont` 至少 3 条可执行禁令（具体物件，不要「不要现代」）。
- 图偏古典/水墨/工笔 → `contemporaryPolicy: adapt`。
- 图偏实拍/胶片/矢量 → `filter`。
- `confidence < 0.45` 视为失败，前端不自动锁定。
- 不要识别或复述真人姓名；notes 只写笔触与时代。

### 7.2 服务端

`POST /api/style/infer`

```
body: {
  imageDataUrl: string,          // 或先 /api/style/upload 再传 id
  visionApi: CustomStyleVisionApiConfig
}
resp: { ok, pack: StylePack, warning? } | { ok: false, error }
```

服务端职责：

1. 检查 Key、endpoint、model。
2. 压缩图（最长边 1280，jpeg 质量 ~0.8），控制视觉 token。
3. 调百炼 `qwen3.7-plus`，`enable_thinking: false`，JSON 模式。
4. 校验必填字段；`must`/`dont` 长度；policy 枚举。
5. 失败回 `{ ok:false, error }`，**不要**静默落到 cinematic。
6. 用图片 hash 做内存/磁盘缓存（可选 P1）。
7. 日志只记 model、耗时、是否 ok，不记 Key、不记整图。

### 7.3 失败与重试

| 情况 | 行为 |
|---|---|
| 未填 Key | 按钮禁用 |
| HTTP 401/403 | 「Key 无效或无该模型权限」 |
| 非 JSON / 缺字段 | 「反推结果不完整，请换图或重试」 |
| 低置信度 | 展示卡，主按钮改为「仍要使用」 |
| 超时 | 顶栏错误吐司，保留已上传缩略图 |

---

## 8. 运行时优先级

永远只注入 **一份** `activeStylePack`：

1. 用户刚在设置里 **确认** 的反推包  
2. 用户在风格页点的预设包  
3. 工程默认 `preset:cinematic`

混合（P2）：「只要图的笔触，世界仍用预设」= 预设 `world` + 反推 `render` + `reference`。P0 不做混合，确认反推即整包替换。

---

## 9. 生图阶段

P0：`compileImagePrompt` 把 StylePack 折进 **Details**（介质 / 色板 / 光 / 材质），**不含镜头焦段**——机位只写在 Scene。hook 镜在 Details 末尾补一句主次光（世界背光轮廓 + 正面补光保表情）。DNA 里的 `Transparent` 会洗成 layered shadows，避免被理解成透明背景。

```
finalPrompt = clip.visualPrompt
```

若 `visualPrompt` 未含 render.quality 中的核心介质词，才追加 `render.medium + render.lighting`（逗号拼接，≤ 12 词）。GPT Image / `promptProfile=gpt-image` 保持五段结构，不再叠 cinematic enhancer。

删除：

- `forecastToClips` 里的 `cinematic lighting, highly detailed`
- `/api/visual/generate` 里与 Pack 重复的整段 `styleEnhancers` 无脑叠加（可保留作 Pack.render 的缺省库）

P2：若 `pack.reference` 存在且生图供应商支持垫图，再把参考图送进供应商；本规划不绑定具体垫图协议。

---

## 10. 工程字段落点

```ts
ProjectSettings {
  visualStyle: VisualStyle;              // 预设目录选中项，兼容旧工程
  activeStylePack?: StylePack;           // 真正注入物；缺省时由 visualStyle 水合
  customStyleVisionApi?: CustomStyleVisionApiConfig;
}
```

水合：无 Pack 时 `activeStylePack = PRESET[visualStyle]`。  
旧工程只有 `visualStyle` 也能用。

---

## 11. 界面与吐司

状态走全局顶栏居中毛玻璃吐司（已有 `StatusToastHost`）：

| 事件 | 文案 | tone |
|---|---|---|
| 开始反推 | 正在用 qwen3.7-plus 看图… | progress |
| 确认包 | 已锁定美术世界：{label} | ok |
| 反推失败 | 风格反推失败：{error} | error |
| 应用并重绘 | 正在按新世界重写画面… | progress |
| API 测试成功 | 百炼视觉接口可用 | ok |

不要在画布左上角再挂风格角标。

---

## 12. 分期

### P0 — 契约进主链路（不接反推也能用）

- StylePack 类型 + 八个预设置 world/render/policy。
- `activeStylePack` 水合。
- draft user 注入契约；写入分镜带入 visualPrompt；生图停止双重 cinematic。
- 风格页点选写入 Pack。
- 设置页出现「美术世界」：先做 API 表单（Key/endpoint/模型）和当前包摘要；反推按钮可先禁用并写「P1」。

### P1 — 设置页反推闭环

- 上传、压缩、`POST /api/style/infer`、结果卡、确认锁定、图片 hash 缓存。
- 「按此世界重写画面并重绘」：重写各镜画面词后再生图。
- 顶栏吐司接好。

### P2 — 垫图与混合

- `reference` 进生图供应商。
- 混合策略：预设 world + 反推 render。
- 可选：风格是否同步改口播（默认关）。

---

## 13. 验收

**P0**

- 选题「地铁抱怨」+ 风格「东方水墨」+ 写稿：`visualIntent` 里不应再是写实地铁广告车厢为默认；服饰/空间应能看出写意东方。
- 同一口播换「真实摄影」：画面回到当代服饰与实拍空间。
- 口播正文不被风格改写成文言。
- 生图请求里不应再出现「cinematic lighting」叠在水墨词后面的固定硬编码（除非当前 Pack 自己就是电影）。

**P1**

- 未填 Key 无法反推。
- 填入百炼 Key、上传一张工笔/水墨静物：结果卡出现 adapt、dont 含现代品牌类禁令；确认后风格页当前行变成「来自上传图」。
- 同一张图第二次反推不重复打满价（有缓存）。
- 关掉设置再打开，Pack 与缩略图仍在。

---

## 14. 风险

- `qwen3.7-plus` 开 thinking 会破坏 JSON：请求里关掉。
- 视觉 token 贵：必须压缩图，禁止原图 4K 直传。
- 反推散文污染 system：校验器丢弃非 JSON。
- TTS 与视觉共用一把百炼 Key 可以，但配置项分开，避免改 TTS 模型名误伤反推。
- 预设枚举写死会卡住 inferred id：UI 目录用预设，运行时只认 Pack。

---

## 15. 一句话

设置页负责 **配百炼 `qwen3.7-plus` + 看图编译成 StylePack**；风格页负责 **选用哪一包**；写分镜的 LLM 只认 **当前这一份世界契约**。上传反推不另做一套提示词系统。
