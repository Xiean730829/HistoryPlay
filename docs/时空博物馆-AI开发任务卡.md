# 时空博物馆：AI开发任务卡与PR执行规范

版本：1.0｜日期：2026-10-24｜适用：长廊式语音参观首版

本文是可以逐项交给AI开发的执行清单，配合[产品与模块手册](./时空博物馆-长廊式语音游玩开发手册.md)和[用户检查与交付清单](./时空博物馆-用户检查与交付清单.md)使用。产品手册定义体验，本文定义每个PR做什么，检查清单定义何时交给用户看、听、说。旧工程手册里的历史任务号不再用来领取本轮任务。

## 1. 领取任务的方法

每次只领取一张卡。先核对分支和已合并实现；只有代码审查、相应验证与证据齐全，才把任务状态更新为“工程通过”。涉及用户检查的任务，还要等对应检查结果才能写“体验通过”。文件存在、提交标题相同、CI绿色都不能直接证明体验通过。

可直接复制以下指令，把任务号替换为本次要做的编号：

```text
请执行 docs/时空博物馆-AI开发任务卡.md 中的【任务号】。
先读该卡、公共执行规范、产品手册相关模块，以及用户检查清单中的对应检查点。
先报告当前实现、依赖是否满足、会修改哪些文件；已有实现先复核，不重复建立同职责模块。
只完成这张卡的一个可审查结果。共享目录里别人的未提交改动不要覆盖、暂存或提交。
实施后运行卡内指定检查，记录实际结果、未验证项和必要的录屏/日志位置。
更新 docs/acceptance/开发进度.md，使用该卡指定的中文 feat PR标题和commit标题。
用独立分支提交细粒度PR；未通过的用户检查如实标记，不自行代替用户签收。
不要自动合并PR。若当前环境不能推送或建PR，保留可审查提交并说明具体缺项。
```

用户检查未反馈时，继续不依赖该结论的任务；不把沉默记为通过。自动化、资料导入和其他独立工作不需要因此全部停下。用户后续调整检查顺序时，以最新指令为准。

## 2. 公共执行规范

### 2.1 分支、PR与提交

- 每卡一个分支，格式 `codex/cw05b-corridor-screen`，从项目实际目标分支或已说明的前置PR创建。不假定目标分支一定叫main；先核对远端默认分支。
- 每PR交付一个可描述的行为。通常控制在约6—10个手写文件、400行左右；超过12个文件或800行时先拆分，必要的Schema、生成类型、样例可同PR并解释。纯内容关联文件也要说明范围，不能借机改运行时。
- PR标题与每个普通commit都使用卡内的 `feat(中文范围): 中文描述`。现有校验器还允许纯中文标题，但本轮采用更严格的feat约定。`codex/`仅用于分支名，不放进标题。
- 只暂存本卡明确修改的文件。禁止在共享工作区直接暂存全部改动，禁止为切分任务重置他人文件。已有相同职责实现优先扩展；路径调整须同时更新本文。
- PR正文写清：触发场景、玩家看到的结果、文件与模块、已运行检查、用户检查编号及状态、缺项、回退方法。多行正文写入临时文本再提交，保留真实换行。
- PR创建后记录实际链接；在支持任务附件的环境将PR附到当前任务。未创建的PR不填写虚构编号。

统一PR正文：

```markdown
本PR完成：
玩家说/做什么，之前怎样，现在怎样。

范围：任务号；前置PR链接；本次主要文件与职责。
验证：实际运行命令、结果；本地环境与证据路径。
用户检查：H编号；待检查/通过/需修改；反馈与证据。
未完成：明确列出，不把模拟语音记为真实语音通过。
回退：撤回本PR后如何回到原版本，是否涉及存档或资源版本。
```

### 2.2 目录缩写与依赖方向

以下缩写都相对仓库根目录，不是要求创建字面名称为W/B/P的目录。

| 缩写 | 实际目录 | 只负责 |
| --- | --- | --- |
| W | `apps/museum-web/src/` | 展示、输入适配、音频播放、服务端状态投影 |
| B | `services/museum/src/museum/` | 权威会话、导航规则、剧情、查询、事务 |
| S | `contracts/schemas/v1/` | 当前公共Schema；按ADR0002兼容增补 |
| P | `tools/content-pipeline/src/content_pipeline/` | 作者稿校验、编译、资源制作与清单 |
| C | `content-src/packs/cn-tang/` | 唐朝内容数据，不写业务代码 |
| V | `services/voice-bridge/src/voice_bridge/` | 小智设备、音频协议、连接与可信生命周期 |
| M | `services/mcp-gateway/src/museum_mcp/` | MCP工具、可信绑定、应用HTTP客户端 |

W的展示模块不导入小智供应商代码；M不导入B的领域或SQLite；领域不导入HTTP、MCP、音频库；P不成为玩家运行时依赖。修改会话只能走统一命令服务，查询不能推进故事。新增模块时补边界检查，不能把当前有限检查覆盖当作已经自动保证所有边界。

W已有 `application/museumApi.ts`、`presentation/MuseumShell.tsx`。继续使用前者承载HTTP，不另建同职责的 `api/museumClient.ts`；后者改成组装入口，旧目录操作移到开发模式。后续若拆成 `App.tsx`，须替代原入口，不能保留两套玩家状态。

### 2.3 实际可用的检查命令

这些命令来自当前仓库配置；本轮编写文档没有运行整套代码测试，也不宣称当前分支已全部通过。

| 检查组 | 在仓库根执行 | 用途 |
| --- | --- | --- |
| QW | `npm run check` | TS类型与生产构建；不包含浏览器行为测试 |
| QC | `uv run python tools/dev/generate_contracts.py --check` 和 `uv run pytest tests/contracts -q` | 契约生成一致性与样例 |
| QP | `uv run pytest tests/content -q` | 制作器、引用与包构建 |
| QD | `uv run pytest tests/domain -q` | 导航、会话、故事、存储规则 |
| QA | `uv run pytest tests/application -q` | 应用命令、查询、HTTP |
| QB | `uv run python tools/dev/check_boundaries.py` | 已配置的导入边界 |
| QL | `uv run ruff check services/museum tools/dev packages/contracts-python tools/content-pipeline` | 当前CI的Python静态检查范围 |
| QG | `git diff --check` | 差异中的空白错误 |

首次安装用 `npm ci`、`uv sync --all-packages --dev`。Schema变更先执行 `uv run python tools/dev/generate_contracts.py`，然后QC。每卡运行相关组；合并前运行当前完整CI。新增V/M包时把其源码加入QL、编译、测试与边界检查，不能让新服务游离于CI。

提交后使用实际基线引用运行：`uv run python tools/dev/check_pr_scope.py --base <基线引用>`、`uv run python tools/dev/check_commit_titles.py --base <基线引用> --title '<本卡标题>'`。尖括号是待替换项，不是可直接执行的参数。现有范围检查只是提示，并非强制阻止大PR。

前端目前没有测试运行器。CW03b负责新增并固定Vitest后，才允许使用新增的 `npm run test:web -- --run`；CW14b负责新增Playwright后才使用 `npm run test:e2e`。两条都是交付目标，当前不能假装存在。涉及音频、长廊或模型的行为测试要验证状态/竞争条件，不做只复制实现公式的无效断言。

### 2.4 统一完成与回退条件

