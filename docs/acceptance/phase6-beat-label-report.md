# Phase 6 补充验收：章节节拍标签优化

日期：2026-09-10。基线：0388595；目标分支：longform。

## 结果

本次节拍标签改造完成。原“包含不符合章节角色的节拍类型”源于章节角色白名单过严，并不能据此判断模型能力。取消角色与节拍类型的组合限制：hook / setup / turn / proof / reveal / cta 均可出现在任意章节中。

误填 body 映射为 proof；大小写与首尾空白归一化；未知或缺失标签沿用已有章节默认值。修正仅处理标签，保留口播，在章节保存 beatLabelWarnings 并显示于大纲与质检面板。单章与整篇生成共用处理，修订端点与质量修复循环共用处理；标签异常本身不增加模型调用。

空正文、没有有效节拍、正文与节拍覆盖不一致仍拒绝；锁定章节仍不可自动改动。章内字数偏差继续沿用 E008 的软提示。旧项目中已保存的非法标签不做批量迁移。

## 回归结果

| 命令 | 结果 | 证据 |
| --- | --- | --- |
| npm test | 137/137 通过，0 失败、0 跳过；包含 visualBible.contract、acceptance、workflow | phase6-beat-label-tests.txt |
| npm run lint | tsc --noEmit 通过 | phase6-beat-label-lint.txt |
| npm run build | 前端及服务端构建成功 | phase6-beat-label-build.txt |
| git diff --check | 通过 | 提交前执行 |

测试覆盖合法跨角色组合、body/空白/大小写/未知/缺失/非文本值、单次模型调用内修正且正文不变、整篇及单章 HTTP 路径、严格质量 schema、修订漏文拒绝、锁定不调用模型及持久化提示的服务端渲染。构建仍有大于 500 KB 的 chunk 提示，不阻塞构建。

## 变更文件

- 共用规则及草稿：src/utils/scriptSections.ts、scriptDraft.ts、scriptDraftEngine.ts、scriptPrompts.ts。
- 修订及质检：src-server/pipeline/section-revise.ts、src-server/llm/prompts/quality.ts、src/shared/quality.ts。
- 数据与展示：src/types.ts、src/components/ScriptOutlineStage.tsx、QualityPanel.tsx。
- 回归：src/utils/scriptDraftEngine.test.ts、scriptLongform.test.ts；src-server/pipeline/quality.test.ts、src-server/routes/script.draft-mock.test.ts；src/components/scriptWritingPolicy.test.ts。
- 文档与证据：README.md、ERRATA.md（E009）、docs/acceptance/phase6-beat-label-*。AGENTS.md 现有边界继续适用。

## 手动复验步骤

1. 更新 longform 代码并重启开发服务，刷新文案模块。
2. 打开已有大纲，重新生成先前失败的第三章；章节中使用合法的其他节拍类型应正常保存。
3. 模型若误填 body 或未知标签，检查章节下方的标签修正提示；口播不应仅为标签问题重写。
4. 对未锁定章节运行定向修订与质检，检查修正提示可保留且结果被质量接口接受；锁定章节仍不变。

以上为供用户复验的步骤，本轮没有操作用户实际工程重新生成第三章。

## 遗留验收边界

本轮使用 Mock 与传输桩，无付费真实调用；不将测试生成的 usage 当作真实供应商记录。早期 Phase 6 报告中缺少可用供应商配置及可核实价格的阻断仍未解决，真实 brief → 大纲 → 草稿 → 质检 → 修复 → TTS → MP4、真实 GenerationRun JSONL 与 E007 验收仍未完成。本报告仅确认本次节拍标签改造与代码回归完成，不宣称整个 Phase 6 验收通过。
