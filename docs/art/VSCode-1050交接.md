# VSCode 10:50 内容接入交接

更新时间：2026-10-25 10:30（北京时间）｜工作树：`C:\Users\21711\.grok\worktrees\cw08b-story-frames`｜分支：`codex/cw08b-story-frames`（从 `origin/main` `6954175` 分出）

本轮只改内容与素材清单，不改运行模块、Schema、锁文件或总进度台账。大图和 GLB 留在 D 盘，不提交二进制。独立路径映射见同目录 `vscode-1050-asset-sources.json`，供集成者构建**新**联调包，不要覆盖已有 published 版本。

图片候选状态如实保留为待审核，未改成 approved。

## P0 三物六幅故事画面（本批先交）

沿用现有 `.01`、`.02` 节点 ID 与返回出口。每节点 `presentation.capability: comic`，绑定一张对应场景图。无真实音频，未填 `audio_asset_id`。

| artifact_id | story_id | node_id | asset_id | 本机路径 | 尺寸 | 字节 | SHA256 | 来源/审核 | 已验证 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cn.tang.artifact.votive-stele | cn.tang.story.votive-stele | cn.tang.node.votive-stele.01 | cn.tang.asset.votive-stele.story-01 | D:\7\History\story-backgrounds\v1\votive-stele-01.png | 2048×1152 | 5216895 | 4604992c82fb97ea9fff5ea2000bd2c1df9993192609a3158343889637ff3307 | 专用故事插画；石作场景为虚构，不复制馆藏碑。审核：candidate / history_and_art_direction_pending | 是：文件可读、哈希、与讲稿对应（石作，非模型截图） |
| cn.tang.artifact.votive-stele | cn.tang.story.votive-stele | cn.tang.node.votive-stele.02 | cn.tang.asset.votive-stele.story-02 | D:\7\History\story-backgrounds\v1\votive-stele-02.png | 2048×1152 | 4770618 | 299b7e0c751b4c15be41db486b7fdde7a41e9d9776932040a1ebea01ead8be23 | 专用故事插画；家庭礼佛为虚构，非真实供养人。审核：candidate / pending | 是：简化一佛二菩萨示意，非 Mia 2021.34 复制 |
| cn.tang.artifact.kaiyuan-coin | cn.tang.story.kaiyuan-coin | cn.tang.node.kaiyuan-coin.01 | cn.tang.asset.kaiyuan-coin.story-01 | D:\7\History\story-backgrounds\v1\kaiyuan-coin-01.png | 2048×1152 | 5443891 | 921f92c9c29e1a6fcc92ca6cc7f920bdc56ba26b7f937af7dfe6c505e308d7cb | 专用故事插画；市集用钱为虚构，非本件馆藏钱。审核：candidate / pending | 是：与本件 718—732 / 类型 621 讲稿对应 |
| cn.tang.artifact.kaiyuan-coin | cn.tang.story.kaiyuan-coin | cn.tang.node.kaiyuan-coin.02 | cn.tang.asset.kaiyuan-coin.story-02 | D:\7\History\story-backgrounds\v1\kaiyuan-coin-02.png | 2048×1152 | 4884082 | 4687843f3bd491d0c1279ebe8856ce4cf36b4dd9cac32880070020de577c830d | 专用故事插画；铺面穿钱为虚构。审核：candidate / pending | 是：与“本件年代 ≠ 类型始铸”讲稿对应 |
| cn.tang.artifact.gilt-bronze-bull | cn.tang.story.gilt-bronze-bull | cn.tang.node.gilt-bronze-bull.01 | cn.tang.asset.gilt-bronze-bull.story-01 | D:\7\History\story-backgrounds\v1\gilt-bronze-bull-01.png | 2048×1152 | 4857083 | 2c153f14bab08ccbad706535b5579b243fb6542c86e0e10d0215e506d0a99fd2 | 专用故事插画；书案镇纸为馆方用途示意，不指认主人。审核：candidate / pending | 是：卧牛为示意，非 Cleveland 1985.74 复制 |
| cn.tang.artifact.gilt-bronze-bull | cn.tang.story.gilt-bronze-bull | cn.tang.node.gilt-bronze-bull.02 | cn.tang.asset.gilt-bronze-bull.story-02 | D:\7\History\story-backgrounds\v1\gilt-bronze-bull-02.png | 2048×1152 | 4936100 | e24641d2af5e1834ca5524a49d9910dcae109b11c70e815521c84b226d5f3250 | 专用故事插画；压纸动作为创作。审核：candidate / pending | 是：不指认真实使用者 |

未采用 `generated/2026-10-24-tang-r02` 中 A04「石头与纸上的证据」、A07「把约定说清」等 58 张选用图：那些是章节/支线主题图，不是当前 `.01/.02` 双幕讲稿的专用镜头。现有 `imports/story-media-candidates.json` 仍是候选审核记录，未改成 approved，也未写入运行节点。

未填音频。未改节点 ID、未改返回出口。未提交 PNG。

## 已有三物展示资源（路径映射一并给出，供新联调包）

| artifact_id | asset_id | 本机路径 | 状态 |
| --- | --- | --- | --- |
| cn.tang.artifact.votive-stele | cn.tang.asset.votive-stele.preview / .display | D:\7\History\previews\votive-stele.png ；D:\7\History\display\votive-stele\display.glb | 已在作者包；哈希与现有 YAML 一致 |
| cn.tang.artifact.kaiyuan-coin | cn.tang.asset.kaiyuan-coin.preview / .display | D:\7\History\previews\kaiyuan-coin.png ；D:\7\History\display\kaiyuan-coin\display.glb | 同上 |
| cn.tang.artifact.gilt-bronze-bull | cn.tang.asset.gilt-bronze-bull.preview / .display | D:\7\History\previews\gilt-bronze-bull.png ；D:\7\History\display\gilt-bronze-bull\display.glb | 同上 |

源 GLB（`lod: source`）不写入联调网页清单；需要时仍在 `D:\7\History\models\`。

## P1 扩馆范围（10:35 锁定，另 PR）

`D:\7\History\display\` 目前只有上述三件展示版。其余 16 个 GLB 文件存在、候选卡已生成，但**没有可用 display/preview**，本半小时不重新优化模型，不写入运行展厅。

详见后文「三种状态」。照片展品 Met 长沙窑碗仅有 `D:\7\History\images\met_1986.97.3\` 两张开放照片，尚未入运行包。

## 集成注意

1. 用 `docs/art/vscode-1050-asset-sources.json` 作为新联调包的 sources，版本号另选，不要覆盖 `0.2.1` 或其他已 published 目录。
2. 故事图是 `kind: comic`，不是 preview，不要拿预览 PNG 或网页截图顶故事背景。
3. 本交接不操作语音桥、设备配对或用户会话。