每卡：实现＋有意义的相关检查＋更新进度记录＋中文commit/PR＋如实的验收状态，缺一项就不能写“全部完成”。检查只需在修改后有效运行；无新改动无需机械重复全量测试。

无存档结构变化时撤回单个PR即可回退。存档任务先备份本机数据库，测试旧记录和新记录，不采用删除数据库“迁移”；数据任务发布新内容版本，撤回时切回旧版本，新旧会话继续固定各自版本；素材衍生版保留原件、哈希及署名。带持久化变化的PR必须写自己的具体回退方案。

## 3. 当前基线与执行顺序

2026-10-24核查工作分支 `walk`，看到以下提交。这里只表示“已有实现待复核”，不表示已合并、CI通过或用户验收。

| 卡 | 看到的提交 | 还要核对 |
| --- | --- | --- |
| CW01a | `1dc7012` 展厅展位契约 | 校验器、样例、生成与兼容 |
| CW01b | `06cfae4` 导航返回协议 | Schema有动作不等于动作已实现；相机存档与根返回点仍需补齐 |
| CW02a | `474eb9a` 三个真实文物展位 | 当前包是draft 0.2.0，不是已发布可玩的全馆 |
| CW03a | `0d7e46d` 长廊与可见展品投影 | 服务端顺序与真实屏幕顺序的一致性 |
| CW04a | `ca05fc4` 前进后退边界 | 当前仅见进入展厅/前后移动实现，远处定位和故事原位返回另做 |
| CW04b | `8382b2b` 远处文物原子定位 | 已有 locate 实现待复核；未知/多目标与可见性约束仍需按卡验收 |
| CW04c | `4d5b009` 展台返回点 | 已有根锚点实现待复核；旧存档兼容与H4画面仍待用户检查 |

其余卡默认“待实施/待盘点”。每次领任务重新读HEAD；其他开发者可能已推进。状态台账放 `docs/acceptance/开发进度.md`，以实际PR及检查链接更新，不能让本文静态快照决定是否重写。

今天按以下顺序推进，晚上目标是可实际参观的唐朝版本；不能仅凭任务排好就保证全部开发在今晚完成。

1. 文档时段：交付本文、产品手册与用户检查清单；用户确认H0。同步先做CW09p能力探针，尽早暴露账号/MCP/指定文稿/取消限制。
2. 基础闭环：复核已有CW01a/b、02a、03a、04a；补CW01c、02b/c/d/e、03b/c/d、04b/c、05a/b、06、07a/b/c。H1/H2/H3依次检查画面、移动、真模型。
3. 语音与故事：CW08a/b、09a/b/c、10a/b、11a/b、12a/b，完成H4/H5/H6。基础闭环期间可独立做资料导入，未完成真实语音隔离不宣称完成语音产品。
4. 扩馆：CW13a、CW13b系列、CW13c系列、CW13d/e；海外比较先做CW01d/e，完成H7。三个文物只是联调切片，最终素材目标仍是19个已取得模型对应资源、20份卡片和贯穿唐朝的10章故事。
5. 晚间交付：CW14a/b/c、H8完整验收。若有失败项，交付已通过部分和具体剩余项，不能用目录页、文本输入、静默点击或虚构资料补成“全完成”。

工程路径可按数据、呈现、语音分工，但同一文件同一时间只由一个开发任务修改。`museumApi.ts`、`command_service.py`、公共Schema、锁文件与CI属于串行集成点；并行任务等前置PR落地后再接入。

## 4. 契约、资料与资源基础

### CW00｜feat(文档): 明确长廊体验与逐项开发验收

- **前置**：无。**文件**：本文、产品手册、用户检查清单、README、旧开发手册入口、`docs/acceptance/开发进度.md`。
- **实施**：统一开场长廊/真物自动加载/语音玩法；建立任务与H检查台账；消除旧目录页作为玩家入口的指令；将已有代码标记为待复核。
- **验证**：文档链接、任务依赖、必填检查项、QG；用户H0。**完成**：AI能找到某卡的文件、行为、检查和PR边界。**禁止混入**：游戏实现和重新生成插画。

### CW01a｜feat(契约): 定义长廊展厅与展位数据

- **前置**：CW00。**文件**：S的 `gallery.schema.json`、`content-pack.schema.json`，P的 `validation/schema_validator.py`、`validation/reference_validator.py`，契约样例、生成DTO与相关内容测试。
- **实施**：先复核已有提交；验证展厅开放状态、地域、默认站点、唯一order/主展位、稳定年代区间、比较资源引用；别名冲突能被报告；新字段不携带屏幕坐标。
- **验证**：QC、QP、QB、QL；用重复展位/缺失引用/未开放宋朝样例测试。**完成**：无歧义表达唐朝展厅；旧包仍能校验。**边界**：不接HTTP、不渲染首页；已有实现通过时仅登记证据，不造重复PR。

### CW01b｜feat(契约): 扩展语音导航与展台返回协议

- **前置**：CW01a。**文件**：S的 `common.schema.json`、`session.schema.json`、`command.schema.json`、`mcp-tools.schema.json`，生成DTO、样例、`docs/adr/0002-gallery-navigation-contract.md`。
- **实施**：复核已有enter_gallery/move_next/move_previous/locate_artifact/return_to_exhibit；应用命令与museum_act共用受限params；视图修订、轮次、票据规则一致；旧字段继续可读。
- **验证**：QC；缺target、缺view_revision、非法相机、过期轮次样例；区分Schema合法和业务允许。**完成**：协议可表达动作，不宣称已执行。**边界**：不删除可见性约束、不手改生成代码；已有实现通过只登记。

### CW01c｜feat(契约): 定义文物展示与固定讲稿资源绑定

- **前置**：CW01a/b。**文件**：S的 `artifact.schema.json`、`asset.schema.json`、`story-node.schema.json`（如需），生成DTO、契约样例、P引用校验与测试。
- **实施**：在现有asset_ids之外增加可选的语义绑定：真实预览、展示版模型/照片、默认相机、一行引子、背景文稿引用；故事片段正文/音频使用稳定引用；不凭asset_ids第一项猜用途。先盘点已有node字段，复用正文和能力结构，避免两份正文。
- **验证**：QC、QP；旧artifact仍有效，新artifact缺引用或照片假标model3d应报错；资源URL不写D盘路径。**完成**：前端知道加载哪张预览和哪个GLB，讲解知道读哪段文字。**边界**：不在此卡批量搬运素材或发TTS请求。

### CW01d｜feat(契约): 固定跨馆比较内容的包依赖

- **前置**：CW01a；首批三物可不等待，伊拉克比较器导入前必须完成。**文件**：S/content-pack、P的reference_validator/compiler/pack_writer、生成DTO、相关契约/内容测试。
- **实施**：为可选依赖定义精确pack_id/version；伊拉克器物保留独立 `iq.abbasid.*` 内容包，唐朝展位通过已声明依赖引用；编译时从显式依赖根校验依赖存在/版本/循环，当前命名空间检查继续约束本包自有ID，不简单关闭；清单保留依赖哈希。
- **验证**：QC/QP；无依赖的旧包正常、缺版本/循环/未声明跨包引用失败、海外器不改名前缀。**完成**：制作器能合法编译跨馆比较。**边界**：本卡不改会话创建，运行时由CW01e接入。

### CW01e｜feat(会话): 固定跨包展品的运行时依赖版本

