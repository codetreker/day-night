# 项目与任务看板设计

状态：完整图 API、项目任务看板、Go 内嵌交付及 localhost/dev-ci 部署已实现；完整生产浏览器与固定性能验收由 W-T6 完成。范围为[只读 MVP](../spec/daynight-web.md)，页面效果见[可交互预览](mockups/task-dashboard.html)和[项目详情截图](mockups/task-dashboard-project.png)。[决策记录](../../.agents/notes/implemented/architecture/2026-10-20-task-dashboard-mvp-design.md)保存选型与范围取舍；[任务清单](daynight-web-tasks.md)拥有任务状态、前置与完成条件。

## 目标与现有基础

浏览器完成“项目列表 → 项目统计 → 根任务展开 → 任务详情”的完整读取路径。数据继续归属 `daynight-server`，不接入 客户端的 review 命令，不新增父子任务或新的任务状态。

已有基础与集成位置：

| 事实 | 证据与影响 |
|---|---|
| Go 服务已有项目与任务 JSON API | `packages/daynight-server/api/projects.go` 的 `ProjectPage` 返回项目及 `nextCursor`；`api/tasks.go` 的 `Task` 包含 `dependsOn`、`blockedBy`、`ready`。 |
| 页面与 API 同源 | `internal/server` 在同一 mux 注册精确页面、静态资源及 API 路由；`internal/webui` 内嵌真实构建产物，未知 API 保留 JSON 404。 |
| 已有一致读取机制 | `packages/daynight-server/internal/core/store/snapshot.go` 的 `ReadSnapshot` 使用只读 `REPEATABLE READ`。 |
| 分页之间没有共同快照 | [服务端分页约定](../spec/daynight-server.md)明确这一边界；不能用多次 task list 拼成准确的项目全图。 |
| web 与 CLI 工作区独立 | 私有 React/TypeScript/Vite 包使用显式 `web:*` 命令；根 build/typecheck/test 继续只覆盖 CLI，web 使用独立必选 CI job。 |

## MVP 范围

交付两个页面、一个详情侧栏和一个新增只读 API。使用手动刷新，保持现有写入接口、依赖规则、数据库结构与本机监听方式。

