# ERRATA

文档与代码冲突时，以代码现状为准；本文件记录作废的文档表述。不得据此回头改文档，除非人工明确要求。

| ID | 来源 | 文档表述 | 以代码为准 | 记录于 |
|---|---|---|---|---|
| E001 | SPEC-v2 §8 `/api/script/generate`；MIGRATION §1.2 | 该端点已返回 410，短视频入口官方弃用 | 仅 `targetDuration > 120` 时返回 410；≤120 仍走短视频生成 | Phase 0 / Q6 |
| E002 | SPEC-v2 §8 `POST /api/script/section-revise` | locked 段返回 403 | 返回 409，body `{ ok:false, code:"draft_contract_failed" }`；`section-draft` 同样 409 | Phase 0 / Q7 |
| E003 | SPEC-v2 §6 时长引擎初始速率 | zh standard ≈ 4.1 字/秒；en standard ≈ 2.35 词/秒 | 沿用 `scriptLanguage.ts` 五档表；`medium` 为 zh 4.3 字/秒、en 2.5 词/秒。无 standard 档。速率精化交给 Phase 4 TTS 校准 | Phase 0 / Q9 |
