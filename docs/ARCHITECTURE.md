# FilmGame Studio Architecture

## Product flow

```text
IDEA -> DESIGN -> GENERATE -> PLAYTEST -> REFINE -> BUILD -> PUBLISH
```

The creator works in one visual console. Natural-language commands become proposed structured changes, not
unreviewed chat output.

```text
Natural language command
  -> intent + target resolution
  -> proposed patch
  -> schema validation
  -> dependency analysis
  -> preview / approve
  -> immutable StoryVersion
  -> selective regeneration plan
```

## Bounded systems

| System | Owns | Must not own |
| --- | --- | --- |
| Story Studio | projects, story versions, narrative entities, authoring commands | provider-specific execution |
| Story Engine | validation, dependency graph, patch proposals, versioning | multiplayer session state |
| Production Orchestrator | workflow DAGs, jobs, retries, costs, provider selection | story authoring UI |
| Provider Layer | normalized LLM/image/video/TTS/music/SFX/storage calls | domain policy |
| Asset Pipeline | asset locks, manifests, rendering and provenance | authoritative player state |
| Multiplayer Runtime | rooms, role authorization, state, timers, resolution, snapshots, events | free-form AI mutation |
| Companion Web | role-private view and intent submission | resolution decisions |
| Unreal Client | cinematic playback, lobby, runtime presentation | authoring and production |

## Authoritative-state rule

Only the multiplayer server may commit runtime mutations. The sequence is always:

```text
client intent -> authentication/role authorization -> schema validation
-> deterministic resolution rules -> atomic state mutations -> event log -> state broadcast
```

LLMs and realtime agents may classify or propose an intent. Their output is untrusted input to the same path.

## Contract rule

The JSON Schemas in `packages/*-schema` are the cross-system contracts. Provider metadata is preserved for
auditability, but provider names and model-specific parameters do not leak into core story or runtime models.

## V1 media rule

Main-film scenes are generated before play, validated, stored and packaged. Player actions resolve immediately
to an already available scene or deterministic fallback. Runtime generation is optional future content only.

# 2026-11-05 制作 Harness 与 UE Runtime 分工合同

用户报告首节点 goal 已持续 3 天 16 小时 32 分钟，要求制作可控、进度可见。此节是最新执行要求；下述未接线能力不得宣称已实现。不得为建设大型平台再延误当前节点交付。

## 职责和交付边界

FilmGame Studio 负责概念图、分镜、视频、配音、音效、音乐和图标的生成与审核。Harness 控制计划、调用、账本、等待、返工和人工决策。sandbox-game agent 主要负责 UE5 runtime：规则、输入、UI、剧情分支、视频时钟、战斗、转场、结算、成长、存档、性能和完整流程验收。素材生成成功不等于采纳，素材采纳也不等于玩法完成。

Studio 向 runtime 交付版本化 manifest：assetId/revision/SHA、路径或 URI、角色/地点参考版本、分辨率/帧率/时长/音轨、图层布局、循环/首尾接点、命中及分支事件、基础检查结果、人工决定及审核人/时间。战斗事件服从游戏规则合同，Studio 不自行更改数值窗口。runtime 校验缺失、SHA、版本及事件匹配；发现问题回传资产ID、时间码、预期/实际和复现证据。开发候选必须显式标注，不得进入正式验收包冒充采纳版。

## 预算、次数、质量和时长的取舍

每个项目/节点/镜头记录独立预算上限、供应商钱包及单位、已结算、在途预留、已确认退款、剩余额度、尝试次数、生成片长、主动处理时间、供应商等待时间、人工等待时间和墙钟耗时。积分与人民币分账，未知价格不能按零计；提交前原子预留，完成后按实际账单结算，超时不自动释放预留或重复提交，退款仅在确认后回补。

