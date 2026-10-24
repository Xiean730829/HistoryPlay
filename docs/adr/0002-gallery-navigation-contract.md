# ADR 0002：长廊导航契约与兼容迁移

- 状态：接受
- 日期：2026-10-24
- 范围：会话投影、应用命令与 `museum_act` 工具输入

## 决策

在现有 v1 契约中以可选会话字段增补 `gallery_id`、`station_id`、`camera_pose` 和根级 `exhibit_return_point`。根锚点独立于故事内问答 `return_stack`，只在从长廊探索首次进入故事时建立。保留 `current_location_id`、既有故事字段、动作及其语义；新投影同时填充 `current_location_id` 与 `station_id`，旧投影仍可读取。

应用命令沿用 `request_id`、`expected_revision`、`expected_view_revision` 与 `interaction_epoch` 的并发控制。导航动作必须提交当前 `expected_view_revision`，并且 MCP 导航调用必须提交 `interaction_epoch`；服务端以一个原子命令更新站点与焦点，过期修订或轮次拒绝执行。`enter_gallery` 的 `target_id` 是展厅 ID，`locate_artifact` 的 `target_id` 是文物 ID；前端坐标不作为导航目标。

从长廊进入的新故事在会话级 `exhibit_return_point` 保存展厅、展位、聚焦文物、相机目标和视图修订号；`return_to_exhibit` 以单一命令恢复该位置和视角并清除已退出的故事状态。故事内问答继续使用原 `return_stack`。旧存档没有新增JSON键时读取为默认相机及无根锚点，不推测历史展位；旧故事仍可继续，但无法执行故事回展台动作。

## 兼容策略

- v1 的既有动作与既有必填字段不变；新增会话字段均可选，旧投影继续有效。SQLite状态保存在JSON快照中，本次只增加可选键，不改变表结构；旧JSON可直接读取。
- `enter_gallery`、移动、定位、`set_view`及`return_to_exhibit`命令需携带视图修订号；MCP导航调用还需携带交互轮次。
- `current_location_id` 在完成存档迁移前继续保留，并由新写入同时投影为 `station_id`；不会在读取旧存档时猜测展位或伪造历史进度。
- 不增加朝代专用工具。展厅及其展位来自会话已固定的已发布内容包。

## 后续实现约束

本ADR确定数据与并发契约；CW04c负责领域规则、命令事务、JSON快照兼容和投影接入，不需要表结构迁移。MCP接入证据仍需使用真实设备验证。
