# 换一台电脑：从 clone 到能跑

> 目标：在一台新机器上 `git clone` 本仓库后，按本文走一遍就能无缝接着干活。
> 仓库里**只有代码、文档、配置模板与加密后的密钥**；模型权重、node_modules、构建产物、生成的素材与本地状态都不在 git 里（体积太大且可再生），本文说明它们各自怎么恢复。

## 0. 你需要随身带的两样东西（git 里没有）

| 东西 | 在哪 | 丢了会怎样 |
| --- | --- | --- |
| **SOPS age 私钥** | 旧机器 `%USERPROFILE%\.config\sops\age\keys.txt` | `secrets/*.env.enc` 永远解不开，只能照 `.env.example` 重新填一遍各家 API Key |
| 各家账号本身 | 火山方舟（Seedance）、ElevenLabs、Cloudflare R2/S3 等 | —— |

**把 keys.txt 存进密码管理器或离线加密盘；不要放进仓库、不要发聊天。**

## 1. 装依赖

| 软件 | 版本 / 来源 | 备注 |
| --- | --- | --- |
| Node.js | **≥ 22.13.0**（package.json engines） | 必须 |
| Git、PowerShell 7 | —— | 脚本多为 .ps1 |
| SOPS + age | https://github.com/getsops/sops 、 https://github.com/FiloSottile/age | 解密本地配置用 |
| FFmpeg | LGPL 构建，加进 PATH | 合成与转码 |
| Python 3.10+ | —— | CosyVoice、ComfyUI |
| Unreal Engine 5.7 | Epic Launcher | 运行时客户端 |
| ComfyUI | 独立 clone，默认 `G:\comfyui` | 本地出图/视频 |
| CosyVoice | 独立 clone + 权重 | 本地配音 |

## 2. 拉代码与装包

```powershell
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

```powershell
# 先把 keys.txt 放回 %USERPROFILE%\.config\sops\age\keys.txt
npm run secrets:decrypt
```
它会把 `secrets/*.env.enc` 解出成 `.env.local`、`apps/creator-console/.env.local`、`services/{video,audio,storage}-gateway/.env.local`（见 `secrets/README.md` 的对应表）。

**解密后必须手工改的机器相关路径**（旧机器的绝对路径会原样带过来）：

| 变量 | 说明 |
| --- | --- |
| `COMFYUI_HOME` / `COMFYUI_BASE_URL` | 新机器的 ComfyUI 位置与端口 |
| `COSYVOICE_MODEL_DIR` / `COSYVOICE_BASE_URL` | CosyVoice 权重目录与服务地址 |
| `*_STATE_FILE`、`.local\` 下的各种路径 | 改成新机器的绝对路径 |
| `UNREAL_ENGINE_ROOT` | 新机器的 UE 5.7 安装目录 |
| FFmpeg 路径（若未进 PATH） | —— |

没有 age 私钥时：照 `.env.example` 与各 `services/*/.env.example` 手工新建 `.env.local`，重新填各家 Key。

## 4. 下载模型权重（不在 git 里）

`config/model-registry.json` 记录了每个模型的来源、文件名、字节数与 sha256。用脚本下载到 ComfyUI 对应目录：

```powershell
npm run model:download -- -Id flux-schnell-fp8
npm run model:download -- -Id wan2-2-ti2v-5b        # 本机曾因虚拟内存不足禁用，视机器而定
npm run model:download -- -Id wan2-2-vae
npm run model:download -- -Id wan-umt5-xxl-fp8
# CosyVoice2-0.5B 按其仓库说明拉取到 COSYVOICE_MODEL_DIR
```

## 5. 启动与自检

```powershell
npm run stack:start      # 起 orchestrator 与三个 gateway
npm run stack:status
npm run smoke:media            # FFmpeg
npm run smoke:comfyui-adapter  # 本地出图
npm run smoke:cosyvoice        # 本地配音
npm run smoke:production-providers   # 远程 provider（需要余额）
npm run stack:stop
```

## 6. 和游戏项目的关系

游戏本体在另一个仓库：`letianxing/sandbox-game`（本机 `G:\Golands\sandbox-game`）。它用
`tools/film/storyboard_to_production.py` 把分镜转成本仓库的 Production 文档，再交给本仓库的编排器生产影视。
两个仓库在新机器上都 clone 下来即可；游戏项目那边另见其 `docs/STATUS.md`。

## 7. 不在 git 里的东西一览

| 路径 | 是什么 | 怎么恢复 |
| --- | --- | --- |
| `node_modules/` | 依赖 | `npm install` |
| `**/dist/`、`*.tsbuildinfo`、`.next/` | 构建产物 | `npm run build` |
| `.local/`（本机约 34 GB） | 不可变素材库、网关状态、缓存、生成的媒体 | 重新生成；要迁移就手工拷贝这一整个目录 |
| `artifacts/`、`generated-assets/` | 生产产物 | 重新生成 |
| `**/.env.local` | 明文密钥与本机路径 | `npm run secrets:decrypt` 或照 `.env.example` 重填 |
| ComfyUI 模型权重 | 几十 GB | `npm run model:download` |
| UE 的 `Binaries/`、`DerivedDataCache/`、`Saved/` | 引擎产物 | 首次打开工程时重新生成 |
