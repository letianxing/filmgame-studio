# 漫剧工作台

更新：2026-10-12。入口：`http://localhost:3000/drama`；教程：`http://localhost:3000/learn`。

## 已实现的使用流程

1. 使用原有 Sites 登录。本地 `vinext dev` 的登录按钮使用 Sites 插件的本地会话，不需要新增账号或密钥；托管版本继续使用 SIWC。
2. 用自然语言描述集数、角色、情节、画风和横竖屏。LLM 生成独立的线性漫剧数据，服务端做 Schema 和实体引用校验，不要求玩家、胜利条件或多个结局。
3. 在剧本与分镜页修改画面、镜头、对白、时长和排序。自然语言修改先产生完整提案，确认后生成新版本；回滚也产生新版本。
4. 在角色与声音页上传 PNG/JPEG 参考图、WAV 参考音频并填写参考文字；也可使用 CosyVoice 已注册的音色 ID。说话角色必须绑定声音并确认使用授权。
5. 选择 AI 视频或分镜预演，可填写背景音乐要求。面板展示镜头数量，明确点击开始后才运行媒体生成。每次执行绑定具体剧本版本，最多 120 镜头，单进程同一时间只执行一个制作任务。
6. 查看进度和错误。成功镜头按依赖输入哈希缓存，未变的镜头在重试或新版本中复用。重启中断的任务标记为失败，可手动重试。
7. 在制作与成片页预览整集、下载 MP4 和 WebVTT 字幕。MP4 有对白时包含 mov_text 字幕轨；浏览器使用单独的字幕文件。

## 配置与存储

- 复用根 `.env.local` 的 LLM、ComfyUI、CosyVoice、视频网关、FFmpeg 配置；可选配乐复用音频网关。
- `DRAMA_STORAGE_ROOT` 可配置独立持久卷，空值默认 `<cwd>/.local/drama`。项目、历史版本、输入素材、生成记录及输出文件保存在这里，不能随应用部署清空。
- 新漫剧链路使用本地不可变、SHA-256 标识的素材库，通过认证 HTTP 流式下载提供浏览器播放；不依赖 R2/S3 的在线状态。原影游存储配置不变。
- 不向浏览器返回供应商密钥或生成素材的上游临时 URL。项目按 Sites 用户 ID 隔离；托管时 Console 和 Orchestrator 必须设置匹配的 `ORCHESTRATOR_API_TOKEN`，并使用可达的 HTTPS 地址。
- 当前文件存储与内存调度面向单个 Orchestrator 进程。部署多个 worker 前，需要共享数据库、分布式执行锁与任务队列。
- 本地可用不等于已发布到远程 Sites：这次变更在商业源码仓库内完成，尚未改动远程部署及公网服务配置。

## 实现边界

- 视频模式将角色参考图缩小为 JPEG，通过现有 VideoProvider 参考图合同提交；实际人物一致性取决于模型能力，仍需人工逐镜验收。
- 分镜预演为静帧加配音。现有 FLUX Schnell 工作流只接受文本，不会声称参考图片已经参与图像条件生成。
- 生成视频每镜至少请求 4 秒，输出按创作者的计划时长剪裁；配音较长时延长末帧，避免截断对白。没有自动对口型。
- 配乐可选，按集生成并以低音量混入；此轮没有新增逐镜音效编辑器、专业多轨时间线或自动口型模型。
- 停止制作会中止本地调用和后续镜头，已提交的上游云任务可能仍执行和计费。
- 当前授权勾选是创作者声明，不替代商业发行的许可证和声音授权材料审查。没有把新成片冒充已经通过原影游商业发布门禁的资产。
- 项目、版本和生成文件会持续占用本地磁盘，运维需安排备份与保留策略；没有自动删除历史素材。

## 验证证据

- 新增独立漫剧 Schema、角色引用、版本冲突、依赖输入和配音绑定测试。
- HTTP 测试覆盖未登录、跨用户访问、未知素材、版本保存/回滚和视频 Range 下载。
- 重启恢复测试防止把中断任务误报为成功。
- 真实 FFmpeg 自动化测试使用合成测试媒体，覆盖双镜头合成、长配音延帧、配乐混音、字幕轨、整集技术检查和已完成镜头复用。合成测试媒体不作为 AI 生成证据。
- 本机真实供应商验收：通过面板创建《雨夜来信·链路验收》，LLM 生成 1 集 2 镜头，视频供应商完成 2 段生成，最终 MP4 约 8.02 秒。该样片无人物、无对白，验证的是文本→视频→整集合成链路，不代表已验证长篇人物一致性或新声音克隆效果。
- 浏览器实测：教程官方播放器加载成功，能显示原作者和指定分集；自然语言剧本生成与制作提交均经面板执行。
- 实测同时发现并修复现有 OpenAI-compatible 适配器问题：JSON_OBJECT 模式原本未将 Schema 放入消息；现在在系统消息中提供完整 Schema，回归测试覆盖该行为。