- **前置**：CW01d。**文件**：B的published_catalog、ports/content_catalog、session_routes、query_service必要映射，`tests/content/test_published_catalog.py`、`tests/application/test_http_api.py`。
- **实施**：服务端解析可用且经批准的依赖闭包，创建会话时一次写pack_versions；缺依赖拒绝创建，不运行中偷取最新版；同名资源按稳定命名空间引用，依赖内容退休不静默换版。
- **验证**：QP/QA；根包＋海外包同会话可读、旧会话版本不变、依赖缺失/循环/不允许状态明确失败。**完成**：比较展位可查可进且对象身份不被改写。**边界**：不新增国际馆专用页面/MCP，不把pack_id让LLM自由指定作为权限来源。

### CW02a｜feat(内容): 编排三个真实文物展位

- **前置**：CW01a/b。**文件**：C的现有manifest、galleries/main、三件artifacts/assets/facts/sources/stories/nodes；`tests/content/test_cn_tang_pack.py`。
- **实施**：复核造像碑→开元通宝→鎏金卧牛的三个展位，主展位唯一；本件钱币718—732与币制始于621分别保存；卧牛按8世纪宽断代，重叠年代说明策展顺序；故事是创作不声称真主人。
- **验证**：QP及本包validate/build；现有manifest 0.2.0为draft，不能直接当发布完成。**完成**：三件真实身份与最小故事引用可用。**边界**：不把预写故事全部塞入一张长文卡；已有提交通过只补后续媒体引用。

### CW02b｜feat(素材): 导出真实模型的长廊预览

- **前置**：CW01c、CW02a。**文件**：P新增 `assets/model_preview.py`、`assets/preview_manifest.py`，P的cli，`tests/content/test_model_preview.py`；C三件preview资产与framing。
- **实施**：使用实际GLB离线渲染透明或可无缝融入展台的预览；固定渲染器版本、相机、环境、尺寸，记录输入哈希/输出哈希/署名；先做三件，再支持清单批量导出；无头渲染不可用时保留明确人工导出流程，不能用生图替代。
- **验证**：三件预览与真模型同物同朝向；透明边缘无底框；重复输入可复用；失败不输出成功记录。QP；H1预览。**完成**：三个展位可真实陈列。**边界**：新增CLI须在本PR给出实际用法，本文不虚构已有命令。

### CW02c｜feat(资源): 提供按清单访问的本机展示资产

- **前置**：CW01c。**文件**：P新增 `assets/stage_assets.py` 与cli；B新增 `ports/asset_store.py`、`adapters/assets/local_store.py`、`adapters/http/asset_routes.py`，`main.py`装配；`tests/application/test_asset_routes.py`。
- **实施**：建立asset_id→哈希/格式/大小/本机来源映射，校验后复制到版本化资源根；网页只拿受控URL；响应正确MIME/缓存/必要跨域，校验资源引用；禁止URL任意读本机文件或路径穿越；不经MCP传GLB。源路径只在忽略的本机配置。
- **验证**：真实PNG/GLB字节哈希一致、404、路径穿越拒绝、发布清单缺文件失败；QP/QA/QB/QL。**完成**：网页能读取本地真实资产而非外部临时地址。**边界**：不混入模型优化或UI；若超过范围，先拆资产stage，再接HTTP两个PR。

### CW02d｜feat(素材): 准备首批文物的网页展示版模型

- **前置**：CW02a/c。**文件**：P新增 `assets/model_profile.py`，三件资产衍生清单与来源记录；生产二进制在D盘/版本资产根，不进普通Git。
- **实施**：造像碑、钱币、卧牛逐件测大小/面数/贴图；保留原件，记录减面/纹理压缩方法；必要的解码器同版本本地供应；配默认朝向，预览与加载后模型大小对齐。卧牛原件约33.9MB须单独处理，不能宣称已达5—10MB目标。
- **验证**：近景纹理/残损/旋转、无丢贴图；记录源与展示版哈希、加载耗时、压缩尺寸与许可；H3。**完成**：三件有实际可用展示资产与性能记录。**边界**：不能为了压缩重画器物形状。

### CW02e｜feat(内容): 生成可直接启动的三物本机联调包

- **前置**：CW02a/c；预览/展示版逐步随CW02b/d加入。**文件**：P新增 `build/rehearsal_pack.py` 和cli，`tests/content/test_rehearsal_pack.py`，`docs/integration/本机联调启动.md`。
- **实施**：当前PublishedCatalog只接收published，不能把draft stage后就要求游戏能读。校验三件资料/创作标识、引用和资源后，显式生成仅在本机联调用的不可变包副本及工程发布清单，指定新的semver和本机资源根；保留作者draft不覆盖。候选故事的审核状态在清单与开发提示保留，runtime published只表示该隔离包可装载，不冒称全馆历史/用户审核通过。
- **验证**：QP/QA；stage后真能create_session、读gallery和资产；缺资源禁止成功；重复版本不覆盖。提供现有stage及新命令的真实参数、MUSEUM_CONTENT_ROOT与默认包版本配置。**完成**：后续H1/H2有直接可启动的入口。**边界**：不放宽正式PublishedCatalog读draft，不部署、不向外发布；H7后的正式版本另由CW13e交付。

## 5. 权威状态、查询与导航

### CW03a｜feat(查询): 提供长廊与可见展品投影

- **前置**：CW01a/b、CW02a。**文件**：B的 `application/query_service.py`、`application/mappers.py`、`ports/content_catalog.py`、`adapters/content/published_catalog.py`、HTTP session/helpers，相关query/http测试。
- **实施**：先复核已有gallery路由；按固定包版本读取，返回站点、稳定顺序、focus、允许动作及素材语义；区分gallery全部路线与当前实际可见display_order。搜索不等于把对象放到眼前。
- **验证**：QA/QP；查询前后revision不变；未开放展厅、缺包、分页、别名；顺序与H2画面核对。**完成**：只读上下文足够驱动参观。**边界**：可见窗口需与CW05a使用同一份离散窗口约定；不通过客户端任意上报重排权威顺序。

### CW03c｜feat(连接): 提供浏览器可用的事件通道握手

- **前置**：CW03a。**文件**：B新增 `application/event_tickets.py`，HTTP event_routes/session_routes/auth，`tests/application/test_event_handshake.py`；W/museumApi仅接签票调用。
- **实施**：原生浏览器WebSocket不能设置现有API需要的Bearer/绑定自定义头。通过已认证HTTP请求签发短期一次性握手凭证，作用域绑定session/connection/origin，WS消费后失效并继续现有事件通路；日志不输出凭证。短期票据与长期会话token分开，重连重新申请。
- **验证**：QA、真实浏览器握手；过期/重放/错误来源/错误会话/撤销绑定拒绝，after_seq重放不变。**完成**：前端实际能连接，不靠测试客户端自定义头掩盖问题。**边界**：不把长期session_token放查询串、不降低原API鉴权。

### CW03d｜feat(查询): 分段读取文物背景与故事正文

- **前置**：CW01c、CW03a。**文件**：B的query_service/mappers，新增HTTP `content_routes.py` 并在main装配；内容Schema有缺口按CW01c同步；`tests/application/test_content_read.py`。
- **实施**：按固定包版本/内容ID读取背景、故事节点及必要出处；使用有界页长和稳定cursor，不把完整故事塞context；复用现有fact接口，不重复保存narration。返回明确text/content_id/版本/段落序号/next_cursor及来源、创作属性，供网页和MCP共用。
- **验证**：QA/QP；读不改revision，非法ID/错版本/错cursor拒绝，字节预算与分页无漏段；图片/音频仍只返回资源引用。**完成**：museum_read_content与固定稿播放器有真实可调用HTTP。**边界**：不在查询里生成新剧情或执行continue。

