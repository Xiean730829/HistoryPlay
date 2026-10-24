# B线语音与MCP交接

日期：2026-10-24。独立工作目录为 `C:/Users/21711/.codex/worktrees/voice-mcp/HistroyPlay`。

## 已可运行的独立交付

`services/mcp-gateway` 提供正式 MCP SDK 的 stdio 服务，包含 `museum_get_context`、`museum_search`、`museum_read_content` 三个只读工具。绑定来自本机配置，不接收模型传入会话ID。网关只访问游戏HTTP，不导入游戏领域或数据库。

这是CW10a的工程基础，真实小智发现尚未通过，不能标CW10a整卡完成。CW09p真实能力尚未完成，因此没有启用不具备来源证明的动作工具。

## 安装及运行

在独立工作目录执行：

```powershell
uv venv .venv
uv pip install --python .venv/Scripts/python.exe -e services/mcp-gateway 'pytest>=8.3,<9' 'ruff>=0.11,<1'
.venv/Scripts/python.exe -m pytest tests/mcp -q
$env:MUSEUM_MCP_BINDING_FILE = '<当前展台写出的本机私密绑定文件绝对路径>'
.venv/Scripts/python.exe -m museum_mcp.server
```

本机绑定文件必须在被忽略的 `.local/` 下，由当前展台或可信启动器提供，字段为 `base_url`、`session_id`、`session_token`、`connection_id`。其中后面三个值必须来自当前页面已创建的会话与配对结果；不能新建另一个会话假装控制当前页面。示例配置只说明字段，不存放任何真实凭据。

## A线需要串行装配的接口

1. `MuseumShell.tsx` 已完成会话创建与配对后，将同一会话的受控绑定交给本机语音模块；重配后旧绑定必须撤销。只读网关不会自行pair，避免踢掉页面原连接。
2. 根 `pyproject.toml` 将 `services/mcp-gateway` 注册为uv成员，并更新根锁；包已固定 `mcp==1.26.0`、`aiohttp==3.14.5`。本B线没有修改根锁。
3. CI增加 `ruff check services/mcp-gateway`、`compileall services/mcp-gateway/src`、`pytest tests/mcp -q`，边界检查增加该包禁止导入museum领域/SQLite的规则。本B线未改公共CI或边界脚本。
4. 启动器后续启动stdio网关与经核实的小智MCP管道；不将带Token的接入URL放命令参数、日志、PR或浏览器。

## 真实预检状态

原网页测试台已经由开发者启动并保留运行，地址为 `http://127.0.0.1:8765`，health返回 `version=2.2.0/status=ok`。没有修改原工程。

设备连接配置保存在原浏览器该地址的localStorage；当前自动化浏览器不共享该存储。Windows Computer Use已找到原Edge窗口，但随后因无法可靠识别URL而强制终止UI操作，未读取或导出任何原设备凭据。

等待用户在原浏览器打开测试台并恢复原固定设备。真实设备连接、云端MCP发现、指定稿逐字朗读、abort后的旧任务隔离、可信来源/轮次关联均保持“未测”。主线程负责一次性请求用户操作。

## 已核实的上游路线

小智官方示例采用 MCP Python SDK stdio 服务，通过WSS管道连接小智控制台接入点。工程选择与该组合一致的 `FastMCP` stdio边界，但没有把hello声明或本机SDK发现当作云端账号成功。

- [小智官方MCP示例](https://github.com/78/mcp-calculator)
- [官方管道实现](https://github.com/78/mcp-calculator/blob/main/mcp_pipe.py)
- [设备侧MCP协议](https://github.com/78/xiaozhi-esp32/blob/main/docs/mcp-protocol.md)

协议中的session_id是连接标识，不能据此证明每一次旧模型工具调用对应哪次玩家输入。动作启用必须等待可信轮次路径；不得在每次工具调用时重新获取“当前epoch”给旧任务续命。

## B线已执行验证

- 在Windows/Python 3.13.3实际安装 `mcp==1.26.0` 和 `aiohttp==3.14.5`。
- `tests/mcp` 18项通过：真实stdio子进程initialize与tools/list、三个工具Schema、本地HTTP请求头与只读请求、无效绑定、拒绝跳转、凭据不外泄、UTF-8字节预算、分页和保留资料出处。
- Ruff通过。SDK搭配当前解析的pydantic-settings发出一条lifespan前向引用警告；本机stdio握手、工具发现和工具错误返回均通过，该警告不是云端兼容结论。
- stdio测试使用测试进程的假绑定，只核实本机协议行为，不声称已连接用户设备或控制浏览器。

## 网页采音与止声基础（独立PR）

新增 `voice/VadController.ts`、`MicrophoneCapture.ts`、`PlaybackQueue.ts`、`capture-worklet.js` 和 `voice-ui/VoiceEntry.tsx`。由A线在MuseumShell装配，B线没有修改主界面。

- `VoiceEntry`只提供首次权限开启与暂停，状态写“麦克风已开启”，不会把采音成功显示为“小智已连接”。
- `MicrophoneCapture`回调顺序是 `onSpeechStarted` 在 `onFrame` 前；A线必须在该回调同步执行队列stop，再通知本机桥abort/生命周期。
- worklet发送16kHz单声道PCM16的20ms帧；上游Opus编码前需要由桥积累为60ms，不能直接把20ms帧交给旧桥的60ms编码函数。
- PlaybackQueue采用本地generation，stop同步撤下所有排队节点，旧代音频不能重新进入。新云端tts.start不能擅自提升到当前代，云端轮次关联依然需要预检。
- 权限拒绝、等待权限期间停止、设备断开有清理路径；关闭页面必须调用stop。浏览器报告AEC不等于外放真实无回声。
- 完成回调在本地音频节点排空后触发；操作系统/硬件缓冲可能仍有尾音，不宣称声学测量或精确毫秒恢复。

`npm run check`通过，新增6个单测覆盖VAD连续120ms/静音650ms、两轮重开、噪声、旧代音频拒绝、播放排空、权限拒绝和取消时清理。真实麦克风/AEC/外放打断仍待H5/H6，CW09a仅交付可装配基础，不关闭整卡。