## 开源方案选择

2026-10-12 调研，只使用官方仓库、许可证和文档进行技术选型，没有复制第三方短剧系统源码。

| 项目 | 本次决定 | 原始来源 |
| --- | --- | --- |
| FFmpeg | 延续已有 CLI 边界，新增整集拼接、统一画幅、音频混合和字幕封装。具体二进制的 LGPL/GPL 状态仍取决于构建选项。 | [官方许可证说明](https://www.ffmpeg.org/legal.html)、[拼接 FAQ](https://www.ffmpeg.org/faq.html)、[滤镜文档](https://www.ffmpeg.org/ffmpeg-filters.html) |
| ComfyUI | 继续通过已有 HTTP 适配器调用。其 GPLv3 源码保持独立，不复制进第一方业务实现。 | [官方许可证](https://github.com/Comfy-Org/ComfyUI/blob/master/LICENSE) |
| CosyVoice | 继续已有 HTTP 边界，新增角色参考声音绑定界面。代码 Apache-2.0，声音素材与模型许可仍分别管理。 | [官方许可证](https://github.com/QwenAudio/CosyVoice/blob/main/LICENSE) |
| OpenCut | 保留为后续专业时间线候选。官方 README 当前说明正在重写，并推荐 classic 版本；本轮不引入整个编辑器。 | [官方仓库与状态](https://github.com/OpenCut-app/OpenCut) |
| Remotion | 不新增依赖；其公司规模等商业使用条件需单独评估。现有 FFmpeg 已覆盖本轮导出。 | [官方许可证](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md) |
| Huobao Drama | 仅参考公开产品范围；许可证含 NonCommercial，不引入实现代码。 | [官方许可证](https://raw.githubusercontent.com/chatfire-AI/huobao-drama/main/LICENSE) |

## B 站教程接入

素材索引在 `apps/creator-console/lib/drama-tutorials.ts`。五个入口覆盖剧本、角色一致性、分镜、配音和后期；每个入口提供原站链接、点击加载的 B 站播放器和本项目自行编写的创作提示词。

- [AI电影系统教学：漫剧流程教程](https://www.bilibili.com/video/BV1V5Ee6iE8k/)：P1 剧本、P9 分镜、P6 后期。
- [ComfyUI系统教程：人物一致性](https://www.bilibili.com/video/BV1Sqge63ESK/?p=2)：P2。
- [与AI同行1996：CosyVoice 使用教程](https://www.bilibili.com/video/BV1Mz421B7bE/)：早期版本教程，界面已提示版本差异。

仅核对公开简介、章节及播放器，不宣称完整审看或背书课程营销内容。未下载、转载、重新托管视频，也未把第三方课件或工作流当作商业授权素材。嵌入受 B 站和原作者的可用性限制，保留原站跳转作为后备。

## 本地 Wan 与 Seedance 选择（2026-10-13）

创作者在「制作整集 → 视频引擎」明确选择 WAN 或 SEEDANCE，渲染记录保存该选择；服务端拒绝未指定／未知引擎。本地失败不会回退到付费云端，缓存按引擎和配置分别计算。自然语言操作由代理先解释，再提交同样的结构化选项，不由模型直接改运行状态。

本机为 M4 Pro，12核CPU、16核GPU、48GiB统一内存。当前通过短样片验证的 Wan 路径为 MLX TI2V-5B q8、512×288（竖屏互换）、原生24fps、20步、单任务、每镜最多4秒。ComfyUI 的8fps MPS测试发生彩色条纹，不作为本机默认生产路径。此档用于本机验证和短镜试制，后期输出720p不代表原始生成达到720p清晰度。单个动作、单个主要人物优先；长台词不能靠循环视频冒充完整表演。

每个 Wan 镜头必须上传并保存 `firstFrameAssetId`：这是已确认构图的单张场景首帧，不是角色多视图概念板。字段经 Schema、归属和版本检查；镜头修改会使依赖缓存失效。自然语言修改改变画面、机位、风格或角色外貌时，会清除旧首帧绑定，要求重新确认。

权重登记位于 `config/model-registry.json`：5B FP16主模型、Wan2.2 VAE、UMT5-XXL FP16文本编码器合计约22.78GB（十进制）。使用官方 Comfy-Org 转换包、固定修订与SHA-256；FP16文本编码器在CPU执行，避免依赖MPS原生FP8。下载器逐文件流式写入、断点续传，校验通过才将.partial转正，完成当前文件后仍需保留20GiB磁盘余量。

本机配置 `WAN_RUNTIME=MLX` 和 `WAN_MLX_PYTHON`、`WAN_MLX_MODEL_DIR`、`WAN_MLX_HF_HOME`，通过适配器启动有资源保护的 `scripts/wan-mlx-worker.py`，每镜结束即退出模型。`COMFYUI_LOCAL_VIDEO_ENABLED` 是当前兼容命名的本地视频总开关，未因CLI成功自动开放正式制作。ComfyUI 单独评估时才用 `COMFYUI_PYTHON` 运行 `scripts/start-wan-safe.py`。不要为审片启动所有本地模型。安全启动限制RSS24GiB、可用RAM至少8GiB、交换空间增长不超过1GiB、MPS分配高水位0.45；这些是进程监控与框架限制，不能保证操作系统永不发生内存压力。作业结束后停止服务释放模型，勿让语音识别、TTS与视频模型同时驻留。

单镜CLI：`node --env-file=.env.local --import tsx scripts/produce-local-wan.ts --first-frame <已确认的单张场景图> --output <新输出.mp4> --seconds 2 --steps 20 --prompt <镜头动作>`。付费原生音画导演脚本必须显式传入 `--backend SEEDANCE`，拒绝把Wan请求偷偷发到云端。

### 声音能力边界

- [Wan2.2 TI2V-5B](https://github.com/Wan-Video/Wan2.2)：当前接入为图生视频，不生成原生对白。普通漫剧工作台走独立TTS合成，**尚没有接入口型同步**，不能标为“人物已对口型”。官方5B的24GB显存示例是CUDA设备，不可直接换算为M4性能。
- Wan2.2 S2V-14B：由已有音频驱动画面，仍须先取得配音；官方单卡条件高于本机选择的安全范围，本轮不下载14B。
- [LTX原生音视频](https://github.com/Lightricks/LTX-2)：优先研究的原生声音候选；[官方桌面路径](https://github.com/Lightricks/LTX-Desktop)列出Apple Silicon支持，但完整2.5模型包约72GB。[MLX社区移植](https://github.com/dgrauet/ltx-2-mlx)提供量化与流式加载；量化主模型大小不包含所有文本编码器、连接器、VAE和其他依赖。本机已下载并校验2.3 q4与Gemma权重，通过有内存保护的CLI实际生成4秒中文原生音画测试；“孔明先生，请上座”ASR与指定台词一致。仍有自生乱码字幕、表情与音色稳定性问题，口型精确同步未通过人工验收，且尚未接入工作台原声保留流程。权重使用LTX社区许可证，不等同于MIT/Apache；创作者已确认符合其[许可证](https://huggingface.co/Lightricks/LTX-2.3/raw/main/LICENSE)营收门槛并授权本地试制，仍按该许可证使用及分发。
- [MuseTalk 1.5](https://github.com/TMElyralab/MuseTalk)：组合路线候选，支持中文等音频驱动局部嘴部修改；配合已有CosyVoice与Wan画面。官方速度为NVIDIA测量，Mac社区移植须单独验证；真人脸效果不能直接推定适用于国漫脸、多角度、胡须、遮挡或群像。尚未接入。

任何替代方案都须以生成样片的实际对白准确性、嘴型、人物一致性和完整动作审片作为验收，不以模型排行榜或接口成功替代。

### 本机实测与资源记录

`artifacts/local-video-evaluation/` 保留请求、原始MP4、资源监控和ASR证据。Wan MLX 25帧约110秒，49帧约209秒；LTX 97帧约110–122秒，已测进程峰值约12.5–13.4GiB。耗时和RSS是这些短样片的实测，不保证长镜头线性扩展。Wan使用受限BF16 T5加载钩子；未修改上游模型源码。图片首帧由内置云端imagegen制作，视频/原生声音在本机生成，不能称为所有资产全离线生产。

技术样片不代表迎客、十人介绍、跪坐和群戏物理连续性验收；正式场景仍是335秒工作稿。旧Seedance开场已标记修订，不能继承其空间或人物质量结论。