### CW03b｜feat(网页): 接入会话投影与有序事件恢复

- **前置**：CW03a/c。**文件**：W的 `application/museumApi.ts`，新增 `state/sessionProjection.ts`、`state/commandDispatcher.ts`、`api/eventChannel.ts`；网页测试配置、package/锁文件及CI。
- **实施**：复用已有create/restore/pair；封装命令request_id和版本；接现有WebSocket events/after_seq，不另造轮询状态库；重连先补序/快照；只从权威事件和查询更新焦点。建立Vitest及 `test:web` 根脚本，加入CI。
- **验证**：QW、新增网页测试；重复事件、缺序、旧快照晚到、断线后恢复、重复提交不双走；使用CW03c的真实浏览器握手，不把长期token放URL。
- **完成**：只有一份服务端状态镜像，浏览器可实际连事件通道。**边界**：不先建大而全状态框架，不在展示组件复制业务状态。

### CW04a｜feat(导航): 实现展位前进后退与边界处理

- **前置**：CW01b、CW03a。**文件**：B的 `domain/gallery/navigation.py`、session/models、application/command_service、sqlite/session_repository及binding/helpers，已有gallery/domain/application测试。
- **实施**：复核现有相邻展位规则、enter_gallery/move_next/move_previous；原子更新gallery/station/focus/visible/order；保留事务、幂等、事件、轮次/票据校验；边界不越界且有明确结果。同一唐朝馆重复请求enter_gallery保留当前站位，不因欢迎语重置到入口；现有实现有差异则补一份修正PR。
- **验证**：QD/QA；同请求重试只走一次、两端边界、旧view/epoch被拒绝、未开放宋朝不动、SQLite往返。**完成**：权威位置正确。**边界**：已有通过实现只登记，不再建另一navigation_service来绕过command_service。

### CW04b｜feat(导航): 原子定位远处文物并保留可见性约束

- **前置**：CW04a。**文件**：B的navigation纯规则、command_service、query/search索引（有缺口才改）、相关domain/application测试。
- **实施**：实现locate_artifact：在已固定的开放展厅找主展位→计算可见窗口→一次提交站位与focus；未知/多个目标不随机选。区分工具search找ID与命令执行；继续保留普通focus_entity可见性约束。
- **验证**：QD/QA；隔两站指名卧牛、不可见对象定位、同名澄清、其他包/未开放目标拒绝、重复请求；H2在后续UI接入后验。**完成**：从钱币可跳到牛，焦点和位置不分裂。**边界**：不通过前端改DOM假定位。

### CW04c｜feat(会话): 保存文物视角并恢复故事前展位

- **前置**：CW04b、CW01b。**文件**：S/session（必要兼容增补）、B的session/models/transitions、command_service、sqlite/session_repository及下一号迁移、ADR0002、对应测试。
- **实施**：落实set_view的持久目标与view_revision；从explore首次进入故事就保存根展台返回点，不能塞进必须已有story_id的问答返回点导致循环；沿用exhibit_return_point命名，必要时在session增加可选根锚点并同步Schema/ADR，别再造exploration_anchor别名。return_to_exhibit恢复展厅/站点/focus/角度；故事内QA的return_stack另管片段。
- **验证**：QC/QD/QA；探究→故事→提问→恢复→退出、故事里直接指名另一物、旧存档无锚点兼容、异常版本、数据库迁移往返；H4。**完成**：回原物原位置原视角，刷新可读。**回退**：备份SQLite，不删除旧记录，旧程序若不能读新字段须恢复备份；写明迁移策略。

## 6. 长廊、三维与故事画面

### CW05a｜feat(展馆): 建立展位纵深投影与可见窗口

- **前置**：CW03a。**文件**：W新增 `gallery/corridorProjection.ts` 与测试，必要时补B的可见窗口投影及测试；数据窗口约定写入产品手册。
- **实施**：站点顺序转深度、位置、缩放、z序、明暗；裁剪负深度/超远展台；视觉窗口与服务端display_order一一对应，明确序号按左到右还是近到远；宽屏/窄屏遵守同一语义次序，不能“第二个”换物。
- **验证**：有意义的投影边界、遮挡和可见性测试，QW；固定三站调试图用于H1。**完成**：可重复的远近关系。**边界**：不让年份差直接决定巨大距离，不在内容写像素。

### CW05b｜feat(展馆): 用真实文物组成深邃长廊首屏

- **前置**：CW02b/c/e、CW03b、CW05a。**文件**：W的MuseumShell/main/style；新增 `gallery/MuseumCorridor.tsx`、`ExhibitStation.tsx`、`FloorTimeline.tsx`、`ArtifactCaption.tsx`、`styles/corridor.css`、`styles/tokens.css`。
- **实施**：首屏就是墙/地面/灯/展台/真物预览；年代沿地面；名、断代、故事引子小字；默认唐朝/服务配置版本，不让玩家输入包ID；创建/恢复绑定后自动进入唐朝展厅，同厅恢复保留站位。原ExhibitList仅开发模式保留。无人物海报/目录卡/大段标题；数据未就绪时仍有诚实的空间骨架。
- **验证**：QW；1366×768、1920×1080、390×844截图与H1；对比度/小字可读。**完成**：用户确认像进入博物馆。**边界**：H1未通过时可继续独立后端任务，先别批量复制未认可的展台视觉；不做3D建筑。

### CW06｜feat(展馆): 呈现前进后退和最新导航目标

- **前置**：CW04a/b、CW05b。**文件**：W新增 `gallery/CorridorMotion.ts`，MuseumCorridor、sessionProjection联动及测试。
- **实施**：权威站点变化→连续缓动；初次进入/刷新直接落稳定位置；新目标取消旧动画，已提交命令的“停下”收束当前权威站点；减少动态效果直接或轻过渡。动效期间不把中间帧当新焦点。
- **验证**：QW/网页行为测试；前后一步、快速三次改目标、方向反转、窗口缩放；H2录屏。**完成**：视野在走廊里推进，非文章滚动；无回闪或到错误文物。**边界**：不改剧情推进或音频。

### CW07a｜feat(文物): 靠近展台自动呈现真实三维模型

- **前置**：CW02d、CW05b、CW06。**文件**：W新增 `gallery/FocusedArtifact.tsx`、`capabilities/Artifact3D.tsx` 及必要TS声明，package/锁文件，展示测试。
- **实施**：固定model-viewer版本；透明背景对齐当前展台；自动加载/自动揭示，同位真预览替换为GLB；映射协议yaw/pitch/zoom到viewer单位，归一化角度/限制缩放；照片资源走照片能力，不能伪装可旋转。
- **验证**：QW/网页测试、真实浏览器三件模型、背面/近看/复位；H3。**完成**：没有加载按钮也可转动，长廊不随文物旋转。**边界**：不同时挂19个viewer，不把load事件当命令已提交。

### CW07b｜feat(资源): 取消过期加载并限制模型缓存