模型方案展示预计费用区间、预期等待、镜头风险、可复用资产与替代方案；价格/模型能力以当前 provider 回执为准。以可采纳秒数、每采纳秒成本、首轮采纳率和返工原因衡量效率，不以生成条数当进度。优先复用通过素材，关键物理动作使用适合模型；降低录制分辨率不改变正式素材质量门。

限额采用项目配置，不恢复用户已取消的固定两轮规则。达到软时间/次数阈值或连续同根因失败时进入 NEEDS_DECISION，禁止继续自动烧额度；预算硬限额拒绝新提交。供给侧运行中的任务仍可查询/收取结果，不因等待超时假定失败或复制任务。预算增加、画质/范围调整、继续返工应有明确决策记录，不能默默降低质量。无回复不算批准。

## 基础审核与 Human in the Loop

基础审核节点检查可解码性、音轨、时长、黑帧/冻结候选、规格、身份参考、接镜和事件完整性。视觉模型可指出神态/物理/一致性疑点，但需附时间码、参考版本、证据和不确定性；不能用分数替代人的审美判断。基础审核通过只进入 AWAITING_HUMAN_REVIEW。

人工门包括概念定妆/场景锁定、关键分镜、视频候选及节点组合审片。提醒应在 Studio 待审队列和弹窗中显示可直接观看的版本、基准对照、已花费用、剩余预算、缺陷摘要及“采纳/定点返工/暂缓”选项；支持集中批审，避免每条日志弹窗。按 assetId+revision+gate 去重并持久化，刷新或重启后仍可看到。系统通知权限不足时使用站内弹窗/待审角标；记录通知已送达不等于用户已经审核。

审核绑定确切 SHA/参考版本，替换媒体后旧批准失效。采纳后锁定；修改影响依赖分析。待审只阻塞依赖该资产的制作，独立工作继续。拒收媒体按项目清理规则删除，保留轻量费用、SHA、原因和回执，不为了审计永久保存错误视频。

## 进度与停滞可见性

展示完整节点清单及分别统计的生产完成、基础通过、人工采纳、runtime接入、玩法通过；不要把这五项揉成虚假的单一百分比。每个任务必须显示当前阶段、最近有效证据时间、运行/等待原因、下一步、负责人、耗时/预算及可用操作。没有可靠估计时显示未知 ETA。

状态至少区分 PLANNED、RUNNING、WAITING_PROVIDER、BASIC_REVIEW、AWAITING_HUMAN_REVIEW、NEEDS_DECISION、APPROVED、REJECTED、INTEGRATED、VERIFIED。心跳陈旧表示需要核查，不等于进程已死。重新提交前核 provider taskId/本地进程和幂等键；同一运行任务不重复启动。达到停滞阈值提醒人，并给出继续等待、局部替换、改变方案的费用/质量/时间影响。

## 当前落地状态与验收

本轮已接通 Studio 最小可控闭环：Comic 双币种预算/预留/人工账单与退款、可配置次数及墙钟上限、基础技术审核、绑定 SHA 的人工审片与通知确认、拒收清理、已采纳素材 manifest。通用 DAG 正式执行也启用人工门；重启不自动重提付费任务。具体使用及测试见 IMPLEMENTATION_STATUS 最新条目。

边界仍须明确：没有自动供应商账单查询或 VLM 审美裁决；时间当前是累计墙钟，未拆分主动处理/供应商/人工等待；通知为打开 Studio 时的站内弹窗。通用 DAG 审核展示输出地址及元数据，Comic 审片可直接播放。交付 manifest 为媒体合同，尚未替代 sandbox-game 的战斗事件/图层及 UE 接入验收；这部分等用户恢复首节点后实施。上述更完整的合同是后续扩展方向，不把本轮基础版本称为全部自动化。

后续以一个节点的真实资产贯通验证：重复提交不重复收费、跨币种不相加、超时任务不复制、超预算拒绝、旧SHA批准失效、人工待审重启可恢复、未审核候选不进入正式包、runtime准确报告缺失资产。先把这条最小实际闭环接起来，不另建重复控制平台。

