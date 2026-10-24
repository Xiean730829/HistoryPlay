# 公共契约

本目录是网页、游戏服务、MCP 和内容制作共用的 JSON Schema。跨语言类型从这里生成，不手写第二份语义。

当前 Schema 版本为 `1`，文件使用 JSON Schema 2020-12。顶层 `$id` 与文件名保持稳定。

| 文件 | 用途 | 计划号 |
| --- | --- | --- |
| `schemas/v1/common.schema.json` | 命名空间 ID、年代区间、事实等级与能力 ID | 02-a |
| `schemas/v1/content-pack.schema.json` | 内容包身份、地域、时间范围、能力与发布状态 | 02-a |
| `schemas/v1/artifact.schema.json` | 真实物件身份；数字模型另见资产契约 | 02-a |
| `schemas/v1/asset.schema.json` | 逻辑资产 ID、哈希、许可、LOD 与降级 | 02-a |
| `schemas/v1/source.schema.json` | 来源定位，不是无主张的链接列表 | 02-a |
| `schemas/v1/fact-card.schema.json` | 主张、事实等级、适用时间与来源 ID | 02-a |
| `schemas/v1/story.schema.json` | 故事入口、节点列表与展品返回 | 02-b |
| `schemas/v1/story-node.schema.json` | 片段、画面、讲解、有限动作、条件与出口 | 02-b |

公开样例在 `examples/v1/`。样例不含密钥、本机盘符或未授权路径。

公元前年份使用天文年编号：公元前 1 年为 `0`，公元前 2 年为 `-1`。显示层再转成纪年标签。不同地区的时间范围允许重叠；不把中国朝代写成唯一时间轴。
