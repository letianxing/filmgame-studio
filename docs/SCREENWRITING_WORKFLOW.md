# 正式影片编剧工作流

11 个项目适配技能位于 `.agents/skills/`，入口为 `$filmgame-sw-workflow`。7 个核心模块处理前提、结构、人物、场景、对白、格式和阶段管理；补充模块处理有机故事、类型、润色和提案。项目宿主已发现这些技能，下轮对话可直接使用。自然语言说“根据这个故事开始正式影片开发”也可以。

这是在当前项目内使用的编剧技能与 CLI 数据工具，不是 Creator Console 新增的编剧按钮，也没有把上游全文直接注入所有后台 LLM 调用。原有分镜、视频、剪辑链路保持独立，创作确认后按阶段交接。

## 数据与版本

候选格式见 `examples/screenwriting/sample-content.json`，Schema 为 `packages/story-schema/screenplay.schema.json`。`lockedFields` 保护选定字段，`confirmedConstraints` 与锁列表本身也受保护。`openQuestions` 表示未定事项，`stage` 和 `nextStep` 支持续写。

在仓库根目录运行：

```bash
npm run screenplay -- validate examples/screenwriting/sample-content.json
npm run screenplay -- commit --project my-film --input candidate.json --expected-version 0 --reason '初始版本'
npm run screenplay -- commit --project my-film --input dialogue-revision.json --expected-version 1 --reason '第一场对白润色' --scope dialogue --scenes scene-one
npm run screenplay -- export --project my-film --output screenplay-v2.md
```

默认保存到 `.local/screenplays/<project>/vN.json`，可用 `SCREENPLAY_STORAGE_ROOT` 或 `--root` 配置。每次写入生成不可覆盖的新版本；并发旧版本写入会失败。导出也不覆盖已有文件。回滚时取历史版本的 content 作候选，以当前版本号提交为新版本。

`--scope dialogue --scenes ...` 只允许所列场景的对白改变，其余动作、角色、结构和结局必须相同。`--allow-locked-changes` 仅在用户已明确授权修改对应锁定设定时使用，不把工具开关当作授权。Schema 和范围验证不能判断剧情好坏或证明自然语言约束均已满足，仍需逐条创作审读。

## 从编剧到制作

先交人物、因果结构、分场与完整剧本，按用户范围改稿。导演阶段读取稳定场次、逐字对白、动作和时长意图，再使用已有 short-drama-storyboard、short-drama-video-prompts、short-drama-edit、short-drama-review。不得用图像或视频提示词反向悄悄改剧本。

## 来源与校验

上游提交、源文件哈希、项目文件哈希和许可证记录于 `.agents/screenwriting-skills.lock.json`。上游原件通过 skill-installer 安装在本机外部 skill-sources 缓存中，不是本仓库运行依赖；项目适配正文是第一方重写，未复制书籍/影视引文。第三方声明位于 `third_party/screenwriting/`。

运行 `npm run skills:check` 检查项目文件完整性、相对引用和许可证；`npm test` 包含 Schema、锁定设定、对白范围、不可变历史与并发冲突测试。技能结构校验和软件测试不等于正式影片艺术质量已经验收。

## 本次验收结果

- 11 个项目技能均通过 skill-creator 的 quick_validate；宿主技能列表已发现全部模块。
- 锁文件完整性、固定提交、许可证及相对链接检查通过。
- 全量 84 项自动测试通过；根 TypeScript 检查和 build:core 通过。
- 在临时独立目录验证 CLI：初始 v1、仅对白修订 v2、重新读取与中文阅读稿导出；覆盖导出、越界动作修改均被拒绝。
- 没有调用视频、图像、声音生成服务，未消耗 Seedance 额度。
- 尚未对用户正式影片做内容质量验收，未新增后台网页编剧工作流。下一步是用户提供故事、片长与必须保留的设定。
