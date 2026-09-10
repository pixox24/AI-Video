# AI Video Studio

Vite + React + Express 视频工作台。长视频内容流程：观众承诺 → 大纲 → 分段草稿 → 质量评估 / 定向修复 → TTS → MP4 导出。

## 开发与回归

```sh
npm install
LLM_MOCK=true npm run dev
npm test
npm run lint
npm run build
```

默认端口 3000，可用 PORT 覆盖。开发时显式设置 LLM_MOCK=true；Mock 只替代 LLM，不模拟 TTS 和浏览器视频编码。生产启动：npm run build 后 NODE_ENV=production npm start。Windows 可用现有 start.ps1。

## 真实模式

在设置页配置现有 LLM / TTS 供应商，以 LLM_MOCK=false 启动。真实调用有费用；小体量验收只运行一个项目。自定义 LLM 通过客户端 llmApi 透传；内置 Gemini 读取 GEMINI_API_KEY。入口通过 dotenv 加载仓库根目录 .env，也可由启动环境注入变量。

先填写观众承诺和时长，再生成并确认大纲，然后生成未完成章节。章节字数为参考预算，偏短或偏长会保存草稿并提示，不要求为凑字重写。结构错误仍会拒绝，初次调用最多重试两次，每份回复都校验。全文完成后，质量检查结合章节承诺与全文口播范围，仅修复有具体内容问题的未锁定段，每次闭环最多两轮。全文预算偏差本身不自动触发扩写；资料不足时可补材料或接受较短时长。TTS 后查看估算与实测差异，进入分镜工作台完成素材及导出检查，用现有导出面板生成 MP4。浏览器必须支持 WebCodecs。

## 调用成本与校准

GET /api/usage?projectId=项目ID 读取 data/generation-runs.jsonl；GENERATION_RUNS_PATH 可覆盖日志路径。Mock 的 token/cost 为 0。真实 token 取供应商 usage；供应商返回 usage.cost 时作为 USD 成本记录。否则可通过 LLM_PRICING_JSON 配置每百万 token 的美元单价，键为完整接口地址（去尾部斜线）与模型名，用 | 连接：

```json
{"https://provider.example/v1|model-id":{"input":1,"cachedInput":0.1,"output":2,"source":"供应商价格页 URL 与核实日期"}}
```

以上仅为配置格式示例，并非实际报价。缓存价格缺失、usage 缺失或未知模型价格时记录 null，面板提示仅汇总已知值。costSource 区分供应商报告和配置的价格来源；按单价计算的费用不是账单结算结果。Gemini outputTokens 包含供应商报告的思考 token。不要把密钥写进证据或提交。

TTS 校准写入 data/rate-table.json；沿用现有 provider / voice / pace 分桶及旁白对齐。工程保存在 data/projects，生成素材保存在 public/generated；不要随验收删除用户工程。

## 规格与验收

SPEC-v2.md 为当前规格；MIGRATION.md 为历史资产基准，已作废的 v1 框架迁移要求不适用于当前项目。差异以 ERRATA.md 已确认条目为准。历次证据见 docs/acceptance/phase*-*。

## Backlog

- ScriptPanel 约 115 KB：Phase 5 已验收，后续按真实维护需求渐进拆分，不阻塞 Phase 6。
- DB 持久化、YouTube 留存数据回写、visualBible 深度联动、词级字幕对齐：继续后置。

### 节拍标签

章节角色描述全章任务，节拍类型描述章内的小段内容，两者不必相同。合法类型为 hook / setup / turn / proof / reveal / cta；误填 body 自动映射为 proof，大小写和首尾空白会归一化，其他未知或缺失标签沿用章节默认类型。标签修正记录保存在章节中并显示，不为此重写正文或新增模型调用。空正文、缺失节拍或节拍漏文仍会拒绝生成。

节奏标签 energy 统一使用 fast / medium / slow / hold。旧草稿质检自动兼容 high/高→fast、low/低→slow、mid/中/steady→medium，其他未知或缺失值按 medium 处理并提示；无需重新生成文章。质检失败会显示 HTTP 状态、出错字段或服务端原因。
