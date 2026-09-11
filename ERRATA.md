# ERRATA

文档与代码冲突时，以代码现状为准；本文件记录作废的文档表述。不得据此回头改文档，除非人工明确要求。

| ID | 来源 | 文档表述 | 以代码为准 | 记录于 |
|---|---|---|---|---|
| E001 | SPEC-v2 §8 `/api/script/generate`；MIGRATION §1.2 | 该端点已返回 410，短视频入口官方弃用 | 仅 `targetDuration > 120` 时返回 410；≤120 仍走短视频生成 | Phase 0 / Q6 |
| E002 | SPEC-v2 §8 `POST /api/script/section-revise` | locked 段返回 403 | 返回 409，body `{ ok:false, code:"draft_contract_failed" }`；`section-draft` 同样 409 | Phase 0 / Q7 |
| E003 | SPEC-v2 §6 时长引擎初始速率 | zh standard ≈ 4.1 字/秒；en standard ≈ 2.35 词/秒 | 沿用 `scriptLanguage.ts` 五档表；`medium` 为 zh 4.3 字/秒、en 2.5 词/秒。无 standard 档。速率精化交给 Phase 4 TTS 校准 | Phase 0 / Q9 |
| E004 | SPEC-v2 §5、§9 Brief 命名 | 新观众承诺类型为 Brief | 按用户已确认决定命名为 ContentBrief，挂在 `scriptWorkspace.contentBrief`；`scriptWorkspace.brief: ScriptBrief` 继续保留 | Phase 1 / 用户恢复指令 |
| E005 | SPEC-v2 §10 Phase 0 schema | Phase 0 完成 Zod 校验重试 | Phase 0 保留宽松 coerce；从 Phase 1 的新增/增强阶段开始启用严格 schema；本轮 Brief 校验与 gateway 最多两次校验重试已实现，旧调用未提供 schema 时保持原行为 | Phase 1 / 用户恢复指令 |
| E006 | 流程备忘 | 全局 strict 可在 Phase 1 顺手开启 | Q10 未批准全局 strict；虽无新增 any/ts-nocheck 且测试全绿，超出批准范围的改动必须先提问再实施 | Phase 2 / 用户追认 |
| E007 | Phase 6 验收补充 | 真实模式只需跑通链路 | 真实模式跑通时 GenerationRun 的 token/cost 必须为非占位真实值；Phase 6 已接通 usage 与有来源计费，缺失值为 null；真实流程验收仍待供应商配置，E007 尚未关闭 | Phase 2 / 用户追认 |

| E008 | SPEC-v2 §7.2–7.3 / Phase 3 原字数门槛 | 单章必须达到 minUnits–maxUnits，偏差触发高优先级修复 | 用户已确认改为内容优先：单章与全文篇幅偏差仅提示，结构有效的草稿保存；质量检查结合章节承诺和全文口播预算，仅修复具体内容问题。单章与整篇共用重试实现，最多两次重试且校验最后一份回复 | 2026-09-10 / 用户确认四项改造 |

| E009 | 章节角色与节拍类型校验 | 节拍必须属于章节角色允许列表，标签错误拒绝整章 | 用户确认取消角色组合限制；合法节拍类型保留，body→proof，大小写/空白归一化，未知或缺失标签按已有章节默认类型兜底并保存提示。仅修标签，不重写正文；生成、修订统一处理，正文与节拍覆盖仍硬校验 | 2026-09-10 / 用户确认节拍标签改造 |

| E010 | 生成与质量接口节奏字段不一致 | 模型返回 high/中文/peak 等 energy 被生成层保存，质检严格枚举返回 400，前端隐藏原因 | 共用节奏归一化用于草稿、修订及旧章节质检输入；明确别名映射，未知值采用 medium 并提示，正文不重写。质检显示具体错误字段或服务端原因 | 2026-09-11 / 用户授权修复 |

| E011 | SPEC-P7 §11 执行协议 | commit 并 `push origin longform` | 按用户指令从 `longform`（含 Phase 0–6 全部 16 个提交）切出 `style-pack` 分支开发，最终 `push origin style-pack`；`main` 上不存在 Phase 0–6，禁止从 main 切分支 | Phase 7 / 用户确认 |
| E012 | SPEC-P7 §3 `WritingStyleProfile` 字段清单 | 档案字段为 id/kind/label/description/rules/bannedPatterns/exemplar/counterExemplar/derivedFromSamples/locked | 经用户批准增加两个字段：`lintThresholds{maxSentenceUnits,minShortSentenceShare,maxSentenceUnitsHard}`（让 styleLint 读档案声明而不是解析 rules 文本）与 `provisional`（标注内置档案尚未用真实优质文案归纳）。两个字段均可选，不改变既有字段语义 | Phase 7 / 用户确认 |
| E013 | SPEC-P7 §7 evaluator 第五类检查 | "追加进评估器 prompt" | 不修改既有 `QUALITY_SYSTEM` 常量，新增独立常量 `QUALITY_STYLE_APPENDIX`，仅在选中风格时运行时拼接（未选中时 system 与 Phase 6 逐字节相同）。第五类同时包含模型 rubric 评分与 `styleLint` 确定性结果 | Phase 7 / 实现说明 |
| E014 | SPEC-P7 §8 `GET /api/writing-styles` | 列出内置 + 当前项目自定义档案 | 端点只返回内置档案（服务端无项目态）；自定义档案由项目文件 `scriptWorkspace.writingStyles` 持有，按项目隔离，与 SPEC-P7 §2.2"不做跨项目风格继承/共享"一致 | Phase 7 / 实现说明 |
| E015 | SPEC-P7 §6 styleLint 检查项 3 | "抽象占位词表（与既有禁令同源扩展）" | 抽象占位词为嵌入 lint 模块的固定代码表（很有氛围/电影感/高级感 等 12 项），档案不可改；档案自身 bannedPatterns 优先于该表报告，避免同一句重复报两条 | Phase 7 / 实现说明 |