- **前置**：CW07a。**文件**：W新增 `capabilities/assetLoader.ts` 及测试，Artifact3D清理逻辑、开发诊断记录。
- **实施**：当前目标优先，邻近预取有界；目标generation关联，A晚到不盖B；不能中断的解码结果丢弃；缓存引用释放，退出卸载，预览/模型分别计量；慢网保留真预览且自动有限重试。
- **验证**：延迟A快到B、取消/卸载、断网/错误GLB、连续20站循环；QW/网页测试、H3/H8性能记录。**完成**：活跃viewer=1，内存无持续无界增长。**边界**：不预取全馆高模；性能目标按实测设备记录，不拿缓存热加载冒充冷加载。

### CW07c｜feat(呈现): 按实际画面确认文物呈现结果

- **前置**：CW03b、CW07a。**文件**：W新增 `capabilities/RenderReceiptReporter.ts`，museumApi；B现有render_service/render_routes（确有缺口才改）及测试。
- **实施**：关联已提交命令的request_id/digest/revision/view_revision/epoch；模型实际可见后rendered，预览/照片降级如实degraded，未完成pending；过期回执不能给当前文物背书；加载失败不由AI说成功。
- **验证**：QA/QW及网页测试；旧模型load、旧回执、提交成功呈现失败、刷新无当前命令的状态查询。**完成**：上下文区分已移动与可旋转。**边界**：不用再执行一次导航来重试确认；H3/H5检查口头确认与画面一致。

### CW08a｜feat(故事): 按请求展示人物场景并回到原展台

- **前置**：CW04c、CW07a、CW03d。**文件**：W新增 `story/ArtifactStoryStage.tsx`、`story/StoryFrame.tsx`，MuseumShell层组合与museumApi的故事查询调用、相关测试。
- **实施**：explore只显示物；enter_story后才挂人物/背景/字幕；保留锚点不让故事层另建进度；一段对应一个已提交节点；return_to_exhibit卸故事层恢复物件与相机；QA保留当前镜头。
- **验证**：QW/QA、先用三件小夹具；H4检查进入/提问/退出/再走。**完成**：故事是文物打开的一层，回来仍在同一物前。**边界**：不顺带实施TTS/任意生成剧情；无图片时不拿另一件图顶替。

### CW08b｜feat(素材): 绑定已审核人物与故事场景

- **前置**：CW01c、CW02c、CW08a。**文件**：P新增 `importers/story_assets.py`，C的故事image资产与节点引用；`tests/content/test_story_asset_import.py`。
- **实施**：读取本机manifest.local/replacement-assets/scene-bindings，按选定图ID导入，拒绝7张被替换原稿混入；保留哈希与候选审核状态；整张人物设定拼版不直接当立绘，先用审核后的整幅镜头或单独合格资源；先接一段验证再扩馆。
- **验证**：QP；每图ID唯一、文件可读、node引用一致、退出后故事图不留首屏；H4/H7。**完成**：当前镜头正确显示对应人/场景。**边界**：58个选用图ID不是58张已通过历史审查的正式资产；不再调用生图批量补首页。

## 7. 小智、MCP与真实语音闭环

### CW09p｜feat(接入): 验证小智工具语音与指定文本能力

- **前置**：CW00；可与资料/视觉任务并行，不等全UI。**文件**：新增 `tools/integration/xiaozhi_probe.py`、`docs/integration/xiaozhi-capabilities.md`、`docs/adr/0001-voice-control-routing.md`；仅必要的探针依赖清单。
- **实施**：只读检查旧工程 `C:/Users/21711/Documents/Xiaozhi_Web_Test/xiaozhi_web_test`；使用用户已授权账号/固定模拟设备，缺登录由用户本机处理；固定官方管道版本，核对实际MCP入口/工具发现/返回预算；测试指定句子朗读、abort、旧音频/旧工具晚到、来源关联。不能把hello加标志当接入证明。
- **验证**：H5预检，录下“调用诊断工具→播放给定句子→打断→旧任务迟到”；记录每项支持/不支持/未测及来源，不写账号秘密。**完成**：ADR选定可信的直连或自有控制路径、固定稿朗读路径。**边界**：不把探针接成正式游戏；直连不能隔离时优先保留MCP工具，改由可信本地编排调用，不降成点击确认。

### CW09a｜feat(语音): 提取网页采音和本地即时停止

- **前置**：CW09p路径结论。**文件**：W新增 `voice/VadController.ts`、`capture-worklet.js`、`PlaybackQueue.ts`、`voice-ui/VoiceEntry.tsx`，必要依赖与浏览器测试。
- **实施**：从旧工程按原许可提取采音/编码接口，不复制旧UI；首次权限/音频解锁，拒绝和设备断开有状态；检测speech_started先停止播放器和清空排队音频，再通知桥；支持耳机与扬声器回声条件记录。
- **验证**：QW/网页测试；真实麦克风/拒绝权限/重开设备/停止后不漏播旧帧；H5/H6。**完成**：能听到真实输入，本地插话立即止声。**边界**：本地VAD不是云端轮次ID，不据字幕直接推进游戏。

### CW09b｜feat(语音): 接通固定小智设备和双向音频

- **前置**：CW09p、CW09a。**文件**：新V包的 `config.py`、`xiaozhi_client.py`、`codec.py`、`persistence.py`、`main.py`、pyproject，W的 `voice/VoiceClient.ts`，uv/锁文件/CI与边界规则、`tests/voice/test_device_bridge.py`。
- **实施**：稳定设备身份、hello/音频协议、编解码、双向WS、断线退避；私密值在本机配置，浏览器只接本机受控桥；新增包才登记uv成员；重连不创建新的游戏会话/设备。检查本机av/Opus等依赖能实际安装。
- **验证**：无账号模拟器自动测试＋真实账号H5；记录端到端听说、断线重连、设备身份未改变；QW及新增包静态/测试CI。**完成**：真实聊天可用且页面位置保留。**边界**：能聊天不等于会控制游戏；不把生图Key当小智凭据。

### CW09c｜feat(会话): 用可信语音生命周期撤销过期控制

- **前置**：CW09b、CW01b。**文件**：V新增 `lifecycle.py`；B新增 `application/voice_lifecycle.py`、`adapters/http/lifecycle_routes.py`，binding_service/control_tickets；S/voice-event必要兼容扩展，相关tests/voice与application。
- **实施**：绑定可信桥connection→本地input turn→interaction_epoch；speech_started停止音频并撤销旧控制范围；服务端仅接受已认证绑定来源；播放器真实排空才completed，收到字幕/云端done不算播完；断线撤销，重连新句柄保留会话。
- **验证**：QC/QA/新增voice测试；伪造来源、旧票据、重复中断、语音先到工具晚到；H6。**完成**：过期输入不能再推动位置/故事。**边界**：不能给一个无法证明来源的旧云端工具调用补上“当前epoch”让它通过。

### CW10a｜feat(工具): 提供博物馆MCP只读查询

- **前置**：CW09p、CW03a/d。**文件**：新M包的 `server.py`、`application_client.py`、`tools/context.py`、`tools/search.py`、`tools/read_content.py`、pyproject，uv/CI/边界规则，`tests/mcp/test_read_tools.py`。
- **实施**：固定MCP SDK与官方管道兼容组合；context/search/read只经B的HTTP；有界中文响应、分页、来源；按当前focus取“它”，搜索别名返回稳定ID；先测试注入绑定客户端，正式绑定由CW10b提供。
- **验证**：MCP工具发现/Schema、只读不改revision、分页/断网/错误HTTP、响应实测字节预算；新增M测试/静态检查。**完成**：三个只读工具可真实被小智发现调用。**边界**：不导入museum.domain、sqlite，不经工具返回整本剧本/图片base64。

