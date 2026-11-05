# 本地漫剧创作台

入口：`http://127.0.0.1:3000/comic`。这是独立的线性漫剧工作流，不需要多人房间、玩家行动或胜利条件。

## 使用

1. 在「创意」输入故事、集数、每集时长、画幅和画风，生成角色大纲与逐集分镜。
2. 在「剧本与角色」编辑方案并确认。自然语言修改先生成待确认方案；确认后形成新版本，可恢复上一版。
3. 保存角色设定后，可上传角色图，或用即梦生成参考图。查看报价、确认积分、同步结果、审核并锁定形象。生成的参考图在即梦里以来源节点连接到后续镜头。
4. 在「镜头制作」选择即梦画布或 Seedance API，准备镜头，确认费用后生成。点击「同步生成进度」取回视频，观看并审核画面、声音、连续性。
5. 本集全部镜头审核通过后，在「整集交付」导出 MP4 和 SRT。输出保留原生音轨，MP4 包含可切换字幕轨。

原生视频对白由模型生成；声音设定与角色图提供一致性依据，仍需审片。字幕来自可编辑的剧本时间轴，尚未实现语音识别强制对齐，发布前应校对。当前输出为 720p，支持竖屏、横屏、方形；逐镜头生产，尚无整季无人值守批量生成。

## 路线选择

本机 `sandbox-game` 中的 Seedance 工具复用了 FilmGame 的视频网关。该网关已经调用 Ark 原生 Seedance 视频，不是把静态图片拼成视频。即梦画布作为额外生产节点接入，其 OAuth 登录、积分账户与 Ark API Key 分开，保留两条可选路线。

主流程不需要单独启动 CosyVoice 或 ComfyUI；原生音画模式保留视频模型生成的对白、环境音和音乐。FFmpeg 负责确定性的转码、拼接与字幕封装。

## 本机配置与启动

在未提交的根 `.env.local` 配置 `DREAMINA_CLI_PATH`、`DREAMINA_PROFILE`（默认 `default`）、`COMIC_PROJECT_ROOT`（默认 `.local/comic-projects`）。复用现有 LLM、REMOTE_VIDEO 和 FFMPEG/FFPROBE 配置。

Windows PowerShell：

```powershell
& ./scripts/start-local-stack.ps1 -Services @('video-gateway','orchestrator','creator-console')
```

已有 CLI 不重复安装。需要重新授权时，在本机终端运行已配置路径的 `auth login`，在官方页面完成授权，再用 `auth status --format json` 检查。不要把令牌粘贴进项目文件。

此入口使用 Vite 本地代理连接工作站服务；现有托管站点不会自动获得本机 CLI、磁盘或 OAuth 凭据。云端部署需要另行提供认证的后端桥接。

## 模块与状态

- `packages/comic-engine`：剧本 Schema、角色引用和对白时间轴验证、视频提示编译。
- `apps/orchestrator/src/comic-workflow.ts`：角色/分集大纲 → 逐集镜头的分阶段 LLM 工作流。
- `apps/orchestrator/src/comic-service.ts`：剧本版本、参考图、报价、生成、同步、审核、整集导出。
- `services/dreamina-adapter`：只调用官方 CLI；动态发现模型，保存后回读，报价后使用明确积分上限确认。
- `services/remote-video-adapter`、`services/video-gateway`：原生音频、画幅、分辨率、角色图与任务查询。
- `services/media-pipeline`：角色预览图压缩、音视频规格统一、拼接、字幕封装和技术检查。

镜头可同时绑定已生成的角色图、场景图和音色参考；音频参考只约束音色，不作为本镜台词。原生音画保留对白与环境声，整片配乐在后期统一混音。项目可记录积分总上限及辅助素材已占额度，未决任务也保留额度，防止批量制作超过授权预算。

Windows 跨盘下载先在系统临时目录接收官方 CLI 文件，校验字节数和 SHA256 后再移动到项目盘，避免 CLI 跨卷重命名失败。审片工具支持每秒抽帧和提取 16 kHz 单声道音轨；本机《合流》制作另用本地语音识别辅助校对对白，最终字幕仍需根据实际声音审核，不能把识别结果直接当作台词正确的证明。

项目状态与版本存入 `COMIC_PROJECT_ROOT`，所有凭据仍留在原配置/CLI 凭据库。对同一项目的修改串行执行。角色、镜头或参考图变化后，对应旧视频与导出标记过期；未受影响镜头可继续复用。

CLI 的画布、节点、保存和提交身份在副作用前保存。提交超时后进入待核对状态，只读查询原任务，禁止自动换编号重试扣费。Seedance 网关也提供按幂等键查询任务。若远端提交成功但网关在保存映射前崩溃，需要人工核对上游任务，系统不会推断未扣费。

## 验证边界

已执行：CLI 登录与实时模型目录、真实即梦画布创建、角色图/视频节点保存回读和报价；域模型、版本、依赖失效、积分门槛及不确定提交的测试；真实 FFmpeg 测试片的拼接与音轨/字幕轨检查；Creator Console lint、构建与浏览器检查。

《合流》已完成 28 镜头的原生音画制作和逐镜抽帧审查，修复人物重叠、纸面金额、昼夜连续性与片尾乱码，并保留所有原始版本。成片约 3 分 46 秒，720×1280，包含配乐、校对后的烧录中文字幕与片尾；素材、剪辑来源、SHA256、积分上限汇总记录在项目交付清单。后期通过音频波形互相关检查累计时差，并在混音前按时间戳消除 AAC 拼接的累积偏移。细微表情和口型仍存在生成模型的不确定性，不能将抽帧和语音识别视为逐音素验收。

本机交付：`.local/comic-projects/33835fd8-0e03-4f91-a6c3-0b0754d878fb/confluence-final.mp4`；同目录保留 `confluence-final.srt`、`confluence-delivery-manifest.json`、`creative-signoffs.json`、`editorial-cuts.json` 和最终技术检查。已验证浏览器播放、拖动进度、移动端布局及 HTTP Range 下载。工作台支持 `/comic?project=<项目ID>&tab=export` 直接进入对应作品的整集交付页。

验证命令：

```powershell
npx tsc --noEmit -p apps/orchestrator
npx tsx --test apps/orchestrator/test/comic-workflow.test.ts services/video-gateway/test/*.test.ts services/remote-video-adapter/test/*.test.ts services/media-pipeline/test/*.test.ts
npx tsx scripts/smoke-comic-media.ts
npm --prefix apps/creator-console run lint
npm --prefix apps/creator-console run build
```
