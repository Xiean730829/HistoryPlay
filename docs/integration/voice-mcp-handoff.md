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

用户已于本轮回复原测试页“已连接”。这是用户对原网页设备连接的确认，不等于新游戏语音桥已连接。开发者独立观察到8765健康接口正常；20:24的本机TCP快照未捕获到该进程的浏览器WS/443上游连接，因此不能据此补写双向音频实测。云端MCP发现、指定稿逐字朗读、abort后的旧任务隔离、可信来源/轮次关联均保持“未测”。

原桥每个 `/ws` 独占上游连接，没有授权共享连接/诊断API。新桥不得在原设备仍在线时抢连同一设备。现有用户连接信息不会因新桥开发而再次要求用户重新配对。

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

## 固定设备本机音频桥（独立PR）

`services/voice-bridge` 和网页 `voice/VoiceClient.ts` 已交付独立实现。设备MAC、UUID、WSS、Token只由服务端读取本机私密文件，浏览器只连接 `ws://127.0.0.1:8781/voice/ws`。桥限制Host/游戏Origin；拒绝上游跳转；默认只容许一个本地音频连接；日志不输出连接配置、异常repr或设备身份。

```powershell
uv pip install --python .venv/Scripts/python.exe -e services/voice-bridge
$env:MUSEUM_XIAOZHI_DEVICE_FILE = '<本机已有设备配置JSON绝对路径>'
$env:MUSEUM_VOICE_PORT = '8781'
$env:MUSEUM_WEB_ORIGIN = 'http://127.0.0.1:5173'
.venv/Scripts/python.exe -m museum_voice.main
```

配置文件兼容原网页导入格式：`device_id`、`client_id`、`websocket: {url,token,version}`。当前不自动复制原浏览器localStorage；不增加账号权限、不生成设备身份、不自动重新绑定。原工程的现有私密配置文件如无可用副本，需由后续可信的同源迁移流程实现，不能声称原页面连上就等于新桥拿到了凭据。

桥实际通过 `av==17.1.0` Opus编码/解码测试，自动将3个20ms PCM帧合并为60ms Opus。协议1/2/3包头与长度校验、Host/Origin拒绝、固定设备两次加载身份不变等11项Python测试通过；网页新增2项连接generation/打断旧音频测试，`npm run check`全通过。

由于云端逐轮关联尚未证明，保守的 `interrupt()` 先本地stop，再abort并退休整个旧音频连接，下一轮须显式重连同一设备；旧连接上的tts.start不会升级为新代。该路径只保证本地音频隔离，**不证明云端旧MCP动作安全，也不承诺云端聊天上下文跨重连保持**。不能把此基础提交标为CW09b/CW09c/CW11b整卡完成。

A线需在根uv成员/锁登记 `services/voice-bridge`（已固定aiohttp/av），CI覆盖 `tests/voice`。VoiceEntry首次操作应先解锁播放AudioContext，再开始采音。**最终推荐装配为：onSpeechStarted调用 `void client.beginTurn().catch(handleVoiceError)`，onSpeechEnded调用 `client.endTurn()`，每帧调用 `client.sendFrame(frame.pcm)`。不要自行拼接connect/start/stop回调。**beginTurn先停止旧声并退休旧连接、等待关闭回执后重连同一设备，避免独占租约409竞态；当前保守路线每条本地输入独占一个上游连接。

VoiceClient保留最近240ms预录；重连等待期间完整缓存本次输入，最多30秒，结束先于ready时也会按start→完整音频→stop补发，不上传结束后的静音。显式disconnect清空缓存；A线无需再复制预录或结束排队。每条输入新建上游连接可能增加延迟，云端聊天上下文跨重连仍未验证，游戏会话/展位不随之重建。浏览器显示“已连接”必须来自桥的ready，不能来自麦克风权限获准。

## MCP真实发现探针与WSS管道（独立PR）

新增 `museum_mcp.probe_server`（两个无私密信息、无游戏控制的诊断工具）和 `museum_mcp.xiaozhi_pipe`（兼容官方stdio↔WSS路径）。无需设备Token，也不会抢占原网页的音频连接。诊断模式不需要游戏绑定，可先验证云端发现；正式museum模式才读取已绑定展台。