### CW10b｜feat(绑定): 将语音工具连接到当前唯一展台

- **前置**：CW10a、CW09c。**文件**：M的 `binding_context.py`、`tools/connect.py`，B的binding/HTTP必要补充，W的VoiceEntry连接装配，`tests/mcp/test_binding.py`。
- **实施**：museum_connect配对码仅安装/重新授权时使用；首版启动器将当前唯一页面与专用管道绑定，日常不反复语音念码；可信连接作用域保存句柄/票据；切标签、撤销、过期、重连有明确策略，不凭LLM报的device_id路由。
- **验证**：两个页面不串控、旧句柄失效、未绑定工具只读也不泄露别会话、刷新可恢复/诚实重配；H5。**完成**：讲解员实际控制当前页面。**边界**：不允许任意会话ID绕过绑定；当前只有一个展台的假设须在诊断中明确。

### CW11a｜feat(工具): 执行导航观察和故事的受限动作

- **前置**：CW10b、CW04b/c、CW07c。**文件**：M的 `tools/act.py`、`action_mapper.py`，应用客户端；`tests/mcp/test_act.py`；工具用语说明。
- **实施**：同一个museum_act映射enter_gallery/前后/locate/set_view/enter_story/return_to_exhibit等现有合法动作；参数受限，相机语义经当前已应用角度计算；保留request_id、版本、可信轮次与票据；提交回执与rendered/degraded分开反馈。
- **验证**：导航/放大/下一故事段意图不同；缺参/过期/同ID变载荷拒绝；未知朝代无变化；QA/新增M测试；H5真声导航铜钱→牛→背面。**完成**：工具调用能导致真画面并诚实确认。**边界**：不由工具修改DOM、生成CSS或外部模型URL。

### CW11b｜feat(编排): 隔离插话前后的工具与回答

- **前置**：CW09p/c、CW11a。**文件**：按ADR选路：V新增 `control_orchestrator.py` 与M的可信调用上下文适配；B既有票据入口必要扩展；`tests/voice/test_turn_isolation.py`、接入证据。
- **实施**：只实施选中的一路。直连需观测可证明的调用来源/轮次，取消旧任务后其工具也不能重新取当前授权。无此能力时，本地可信输入分段→可关联控制规划器→同一MCP工具，独立ASR/模型能力另验另配。普通小智聊天输出与控制输出明确归属，不能双份执行。
- **验证**：延迟旧“前进”→新“停下/看牛”→旧请求晚到，以及重新get_context后试图执行的旧任务；自动对抗测试＋H6实测。**完成**：新意图生效，旧任务不复活。**边界**：不能用“提示词要求别乱动”替代关联；关联仍无法证明时本卡未完成，列明阻碍而非宣称成功。

### CW12a｜feat(讲解): 朗读指定文物正文与故事片段

- **前置**：CW09p、CW08a/b、CW09b。**文件**：W新增 `narration/NarrationPlayer.ts`、`narration/AudioFocus.ts`，V新增 `narration_adapter.py`（按选路）；故事/背景查询必要扩展，相关测试。
- **实施**：固定稿由内容ID取指定正文，使用已实测的指定文本TTS或离线合成音频；接口只暴露play/stop/checkpoint，不让剧情认识供应商。自由问答与固定稿争用同一AudioFocus，不能双声；小智若不能逐字读则换朗读适配，不能把自由复述标逐字稿。
- **验证**：三件介绍＋一段故事的正文/字幕/声音一致；问答开始先停固定稿，网络错误可恢复；H4/H6，新增音频测试。**完成**：用户要听时确实读准备好的内容。**边界**：不在浏览器放TTS密钥，不把播放开始标为完成。

### CW12b｜feat(讲解): 打断后恢复同片段并保持故事画面

- **前置**：CW12a、CW09c、CW11b、CW04c。**文件**：NarrationPlayer/PlaybackQueue、V lifecycle/narration，B narration_checkpoint/剧情转换必要扩展与迁移，相关测试。
- **实施**：last_started与last_completed分开；首版允许从被打断片段开头重读，明确说明，不要求伪造毫秒级恢复；“继续”恢复本片段，“下一段”才推进；explore追问不伪造story/QA返回点；返回长廊后不播放已退出故事的晚到音频。
- **验证**：H6；中段打断→问两问→继续仍同段→下一段才变镜头，音频未排空不完成，结束后迟到帧丢弃；QD/QA/新增音频测试。**完成**：片段不跳、不双播、画面与叙述同一物。**边界**：不扩成无限固定QA题库。

## 8. 扩充全唐朝：逐件数据与逐章故事

### CW13a｜feat(内容): 将作者卡片转换为可校验运行包

- **前置**：CW01c、CW02a、CW08b。**文件**：P新增 `importers/tang_cards.py`、`importers/id_map.py`、cli与导入测试；`docs/content/唐朝内容映射.md`。
- **实施**：读取D盘20卡、10章timeline、人物/史实/来源/scene-bindings；保留稳定ID，输出已有Schema目录，不复制作者JSON到运行时假装合格；已有三件ID不变；事实、创作、断代不确定性分开；导入幂等且冲突报告不覆盖手改源稿。生成候选包，不自动发布未审核内容。
- **验证**：QP；缺图/错误引用/不确定断代/重复ID/重跑/手改冲突；现有三件能继续读取。**完成**：后续数据卡能按同一流程落地。**边界**：不在此卡同时导入全部内容和调整游戏核心。

### CW13b系列｜每件文物一份独立内容PR

**共同前置**：CW13a；伊拉克比较器另需CW01d/e。数据可在声音模块联调时独立编排，正式呈现依赖CW07/08/12。以下每一行是实际可领取的一张任务卡，编号后缀就是卡片清单里的稳定slug，不是要把17件塞进一个PR。

**共同文件与步骤**：C的 `artifacts/<slug>.yaml`、对应assets/facts/sources、最小故事入口与nodes、galleries/main.yaml；先查询映射表复用已有source/asset；补名称/真断代/馆藏号/别名/背景稿/一句钩子/主展位/故事来源。每件支线聚焦独有问题，不重复编写“捡到古物后许愿”。若一件关联文件超建议规模，拆成身份资料PR和故事绑定PR，不跨物混改核心。

伊拉克一行的自有资料文件放 `content-src/packs/iq-abbasid/`，唐朝只保留比较展位与精确依赖引用；不把iq命名空间硬塞进cn-tang包。

**共同验证与完成**：QP、validate/build；从真实资源根可定位对应模型或照片；每物能被语音名/俗称找到、自动呈现、介绍、进入故事、返回；关联H7。身份待核只能标候选或争议区，不能伪造馆藏号/精确年代。**回退**：删除新数据引用或切回上一内容版本，不改核心。PR/commit使用表内完整标题。

