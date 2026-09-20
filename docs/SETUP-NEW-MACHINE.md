# 换一台电脑：从 clone 到能跑

> 目标：在一台新机器上 `git clone` 本仓库后，按本文走一遍就能无缝接着干活。
> 仓库里**只有代码、文档、配置模板与加密后的密钥**；模型权重、node_modules、构建产物、生成的素材与本地状态都不在 git 里（体积太大且可再生），本文说明它们各自怎么恢复。

## 0. 你需要随身带的两样东西（git 里没有）

| 东西 | 在哪 | 丢了会怎样 |
| --- | --- | --- |
| **SOPS age 私钥** | Windows `%USERPROFILE%\.config\sops\age\keys.txt`；macOS/Linux `~/.config/sops/age/keys.txt` | `secrets/*.env.enc` 永远解不开，只能照 `.env.example` 重新填一遍各家 API Key |
| 各家账号本身 | 火山方舟（Seedance）、ElevenLabs、Cloudflare R2/S3 等 | —— |

**把 keys.txt 存进密码管理器或离线加密盘；不要放进仓库、不要发聊天。**

## 1. 装依赖

| 软件 | 版本 / 来源 | 备注 |
| --- | --- | --- |
| Node.js | **≥ 22.13.0**（package.json engines） | 必须 |
| Git | —— | 必须 |
| SOPS + age | https://github.com/getsops/sops 、 https://github.com/FiloSottile/age | 解密本地配置用 |
| FFmpeg | LGPL 构建，加进 PATH | 合成与转码 |
| Python 3.10+ | —— | CosyVoice、ComfyUI |
| Unreal Engine 5.7 | Epic Launcher | 运行时客户端 |
| ComfyUI | 独立 clone，默认 `G:\comfyui` | 本地出图/视频 |
| CosyVoice | 独立 clone + 权重 | 本地配音 |

### 1.1 脚本的跨平台约定

`stack:*`、`secrets:*`、`model:download`、`smoke:production-providers` 这些 npm 脚本
统一经 `scripts/run-platform.mjs` 分发：Windows 跑 `scripts/<name>.ps1`，macOS/Linux 跑
`scripts/<name>.sh`。两边行为一致（端口幂等、`.local/logs` 日志、`.local/processes.json` 记录 PID），
所以下文的 `npm run ...` 在两个平台都照抄即可。

`smoke:unreal-package` 只有 .ps1，macOS 上会明确报「没有对应实现」。

### 1.2 macOS（Apple Silicon）实测步骤

以下在 M4 Pro / 48 GB / macOS 15 上逐条验证过。

```bash
brew install sops age ffmpeg
brew install python@3.12          # ComfyUI 用；uv 会按需自动取 3.10 给 CosyVoice
brew install uv

# ComfyUI（MPS 后端）
git clone --depth 1 https://github.com/comfyanonymous/ComfyUI.git ~/Golands/ComfyUI
cd ~/Golands/ComfyUI
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python torch torchvision torchaudio
uv pip install --python .venv/bin/python -r requirements.txt

# CosyVoice（README 指定 Python 3.10）
git clone --depth 1 --recursive https://github.com/FunAudioLLM/CosyVoice.git ~/Golands/CosyVoice
cd ~/Golands/CosyVoice
uv venv --python 3.10 .venv
grep -v '^--extra-index-url' requirements.txt > /tmp/req-macos.txt   # 剔除 CUDA 专用索引
uv pip install --python .venv/bin/python "setuptools<81" wheel
uv pip install --python .venv/bin/python --no-build-isolation-package openai-whisper -r /tmp/req-macos.txt
.venv/bin/python -c "from modelscope import snapshot_download; \
  snapshot_download('iic/CosyVoice2-0.5B', local_dir='pretrained_models/CosyVoice2-0.5B')"
```

macOS 上踩到过的四个坑，装之前先知道：

