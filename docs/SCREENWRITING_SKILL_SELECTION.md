# 正式影片编剧 Skill 筛选

核查日期：2026-10-13。状态：11 个项目适配技能已加入 `.agents/skills/`，固定版本与许可见锁文件；使用与验证说明见 [SCREENWRITING_WORKFLOW.md](SCREENWRITING_WORKFLOW.md)。等待用户提供正式剧情与预计片长。

## 主方案

选择 [jtydhr88/screenwriting-skills](https://github.com/jtydhr88/screenwriting-skills) 的电影核心模块，作为现有分镜、视频提示词、剪辑与审查流程的上游。核查过 README、LICENSE、NOTICE 及以下技能正文。选择依据是中文适配、职责划分、工作步骤和改稿检查的覆盖度；尚未在本项目正式剧本上做效果对照，不能把仓库的专业定位或关注数当作成片质量保证。

| 模块 | 本项目中的用途 |
| --- | --- |
| `sw-workflow` | 创作阶段、已定事项、稿次与下一步管理 |
| `sw-premise-theme` | 一句话故事、核心矛盾、主题与人物代价 |
| `sw-story-structure` | 起承转合、因果递进、转折、高潮和结尾 |
| `sw-character-conflict` | 人物动机、弱点、对手、关系与成长变化 |
| `sw-scene-craft` | 每场的目标、阻力、行动、结果及相邻场景衔接 |
| `sw-dialogue` | 角色不同的说话方式、潜台词、信息释放与对白精简 |
| `sw-format-adaptation` | 中文场号制剧本、可拍动作描述、改稿与改编交付 |

按题材补充 `sw-truby-anatomy`（人物选择与故事结构的关联）或 `sw-genre-anatomy`（类型预期）。尚未确定题材和片长，不提前套入特定类型、戏曲或剧集流程。

## 使用约束

- 先确定实际片长与媒介。技能中的经典长片页码、40卡等启发式方法不能直接变成所有影片的强制门槛。
- 若用户提供完整初稿，先提取已定设定并诊断结构、人物、场景和对白；修改以可审阅建议和版本差异呈现。
- 创作阶段优先解决人物选择、冲突与因果，导演阶段再确定特写、运镜、调度和剪辑点。
- 接入本仓库时，原生 `story-bible.md` 用作可读视图；权威数据仍遵守第一方 JSON、校验和版本规则。
- [LICENSE](https://github.com/jtydhr88/screenwriting-skills/blob/main/LICENSE) 为 MIT，但 [NOTICE](https://github.com/jtydhr88/screenwriting-skills/blob/main/NOTICE) 明确不为书籍、影视剧本及译本引文重新授权。使用原创流程和方法，不将第三方引用文本当成可自由再分发的商业素材。
- 正式启用前固定所选提交并读取相应模块。当前已安装项目适配技能；不等同于接入后台自动调度。

## 比较过的备选

- [EveryDay-Writer / script-writing](https://github.com/Deupaxx/EveryDay-Writer/blob/main/skills/script-writing/SKILL.md)：覆盖可拍动作、潜台词、场景效率及多种视频格式，可作场级润色的第二视角。正文也有较强的固定格式、页码与短片结构假设，不作为本项目主调度器。
- [autopunk / treatment-writer](https://github.com/ur-grue/autopunk-media-skills/blob/main/skills/screenwriting/development/treatment-writer/SKILL.md)：适合把已有故事整理成开发梗概或提案，范围较窄，不承担完整剧本创作与逐场改稿。仓库中的 stable/eval_score 属于发布者标注，并非本项目的独立实测。

## 正式影片衔接

用户故事与片长 → 剧情诊断/开发 → 人物与结构 → 分场大纲 → 完整剧本与改稿 → 用户确认创作方向 → 既有分镜与视觉设定 → 角色/场景参考 → 代表性样段 → 分批制作与剪辑。

保留此前偏好：风格化写实三维国漫、人物和场景一致性、人物情绪特写、具有叙事目的的运镜与自然转场。具体故事、角色和结局由用户后续提供；本次不预设《夜渡》为正式影片。