| 任务号 | PR及commit标题 | slug／故事承接重点 |
| --- | --- | --- |
| CW13b-standing-woman-mhc | feat(内容): 编排女立俑的身份与生活支线 | standing-woman-mhc；宫女视角为创作，不认定原物就是宫女本人 |
| CW13b-equestrian-pair | feat(内容): 编排骑马俑与出行支线 | equestrian-pair；出行、人与马，组合模型不虚增原物数量 |
| CW13b-tomb-guardian | feat(内容): 编排镇墓兽的守护观念支线 | tomb-guardian；丧葬信仰，儿童表达不过度惊吓 |
| CW13b-lute-musician | feat(内容): 编排弹拨乐俑与合奏支线 | lute-musician；具体器名按来源，不擅定演奏曲 |
| CW13b-flute-musician | feat(内容): 编排吹笛乐俑与合奏观察 | flute-musician；关联同一合奏故事而非重复主线 |
| CW13b-dragon-amphora | feat(内容): 编排三彩龙柄瓶与工艺支线 | dragon-amphora；器形交流为馆方解释，object12229不冒充馆藏号 |
| CW13b-changsha-bird-bowl | feat(内容): 编排长沙窑碗与晚唐海贸支线 | changsha-bird-bowl；Met1986.97.3两张真照片，明确照片展位 |
| CW13b-iraq-blue-bowl | feat(内容): 编排伊拉克比较器的交流支线 | iraq-blue-bowl；沿用iq.abbasid.artifact命名空间，比较陈列不冒充唐代中国器 |
| CW13b-kundika | feat(内容): 编排净水瓶的争议断代展示 | kundika；MG138断代冲突保留，核清前不作为确定唐代核心证据 |
| CW13b-dancer-brick | feat(内容): 编排舞者砖与技艺传递支线 | dancer-brick；建筑装饰/舞蹈图像与工匠故事分开 |
| CW13b-seated-buddha-tianlongshan | feat(内容): 编排天龙山坐佛的原位置支线 | seated-buddha-tianlongshan；遗产与观看，不与其他残件拼成同一尊 |
| CW13b-bronze-mirror | feat(内容): 编排铜镜与纹样交流支线 | bronze-mirror；保留CC BY-SA署名及衍生许可，生活联想不冒称主人 |
| CW13b-kneeling-bodhisattva | feat(内容): 编排敦煌菩萨与遗产阅读支线 | kneeling-bodhisattva；按原物记录讲姿态与保存 |
| CW13b-woman-figure-mia | feat(内容): 编排另一女俑的比较观察 | woman-figure-mia；与女立俑不同馆藏号，不重复宫女人生，比较衣着/姿态 |
| CW13b-buddha-follower | feat(内容): 编排抚顶浮雕的图像阅读 | buddha-follower；晚8世纪，题材解释依来源，不说经历845事件 |
| CW13b-dvarapala | feat(内容): 编排守门力士与空间守护比较 | dvarapala；寺院守护像，不是唐军士兵/兵器 |
| CW13b-guardian-head | feat(内容): 编排力士头像与流散线索 | guardian-head；约735年，原位置与现藏地分别陈述 |

开元通宝、造像碑、卧牛已有资料卡，媒体/故事缺口分别由CW02d、08b、12补齐，不为凑20个PR重复创建ID。冠饰/兵器尚未取得合格模型，不在本轮清单里伪造新展品。

### CW13c系列｜每章一份贯穿主线PR

**共同前置**：CW13a和该章引用文物的CW13b卡。**文件**：C的 `stories/tXX.yaml`、`nodes/tXX-*.yaml`、必要facts/sources/image/audio引用；映射表。**实施**：从已有10章40主节点候选稿导入，不另写第二套大纲；每章保留事实依据、创作人物、可追问空间和文物返回路径。进入章时不能跳过用户“听故事”的意图，章节完成也不强制把人传送到下一件文物。

**验证**：QP/故事规则测试，节点无死路且能退出；每章图片/朗读稿/文物对应；时间线覆盖建立、兴起、转折、战后、晚唐与结束，器物断代与故事年代分别显示；H7。**完成**：本章可听、可打断、可返回；不需要每章新引擎机制。**回退**：发布新内容版本，旧会话不被原地替换。

| 任务号 | PR及commit标题 | 核查重点 |
| --- | --- | --- |
| CW13c-t01 | feat(故事): 接入大唐来信第一章 | 从作者timeline原题导入，核对建唐入口与618背景 |
| CW13c-t02 | feat(故事): 接入大唐来信第二章 | 核对初唐权力事件；角色代入不改写史实结局 |
| CW13c-t03 | feat(故事): 接入大唐来信第三章 | 造像碑等物件与故事时间关系，不能只用两节点夹具冒充整章 |
| CW13c-t04 | feat(故事): 接入大唐来信第四章 | 盛唐生活、乐舞/工艺与人物选择，避免重复背景 |
| CW13c-t05 | feat(故事): 接入大唐来信第五章 | 转折的因果、多方人物与儿童可理解表达 |
| CW13c-t06 | feat(故事): 接入大唐来信第六章 | 战后生活与重建，避免用晚期器物冒充现场见证 |
| CW13c-t07 | feat(故事): 接入大唐来信第七章 | 海贸与伊拉克比较器的地域/时代标识 |
| CW13c-t08 | feat(故事): 接入大唐来信第八章 | 信仰/政策与普通人影响，不虚构某件实物的遭遇 |
| CW13c-t09 | feat(故事): 接入大唐来信第九章 | 晚唐变局与不同人的有限选择，不渲染暴力细节 |
| CW13c-t10 | feat(故事): 接入大唐来信第十章 | 907结束、全线回望及可返回展馆继续自由参观 |

章节编号/原题/具体年份以作者timeline与审核后来源为准；上表是审核重点，不授权覆盖已写好的章序。若原稿映射不同，先更新映射表并在PR说明，不把猜测写成历史事实。

### CW13d系列｜逐件补全模型与预览配置

- **前置**：CW02b/c/d、对应CW13b。**实例**：每个尚未交付展示版的模型一张 `CW13d-<slug>`，标题 `feat(素材): 完成<文物中文名>的展示版与真实预览`；无需处理只有照片的长沙碗，首批三件已验过的不重做。
- **文件**：对应asset/framing、预览/衍生清单与验收记录；P有通用缺陷时另开工具修复卡，不在每件PR复制转换代码。
- **实施**：沿用CW02d流程，核19个模型文件台账；高模三彩瓶/坐佛等逐件测，展示版按目标设备预算优化；海外器/有争议器分别陈列，不因有模型就修改文物身份。
- **验证**：哈希、贴图、正面/背面、真实预览同位替换、冷/热加载、资源释放；H7。**完成**：每个实际开放的3D展位都有可用模型且无隐藏加载按钮。**边界**：19模型不等于19个同级主展台；乐俑可共台/比较物为附属，主展位映射唯一。

以下16个实例全部继承上面的文件、步骤和验证；首批造像碑、钱币、卧牛由CW02d覆盖。每行独立PR/commit，不能把16件二进制打包提交Git。