| 坑 | 症状 | 处理 |
| --- | --- | --- |
| CUDA 专用 extra-index | uv 解析 `onnxruntime==1.18.0` 失败 | 装之前把 `--extra-index-url` 行去掉；CUDA 包本来就按 `sys_platform == 'linux'` 门控 |
| `openai-whisper` 构建 | `ModuleNotFoundError: pkg_resources` | `--no-build-isolation-package openai-whisper`，并先装好 setuptools |
| **setuptools ≥ 81** | CosyVoice 整个起不来（`pkg_resources` 被移除） | **必须钉 `setuptools<81`**。升级 modelscope 等操作会把它顶上去，之后要钉回来 |
| FFmpeg 编码器 | `Unknown encoder 'libopenh264'` | Homebrew 是 GPL 构建，没有 libopenh264。设 `MEDIA_VIDEO_CODEC=h264_videotoolbox`（Apple 硬件编码，同样避开 GPL-only 的 libx264） |

### 1.3 关于 CosyVoice 的文本正则化

`wetext` 的 FST 需要**先拉一次**到本地（上面的 `snapshot_download` 已包含）：

```bash
~/Golands/CosyVoice/.venv/bin/python -c \
  "from modelscope import snapshot_download as d; print(d('pengzhendong/wetext'))"
```

原因：`wetext.Normalizer` 每次构造都会访问 modelscope（即使 FST 已在本地），而
`CosyVoiceFrontEnd` 把它包在裸 `except:` 里——网络抖一下就会**静默降级**，日志里只有一行
`no frontend is avaliable`，不报错，但数字和日期会被逐字念出来。

adapter 现在有两道防护（`services/cosyvoice-adapter/python/wetext_cache.py`）：

- FST 已完整缓存时直接用本地副本，**不碰网络**；只有缓存缺失才回落到下载。
- 启动后检查 CosyVoice 实际加载到的 frontend，**没有就拒绝启动**并给出取回 FST 的命令。
  确实想在没有正则化的情况下出音频，用 `--allow-degraded-text-frontend`
  （`smoke:cosyvoice` 对应 `COSYVOICE_ALLOW_DEGRADED_TEXT_FRONTEND=1`）。

`/health` 与 `smoke:cosyvoice` 的输出都会带 `textFrontend` 字段，正常应为 `wetext`。

## 2. 拉代码与装包

```bash
git clone git@github.com:letianxing/filmgame-studio.git
cd filmgame-studio
npm install                     # 根 workspace
npm --prefix apps/creator-console install
npm --prefix apps/companion-web install
npm --prefix apps/multiplayer-server install
npm run build:core
npm test                        # 应全绿
```

## 3. 恢复本地配置（密钥）

```bash
# 先把 keys.txt 放回对应位置：
#   Windows      %USERPROFILE%\.config\sops\age\keys.txt
#   macOS/Linux  ~/.config/sops/age/keys.txt   （chmod 600）
npm run secrets:decrypt
```
它会把 `secrets/*.env.enc` 解出成 `.env.local`、`apps/creator-console/.env.local`、`services/{video,audio,storage}-gateway/.env.local`（见 `secrets/README.md` 的对应表）。

**密钥按平台分开存**：因为这些文件里全是机器相关的绝对路径，Windows 的 `G:\...` 到 macOS 毫无意义。
Windows 读 `<name>.env.enc`，macOS 读 `<name>.macos.env.enc`，Linux 读 `<name>.linux.env.enc`；
找不到本平台的就回退到共享那份并在 stderr 给出提示。同一把 age 私钥能开全部。
所以**在一台机器上 `npm run secrets:encrypt` 不会破坏另一台的路径**——下面那张「必须手工改」的表，
只在你这个平台第一次配置时需要走一遍。

**解密后必须手工改的机器相关路径**（旧机器的绝对路径会原样带过来）：

