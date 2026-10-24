# 当前展台语音控制接入（2026-10-24晚间B线）

## A线只需装配的位置

1. 游戏 `main.create_app`已有database/commands/bindings/tickets时，导入VoiceLifecycle与register_voice_lifecycle_routes，执行 `register_voice_lifecycle_routes(app, VoiceLifecycle(database, services.commands, services.bindings, tickets))`。不重复创建游戏状态或配对。
2. MuseumShell在当前ActiveSession可用时挂载 `GameVoicePanel`，传入 `session`、`onRefresh(receipt)`、gameUrl与bridgeUrl。onRefresh应刷新当前会话并将receipt交给已有render-receipt协调器；禁止重新调用restoreSession/pair。动作返回committed仍只是提交，不能替代真实呈现回执。
3. 语音包新增对museum-mcp-gateway==0.1.0的workspace依赖，A更新根uv.lock；CI新增tests/voice_lifecycle。现有MCP/voice测试继续执行。

```tsx
<GameVoicePanel session={session} onRefresh={async (receipt) => {
  // 刷新当前配对的session；receipt交现有呈现回执协调器。
}} gameUrl="http://127.0.0.1:8781" bridgeUrl="http://127.0.0.1:8782" />
```

语音桥独立端口采用8782，因8781实际已被museum-game使用。页面若为5174，启动桥须设置MUSEUM_WEB_ORIGIN=http://127.0.0.1:5174。MUSEUM_XIAOZHI_DEVICE_FILE仍只指向本机私密设备配置，不能用MCP端点代替。

## 可信控制路径

当前网页把原有session_token/connection_id通过受Origin限制的本机/voice/bind交给桥。桥验证游戏HTTP绑定，获得独立bridge_token；不createSession/pair，不把设备Token传浏览器，也不把游戏凭据传模型。

每次本地VAD开始都退休旧音频连接，新的独占上游连接在上传音频前领取一次性input_token。只有该连接已start、已stop、实际收到至少3帧PCM后返回的第一条最终STT参与编排；重复STT、旧连接或关闭后的回调不能再次控制。中文意图只作为可替换控制规划器，调用同一ActionTools，再经游戏voice/act进入CommandService。

云端MCP调用没有可信input_token，museum_act明确拒绝；museum_get_context不会续权。本机scope冻结出生revision/view_revision/interaction_epoch，单动作后消费；新输入、取消、过期、重绑都拒绝旧scope。因此不能把“延迟旧输入重新get_context”变成新动作。核心游戏状态不复制到桥，不通过字幕改DOM。

## 第一版语音范围

- 往前/下一件；往后/上一件；看牛/看铜钱/看碑（内容搜索得到稳定ID，歧义时询问而不移动）。
- 看背面/正面/放大/缩小；背面按已有相机目标角度计算，实际应用回执仍由A整合。
- “介绍这个文物”读已准备背景；“看背后的故事”进入当前文物故事并读当前段。
- “继续”从被打断的同片段开头重读；“下一段”才调用continue_story；“返回展台”恢复展台。
- 规则外问题保留小智自由问答；不会同时执行第二份游戏控制。

固定正文由内容ID/版本取回，BrowserSpeechAdapter朗读原文，AudioFocus保证QA与固定稿互斥；退出/换展台清掉旧恢复目标。系统中文音色与实际外放仍需用户测试。

## 仍必须实际验证

新桥设备配置尚未等同于原8765页已连接；不能同时抢连同一设备。用户复用已有导入配置JSON最省操作；原工程没有导出/共享WS接口。云端probe17968保持原样，正式只读工具切换须先停旧probe再启动，不能双管道抢同端点。

工程测试不等于H5/H6：需在游戏页真实说“看铜钱→看牛→看背面→讲故事→中途插话→继续”，观察真正模型/视角/故事及旧输入拒绝。未完成前不把CW09c/10b/11a/b/12a/b整卡标通过。
