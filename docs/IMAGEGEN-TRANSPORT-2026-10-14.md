# 生图与 Broken pipe 排查

2026年10月14日。没有修改代理、客户端网络设置或凭据。不得使用Computer Use检查或操作代理。

## 已确认的证据

- 日志中检索到的26条Broken pipe均由`codex_core::responses_retry`记录，消息为`stream disconnected before completion: IO error: Broken pipe (os error 32)`。项目scripts及本轮媒体日志未检索到同类错误。
- 三参考图的入堂生图请求最终由内置`images/edits`调用报`error sending request`，没有生成文件。它和回复流错误不是同一个报错位置，不能直接认定因果。
- `codex doctor --json`确认CLI与后台服务均为0.162.1，数据库正常，HTTP可达、WebSocket握手成功。该诊断不证明长请求持续稳定，也未检查当前线程全部覆盖配置。
- 诊断报告保存在被Git忽略的`artifacts/runtime-diagnostics/codex-doctor-20261014.json`。配置中有过期字段警告，与Broken pipe的因果关系未证实，没有盲目修改。

## 已成功的生产路径

保持同一环境，拆分复杂请求，内置imagegen连续完成：

1. 无参考图的单个羽扇道具：22.4秒。
2. 单参考图为孔明添加纶巾和右手羽扇：36.0秒。
3. 使用孔明及鲁肃两张参考图合成入堂首帧：42.0秒。

三份图片已保存到`productions/wolong-chengxiang/v5/assets/`。双人图视线不一致，状态为REVISE，尚未批准视频生成。采用少量必要参考、分阶段编辑是当前经过实测可工作的办法，但不能据此声称已证明请求体大小是根因，也不能声称永久消除了客户端断流。

后续若再次失败，记录准确工具、时间、错误和是否落盘；先核对原请求结果，再做有区别的最小对照，不重复提交同一长请求，不把增加重试次数当作修复。没有启用CLI/API生图备用路径，也没有使用新的付费视频服务。
