# 当前展台语音控制接入

## 2026-10-25 00:10 运行与验收状态

- 当前验收页面是 `http://127.0.0.1:5176/`；游戏服务8783，语音桥8782，仅允许已配置的5176 Origin。旧5173/5174/5175页面不代表这次集成版本。
- PR #91/#92/#93/#95/#96 已依次合入main；生产装配 #101、实际相机回执 #102、真实作者故事返回出口修复 #103 均按准确head通过CI后合入。生产代码为 `e6d0def`。
- 本机内容为隔离联调包 `cn.tang.core@0.2.1`，由当前作者稿生成，包含三件文物的PNG/展示版GLB。作者稿未被覆盖；联调published不等于历史内容审核已完成。
- 已实测生产HTTP：会话创建→原配对→语音bind→一次性scope动作提交→本机桥绑定→MCP应用客户端读取相同焦点。未打开网页时真实呈现状态是pending，未把提交当呈现。
- 三件固定背景正文均已从实际HTTP读回；卧牛故事进入首段63字→下一段54字已实际提交并取回。新增真实作者稿三故事开始/下一段/返回原展台回归；118项后端、46项前端与5项投影测试通过。
- 原probe已停，唯一正式museum管道真实连接并收到initialize与tools/list；正式工具调用与新桥真实声音尚待玩家操作。设备JSON配置已校验并加载，health的device_configured=true只证明配置可读取。

请玩家先断开原8765设备页及其他语音页，再打开5176，只点一次“开启语音”。按顺序测试：“我要看牛”→等待真实模型→“看背面”→“介绍这个文物”→“看背后的故事”→中途提问→“继续”→“下一段”→“返回展台”。记录实际画面、字幕、声音、是否立即停读以及继续是否仍为同段。恢复旧会话若没有当前命令回执，先定位一次文物，不能伪造基线呈现。

CW10b/CW11a/b/CW12a/b 已有集成实现和工程验证，但H5/H6真实声音与打断未通过前，不把整卡标完成。当前中文意图范围是有界适配器；普通追问仍用小智问答，尚未证明重连后云端长期对话记忆。

## 已完成的生产装配

1. `services/museum/src/museum/main.py` 的create_app注册VoiceLifecycle与HTTP路由，复用既有database/commands/bindings/tickets。生产工厂集成测试不再手工补注册。
2. `MuseumShell.tsx` 挂载 `GameVoicePanel`，使用现有ActiveSession；刷新回调不重新配对，并把receipt交RenderReceiptReporter。首次进入长廊的命令也保留供真实载入回执关联。
3. 根uv.lock登记语音包到MCP包的workspace依赖；CI执行tests/voice_lifecycle和既有MCP/voice测试。
4. `RenderService.latest(session_id, connection_id)` 在锁内只读当前回执；voice/view仅在版本匹配且rendered时开放角度。`Artifact3D` 在模型可见帧读取实际相机方向与相对距离，拒绝旧角度/旧距离。
5. `tools/dev/run_local.py` 根据选定端口设置页面服务地址和单一Origin；Vite strictPort防止悄悄换端口。配置设备文件时启动语音桥，未配置时只启动网页/游戏。正式MCP管道单独管理，启动器不会偷偷创建第二条管道。

```tsx
<GameVoicePanel session={session} onRefresh={async (receipt) => {
  // 刷新当前配对的session；receipt交现有呈现回执协调器。
}} gameUrl="http://127.0.0.1:8781" bridgeUrl="http://127.0.0.1:8782" />
```

当前运行使用 `MUSEUM_PORT=8783`、`MUSEUM_WEB_PORT=5176`、`MUSEUM_VOICE_PORT=8782`，并将MUSEUM_ALLOWED_ORIGINS和MUSEUM_WEB_ORIGIN都设为http://127.0.0.1:5176。MUSEUM_CONTENT_ROOT/MUSEUM_ASSET_ROOT指向同一联调包的published/assets根。MUSEUM_XIAOZHI_DEVICE_FILE只引用本机已有私密设备JSON，不复制进Git，不用MCP端点代替。配置后执行 `uv run python tools/dev/run_local.py`。

## 可信控制路径