| 变量 | 说明 |
| --- | --- |
| `COMFYUI_HOME` / `COMFYUI_BASE_URL` | 新机器的 ComfyUI 位置与端口 |
| `COSYVOICE_MODEL_DIR` / `COSYVOICE_BASE_URL` | CosyVoice 权重目录与服务地址 |
| `*_STATE_FILE`、`.local\` 下的各种路径 | 改成新机器的绝对路径 |
| `UNREAL_ENGINE_ROOT`、`UNREAL_EDITOR_PATH` 等 | 新机器的 UE 5.7 安装目录。注意二进制路径分平台：Windows 是 `Engine\Binaries\Win64\UnrealEditor.exe`，macOS 是 `Engine/Binaries/Mac/UnrealEditor`，构建脚本则是 `Engine/Build/BatchFiles/Mac/Build.sh` 与 `RunUAT.sh` |
| `FFMPEG_PATH` / `FFPROBE_PATH` | 指向本机 ffmpeg/ffprobe |
| `MEDIA_VIDEO_CODEC` | 不设时默认 `libopenh264`（LGPL FFmpeg 构建自带）。Homebrew 的 GPL 构建没有它，macOS 上设 `h264_videotoolbox` |
| `VISUAL_STUDIO_ROOT`、`WINDOWS_SDK_ROOT` | 仅 Windows 有意义，其他平台注释掉 |

没有 age 私钥时：照 `.env.example` 与各 `services/*/.env.example` 手工新建 `.env.local`，重新填各家 Key。

## 4. 下载模型权重（不在 git 里）

`config/model-registry.json` 记录了每个模型的来源、文件名、字节数与 sha256。用脚本下载到 ComfyUI 对应目录：

```bash
npm run model:download -- -Id flux-schnell-fp8       # 17.2 GB，本地出图必需
# 下面三个合计约 18.1 GB，只在需要本地出视频时才要；
# COMFYUI_LOCAL_VIDEO_ENABLED=false 时视频走远程 Seedance，可以整组跳过。
npm run model:download -- -Id wan2-2-ti2v-5b
npm run model:download -- -Id wan2-2-vae
npm run model:download -- -Id wan-umt5-xxl-fp8
# CosyVoice2-0.5B 按其仓库说明拉取到 COSYVOICE_MODEL_DIR
```

加 `-VerifyHash` 会在下完后比对 registry 里的 sha256。

下载走代理时链接容易中断。`.sh` 版每次重试都重新调用 curl；**不要**改成靠 `curl --retry`
自己重试——`--continue-at` 只在启动时算一次，中途重试会从 0 字节重来并截断已下好的部分。

## 5. 启动与自检

```bash
npm run stack:start      # 默认起 comfyui/cosyvoice/orchestrator/multiplayer 与两个前端
npm run stack:start -- --services video-gateway,audio-gateway,storage-gateway
npm run stack:status
npm run smoke:media                  # FFmpeg
npm run smoke:comfyui-adapter        # 本地出图（空图，快）
npm run smoke:comfyui-flux           # 本地出图（真跑 flux，首次约 80 秒含加载模型）
npm run smoke:cosyvoice              # 本地配音
npm run smoke:production-providers   # 三个远程 gateway 的 /health
npm run stack:stop
```

`smoke:comfyui-*` 不会自己读 `.env.local`，直接 `npm run` 会因为缺环境变量而失败。用：

```bash
npx tsx --env-file=.env.local scripts/smoke-comfyui-flux.ts
```

`smoke:production-providers` 的 HEALTHY 只证明**内部 token 一致、各家 API Key 有效、端点可达**
（视频那条会带 Key 去方舟查任务列表）。它**不检查余额，也不检查视频模型是否已开通**——
这两样只有真正提交一次生成任务才会暴露。

## 6. 和游戏项目的关系

游戏本体在另一个仓库：`letianxing/sandbox-game`（Windows 机 `G:\Golands\sandbox-game`，
Mac 上 `~/Golands/sandbox-game`）。它用
`tools/film/storyboard_to_production.py` 把分镜转成本仓库的 Production 文档，再交给本仓库的编排器生产影视。
两个仓库在新机器上都 clone 下来即可；游戏项目那边另见其 `docs/STATUS.md`。

## 7. 不在 git 里的东西一览

| 路径 | 是什么 | 怎么恢复 |
| --- | --- | --- |
| `node_modules/` | 依赖 | `npm install` |
| `**/dist/`、`*.tsbuildinfo`、`.next/` | 构建产物 | `npm run build` |
| `.local/` | 不可变素材库、ComfyUI 模型与 base-directory、网关状态、缓存、生成的媒体。Windows 机约 34 GB；只装 flux 的 Mac 约 16 GB | 重新生成；要迁移就手工拷贝这一整个目录 |
| `artifacts/`、`generated-assets/` | 生产产物 | 重新生成 |
| `**/.env.local` | 明文密钥与本机路径 | `npm run secrets:decrypt` 或照 `.env.example` 重填 |
| ComfyUI 模型权重 | 几十 GB | `npm run model:download` |
| UE 的 `Binaries/`、`DerivedDataCache/`、`Saved/` | 引擎产物 | 首次打开工程时重新生成 |
