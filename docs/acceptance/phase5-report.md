# Phase 5 验收报告：前端整合与拆分

日期：2026-09-10

## 变更文件清单

- `src/components/ScriptStageViewport.tsx`：八个阶段画布的统一视口与阶段容器。
- `src/components/ScriptWritingStages.tsx`：调研、节拍、口播、节奏四个独立画布组合层。
- `src/components/ScriptWorkspaceView.tsx`：从 `App.tsx` 提取文案工作台装配及隐藏预览播放器。
- `src/components/UsagePanel.tsx`：按当前项目读取 `/api/usage`，按生成阶段聚合调用数、Token、成本和模型耗时。
- `src/components/ScriptPanel.tsx`：只保留协调、事件处理和阶段路由，改由 `ScriptStageViewport` 装配画布。
- `src/App.tsx`：文案页改为装配 `ScriptWorkspaceView`。
- `src/components/BriefStage.tsx`、`src/components/ScriptOutlineStage.tsx`、`src/components/QualityPanel.tsx`：为现有 gateway 调用透传项目 ID。
- `src-server/llm/gateway.ts`、`src-server/routes/script.ts`：仅增加可选 `projectId` 的透传，令既有 `GenerationRun` 能按项目查询；没有改动时长、LLM、锁定或其他纯逻辑行为。

`src/utils`：0 个文件、0 行 diff。`src-server`：仅上述项目 ID 接线，`+15/-7` 行。

## 组件行数对照

| 文件 | 拆分前 | 拆分后 | 变化 |
| --- | ---: | ---: | ---: |
| `src/components/ScriptPanel.tsx` | 3018 | 2546 | -472 |
| `src/App.tsx` | 1873 | 1837 | -36 |
| `src/components/ScriptStageViewport.tsx` | 0 | 46 | +46 |
| `src/components/ScriptWritingStages.tsx` | 0 | 516 | +516 |
| `src/components/ScriptWorkspaceView.tsx` | 0 | 108 | +108 |
| `src/components/UsagePanel.tsx` | 0 | 87 | +87 |

行数通过 `git show HEAD:<file> | Measure-Object -Line` 与工作区 `Get-Content <file> | Measure-Object -Line` 取得。

## 验收结果

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| utils 纯函数未改动，服务端仅项目 ID 接线 | 通过 | `git diff --numstat -- src/utils src-server`：utils 无输出；gateway `+4/-1`，script route `+11/-6`。`git diff --check` 退出 0。 |
| ScriptPanel 按阶段画布拆分 | 通过 | `ScriptStageViewport` 覆盖 `brief`、`intent`、`topic`、`research`、`duration`、`beats`、`copy`、`rhythm` 八个阶段；写作画布已移至 `ScriptWritingStages`。 |
| 各阶段画布独立渲染 | 通过 | 浏览器探针：Brief、Intent、Topic、Research、Duration、Beats、Copy、Rhythm 都返回对应 `data-script-stage` 与标题。见 `phase5-ui-*.json`；Beats/Copy/Rhythm 截图见同名 PNG。验证结束后项目已恢复到 Duration。 |
| App.tsx 减负 | 通过 | 文案页面的项目级依赖、播放器和 ScriptPanel 组合移入 `ScriptWorkspaceView`，App 减少 36 行。 |
| 成本按项目/阶段聚合 | 通过 | `GET /api/usage?projectId=project-1788933507771` 返回当前项目的 1 条 `brief` Mock run；面板显示 1 次、0 Token、$0.0000。见 `phase5-usage.json`。 |
| `npm test` | 通过 | 130/130 passed。完整输出：`phase5-tests.txt`。 |
| `npm run lint` | 通过 | `tsc --noEmit` 退出 0。完整输出：`phase5-lint.txt`。 |
| `npm run build` | 通过 | Vite 和 server bundle 均构建成功。完整输出：`phase5-build.txt`。 |

## 手动验证步骤

1. 以 `LLM_MOCK=true` 启动本地隔离服务，打开文案工作台。
2. 分别选中八个阶段，并检查每次仅存在对应的 `data-script-stage` 画布及其标题。
3. 在 Beats 检查节拍表，在 Copy 检查整段口播输入与节奏带，在 Rhythm 检查 10 个节奏格。
4. 刷新成本面板，确认只读取当前 `projectId` 的调用，并按 `stage` 聚合。
5. 验证完成后切回 Duration，确认渲染阶段和磁盘持久化阶段均为 `duration`。

## 遗留问题

无阻断项。生产构建仍报告第三方 `zod` 注释解析提示及单个前端 chunk 大于 500 kB 的 Vite 提示；二者均为非失败警告，且本 Phase 未进行范围外的打包策略调整。
