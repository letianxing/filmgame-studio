# Implementation status

Updated: 2026-08-30

## Production hardening update - 2026-08-31

- Added Canonical Bible projection, five-state Asset Lock lifecycle and multi-domain Continuity validation.
- Added per-job input/dependency hashes, selective dependency invalidation preview and stable retry idempotency.
- Added durable Production Run snapshots with interrupted-worker recovery and durable Runtime event/snapshot files with hash-verified replay.
- Restricted Bot inputs to role knowledge and made bot-fill host-authorized.
- Added Provider capability selection, retry/timeout/circuit breaker and contract-preserving Video fallback.
- Added preflight workload/cost estimates, retry reserve and max-budget pause before provider calls.
- Added complete generation provenance records and fail-closed commercial license/provenance gates.
- Added FFmpeg technical validation, black/silence review signals, participation heatmaps and creator-actionable failures.
- Added a 4-player Golden Project and expanded the automated suite from 42 to 67 tests before final acceptance runs.

Legend: **Implemented** means source plus proportionate automated verification exists. **Contract** means the
formal model/boundary exists but a real external provider or final production implementation is not yet verified.

| Area | Status | Evidence / remaining gate |
| --- | --- | --- |
| Project Brief / World / Tone / Visual Bible | Implemented | Story Schema + specialist Story Workflow + fixture |
| Characters / profiles / secrets / goals / victory | Implemented | Story Schema, sample story, semantic validator |
| Relationships / evidence / inventory / locations | Implemented | Story Schema and validated fixture |
| Chapters / story graph / scenes / endings | Implemented | Reachability and reference validation |
| Role actions / resolution / state mutations | Implemented | Server-only Resolution Engine and tests |
| Story version / change preview / dependency analysis | Implemented | Story Engine tests include version conflicts and locked assets |
| Story command UI / apply / rollback | Implemented | Creator API persists proposals in D1, previews Patch/dependencies, applies immutable versions, and rolls back by creating a new version |
| Story and multiplayer balance validation | Implemented baseline | Reachability, references and role action participation; deeper simulation remains |
| Script and dialogue generation | Implemented + locally verified | Development Codex CLI provider generated a schema-valid 6-player story through all five specialist nodes; production uses the API provider boundary |
| Director treatment / shot lists | Implemented workflow | Production fixture covers 2 scenes + 6 endings, BGM and shot SFX in a 104-job validated DAG |
| Storyboard / image | Implemented local provider | FLUX.1 Schnell FP8 generated and visually verified a real 768×432 storyboard; hash recorded |
| Video | Implemented contract + installed local candidate | Wan2.2 workflow and weights verified by size; local automatic admission is disabled after Windows virtual-memory exhaustion; configure another VideoProvider or qualify on a larger machine |
| Character / location consistency | Implemented contract | DRAFT→APPROVED→LOCKED plus dependency conflicts; visual QA model remains |
| Voice | Implemented | CosyVoice2 CUDA inference and first-party HTTP `TTSProvider` smoke passed; voice-reference rights remain a release gate |
| Subtitle | Implemented | Deterministic per-shot SRT handler, immutable storage, and tests |
| Music / SFX | Implemented remote contract + DAG | Stable submit/poll providers, immutable asset handlers and FFmpeg mixing; upstream service credentials remain |
| Remote media / storage | Implemented first-party contracts | Video, music, SFX and object storage submit/poll/upload boundaries have mock-server integration tests |
| Production cost / audit | Implemented baseline | Provider usage/model/request metadata, estimated cost rollup, and serialized JSONL job audit events |
| FFmpeg final render | Implemented | LGPL CLI installed; video/voice/subtitle final-scene handler plus video/thumbnail/probe smoke |
| Immutable asset storage | Implemented local + remote contracts | Streaming writes/uploads, SHA-256 receipts, traversal protection, idempotent retries, signed reads, and tests |
| Asset Manifest | Implemented contract | Fixture validates; real media assets intentionally marked MISSING |
| Multiplayer runtime package | Implemented | First-party deterministic packager, four target entries, immutable runtime definition, and versioned directory loader |
| Colyseus room / reconnect / Bot / event log | Implemented | SDK and gateway smoke tests pass |
| LiveKit speech intent boundary | Implemented V1 contract | Realtime bridge returns non-authoritative Intent Candidates; server rule engine remains state owner |
| Companion client | Implemented vertical slice | Production build passes |
| Playtest room / mobile join | Implemented vertical slice | Creator API creates real Colyseus rooms; QR links carry room/project/runtime into Companion |
| AI Bot playtest / analytics | Implemented baseline | Bounded deterministic path exploration, ending coverage, role action counts, D1 reports, and Creator UI; richer combinatorial coverage remains |
| Unreal Runtime Client | Implemented buildable shell | Editor/Shipping compile, headless load, Cook, Pak/IoStore, Archive and packaged launch smoke pass |
| Unreal Runtime Gateway | Implemented | Real WebSocket bridge smoke passes |
| Creator Console | Implemented vertical slice + private alpha | Natural-language one-click dispatch, Story sync/versioning, Production DAG sync/run gate, Playtest room QR, dynamic Publish gates, D1/R2, lint/build; owner-only Sites deployment live |
| Build / Publish | Implemented local build + gates | UE Shipping archive passes; approved real media, SBOM completion, signing and store release remain commercial gates |