项目列表只展示项目元数据，不为每张卡额外请求任务统计。统计集中在项目详情，避免列表产生 N 次图查询。创建编辑、实时推送、身份认证和大图分片的延后成本及保留条件由[要求文档](../spec/daynight-web.md#明确延后的能力)定义。

## 页面与视觉

采用浅色内容区、白色卡片、深色窄导航栏和克制的靛蓝强调色。节点颜色始终表达业务状态；选中态使用描边，不覆盖状态颜色。所有内容使用中文标签，代码标识和仓库地址保留原文。

### 项目列表 `/`

- 页首显示“项目”和刷新按钮。
- 卡片显示项目名称、仓库地址、创建日期和“查看任务”。长名称、地址允许换行，仓库地址按普通文本展示。
- 复用 `GET /api/v1/projects?limit=50&cursor=...`，以“加载更多”遍历，按 ID 去重。
- 加载下一页失败时保留已加载卡片，错误和重试定位在列表末尾；首次加载失败使用整页错误。
- 刷新重置分页，从新列表开始。列表没有跨页一致性承诺，不显示未经完整读取的项目总数。

### 项目详情 `/projects/{projectId}`

```text
← 项目                         最近刷新时间   [刷新]
项目名称
仓库地址

[任务总数] [已完成] [待处理] [进行中] [可开始] [被阻塞]
可开始与被阻塞均为待处理的子集；已完成卡展示完成比例

任务链                   灰 待处理  蓝 进行中  绿 已完成
▾ 根任务 A       已完成       3 / 8 已完成
  ┌─────────────────────────────────────────────┐
  │ A → C → E          横向依赖图      [−][+][适应] │
  │ B ⇢ C              B：外部前置，上游已省略       │
  └─────────────────────────────────────────────┘
▸ 根任务 B       进行中       1 / 5 已完成
▸ 独立任务 F     待处理       0 / 1 已完成
```

- 初次成功加载展开第一条任务链；之后同时最多展开一条，图组件随折叠卸载。
- 根条目保留服务端 `(createdAt,id)` 的精确排序；前端不通过 JavaScript 毫秒时间重新排序，以免丢失数据库时间精度。根任务的状态与整条任务链的完成数分开显示。
- 图节点使用固定尺寸和两行标题；省略内容在详情侧栏中完整展示。
- 默认从左到右布局，前置在左、后续在右，箭头始终表达执行方向。
- 图内提供缩放、平移、适应画布，触屏和窄屏可滚动。初始缩放范围为 0.8–1；若此缩放无法容纳全图，将当前根放在左侧 32px 并垂直居中，避免长链打开在中段。显式适应画布允许缩小至 0.2，保留平移查看。初始化仅执行一次，选择与平移不重新居中或计算布局。
- 保留 React Flow attribution；禁用节点拖动、连线、重连、删除，保留焦点与选择。
- 页面展示最近一次成功快照的本机接收时间，不把 project.updatedAt 当作任务图更新时间。

### 详情侧栏

桌面从右侧打开，窄屏占满可用宽度。显示完整标题、纯文本描述、状态、时间、完整 ID、直接前置、当前阻塞项和直接后续。依赖引用可以切换侧栏内容；全部标签使用可访问的按钮。

使用既有 `GET /api/v1/projects/{projectId}/tasks/{taskId}`。节点详情单独加载、失败局部重试，不阻塞图。切换节点时取消旧请求，并检查请求所属 project/task，防止晚到响应覆盖新选择。

前置与后续标签来自当前图快照；若详情依赖指向快照中没有的节点，显示其 ID 并允许打开详情，不伪造标题。直接后续来自图快照，明确标为“任务图快照中的后续”。详情与快照中的状态、ready、依赖集合、阻塞集合、更新时间不符时，提示刷新全图。详情读取成功不会单独修改画布或统计。

侧栏打开后焦点进入关闭按钮，Tab 在侧栏内循环，Esc 和关闭按钮关闭。关闭后恢复原节点焦点；若节点随刷新消失，则恢复任务链标题焦点。

## 图投影与统计

为每个 task 建立 `id → task`、前置与后续索引。用全部节点的 `dependsOn.length === 0` 判定根；不能用 `blockedBy` 判定根，已完成前置仍是依赖。

展开根 `r` 时：

```text
R = {r} ∪ 从 r 沿后续边可达的所有任务
B = R 中各任务的直接前置集合 − R
主节点 = R
外部前置节点 = B
边 = 所有终点在 R 且起点在 R ∪ B 的依赖边
任务链进度 = R 内已完成的去重任务数 / |R|
```

B 使用虚线边框与“外部前置，上游已省略”标签；节点仍可打开详情。B 的祖先停止展开，来自 B 的边使用虚线区分上下文。B 的状态与阻塞信息来自完整项目快照，不能按当前可见边重新计算。

例如 `A → C ← B`：A 的展开图显示 A、C 和外部前置 B；B 的展开图显示 B、C 和外部前置 A。C 在每张图只出现一次，任务链进度均包含 C，项目统计只计算一次 C。

主节点在多个根的 R 中可达时显示“共享”标记。采用集合遍历处理菱形路径，避免重复节点与无限递归。服务端保证无环；前端解析时仍验证引用闭包、唯一 ID 与无环，失败显示“任务图数据不完整”而不是部分图。

布局适配器使用固定 Dagre 3.1.1 与 `rankdir: "LR"`，节点固定为 220×96，按 ID 稳定输入节点和边，减少无数据变化时的跳动。返回坐标转换为左上角位置并保留边路径点；空投影在调用 Dagre 前返回零尺寸，非空几何无效时明确失败。只在展开或新快照到达后计算布局；视口缩放不触发重新布局。

图计算模块不导入 React、fetch 或 React Flow。其输入是已解析的图 DTO，输出是可测试的数据结构：

```ts
type GraphIndex = {
  nodes: ReadonlyMap<string, GraphTask>;
  successors: ReadonlyMap<string, readonly string[]>;
  roots: readonly string[];
  sharedIds: ReadonlySet<string>;
  rootProgress: ReadonlyMap<string, { total: number; done: number }>;
};
type RootProjection = {
  rootId: string;
  mainIds: ReadonlySet<string>;
  boundaryIds: ReadonlySet<string>;
  edges: readonly { source: string; target: string; external: boolean }[];
  completed: number;
};
declare const buildGraphIndex: (graph: TaskGraph) => GraphIndex;
declare const projectRoot: (index: GraphIndex, rootId: string) => RootProjection;
declare const layoutGraph: (projection: RootProjection) => CanvasLayout;
```

`buildGraphIndex` 用 Kahn 遍历校验无环，同时建立后续索引。必须验证唯一 ID、前置引用闭包、合法状态、blockedBy 与未完成前置相符、ready 与状态相符、summary 与节点折叠一致。无效数据整体拒绝，不能靠默认空数组或删除坏边继续展示。

索引构建与单根投影均为 `O(V+E)`。主节点集合用迭代栈或队列和 Set 访问，防止菱形路径重复；每个快照计算一次各根的进度与共享归属，最坏 `O(K(V+E))`，其中 K 为根数。根统计可缓存到当前快照，布局只为正在展开的一条任务链生成。替换快照时整体释放索引、投影缓存与旧布局，不保存跨快照可变图。

## 技术选型

推荐 **React + TypeScript + Vite + React Flow + Dagre**。没有现有 UI 框架需要兼容；React Flow 提供缩放、平移、节点事件和键盘能力，Dagre 提供横向 DAG 布局。

| 方案 | 成本与适用性 | 选择 |
|---|---|---|
| React + React Flow + Dagre | 复用图交互和可访问性；需要明确禁用编辑功能，固定节点尺寸 | 推荐 |
| React + 自绘 SVG + Dagre | 需要自行实现视口变换、键盘定位、焦点和平移缩放测试 | 交互预览可以使用，产品代码不选 |
| Vue + Vue Flow + Dagre | 同样能够实现；仓库没有 Vue 基础，不能减少本次工作 | 保留为可替代方案 |

依据：[React Flow 布局指南](https://reactflow.dev/learn/layouting/layouting)、[Dagre 示例](https://reactflow.dev/examples/layout/dagre)、[可访问性](https://reactflow.dev/learn/advanced-use/accessibility)、[Vue Flow](https://vueflow.dev/guide/)、[Vite 构建](https://vite.dev/guide/build)。Dagre 对外联子图的限制针对嵌套分组；这里每个根条目是独立平面图，不使用嵌套 subflow。

React Flow 固定为 12.12.0，使用单个原生任务按钮处理鼠标/Enter/Space，关闭 wrapper
焦点与所有编辑入口，控件不提供解锁开关。边保留 Dagre 路径点，透明但可测量的
不可连接 handle 满足框架初始化；布局、选择和请求仍分别归所属模块。

锁定的 `@xyflow/system@0.0.83` 仅声明补丁显式保留 NodeBase 泛型约束，ESM/UMD
运行时字节不变，`exactOptionalPropertyTypes` 与依赖类型检查继续有效。静态测试
保护自定义数据与位置字段约束；容器构建必须复制 root patches 作为安装输入。

## 模块职责与调用方向

```text
packages/daynight-web/
  src/main.tsx                      浏览器入口
  src/app/{App,router}.tsx           两个页面的路由与组合
  src/api/{types,client,parse}.ts    DTO、请求、运行时解析与错误
  src/features/projects/           ProjectsPage、ProjectPage、统计卡
  src/features/task-graph/          model.ts、layout.ts、RootList、TaskGraph、TaskNode
  src/features/task-detail/         TaskDrawer 与详情请求 hook
  src/styles/                      设计变量、排版与样式
  scripts/                         构建产物发布和严格覆盖率检查
  tests/                           组件、算法与真实浏览器验收

packages/daynight-server/
  api/task_graph.go                 HTTP 图 DTO
  internal/core/task_graph.go       无传输依赖的读取模型
  internal/core/store/task_graph.go PostgreSQL 快照查询
  internal/service/task_graph.go    图读取编排、上限与统计
  internal/server/task_graph.go     图 HTTP handler 与 DTO 转换
  internal/webui/                   内嵌 FS、HTML 与资源 handler
```

| 模块 | 拥有的内容 | 依赖方向 |
|---|---|---|
| 浏览器 app/router | URL 解析、history/popstate、页面装卸与 404 | 组合页面，不直接 fetch |
| api/client、api/parse | 相对 `/api` 请求、AbortSignal、JSON 结构校验与 typed error | 不引用组件和图布局 |
| projects hooks | 列表游标、完整图快照、加载/刷新状态 | 调用 api，交给 model 建索引 |
| task-graph/model | 根、可达集合、外部前置、统计与共享关系 | 仅依赖 DTO 类型与标准集合 |
| task-graph/layout | 将投影映射为确定的节点坐标和边 | 依赖 model 与 Dagre |
| React Flow 组件 | 画布、只读节点、缩放和节点选择 | 接收布局与 onSelectTask，不调用 API |
| TaskDrawer | 当前 taskId 的详情、关系跳转、焦点和关闭 | 调用详情 hook；不修改图快照 |
| Go server | HTTP 解析、响应、路由与方法语义 | 调用 service 或 webui |
| Go service | 具体 store 的读取事务、领域拒绝、图摘要 | 调用 core/store，返回 core 模型 |
| core/store | 同一快照内的具体 SQL 查询与扫描 | 使用 pgx，不依赖 HTTP、React 或 API DTO |
| webui | 内嵌资源及正确的 Content-Type、缓存策略 | 不访问 service/store，不另包日志中间件 |

```mermaid
flowchart LR
  Browser[浏览器路由] --> Page[项目页面与请求 hooks]
  Page --> Client[typed API client]
  Page --> Model[纯图模型]
  Model --> Layout[Dagre 布局]
  Layout --> Canvas[只读 React Flow]
  Canvas --> Drawer[详情侧栏]
  Drawer --> Client
  Client --> Mux[Go ServeMux]
  Mux --> HTTP[图与详情 handler]
  Mux --> Assets[webui 内嵌资源]
  HTTP --> Service[service.Tasks]
  Service --> Store[core/store ReadSnapshot]
  Store --> PG[(PostgreSQL)]
```

### 前端数据和状态所有权

不用全局可变 task store，也不引入 Redux 或查询框架。页面维护加载状态与当前资源；纯图模型只计算派生内容。

- `useProjects` 拥有当前已加载页、nextCursor 和下一页错误。首次请求、加载更多和刷新有各自状态；刷新使旧游标及旧请求失效。
- `useTaskGraph(projectId)` 拥有完整 `TaskGraph`、接收时间、请求序号和 refresh 动作。新请求成功后一次替换快照与索引，不能逐节点补丁式混合两次响应。
- `ProjectPage` 只持有 `expandedRootId`、`selectedTaskId`。图刷新后沿用仍存在的根与选中任务，否则重新选择首根或关闭详情。
- `useTaskDetail(projectId, taskId)` 拥有最新详情与局部加载/错误。侧栏换节点不改变页面路由，关闭侧栏释放请求；前置引用在侧栏内部切换同一个选择。
- 图与详情的已加载数据分别绑定 projectId 与 `(projectId,taskId)`。渲染时只显示 key 相符的数据；key 变化立即显示新资源的加载状态，不能等 effect 清理后再去掉旧内容。同资源刷新才保留旧快照，取消/序号检查不能代替这一显示身份约束。侧栏的焦点外壳保持独立，关系跳转不把焦点临时恢复到旧节点。
- API client 的明确入口为 `listProjects(query, signal)`、`getTaskGraph(projectId, signal)`、`getTask(projectId, taskId, signal)`。错误类型区分已取消、网络/解析失败和服务端错误码；错误页面只展示脱敏文案及 requestId。图响应的 project.id、详情响应的 projectId/id 必须与规范化后的请求资源匹配，否则按协议错误拒绝显示。
- 页面导航使用 `pushState`，浏览器返回使用 `popstate`；在组件装卸边界取消请求。未知路径、无法解码的路径或无效 projectId 有明确错误页面，不发起拼接后的非法请求。

### Go 路由和静态资源

Go 服务在同一 origin 提供 JSON API、页面和真实内嵌资源。

保留 `server.New` 的单一 `http.ServeMux`，继续由 `runtime.Start` 中现有 `RequestLogging` 包裹一次。UI 与 API 共用 request context、requestId、panic 处理和访问日志。

| 路径 | 行为 |
|---|---|
| `GET /{$}` | 精确根路径，返回 SPA index；`GET /` 不能替代精确匹配 |
| `GET /projects/{projectId}` | 返回同一个 index，资源存在性由图 API 决定 |
| `GET /assets/` 前缀 | 仅返回实际存在的构建资源；目录与缺失文件返回 404 |
| `/api/v1/...` | 项目、任务及 task-graph API 已实现 |
| 其他路径 | 404；未知 `/api/*` 保留 JSON 错误，不返回 HTML |

GET 沿用 Go 的 HEAD 语义；已知 UI、asset 和图路径不支持的方法返回 405 与 Allow。`internal/webui` 暴露具体 HTML/asset handler，server 拥有路由注册，不用外层 URL dispatcher 绕过原 mux。HTML、图和最新详情响应采用 `Cache-Control: no-store`，内容哈希资源采用长期 immutable 缓存；不注册 Service Worker。

### 本地构建与开发

生产构建采用 web typecheck → Vite build → 完整产物发布到 Go 的 `internal/webui/dist/` → Go build。生成目录忽略 Git；不提交占位页面。发布产物前验证 index 及引用资源存在，以临时目录准备完整新产物后替换旧产物；构建失败必须阻止 Go 构建，不能继续使用旧页面。

```text
# 仓库根目录：本地依赖安装
pnpm install --frozen-lockfile

# 私有 web 包的开发与校验
pnpm web:dev
pnpm web:typecheck
pnpm web:test
pnpm web:build
pnpm web:acceptance

# Go 模块：完整校验（显式提供隔离 PG URL）
DAYNIGHT_TEST_DATABASE_URL=... bash scripts/check.sh
```

`web:dev`、`web:typecheck`、`web:test` 和 `web:build` 已实现；`web:acceptance` 由 W-T6 接入。共享 `web:build` 调用 Vite 后执行 `scripts/publish-assets.mts`，验证普通文件、index 及其引用，完成整目录暂存与替换，替换失败时尝试恢复先前目录；恢复也失败时保留先前产物并传播两个原因。`web:test` 执行覆盖率检查器、文件系统发布测试、单元/组件测试与严格覆盖率检查。计划的 `web:acceptance` 使用现有隔离 PostgreSQL 验证直接构建的 Go 进程，并通过独立 `deployment/dev-ci` 验证完整容器栈的浏览器路径，需要 Docker 与固定版本的测试浏览器。浏览器本机优先复用，CI 下载及全部临时 profile 放在项目 `.tmp/`。`web:build` 不调用 Go，避免循环依赖。Go `scripts/check.sh` 在执行需要内嵌资源的 Go 命令前，从仓库根调用该命令；Go 测试中重新构建的进程使用同一份真实资源。缺少 pnpm、依赖、index 或资源时明确失败。

开发模式的 Vite 将 `/api` 代理到本机 Go，不引入 CORS 通配配置；生产使用 `http://127.0.0.1:8787/`。运行机器只需要服务二进制与 PostgreSQL；源码构建固定使用 Node 24 与 pnpm 10.34.5。根目录现有 CLI build/test/acceptance 命令的含义保持独立，新增 web 命令显式选择 `@codetreker/daynight-web`。

### localhost 交付部署

生产交付直接集成既有 `deployment/localhost/`。继续执行 `bash deployment/localhost/up.sh`，一次构建并启动带页面的 Go 服务、PostgreSQL 和 gateway；完成后同一地址可打开项目页面与 API。镜像加入前端构建阶段，最终运行阶段仍只有非 root Go 二进制，不增加前端容器。日常重建与停止保持现有数据保留语义。

```text
仓库根构建上下文
  → Node 24 + pnpm 10.34.5：锁文件安装 → web:build
  → Go 构建阶段：Go 源码 + 已验证 dist → 二进制
  → 非 root 运行阶段：仅复制二进制
```

`deployment/localhost/compose.yaml` 使用仓库根 context 并显式指定 `deployment/localhost/Dockerfile`。Dockerfile 专属 `.dockerignore` 使用根相对 allowlist，纳入 workspace/root/web/Go manifests、锁文件、`patches/` 声明补丁、实际构建脚本与源码，排除宿主 `node_modules`、`.tmp`、生成 dist 和无关工作区内容。安装层只下载 web 所需依赖；镜像内部执行同一 `web:build`，不依赖宿主预构建产物。

保留 nginx stream/TCP 转发、服务与 gateway 共享网络命名空间、服务 loopback 监听、宿主 loopback 端口发布、现有 project API 健康检查和命名卷。nginx 不增加 SPA fallback，HTML、资源和 API 都由同一个 Go mux 处理。正常重建栈继续保留数据库数据。操作细节由 `deployment/localhost/README.md` 拥有，拓扑与内嵌交付选择分别由[本机部署决策](../../.agents/notes/implemented/architecture/2026-10-20-localhost-compose.md)和[内嵌交付决策](../../.agents/notes/implemented/architecture/2026-10-20-embedded-dashboard-deployment.md)拥有。

### dev-ci 验收部署

`deployment/dev-ci/` 供本机调试和 CI 验收使用。它运行生产构建的完整应用，不提供另一套前端实现；Vite 开发仍使用既有 `web:dev`。

```text
deployment/
  localhost/
    Dockerfile                  UI/Go 共用生产镜像构建
    Dockerfile.dockerignore
    compose.yaml                日常持久化栈
    nginx.conf                  共用 TCP 转发配置
    up.sh                       日常完整启动入口
  dev-ci/
    compose.yaml                独立的临时验收栈
    run.sh                      启动、发现端口、执行命令与清理
    README.md                   本机/CI 使用与隔离契约
```

两份 Compose 分别拥有环境配置，dev-ci 直接复用 `deployment/localhost/Dockerfile` 和 `nginx.conf`。不把日常 Compose 文件作为 override 基底，避免继承固定项目名、8787 端口及持久卷后再逐一覆盖。生产构建只维护一份；测试比较两份有效 Compose 配置的关键拓扑、固定镜像与服务命令，允许差异限于项目身份、端口、测试数据和资源生命周期。

| 项目 | localhost | dev-ci |
|---|---|---|
| 用途 | 日常运行完整应用 | 本机与 CI 的隔离生产验收 |
| 启动入口 | `up.sh` | `run.sh <command> [args...]` |
| Compose 身份 | 现有 `daynight-localhost` | 每次生成 `daynight-dev-ci-<run-id>`，所有操作显式传 `--project-name` |
| HTTP | 现有 8787 或显式指定端口 | 127.0.0.1 上由 Docker 分配空闲端口，健康后通过 `compose port gateway 80` 发现 |
| PostgreSQL | 现有命名卷，重建保留 | 独立容器、数据库及项目作用域卷，API 创建测试数据，不发布数据库宿主端口 |
| 网络与卷 | 现有日常项目资源 | Compose 项目作用域；不设全局资源 name 或 external |
| 结束 | 保留业务数据 | 只清理当前 run 的容器、卷和网络 |

`run.sh` 在创建任何资源前生成并校验项目名、注册有界清理，固定同一组 file/project-directory/project-name 参数。使用生产 Dockerfile 构建本次唯一镜像标签，记录 image ID，等待数据库及 API 健康后发现 base URL，通过 `DAYNIGHT_BASE_URL` 交给子命令。W-T6 的 `pnpm web:acceptance` 将调用该入口运行容器浏览器用例，不启动、重建或清理日常 localhost 栈；Go 覆盖率和直接二进制测试继续使用已有独立 PostgreSQL 测试机制。

正常退出、测试失败和信号取消都先终止本次子命令进程组，再收集本项目的必要日志及状态，执行仅针对该项目的 `down --volumes --remove-orphans`。进程组在 leader 退出后仍受管理，避免成功或失败的 callback 留下继续使用资源的后代。清理拒绝空项目名、非 dev-ci 前缀和 `daynight-localhost`，不执行全局 prune；本次镜像标签也只在确认本次容器退出后移除。取消后的清理采用独立有界步骤，清理失败必须使验收失败并保留原测试失败。run ID、base URL、image ID、资源清单和结果记录在任务 `.tmp/`，诊断不输出环境凭据、原始连接串或任务正文。恢复入口 `run.sh --cleanup RUN_ID` 只接受已有本地回执的有效身份，保留原 manifest，另写 recovery-manifest；执行恢复前必须先停止原 runner 与子命令进程组。W-T6 的 CI 外层始终执行定向清理步骤，复用已登记的 run 身份；进程被强制终止而无法确认清理时，保留资源清单并报告未完成，不能宣称已回收。

两套环境定义、隔离 HTTP smoke、运行镜像身份和并发隔离均已本地验证，正常重建保留数据。12 项受控 Docker fixture 验证成功、失败、取消、恢复与遗留子进程清理；它们不代替真实 Docker 故障验收。W-T6 接入完整浏览器、性能和 clean CI 证据，并扩大实际失败/清理路径验证。localhost 的配置与数据不会作为测试前置被修改。

### CI 构建归属

`verify-web` 和 `verify-server` 都配置固定 Node/pnpm，并在干净 checkout 从锁文件安装依赖、构建真实 UI。Go 检查调用共享构建后继续负责 build/vet/race/go-cov；web job 负责 web typecheck、构建、严格覆盖率及 dev-ci 生命周期 fixture。W-T6 扩展 web job，加入生产浏览器、Docker 与性能验收。两个 job、原生 CLI 各平台和独立 Linux shell completion job 的真实成功共同进入 `checks`。

根 `package.json`、锁文件、共享构建脚本和 `.github/workflows/checks.yml` 的唯一编辑归属按阶段交接：W-T2 建立并负责 web 命令和 `verify-web`；W-T2 验收后由 W-T5 接手构建/Go 工具配置；W-T5 验收后由 W-T6 接手最终生产验收步骤。接收任务在开始时核对前一阶段已通过的命令与 required job 清单，再接管编辑；其他任务只提出所需命令和依赖，不直接并发修改这些文件。W-T6 是最终汇总责任方，验证 `checks.needs` 包含 `verify-server`、`verify-web`、现有 CLI `verify` 与 `verify-completion`，且任何失败或取消都不能被成功汇总。

## 完整图 API

```http
GET /api/v1/projects/{projectId}/task-graph
```

成功返回：

```ts
type TaskGraph = {
  project: Project;
  summary: {
    total: number;
    todo: number;
    inProgress: number;
    done: number;
    ready: number;
    blocked: number;
  };
  tasks: Array<{
    id: string;
    titlePreview: string;
    titleTruncated: boolean;
    status: "todo" | "in_progress" | "done";
    dependsOn: string[];
    blockedBy: string[];
    ready: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
};
```

### Go 读取模型与事务

`internal/core/task_graph.go` 拥有只读投影，不把 HTTP 字段名或 JSON 编解码放入 core：

```go
type GraphTask struct {
    ID             string
    TitlePreview   string
    TitleTruncated bool
    Status         TaskStatus
    DependsOn      []string
    BlockedBy      []string
    Ready          bool
    CreatedAt      time.Time
    UpdatedAt      time.Time
}

type TaskGraphSummary struct {
    Total, Todo, InProgress, Done, Ready, Blocked int64
}

type TaskGraph struct {
    Project Project
    Summary TaskGraphSummary
    Tasks   []GraphTask
}
```

具体调用入口为：

```go
// internal/service/task_graph.go
func (s *Tasks) Graph(ctx context.Context, projectID string) (core.TaskGraph, error)

// internal/core/store/task_graph.go
func (s *Snapshot) TaskGraphSize(ctx context.Context, projectID string) (TaskGraphSize, error)
func (s *Snapshot) TaskGraphTasks(ctx context.Context, projectID string, previewCharacters int) ([]core.GraphTask, error)
```

`store.TaskGraphSize` 包含 int64 的 NodeCount 和 EdgeCount；它只描述查询结果。`Tasks.Graph` 使用现有具体 store，拥有 1,000/5,000/160 的策略常量，不新增可配置项、连接池或存储接口。

事务顺序固定为：规范化 projectId → `ReadSnapshot` → `Project` 确认项目并确立快照 → 精确节点/边计数 → 检查上限 → 查询轻量完整节点及前置 → 从节点折叠 summary → 完成事务 → 返回资源或待返回的领域错误。

store 的 SQL 直接读取 `left(title, previewCharacters)` 与 `char_length(title) > previewCharacters`，不先读取完整 title 或 description。复用现有 project 范围的有序 dependsOn/blockedBy 与 ready SQL 语义，避免另写一套阻塞规则。查询使用现有 project 前缀索引和 `(created_at,id)` 排序；空数组和空节点列表保持 `[]`。计数与长文本扫描仍有数据库成本，上限保证的是返回与渲染规模，不是数据库查询已经有常数耗时。

`api/task_graph.go` 独立定义 JSON DTO，server 将 core 结果转换为 DTO 和 UTC 时间。HTTP handler 拒绝全部 query 参数，不接受分页或筛选；沿用请求 context 与正常的 GET/HEAD、405 方法边界。

### 错误详情与兼容范围

在 `service.Fault` 中增加可选的强类型 `GraphLimit *GraphLimitDetails`，其中包含精确数量和上限。`api.ErrorDetails` 增加对应可选数字字段，图规模错误仅输出这四个字段，原依赖错误继续输出 `taskIds`，不引入任意 map 或将 `taskIds: null` 混进图错误。

同步 `server` 的状态映射、details 转换和 `knownFault` 白名单，保持 `409 graph_limit_exceeded` 可识别且有 requestId。缺失项目或超限 Fault 在 snapshot callback 内暂存并正常完成回调；只有外层事务完成成功后才返回。数据库、取消、提交和清理失败优先，不能因保留了 Fault 就降格为 404/409。

不改变已有列表、详情和写入接口的请求或响应语义，也不进行数据库迁移。

### 图 API 行为

- 无分页、无筛选。`tasks` 是完整项目图；edges 从 `dependsOn` 推导，不再重复传一份边。
- 在一个 `ReadSnapshot` 中读取项目、节点数、边数、节点与依赖，最终推导统计。回调内领域拒绝仍沿用服务现有事务收尾约定，数据库及清理错误不被领域错误覆盖。
- 快照内先查询数量；超过 1,000 节点或 5,000 边时返回 `409 graph_limit_exceeded`，details 包含 `nodeCount/edgeCount/maxNodes/maxEdges`。不返回部分成功数据，不改变既有写入规则。
- 标题预览限制为 160 Unicode code points，并返回 `titleTruncated`；查询直接投影预览，避免先加载所有完整标题。GraphTask 不含 description；完整文本在点击详情时读取。
- 查询 `dependsOn` 与 `blockedBy` 只覆盖该项目。数组排序、任务排序与既有 API 规则保持稳定。HTTP 400/404/500 沿用现有 typed Fault 和错误脱敏。
- 增加图规模错误时，同步维护 `service.Fault`、HTTP 错误 DTO、状态映射与日志白名单。错误响应沿用 requestId；不返回 SQL、驱动错误或仓库凭据。
- 不改数据库 schema，不加存储接口，不复用 CLI 的 YAML 或 SQLite。

## 请求、刷新与故障

项目列表请求、图请求、详情请求分别归属其页面/选择。导航、关闭详情或重新刷新时通过 `AbortController` 取消旧请求，并用请求序号检查晚到结果；取消不展示失败通知。

首次加载显示 skeleton。刷新时保留上次成功图，显示“正在刷新”；刷新失败保留旧图和上次成功时间，明确显示“刷新失败，当前为此前数据”。成功时一次替换统计、索引和所有根条目；当前展开根仍存在则保留，否则选择新首根。当前详情仍存在则重读详情，不存在则关闭并提示。

后端图超限是可解释的页面拒绝。HTTP 404 显示项目不存在与返回入口；其他错误提供重试和 requestId，避免渲染原始响应内容。标题、描述和仓库地址以纯文本显示，不渲染 HTML 或 Markdown。

## 观测与生命周期

生产请求路径没有新增后台调度、推送连接或浏览器遥测服务。新增边界为浏览器 fetch、图布局与现有 HTTP/数据库请求；验收环境另包含 dev-ci 子命令和 Compose 资源的生命周期。

- 浏览器的图请求范围由 projectId 和请求序号关联，详情由 projectId/taskId 和请求序号关联；组件卸载或选择变化负责取消请求。
- dev-ci 验收按 run ID、Compose project 与 image ID 关联启动、健康、测试和清理阶段；资源所有权及取消后的清理由[dev-ci 契约](#dev-ci-验收部署)定义。通过该 run 的清单与 phase/result 字段核对容器、卷和网络的最终状态。
- HTTP 入口沿用现有 requestId；图用例日志附 project_id、component、phase、耗时和 node_count/edge_count，禁止记录标题、描述、repoUrl、SQL 或完整响应。
- 使用既有请求 context 进入 store。布局同步计算只属于当前快照；卸载图后释放节点、边和视口，不保留其他展开图实例。
- API 错误在 HTTP 边界记录一次；浏览器仅展示脱敏 message 与 requestId。静态资源请求也走现有访问日志，不新增第二套错误上报。
- 验证时访问指定项目的 task-graph，从浏览器 Network 记录响应或错误的 requestId；在服务结构化日志中按该 requestId 与 project_id 过滤，确认一次请求的状态、耗时和图规模。禁止用任务正文定位。

模型工具预算不适用：本功能不新增模型调用或工具接口。

## 验证与 CI

1. Go：真实 PostgreSQL 测试完整图与统计一致性、空项目、不存在、规模边界、长文本预览、并发写期间的一致快照、取消与数据库失败；增加静态资源、深链接、API 优先级、缺失资源与方法测试。
2. web：Vitest + Testing Library，重点测根识别、闭包、菱形去重、共享节点、外部前置、统计口径、请求取消/晚到、失败重试和侧栏焦点。项目列表必须覆盖续页游标、末页隐藏加载按钮、去重及下一页失败重试，证明所有项目可访问。断言可见行为，不依赖框架内部坐标。
3. 覆盖率：保留 Go go-cov 和原始 profile 的严格 `covered * 10 > total * 9`。新增 web 必选 job，使用 Vitest V8 provider 输出的 `coverage-final.json`，按产品文件的语句命中表汇总计数并用整数执行同样严格比较。显式设置 `coverage.include` 为 `src/**/*.{ts,tsx}`；检查脚本另行枚举同一源码清单并逐文件核对报告，含未被测试导入的产品文件，缺失即失败。纯类型文件只有在确认没有运行语句时允许零语句；API、图算法和入口没有排除项。拒绝空、畸形报告，测试恰好 90%、舍入、未导入文件和遗漏文件等失败边界。第三方库与构建产物不属于产品源码。
4. 两个模块分别大于 90%，因此加权总体也大于 90%；不能靠 Go 的高覆盖率掩盖 web 缺口。现有 Go package/function/critical-block 与所有 CLI 原生平台门槛保持。
5. 浏览器验收使用 Playwright、构建后的真实页面、真实服务与隔离 PostgreSQL。通过 API 建立项目和任务，验证完整点击路径、共享/外部前置、空项目、局部失败与重试、深链接刷新、键盘节点操作，以及侧栏实际焦点进入/Tab 循环/Esc、关闭按钮和关闭后恢复焦点；收集截图、测试 SHA、通过结果和资源清理证据。
6. 必选 web job 纳入 `checks`，与 Go、原生 CLI 和独立 shell completion 检查共同汇总。Go job 与 web job 各自在干净 checkout 中生成真实 UI 产物，验证内嵌页面可用。依赖变更遵守现有 workspace 与 CLI 版本检查规则。
7. 性能验收使用 Linux CI 的固定 Chromium、生产构建和固定种子图集，覆盖 1,000 节点的单链，以及恰好同时具有 1,000 节点和 5,000 边的分叉合流、多根共享图。每次从折叠状态打开，重复五次，最慢一次从点击到可操作画布不超过 3,000ms；布局后打开详情、缩放或平移的可见反馈不超过 300ms。单独保存布局/渲染耗时和完整测试环境，接口耗时与详情网络时间分开记录。失败必须优化或重新评审支持上限，不能把超时结果当成已支持，也不默认引入后台 worker。

## 实施与验收边界

[任务清单](daynight-web-tasks.md)定义六个实现任务：图读取 API、项目浏览基础、纯图模型、项目任务看板、localhost 与 dev-ci 交付、完整验收。任务状态、依赖和文件归属只在该文档维护。图 API 与项目浏览基础可以并行，后续按清单依赖推进。

所有任务交付自身的有效测试与覆盖率；最终验收任务验证组合后的真实进程，不替前面的任务补写缺失测试。设计预览不是实际 API、覆盖率、Docker 或集成完成证据。

## 风险与重审条件

- 大量共享节点会重复出现在不同根图中；通过去重统计和单展开控制成本。需要同时比较多条图时再重审交互。
- 1,000/5,000 是明确的保护上限，实施验收应记录代表性最大图的布局和交互时间；不能将未经测量的上限宣称为性能保证。
- 外部前置必须保留显式标记，否则图会错误暗示前置已完整展示。
- Node 成为 Go 二进制的构建前置；固定构建顺序与干净 checkout 验证，运行时仍只有 Go 与 PostgreSQL。
- 只有本机访问需求。出现远程访问要求时必须先补齐身份与授权设计。
