# 时空博物馆

《时空博物馆》以真实文物观察、历史故事、开放追问和角色体验组成可持续扩展的数字展览。当前已有内容、会话与游戏接口等工程基础，网页已有会话与目录操作界面，长廊主界面待实现。最新产品方案是：语音驱动的文物时间长廊，近大远小，靠近自动加载真实三维文物，请求故事后才展示人物与插画；完整体验尚待实现。

## 开发文档

- **[长廊式语音游玩开发手册 v2.1](docs/时空博物馆-长廊式语音游玩开发手册.md)**：最新游玩方式、首屏与自动加载规则、语音/MCP衔接、逐文件职责、CW细粒度PR与验收标准。产品体验以此为准。
- **[AI开发任务卡与PR规范](docs/时空博物馆-AI开发任务卡.md)**：直接交给AI执行；逐卡写明前置、文件、改动、验证、完成条件及中文feat标题。
- **[用户检查与交付清单](docs/时空博物馆-用户检查与交付清单.md)**：H0—H8检查时间点、口语脚本、画面/音频预期与失败判据。
- [实际开发与验收进度](docs/acceptance/开发进度.md)：已有实现、PR证据和用户检查结论。
- [架构设计](docs/时空博物馆-架构设计.md)：模块职责、依赖方向与长期约束。
- [工程开发手册](docs/时空博物馆-开发手册.md)：保留既有模块拆分、制作流程和提交规范；首屏与玩法按v2.1执行；本轮工作项按AI任务卡领取。
- [唐朝全馆素材盘点与下载](docs/时空博物馆-唐朝全馆素材盘点与下载.md)：19个模型文件的当前盘点入口。
- [新增文物与素材验收](docs/时空博物馆-新增文物与素材验收.md)：前一轮八件模型的阶段快照。
- [手动补充模型验收](docs/时空博物馆-手动补充模型验收.md)：铜镜、卧牛与敦煌菩萨的结构检查记录。
- [公共契约](contracts/README.md)：内容包、文物、故事、会话命令与生成传输类型。
- [《大唐来信》贯穿主线](docs/时空博物馆-大唐来信贯穿主线.md)：十章作者稿与事实边界。
- [唐朝文物与情节](docs/时空博物馆-唐朝文物与情节.md)：文物身份、来源与支线编排。

研究元数据见 `research/`。按开发手册的小步工作项逐项交付。计划号用于区分工作范围，不代表GitHub PR编号；实现状态以实际PR和验收记录为准。作者原稿与本机素材的导入、审核和正式发布按AI任务卡CW13系列执行。

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

当前检查 YAML 形状和包内引用完整性，并可编译候选 JSON；不会发布。跨包引用必须在作者包 `manifest.yaml` 的 `dependencies` 中声明精确的 `pack_id` 与 `version`，并对每个可用依赖重复传入 `--dependency-pack`。工具检查依赖闭包、版本和循环；未声明包不能提供引用目标。

```yaml
dependencies:
  - pack_id: iq.abbasid.core
    version: 0.1.0
```

仓库已有 `content-src/packs/cn-tang/` 三物作者包，当前manifest为draft 0.2.0；校验/编译不等于已发布。

```powershell
uv run --package museum-content-pipeline content-pipeline build --pack <作者包目录> --dependency-pack <依赖包目录> --out <候选JSON目录>
```

编译会先完整校验，按源稿相对路径写出 JSON，不联网补充史实，也不覆盖发布目录。

写入不可变版本目录（已存在的包版本会失败）：

```powershell
uv run --package museum-content-pipeline content-pipeline stage --pack <作者包目录> --dependency-pack <依赖包目录> --out <版本化内容根目录>
```

需要多个依赖时重复 `--dependency-pack`。`stage` 会按 `包ID/版本` 写出规范 JSON 和哈希清单，并为每个直接依赖记录稳定源文档哈希；不覆盖已有版本。这不是面向玩家的发布。