The complete 104-job production DAG also passes a controlled end-to-end test through reference generation,
all media providers, voice/music/SFX mixing, scene assembly, QA, every ending, four runtime targets and audit.
This proves orchestration behavior, not that unconfigured external providers have produced commercial assets.

## Remaining external / commercial gates

1. Development story generation is configured through the existing Codex CLI session and has produced a formally validated 6-player story with 17 scenes and 9 endings. A commercial hosted deployment still needs an API key or workload identity; CLI session authentication is never extracted or shipped.
2. Local Wan2.2 video is not admitted on this workstation under representative load; another VideoProvider or a larger committed-memory budget is required.
3. Commercial voice-reference consent and provenance must be tracked per character.
4. Steam signing/store configuration and release QA require publisher credentials; the local Win64 Shipping archive itself builds and launches successfully.
5. The Creator Console private alpha is hosted; externally reachable Orchestrator/Colyseus/Provider services are still required for hosted generation and playtest.

The real Codex CLI story run completed all five specialist nodes without retry. Deterministic validation returned
`valid=true`; its only findings were two non-blocking participation-balance warnings, which remain visible for
creator refinement rather than being silently discarded.

Epic Launcher registration has been recovered. Launcher reports UE 5.7.4 installed at
`G:\Epic Games\UE_5.7`, and an Epic protocol launch smoke opened the verified UnrealEditor executable. See
`UNREAL_LAUNCHER_RECOVERY.md`.
## 2026-11-05 当前：受控素材工作流改造（未完成）

用户暂停 sandbox-game 首节点，要求先完成 FilmGame Studio 改造，完成后等明确指令才恢复节点；GPU 释放供用户游戏。本轮停止原项目 cook PID33220/session57903，终态 exit1 属用户主动暂停，不算编译缺陷。没有新生成、编码或UE任务。

已接线：ComicService.run 提交前的同镜头运行/不确定任务去重、配置化次数与累计墙钟耗时门；超过等待阈值只提醒，不推断失败或退款。默认3次/90分钟、供应商等待20分钟是可调决策提醒边界，并非历史两轮规则。新增 comic-harness.ts 只读进度投影，分别显示生成数、人工采纳数、待审和耗时，实际结算未知不冒充支出。Comic routes 返回 harness；支持持久化修改 policy、按SHA确认已知晓。Creator Console HarnessPanel 提供站内审片dialog、候选预览、明确采纳/稍后审核，关闭不采纳；SHA改变会重新提醒。HTTP批准要求当前SHA，磁盘SHA变化拒绝沿用审核。完成同步时记录终态时间。

验证：comic-harness + comic-workflow 14 tests 全通过；orchestrator tsc --noEmit通过。UI尚未浏览器视觉验证（当前不启动GPU作业），Creator Console类型检查另见后续结果。

尚缺：真实费用/确认退款分账与报价新鲜度、拒收/定点返工与基础视觉检查接线、按版本的人审审计、审核包交付runtime、generic production orchestrator同等控制（当前只接Comic路径），以及UI实测。不可宣称整个平台已经改造完成。已有大量他人/此前未提交改动需保留，不覆盖。

## 2026-11-05 审核与交付继续接线（仍未整体完成）

