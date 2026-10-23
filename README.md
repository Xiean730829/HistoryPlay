# 时空博物馆

《时空博物馆》以真实文物观察、历史故事、开放追问和角色体验组成可持续扩展的数字展览。当前已建立网页与游戏服务的最小本地运行链路；展厅内容与游戏交互尚未实现。

## 开发文档

- [架构设计](docs/时空博物馆-架构设计.md)：模块职责、依赖方向与长期约束。
- [开发手册](docs/时空博物馆-开发手册.md)：文件归属、实施顺序、PR范围与验收标准。
- [唐朝全馆素材盘点与下载](docs/时空博物馆-唐朝全馆素材盘点与下载.md)：19个模型文件的当前盘点入口。
- [新增文物与素材验收](docs/时空博物馆-新增文物与素材验收.md)：前一轮八件模型的阶段快照。
- [手动补充模型验收](docs/时空博物馆-手动补充模型验收.md)：铜镜、卧牛与敦煌菩萨的结构检查记录。
- [公共契约](contracts/README.md)：内容包、文物、故事、会话命令与生成传输类型。

研究元数据见 `research/`。按开发手册的小步工作项逐项交付。计划号用于区分工作范围，不代表GitHub PR编号；实现状态以实际PR和验收记录为准。主线与文物故事依据另见计划号00-b；素材盘点与验收记录另见计划号00-c。

## 本地启动

需要 Node.js 24、Python 3.12或更高兼容版本，以及 [uv](https://docs.astral.sh/uv/getting-started/installation/)。

```powershell
npm ci
uv sync --all-packages --dev
uv run python tools/dev/run_local.py
```

网页默认在 `http://127.0.0.1:5173`，游戏服务健康检查在 `http://127.0.0.1:8780/health`。启动器从进程环境读取配置，不会自动加载 `.env.local`。运行 `npm run check` 可检查网页类型和生产构建。

作者源稿按公共 Schema 校验：

```powershell
uv run --package museum-content-pipeline content-pipeline validate --pack <作者包目录>
```

当前检查 YAML 形状和包内引用完整性，并可编译候选 JSON；不会发布。仓库里还没有 `content-src/packs/` 作者包。

```powershell
uv run --package museum-content-pipeline content-pipeline build --pack <作者包目录> --out <候选JSON目录>
```

编译会先完整校验，按源稿相对路径写出 JSON，不联网补充史实，也不覆盖发布目录。

写入不可变版本目录（已存在的包版本会失败）：

```powershell
uv run --package museum-content-pipeline content-pipeline stage --pack <作者包目录> --out <版本化内容根目录>
```

`stage` 会按 `包ID/版本` 写出规范 JSON 和哈希清单，不覆盖已有版本。这不是面向玩家的发布。
