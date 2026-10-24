# 小智能力预检

## 当前状态

CW09p 尚未完成。当前证据只来自旧版网页测试桥的只读静态检查；本轮不使用账号、令牌、音频或网络请求。静态代码路径不会被
表述成上游服务已支持、已授权或已通过。

运行方式：

```powershell
uv run python tools/integration/xiaozhi_probe.py `
  --reference-root C:/Users/21711/Documents/Xiaozhi_Web_Test/xiaozhi_web_test
```

JSON适合后续自动归档：

```powershell
uv run python tools/integration/xiaozhi_probe.py `
  --reference-root C:/Users/21711/Documents/Xiaozhi_Web_Test/xiaozhi_web_test `
  --format json
```

工具只读 `server.py`，不执行参考项目、不连接小智、不加载配置或环境变量，也不输出源码、设备身份和凭据。静态报告中的
`code_path_present` 仅表示在本地源文件看到了对应转发路径；`not_evidenced` 表示没有足够证据，不能解读为上游不支持。

## 静态观察与待验证项

| 能力 | 静态观察 | 仍需的证据 |
| --- | --- | --- |
| Hello能力声明 | 本地桥接发送空 `features` 对象 | 不能推断上游MCP能力 |
| `abort` | 本地存在带 `session_id` 的转发路径 | 真实旧请求隔离、旧音频丢弃与竞态结果 |
| 固定文本输入 | 本地把测试文本映射为 `listen/detect` | 指定稿播放及返回音频匹配 |
| MCP工具发现 | 参考桥没有可识别的发现流程 | 获准设备上的入口、发现响应和返回预算 |
| 来源/轮次关联 | 静态观察不证明 | 真实语音来源、工具回执和晚到响应的关联记录 |

## H5真实预检记录

状态：待用户在本机使用已授权账号或固定模拟设备执行。不要把登录令牌、设备令牌、MCP令牌、儿童原始音频或完整私人对话写
入报告。至少需要记录：

1. 实际MCP入口及工具发现结果、响应预算。
2. 通过工具触发指定稿播放，确认音频来源与片段对应。
3. 播放中打断并发送下一轮，确认旧音频和旧工具回复无法覆盖新轮。
4. 可信来源/轮次关联证据，以及无法提供该证据时的明确降级边界。

在这些步骤完成前，CW09p 和 H5 均为待验证，不选定直连或自有编排路由，不把当前MCP实现声明为已完成。
