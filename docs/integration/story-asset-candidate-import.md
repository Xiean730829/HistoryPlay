# 故事场景素材候选导入

`import-story-asset-candidate` 从本机生成批次的 `manifest.local.json`、`replacement-assets.json` 和 `content/scene-bindings.json` 解析一张明确选中的场景图。导入会读取图片并重算SHA-256；不复制图片、不改作者稿、也不把候选写进运行时包。候选清单中的 `relative_path` 相对于 `--source-root`，来源图片应保留在本机素材批次。

首段造像碑故事镜头的命令示例：

```powershell
uv run --package museum-content-pipeline content-pipeline import-story-asset-candidate `
  --source-root "<本机素材批次目录>" `
  --pack content-src/packs/cn-tang `
  --binding-key A04 `
  --story-id cn.tang.story.votive-stele `
  --node-id cn.tang.node.votive-stele.01 `
  --out content-src/packs/cn-tang/imports/story-media-candidates.json
```

导入器会从`--pack`验证目标故事存在、节点属于故事且节点ID唯一。当前清单只把A04选中的“石头与纸上的证据”候选绑定到造像碑故事首节点。素材历史核查和美术方向审核状态仍为待审；它不是人物立绘授权，也不是正式发布素材。`story-media-candidates.json` 是审核工作记录，不符合运行时资产Schema，编译器不会自动载入。

审核通过后仍需单独把合格图片纳入内容包、为对应节点声明故事场景资产，并验证进入故事时显示、返回展台后卸载。未经人工审核不得将候选状态改成已批准或已发布。