Comic 路径新增拒收/定点返工说明，审核决定保存 SHA、输入hash、时间、LOCAL_CREATOR身份来源；该身份是现有本地单用户控制台，并非多人鉴权审计。HTTP和service批准均要求明确SHA，旧客户端不带SHA拒绝；原界面两处批准按钮已更新。REJECTED不能直接批准，需新候选重新审。基础检查仍为现有技术检查，不冒充视觉AI评审。

新增 GET /v1/comic/projects/:id/reviewed-manifest，逐镜要求当前输入对应的明确人工采纳，重新核本地媒体SHA，缺镜/旧批准/变更字节拒绝交付。输出标为 REVIEWED_MEDIA_HANDOFF，并明确 runtimeIntegrated/runtimeVerified=false；尚不是sandbox-game专用战斗图层manifest，前端下载入口待接。

修复Ajv2020命名导出兼容和creator-console共享类型路径。orchestrator及creator-console tsc --noEmit均通过；15个comic/harness测试通过，新增拒收重启持久化、缺镜门、文件篡改拦截验证。未运行GPU/真实生成/收费请求。

继续项：真实账单/退款分账及UI配置、拒收媒体依赖安全清理、进一步基础审核/方案取舍展示、generic orchestrator适配、交付入口与UI验收。首节点继续暂停，等待用户未来明确指令；当前goal仍为完成Studio改造。

## 2026-11-05 费用账本接入；用户授权完成后 commit/push

新增 comic-cost-ledger.ts：DREAMINA_CREDIT/CNY分账；保守预留、最终扣费、确认退款分别统计；账单编号幂等且冲突拒绝；非终态不能登记最终账单释放预留；退款必须先有扣费且不能超额。creator-confirmed凭据明确为用户核对，不冒充供应商自动核验。未知费用列为unknownReservations，不当作免费。即梦提交上限门改为使用账本净占用，确认退款才恢复对应额度。UI接入两账统计与账单登记表。

18项comic/harness/ledger测试通过；orchestrator与creator-console类型检查通过。本轮没有收费调用/GPU作业。尚未完成火山提交前报价及预算门、预算配置UI、generic orchestrator统一接线、视觉审核扩展、拒收清理与端到端UI验收，不标整个改造完成。

用户明确要求完成并测试后git add/commit/push，已记录AGENTS。当前分支main，origin为filmgame-studio GitHub SSH远端。仓库许多既有未提交文件是Comic基础依赖，需要审查后形成可复现提交，不盲目全量add；目前未提交/未推送。完成后等待用户指令才恢复首节点。

## 2026-11-05 双预算提交门与配置界面

ComicService 两provider均要求项目预算。新增configureBudgets与UI项目总额/其他素材预留输入；总额包括已消耗及在途，不冒充钱包实时余额。火山提交要求creator-confirmed单次人民币上限与报价依据；明示不是自动供应商报价。该上限在调用provider前保存，预算不足/未知历史费用拒绝调用。即梦继续使用原生quote与积分上限。预算门不保证供应商实际账单必然不超估算；实际账单可如实登记并阻止后续超预算任务。

新增测试确认无报价/超预算/空依据时调用数0、预留持久化先于provider调用、UNCERTAIN不可重提。19项相关测试通过，前后端tsc通过。UI增加已审核manifest下载入口，尚待HTTP/浏览器验证。仍未完成整体Studio改造和commit/push；后续优先清理/基础审查、generic路径风险及UI验收。用户GPU继续空出，不恢复首节点。

## 2026-11-05 拒收媒体清理已接线

Comic reject-review保存拒收决定后调用cleanupRejected，检查本项目绝对路径、普通文件/非链接、当前SHA及references/referenceNodes/shotReferences/其他候选/referenceUploads/exports依赖。先持久化DELETE_PLANNED再unlink，完成后删除活动file字段、保留SHA/拒收理由/费用和DELETED回执；有依赖保留并记录RETAINED_DEPENDENCY。新增cleanup-rejected API和UI按钮，可在依赖解除后再次清理。只处理明确REJECTED主媒体，不删除未知目录或仍引用源。

3项专项测试验证删除顺序、共享引用保护及SHA变化拦截；原19项工作流测试通过；orchestrator tsc通过。测试使用临时夹，不运行实际素材清理/GPU任务。尚有原始规范化副本清理、基础视觉审核/方案取舍、generic路径及UI HTTP/浏览器验收要处理。未commit/push，不标完成。

