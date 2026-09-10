# 文案篇幅策略与重试修复验收

2026-09-10，基线 964e9d3。用户明确批准四项调整；本次不等同于此前仍待完成的 Phase 6 真实 TTS / MP4 验收。

## 结果

1. 单章、章节组合与整篇校验不再仅因字数偏差拒绝正文。返回软提示，页面显示“草稿已保存”和参考范围。结构错误与软提示分开，重试只反馈结构错误。空正文、角色不匹配、节拍不完整、未知证据和锁定仍有硬约束。
2. 全文口播预算由 duration/engine 计算：有 DurationSpec 时使用 min/max × narrationRatio；无规格时汇总全部大纲章节范围。允许章节之间补偿；大纲未写完时不作全文超短/超长问题判定。章节偏差保留在明细中，不自动生成高优先级问题。全文偏差作为 medium 提示，不自动生成单章补字任务。
3. 评估器逐章检查问题与承诺是否兑现，要求指出具体内容缺口或冗余。修订不再依据字数差选择扩写/压缩，而按具体问题编辑。中英文生成与修订提示词均明确篇幅仅供参考；三段原系统提示词前缀逐字保留，新增原则仅追加。
4. 单章 HTTP 接口复用 draftOneSection。初次调用加最多两次重试，第三份回复也正确校验和采用。无需重试的偏短草稿只调用一次。
5. 批量逐章生成显式携带上一步返回的 sections/outline，避免闭包内的旧列表覆盖之前已生成的章节。

## 验证

- npm test：135/135。包含 visualBible 三套测试、原系统提示词前缀检查、Mock HTTP 与供应商传输桩，无真实付费调用。
- npm run lint：通过。
- npm run build：通过。既有 bundle 大小和第三方注释提示不阻断构建。
- git diff --check：通过。
- 完整输出：phase6-writing-policy-tests.txt、phase6-writing-policy-lint.txt、phase6-writing-policy-build.txt。

关键回归场景：

- 104 字 / 参考 130–152：成功保留，一次调用，有软提示；空正文失败且不超过三次调用。
- 前两次节拍错误、第三次正确：单章与整篇均成功采用第三份回复；单章返回值通过质量检查请求 schema。
- 锁定章节不调用模型，整篇生成保留已锁正文。
- 章节短长互补而全文达标：in_range，无机械扩写；部分草稿不产生全文预算问题。
- 删除 40% 后只有字数偏差：报告全文预算提示，repair=true 也不自动填字。
- 评估器指出具体章节任务缺口：允许定向修订；持续存在的问题最多修订两轮。
- 组件服务端渲染：104 字已保存提示出现；部分草稿显示“章节尚未写完”；无内容问题时不提供批量修复按钮。

## 变更文件

- 生成与校验：src/utils/scriptDraft.ts、scriptOutline.ts、scriptDraftEngine.ts；src-server/routes/script.ts。
- 质量与预算：src-server/duration/engine.ts、pipeline/quality.ts、llm/prompts/quality.ts；src/shared/quality.ts。
- 提示词与 Mock：src/utils/scriptPrompts.ts；src-server/llm/mock.ts。
- 界面：src/components/ScriptOutlineStage.tsx、QualityPanel.tsx。
- 测试：scriptDraftEngine.test.ts、scriptLongform.test.ts、script.draft-mock.test.ts、quality.test.ts、新增 scriptWritingPolicy.test.ts；package.json。
- 文档：README.md、ERRATA.md E008、本报告及命令证据。

## 使用复验

1. 更新代码、重启服务并刷新页面。保留原有工程，进入“提纲 / 章节”。
2. 对未锁定的偏短章节生成正文；结构正确时应显示“草稿已保存”，下方字数仅为参考提示，可继续写后续章节。
3. 全文写完后点“检查质量”。核对全文口播范围以及具体内容问题，只有缺少解释、重复、事实风险等可定位问题才定向修复。
4. 材料不足而篇幅较短时保留有依据的稿件，补充资料或调整目标，不反复点击要求模型凑字。

## 限制

内容是否充分仍由模型评估并需要人工审阅；本轮验证证明控制流与边界正确，不代表实测所有模型均能准确判断论证质量。没有运行真实模型、TTS 或 MP4；此前 E007 真实验收仍未关闭。已有工程不自动重写，旧版失败后未保存的模型正文也无法凭空恢复。
