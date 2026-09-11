# Phase 6 补充修复：质量检查被节奏标签阻断

日期：2026-09-11（Asia/Shanghai）；基线：dea260e；目标分支：longform。

## 根因与修复

当前保存工程 8 章、27 个节拍中，26 个 energy 使用 high/low/mid/中文/steady/peak/punch 等值。原生成层直接保存，质量请求只接受 fast/medium/slow/hold，实际接口返回 HTTP 400 / quality_input_invalid；前端把具体问题隐藏成“质量检查失败，请重试”。

- 共用 normalizeBeatEnergy：标准值保留，大小写/空白归一化，high/高→fast，low/低→slow，mid/中/steady→medium，其他未知或缺失值默认 medium 并显示含义不确定提示。
- 草稿生成、扁平节拍解析、章节修订共用转换；不为修节奏标签重复调用模型。生成/修订提示明确枚举含义。
- 质量请求入口仅兼容节奏元数据，其他字段继续严格验证；对副本归一化，保存的源工程不被改写。新生成/修订章节保存标签提示；旧草稿本次质检的修正提示也展示于面板。
- 应用修复结果时前端保留原锁定章节，质检本身不应用正文修订。
- 错误提示显示状态、输入字段或后端具体原因；HTML/非 JSON 错误也有可读状态提示。

## 验证

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| npm test | 139/139，0 失败，含 visualBible 三文件 | phase6-energy-tests.txt |
| npm run lint | 通过 | phase6-energy-lint.txt |
| npm run build | 前端/后端通过；保留大 chunk 提示 | phase6-energy-build.txt |
| 当前工程 HTTP Mock 质检 | 200；8 章/27 节拍；26 个归一化提示；报告 schema 通过；0 轮修订；正文逐字不变 | phase6-energy-current-project.json |
| 本地运行服务 | 已重启 localhost:3000 加载修复；保留旧 energy 并故意设正文为 null 的探针仅拒绝正文，确认在线服务已接受旧节奏格式；未调用模型 | 本次执行输出 |
| git diff --check | 通过 | 提交前执行 |

新增回归覆盖合法节奏、中文和英文别名、未知/空/非文本/原型键、单次生成内归一化且口播不变、修订严格 schema、HTTP 旧草稿兼容及错误提示。既有正文覆盖与锁定测试全部通过。

## 变更文件

src/utils/scriptSections.ts、scriptDraft.ts、scriptDraftEngine.ts、scriptPrompts.ts、scriptDraftEngine.test.ts；src/shared/quality.ts；src/components/QualityPanel.tsx；src-server/pipeline/section-revise.ts、quality.test.ts；README.md、ERRATA.md，以及 phase6-energy-* 证据。

## 用户复验

本地服务已加载修复。在当前工程点击“检查质量”；若页面仍显示旧状态，先确认保存后刷新。无需重新生成文章。应能提交至评估器，并看到标签修正提示；供应商失败时显示具体原因。仅在确认质检问题后再使用修复按钮。

## 边界

本轮已验证当前真实工程数据通过完整本地 HTTP Mock 评估链路；浏览器控制连接在复验时不可用，未完成页面上的真实供应商评估，不能把 HTTP Mock 200 称为真实模型质量报告。未改写用户正文，未将项目内容或凭据提交到仓库。Phase 6 的完整真实 TTS/MP4 与 E007 仍未关闭。