## 2026-11-05 基础检查证据与 HTTP 回归；全套92测试通过

sync视频获取后记录与SHA绑定的technical报告，并调用已有CPU blackdetect/silencedetect分析，将告警交给人工；图片记录既有归一化/尺寸检查通过证据。人工队列显示报告时间、告警、人物/动作/接镜/配音检查要点；报告缺失明确标注，不冒充VLM视觉审片。加入计划秒数和已采纳秒数。

新增真实本地HTTP（临时服务/无供应商）测试：创建项目、预算保存、进度JSON、跨来源拒绝、旧批准拒绝、缺镜manifest拒绝、重启持久化。全套npm test实际92/92通过；前后端类型检查通过。本轮无真实生成、收费请求、UE或GPU编码。

剩余需收口：generic production路径不能绕过控制、实际UI测试/视觉检查、明确的方案取舍展示、当前改动及依赖审查并commit/push。不能从92项测试推断界面已验收或完整改造已完成。用户明确要求完成后等指令，首节点不恢复。

## 2026-11-05 Generic DAG 人工审核门（UI尚待接线）

ProductionOrchestrator新增requireHumanReview，正式server开启。IMAGE/STORYBOARD/VIDEO/MEDIA_RENDER的成功输出进入WAITING，JobGraph用inputHash+完整output的SHA256绑定审核，不解锁下游。decideHumanReview匹配版本及明确理由，采纳才SUCCEEDED，拒收FAILED不自动返工。WAITING人审状态恢复后仍保留。新增server POST /v1/production/plans/:id/review，持久化决定；正式执行恢复上次budget state，修复等待批次间预算归零风险。

正式server重启加载待审/暂停计划供查看，不自动恢复付费任务；未确认的RUNNING转暂停要求核对，避免旧recoverRunning直接重试。requireHumanReview路径provider异常保留预留并停止自动重试。独立测试验证下游调用数、旧版本拒绝、人审状态恢复、拒收不重复调用、异常仅调用一次。全套94/94通过；orchestrator tsc通过。旧scheduler期望增加awaitingReview=0，未降低其并行限额断言。

此条的剩余项已由下方交付记录更新；GPU与首节点仍不启动。

## 2026-11-05 可控制作基础版交付

- `/comic` 制作台显示分镜生成/采纳数、计划/采纳秒数、分账预算与任务耗时；设置预算、尝试/时间上限，生成前报价，未核实账单保守占用。优先复用、先短片验证、再扩展时长的取舍说明已加入界面。
- 生成候选进入人工审片弹窗；“暂时关闭”“已知晓”和“采纳”分开。决定绑定 SHA/参考版本，错误版本拒绝；拒收记录原因，安全清理无依赖媒体；下载 reviewed-manifest 交给 runtime。
- 通用 Production 页面接通待审状态及审核代理，等待不再轮询到超时。无预算/估算或有待审候选拒绝下一阶段。正式 server 恢复预算并重新估算；未知远程结果暂停，不自动重提。异常暂停仍需人工核对，不提供可能重复扣费的一键重试。
- 基础审核为技术规则（规格、音轨、时长、黑场/静音信号），不冒充视觉审核。信号分析失败保留候选并提示人工核对，不重复下载和生成。

验证：全套 94/94 自动化测试通过；完整 npm run build（core、multiplayer、creator、companion）通过；前后端 tsc 与 npm run lint 通过。另以本地 Edge headless / disable-gpu、模拟 API 在实际 `/comic` 页面验证：待审弹窗、未自动采纳、通知确认后刷新不重复弹窗、手动重开及精确 SHA 采纳；无 pageerror，截图已检查并修正弹窗布局及中文编码。没有调用真实生成商、消费积分或运行 UE；浏览器测试是模拟回执，不是供应商生产验收。

使用：启动现有 orchestrator 与 Creator Console 后进入 `/comic`。先设置项目总预算（包括已花与预留，非钱包余额），再准备/报价/提交；审片后采纳；全部镜头通过才可下载已审 manifest。账单/退款依据由创作者填写并留档，未知费用不当零。明确暂停首节点，等待用户下一条指令。

未纳入本轮：系统托盘后台通知、自动供应商账单同步、VLM审美评分、分段工时统计、UE战斗事件与素材清单适配。这些不影响当前站内人工制作闭环，不为补齐它们擅自恢复游戏节点或消耗额度。
