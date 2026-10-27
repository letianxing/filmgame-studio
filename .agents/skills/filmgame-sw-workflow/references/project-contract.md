# 项目数据契约

以仓库根目录 `docs/SCREENWRITING_WORKFLOW.md` 为使用说明，`packages/story-schema/screenplay.schema.json` 为候选字段约束。先看 `examples/screenwriting/sample-content.json`，按实际故事填写，不复制示例剧情。

持续项目的 JSON content 包含 title、format、targetMinutes、stage、premise、theme、ending、confirmedConstraints、lockedFields、characters、beats、scenes、openQuestions、nextStep。未知内容用允许的空字符串、空数组或 null，不能伪造用户已确认事实。

每次修改先读最新 vN.json，保留 projectId 和历史不动，只生成 content 候选。版本、时间与父版本由 screenplay commit 设置。先 validate，再 commit，并从接受版本 export 阅读稿。对白任务用 dialogue scope 与实际 scene IDs，锁定字段变更需要用户对具体设定的明确修改要求。

审美自检另写结论，机器通过不代表故事或表演质量通过。阅读稿不是第二份权威数据；有人修改阅读稿时，把差异提取为候选后校验、提交。