当前网页把原有session_token/connection_id通过受Origin限制的本机/voice/bind交给桥。桥验证游戏HTTP绑定，获得独立bridge_token；不createSession/pair，不把设备Token传浏览器，也不把游戏凭据传模型。

每次本地VAD开始都退休旧音频连接，新的独占上游连接在上传音频前领取一次性input_token。只有该连接已start、已stop、实际收到至少3帧PCM后返回的第一条最终STT参与编排；重复STT、旧连接或关闭后的回调不能再次控制。中文意图只作为可替换控制规划器，调用同一ActionTools，再经游戏voice/act进入CommandService。

云端MCP调用没有可信input_token，museum_act明确拒绝；museum_get_context不会续权。本机scope冻结出生revision/view_revision/interaction_epoch，单动作后消费；新输入、取消、过期、重绑都拒绝旧scope。因此不能把“延迟旧输入重新get_context”变成新动作。核心游戏状态不复制到桥，不通过字幕改DOM。

## 第一版语音范围

- 往前/下一件；往后/上一件；看牛/看铜钱/看碑（内容搜索得到稳定ID，歧义时询问而不移动）。
- 看背面/正面/放大/缩小；按当前实际呈现回执计算，提交与真正呈现分别确认。
- “介绍这个文物”读已准备背景；“看背后的故事”进入当前文物故事并读当前段。
- “继续”从被打断的同片段开头重读；“下一段”才调用continue_story；“返回展台”恢复展台。
- 规则外问题保留小智自由问答；不会同时执行第二份游戏控制。

固定正文由内容ID/版本取回，BrowserSpeechAdapter朗读原文，AudioFocus保证QA与固定稿互斥；退出/换展台清掉旧恢复目标。系统中文音色与实际外放仍需用户测试。

## 仍必须实际验证

新桥已读取已有设备JSON，仍不能将配置成功等同云端握手或声音成功。原8765页必须先断开；同一设备不能同时开麦连接。原probe已停并切到唯一正式管道，后续重启同样禁止双管道抢端点。

工程测试不等于H5/H6：需在游戏页真实说“看铜钱→看牛→看背面→讲故事→中途插话→继续”，观察真正模型/视角/故事及旧输入拒绝。未完成前不把CW09c/10b/11a/b/12a/b整卡标通过。

## 22:30联调回归

已通过真实本机HTTP与SQLite的端到端：创建独立测试会话与原配对→绑定本机桥→上传三帧真实Opus编码的PCM→模拟独占云连接返回最终STT→ActionTools→游戏HTTP一次性scope→展台从coin移动到bull。重复STT不再执行。另测旧输入读最新context后仍403，一次动作后不可重放。这里云端为测试适配器，不冒充真实账号声学验证。

修正了固定稿字幕会被迟到STT覆盖、否定旧目标误定位、普通“为什么”追问误转角度，以及动作等待画面刷新时新问题先到导致旧正文迟到开口。真实新桥设备仍待本机配置与用户操作，probe17968未切换。

## 当前页面进入正式MCP只读讲解

语音桥与正式MCP服务同时设置同一绝对路径 `MUSEUM_MCP_BINDING_FILE=<root>/.local/voice/game-binding.json`。页面原配对通过/voice/bind验证后，桥原子写入本机当前绑定；正式MCP只读工具每次调用加载此绑定，刷新/更换页面后不需要手抄会话ID。绑定文件不含任何云端动作scope，云端museum_act仍拒绝无来源调用。

先协调停止probe17968，再以 `MUSEUM_MCP_MODE=museum` 重启唯一官方MCP管道；不得同端点开两个进程。正式SDK在页面尚未绑定时也可先发现工具，查询会诚实提示尚未绑定。

如果设备JSON暂缺，可显式设置 `MUSEUM_VOICE_ALLOW_UNCONFIGURED=1` 启动本机桥，只提供当前展台绑定与MCP上下文。/voice/status明确device_configured=false；Panel绑定后阻止开启采音并提示一次性设备配置，不假装音频已连接。原8765语音页面可继续配合正式MCP只读工具询问当前文物。配置完成并暂停原设备后重启新桥，才能测试真正的游戏语音控制。
