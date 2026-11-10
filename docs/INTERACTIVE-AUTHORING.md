# 自然语言影游三阶段创作

入口为 `npm run authoring -- ...`，由现有编剧 agent 使用。它生成带共同上下文的提示词包、验证阶段候选、保存不可覆盖的检查点并导出文字稿；不新增网页按钮，不自动调用模型、生成媒体或修改游戏状态。结构校验不是语义审片。

阶段依次为 STORY（互动剧本编辑）→ CINEMA（影视化场景与表演）→ STORYBOARD（细粒度分镜及生成计划）。每阶段读取同一世界观、角色、锁定事实、完整分支约束、参考素材版本、任务范围和预算。原小说推文中的强制爆款/每段钩子改为有叙事需要的吸引力；15秒不是剧情长度，也不强制六镜。

## 操作

复制 `examples/screenwriting/interactive-context.json` 到本地工作目录并替换为真实输入。示例是虚构测试，不包含正式资产。预算未知写 null，不推断余额；空分支数组用于线性段落。

```powershell
npm run authoring -- prepare --context context.json --output story-packet.json
# agent 读取 packet.prompt，按其中要求输出 story-result.json
npm run authoring -- record --context context.json --packet story-packet.json --result story-result.json --output chain-v1.json
npm run authoring -- prepare --context context.json --chain chain-v1.json --output cinema-packet.json
# 同样记录 cinema-result，得到 chain-v2，再 prepare/record 分镜得到 chain-v3
npm run authoring -- verify --context context.json --chain chain-v3.json
npm run authoring -- export --context context.json --chain chain-v3.json --output reading.txt
```

结果字段见 `AuthoringResult` 和 `Shot`，定义在 `packages/story-engine/src/interactive-authoring.ts`。非分镜阶段 shots 为空。每个镜头有时长、叙事目的、内容、景别、视角、运镜、表演、逐字对白、声音、光照、首尾状态、接切、参考 ID、分支 ID、生成组、复用/新增和提示词。阅读稿 prose 使用文字段落，不用表格。

## 版本与边界

检查点记录上下文 hash、父阶段 hash 和结果 hash。输入、人物或分支改变后旧链拒绝继续；上游结果变动后旧下游提示词包拒绝提交。只修改分镜时保留前两阶段，准备新分镜包；修改第二阶段时保留第一阶段并重建下游。不要覆盖历史文件。共同上下文有变化须从第一阶段重新核对；当前未实现自动按场景计算最小失效范围。

分支 ID 必须完整保留，每个分支在分镜中必须有覆盖。其前置条件、状态变化和后果的语义仍须作者逐项审读；ID 齐全不证明内容正确。引用必须存在，REUSE 不允许绑定未采纳资源。新增成片镜头时长受 maxNewSeconds 限制；它不是供应商计费时长或费用报价。生成组可能受最短时长、重试和复用影响，实际付费仍走现有 Studio 报价与审核入口。

遇到未决问题可保存候选，不等于批准下游制作。正式剧本内容仍通过 `screenplay validate/commit` 保存版本并保护锁定字段；三个阶段候选不会自动覆盖该权威库。分镜经语义检查后交接现有导演/视频提示词工作流，需重新核实真实参考绑定、音画与接缝。图像、视频采纳及最终节点验收均沿用现有授权和质量门。
