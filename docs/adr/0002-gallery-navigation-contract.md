# ADR 0002：长廊导航契约与兼容迁移

- 状态：接受
- 日期：2026-10-24
- 范围：会话投影、应用命令与 `museum_act` 工具输入

## 决策

在现有 v1 契约中以可选会话字段增补 `gallery_id`、`station_id` 和故事返回点里的 `exhibit_return_point`。保留 `current_location_id`、既有故事字段、动作及其语义；新投影同时填充 `current_location_id` 与 `station_id`，旧投影仍可读取。只有导航启动和定位等新动作依赖新增字段，不强制旧客户端升级后才能查询或继续既有故事。

应用命令沿用 `request_id`、`expected_revision`、`expected_view_revision` 与 `interaction_epoch` 的并发控制。导航动作必须提交当前 `expected_view_revision`，并且 MCP 导航调用必须提交 `interaction_epoch`；服务端以一个原子命令更新站点与焦点，过期修订或轮次拒绝执行。`enter_gallery` 的 `target_id` 是展厅 ID，`locate_artifact` 的 `target_id` 是文物 ID；前端坐标不作为导航目标。

故事返回点沿用已有的问答／故事检查点，在可选的 `exhibit_return_point` 中记录展厅、展位、聚焦文物和观察角度。旧故事返回点可以没有该字段；从长廊进入的新故事应保存它，返回时恢复原展位及视角。

## 兼容策略

- v1 的既有动作与既有必填字段不变；所有新增会话字段均可选，旧投影继续有效。
- 新动作只由明确支持它们的客户端发出，导航命令需携带视图修订号；MCP 导航调用还需携带交互轮次。
- `current_location_id` 在完成存档迁移前继续保留，并由新写入同时投影为 `station_id`；不会在读取旧存档时猜测展位或伪造历史进度。
- 不增加朝代专用工具。展厅及其展位来自会话已固定的已发布内容包。

## 后续实现约束

本ADR只确定数据与并发契约，不表示导航状态迁移、SQLite迁移或小智真实调用已经实现。领域规则与事务接入分别在导航及存档PR完成；MCP接入证据仍需使用真实设备验证。