| 任务号 | PR及commit标题 | 重点 |
| --- | --- | --- |
| CW13d-standing-woman-mhc | feat(素材): 完成女立俑的展示版与真实预览 | 人物取景与纹理，不能用另一女俑模型换身份 |
| CW13d-equestrian-pair | feat(素材): 完成骑马俑的展示版与真实预览 | 组合体包围盒、相机与两件间距 |
| CW13d-tomb-guardian | feat(素材): 完成镇墓兽的展示版与真实预览 | 角/足/细部保真与儿童观看尺度 |
| CW13d-lute-musician | feat(素材): 完成弹拨乐俑的展示版与真实预览 | 约2.6MB原件先测，不为压缩而多次破坏细节 |
| CW13d-flute-musician | feat(素材): 完成吹笛乐俑的展示版与真实预览 | 约2.3MB原件，乐器细部与同台比例 |
| CW13d-dragon-amphora | feat(素材): 完成三彩龙柄瓶的展示版与真实预览 | 约264.6MB原件，已有正立兼容版仍未减面 |
| CW13d-iraq-blue-bowl | feat(素材): 完成伊拉克比较碗的展示版与真实预览 | 独立地域资产，内壁/外壁可观察 |
| CW13d-kundika | feat(素材): 完成净水瓶的展示版与真实预览 | 技术可用不等于断代核清，保留候选标签 |
| CW13d-dancer-brick | feat(素材): 完成舞者砖的展示版与真实预览 | 浮雕正面、厚度、光照阴影 |
| CW13d-seated-buddha-tianlongshan | feat(素材): 完成天龙山坐佛的展示版与真实预览 | 高模和残损纹理，保持原物状态 |
| CW13d-bronze-mirror | feat(素材): 完成铜镜的展示版与真实预览 | 原件约44.6MB与4K纹理，正反面、衍生许可 |
| CW13d-kneeling-bodhisattva | feat(素材): 完成敦煌菩萨的展示版与真实预览 | 朝向、残损边缘、全身取景 |
| CW13d-woman-figure-mia | feat(素材): 完成女性人物俑的展示版与真实预览 | 原件默认偏斜，修正framing不改形 |
| CW13d-buddha-follower | feat(素材): 完成抚顶浮雕的展示版与真实预览 | 默认侧面取景修正，残损不补全 |
| CW13d-dvarapala | feat(素材): 完成守门力士的展示版与真实预览 | 石像不完整躯体的合适视窗 |
| CW13d-guardian-head | feat(素材): 完成力士头像的展示版与真实预览 | 约63.8MB原件、旧材质兼容版、正面取景 |

### CW13e｜feat(内容): 发布审核后的唐朝版本与素材清单

- **前置**：对应CW13b/c/d通过，H7明确哪些可开放。**文件**：C及海外比较包manifest、新增 `docs/content/发布清单.md`、资源清单版本；P已有stage工具（不额外重造发布器）。
- **实施**：明确本次开放/待核/后备的ID与章；仅把审核允许开放的依赖图作为发布包，更新精确semver和publication_status，先完整validate/build/asset检查再stage不可变版本根；不修改仍被旧会话引用的旧包。争议内容可独立保留说明，不能偷偷删标签换确定年代。
- **验证**：QP/QA；PublishedCatalog实际可读取、所有资源URL可用、旧会话固定旧版、新会话使用新配置；H7清单与H8一致。**完成**：全馆不是只有作者JSON，而有实际可加载发布版本。**边界**：本机版本发布不等于部署上线，未获授权不推送外部服务。

## 9. 扩展性、故障与交付

### CW14a｜feat(扩展): 用独立展厅夹具验证内容可扩充

- **前置**：CW13a、CW11a。**文件**：`tests/fixtures/packs/extension-gallery/` 及相关内容/应用测试；只在夹具暴露真实缺口时另开核心修正PR。
- **实施**：增加独立地域/时间范围的非发布测试展厅，沿用同一页面/五工具/导航；唐朝默认仍唯一开放，宋朝请求诚实未开放；禁止按cn.tang常量硬编码行为。
- **验证**：QP/QA；只加数据可装载第二厅、站位和返回点互不串；H8。**完成**：扩展不需要另写宋朝页面/MCP。**边界**：测试夹具不是正式宋朝史料，不展示给玩家冒充内容。

### CW14b｜feat(验收): 覆盖长廊故障恢复与性能边界

- **前置**：CW07b/c、CW12b。**文件**：`tests/e2e/voice_corridor/`、Playwright配置、package/锁文件/CI，必要最小故障注入支持和性能记录。
- **实施**：先建立真实可运行的test:e2e脚本；浏览器自动验证状态/画面链，音频模拟仅自动回归；慢网/模型404/照片展位/无匹配/歧义/未开放宋朝/断连/刷新/窄屏/减少动画；记录真实设备20站往返资源与冷/热耗时。故障修复按所属模块另卡提交，验收PR不混巨大功能。
- **验证**：自动E2E＋H8真声整段录屏；不能用注入文本算真麦克风通过。**完成**：故障可解释、可继续参观，性能实测透明。**边界**：无新改动不机械重跑全部媒体下载。

### CW14c｜feat(启动): 一次启动装配展馆语音与内容配置

- **前置**：CW09—12工程通过、资源stage可用。**文件**：`tools/dev/run_local.py`、新增 `tools/dev/preflight.py`、`.env.example`、README、相关启动测试。
- **实施**：明确定义加载.env.local（仅本机/不覆盖已设置环境）的规则；检查Node/Python/设备配置/管道/资源根/内容版本；装配museum、web、voice、MCP，失败明确进程名并清理；默认已发布包版本来自配置，不让用户填包ID；账号初次绑定是安装步骤，不是每次游玩步骤。
- **验证**：干净依赖环境、一条实际启动命令、缺Key/资源/端口占用提示、Ctrl+C无孤儿进程；H8。**完成**：用户晚上能照README打开localhost开始参观。**边界**：生图配置可缺省，玩家运行不依赖生图Key；不向远端部署。

## 10. 生图中转的开发约定

继续采用七牛中转，离线制作参数为 `IMAGEGEN_BASE_URL=https://llmapi.qiniu.io/v1`、`IMAGEGEN_MODEL=gpt-image-2`、`IMAGEGEN_API_KEY`本机填写。实际接口字段、尺寸、返回格式与轮询以之前已验证配置及后续探针为准，不因模型名相似就假定所有OpenAI端点支持。图像制作沿用旧工程手册的制作模块；当前任务重点是导入已有58个选用候选图ID，游戏运行时不发图像生成请求。

任何新增配图另开 `feat(素材): 补充<具体故事镜头>`：只描述缺口、提示词/风格版本、引用ID、审核和素材清单，不把Key写PR，不用图像改造真实器物。生成图不能自动通过历史审核。真实文物预览只从真实模型或授权照片制作。

## 11. 模块修改影响与开发交接

| 改动 | 同时核对 | 不应顺带改变 |
| --- | --- | --- |
| Schema/动作参数 | 生成DTO、样例、应用入口、MCP输入、兼容ADR | CSS与史实正文 |
| 导航/可见窗口 | 会话事务、事件、display_order、序号语义、动画目标 | 供应商协议 |
| 故事返回点 | 存档迁移、QA返回栈、相机、刷新恢复 | 实物身份/断代 |
| 预览/模型/压缩 | 哈希/署名/解码器/相机/资源清单与回执 | 文物ID/故事结局 |
| 插话/轮次 | 停声、票据撤销、旧工具/旧音频/旧模型回执隔离 | 长廊投影数学 |
| 背景稿/故事段 | 图片绑定、朗读ID/缓存、来源审核、退出路径 | MCP工具数量 |
| 新朝代/国际内容 | 新包/展厅/地域/别名、跨包引用 | 页面复制/朝代专用代码 |
| 生图服务 | 离线配置/制作器/清单与审核 | 玩家语音或导航服务 |

开发交接只需要给下一位AI：本卡PR链接、实际基线、修改文件、检查证据、对应H检查结论、下一张可领取卡。不要用“差不多好了”“接口通了”替代状态；没有真实设备证据就写“真实语音待验”。
