---
name: filmgame-sw-workflow
description: "在 FilmGame Studio 开始、继续或修订正式影片剧本时组织阶段、约束、稿次与导演交接。用户只改一场或一句时保留该范围。"
---

# 影片编剧工作流

先读取用户实际提供的故事、预计片长及已有稿件。区分用户已定事实、已有素材、必要假设和你的建议。主要交付应是人可读的剧情或剧本；持续项目同时记录经过校验的 JSON。

## 从正确的位置开始
- 只有想法：先明确主人公要做什么、什么阻止他、失败会失去什么；给出一句话故事和待定项。
- 已有完整稿：先反向提取人物、因果链、结局与已定约束，定位问题再提改稿建议。保留原稿，不重新发明用户已经确定的结局。
- 只改对白或一场戏：只调用对应模块；不自动扩为整片开发。
- 续写：读取最新 JSON 版本的 stage、lockedFacts、openQuestions 和 scenes；讲清本次推进什么，不让旧 Markdown 覆盖新版本。

## 按任务读取模块
模块均在相邻技能目录；一次只加载当前阶段需要的正文。
| 当前问题 | 技能 |
|---|---|
| 故事核心和主题 | [前提](../filmgame-sw-premise-theme/SKILL.md) |
| 因果、转折、高潮 | [结构](../filmgame-sw-story-structure/SKILL.md) |
| 动机和关系冲突 | [人物](../filmgame-sw-character-conflict/SKILL.md) |
| 分场与行动 | [场景](../filmgame-sw-scene-craft/SKILL.md) |
| 潜台词和角色口吻 | [对白](../filmgame-sw-dialogue/SKILL.md) |
| 中文剧本与格式交付 | [格式](../filmgame-sw-format-adaptation/SKILL.md) |
| 中段脱节、人物选择缺少后果 | [有机故事](../filmgame-sw-truby-anatomy/SKILL.md) |
| 类型承诺与差异化 | [类型](../filmgame-sw-genre-anatomy/SKILL.md) |
| 局部语言润色 | [润色](../filmgame-script-polish/SKILL.md) |
| 开发梗概与提案 | [提案](../filmgame-treatment/SKILL.md) |

先按影片实际长度组织工作。短片可以只有几场和一次关键选择；长片可按段落推进；非线性、群像或反高潮有自己的结构。页码、幕数、卡片数量都只是工具，不强制每场争吵或所有人物成长。

## 持续项目与交接
在首次持久化前读取 [项目数据契约](references/project-contract.md)。使用仓库根目录的 `npm run screenplay -- validate <候选.json>` 与 `commit` 命令维护版本，不直接覆盖权威文件。审美判断与 Schema 通过分别记录。

编剧完成后，将用户已确认的场次、动作、对白和未解决问题交给现有 short-drama-storyboard，再进入视频提示词、制作、剪辑与审查。若需要制作分镜，先读取对应已安装技能；未找到时报告缺失，不能假装调用成功。

用户只要求剧本时停在剧本交付。本技能不赋予新的图片、视频、声音生成或外部发布权限；已获得的具体授权继续有效，不重复索要同一授权。

## 项目边界与来源

在 FilmGame Studio 中使用本模块，遵守仓库 AGENTS.md 和用户已明确的创作范围。持续项目遵循仓库根目录 `docs/SCREENWRITING_WORKFLOW.md` 的 JSON 校验、版本与导出契约；局部口头建议不强制建立项目。只有用户授权的制作请求才进入付费媒体阶段。

本文件是第一方项目适配，不是上游原文副本。方法来源：[固定版本的 sw-workflow](https://github.com/jtydhr88/screenwriting-skills/blob/51115f18d160aa8b2ac5813e4432b6f0b425358f/plugins/screenwriting/skills/sw-workflow/SKILL.md)。许可证和引用边界记录在仓库根目录 `third_party/screenwriting/`；未打包上游书籍、影视剧本引文或参考语料。
