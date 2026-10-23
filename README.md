# 时空博物馆

《时空博物馆》以真实文物观察、历史故事、开放追问和角色体验组成可持续扩展的数字展览。当前已建立网页与游戏服务的最小本地运行链路；展厅内容与游戏交互尚未实现。

## 开发文档

- [架构设计](docs/时空博物馆-架构设计.md)：模块职责、依赖方向与长期约束。
- [开发手册](docs/时空博物馆-开发手册.md)：文件归属、实施顺序、PR范围与验收标准。

按开发手册的小步工作项逐项交付。计划号用于区分工作范围，不代表GitHub PR编号；实现状态以实际PR和验收记录为准。

## 本地启动

需要 Node.js 24、Python 3.12或更高兼容版本，以及 [uv](https://docs.astral.sh/uv/getting-started/installation/)。

```powershell
npm ci
uv sync --all-packages --dev
uv run python tools/dev/run_local.py
```

网页默认在 `http://127.0.0.1:5173`，游戏服务健康检查在 `http://127.0.0.1:8780/health`。启动器从进程环境读取配置，不会自动加载 `.env.local`。运行 `npm run check` 可检查网页类型和生产构建。