用户只需在当前智能体的MCP接入点复制现有WSS地址，保存到本机忽略目录 `.local/voice/mcp-endpoint.txt`。这是MCP管道接入点，与设备语音WSS/Token是两种配置，不能互换。不要把接入点发到聊天、截图、PR或命令参数。

```powershell
$env:MUSEUM_MCP_ENDPOINT_FILE = '<本机mcp-endpoint.txt的绝对路径>'
$env:MUSEUM_MCP_MODE = 'probe'
$env:MUSEUM_MCP_REPORT_FILE = '<本机.local/voice/probe-report.json的绝对路径>'
.venv/Scripts/python.exe -m museum_mcp.xiaozhi_pipe
```

用户在原小智页面说：“调用时空博物馆诊断工具。”然后说：“取博物馆测试句并逐字读。”工具返回的固定测试句为：“这里是时空博物馆。我们正通过一件文物，走近唐朝人的生活。”用户听到的逐字一致性另记录，工具返回句子不等于TTS验收通过。

脱敏报告只记录连接状态、initialize/tools-list请求次数、白名单工具调用次数；不记录参数、响应原文、录音、设备身份或接入点。即使实际调用成功，报告中的audio/abort/turn_association仍为false，必须分别核实，不会自动把工具发现提升为全链路语音成功。

本地 `tests/mcp` 已增到24项通过（含诊断工具和脱敏报告/目标校验），Ruff通过。当前没有读取到本机MCP接入点，云端发现仍未测。

## 固定正文朗读与同片段恢复（独立PR）

新增 `narration/AudioFocus.ts`、`NarrationPlayer.ts`、`BrowserSpeechAdapter.ts`。播放器只消费稳定的 `packId/version/contentId/text`；不认识模型供应商、不推进剧情或改场景。QA与固定朗读共用AudioFocus；QA抢占先停止固定稿，继续时从被打断的同片段开头重读；只有下一段命令才能推进剧情。

`lastStarted`、`lastCompleted`分开记录，适配器真实完成Promise后才记已读完。leave清除恢复目标，迟到完成回调不能把退出的故事复活。启动、错误、中断、完成可由getCheckpoint观察，由A线展示简短状态。

浏览器SpeechSynthesis是可选的第一版固定正文适配器，直接传入准备的原文，不调用小智自由复述。系统中文音色、首次解锁、真实声音逐字一致性和外放打断仍需H4/H6；API缺失或合成错误明确失败，不默默变成模型重述。它不能作为小智“指定文本TTS已支持”的证据。

A线在故事/文物背景正文取到后调用player.play，画面保留在同节点；用户追问时先AudioFocus.claim("qa",stopQA)，用户“继续”调用resume，返回展台调用leave。后台持久化检查点和可信语音生命周期由A串行装配，当前仅是网页播放器基础，不关闭CW12a/b整卡。

## 接入回归补充

额外执行真实stdio子进程经过管道的initialize→tools/list→tools/call回归（模拟云端传输，不连接云端账号），诊断工具调用成功且脱敏计数正确。收到新的tts.start只重置解码器，不提升音频generation；异常JSON形态明确拒绝。又修正了重连丢失预录的问题，并增加240ms帧顺序、完整输入等待ready及结束先于ready的回归。当前Python接入测试合计36项通过，Ruff与compileall通过；全网页21项、投影5项、TS和构建通过。

20:40又对正在运行的旧8780游戏预览执行真实HTTP烟测：创建独立临时会话，context成功，铜钱/牛/碑搜索分别命中1/5/5，取正文返回HTTP404。未修改用户当前展台，测试结束已撤销自己的配对。此结果说明真实HTTP认证/查询通道已通，但旧预览没有新的正文读取能力或新版内容装配；最终联调必须更新运行版本和联调包，不能仅以远程main合并代替重启验证。没有把该烟测声明为云端MCP或用户语音成功。
