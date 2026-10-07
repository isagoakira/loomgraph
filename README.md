# Loomgraph

**Weave thought into action.**

面向人与 Agent 协作的空间笔记：把知识图谱、流程、富文本、图解和真实任务进度织进同一张可交互画布。

Loomgraph 原开发名称为 Agent Visual Canvas。当前保留 `agent-visual-canvas` 软件包、技能与 MCP 标识，以兼容既有安装和项目数据。

本地 Excalidraw 图形工作区，通过 stdio MCP 复用现有 Codex / Claude Code 对话。项目模型、子图、独立批注、讨论和历史保存在项目目录；发布页面、字体和布局引擎随包提供。

最新 Agent 作图引导、局部增量、批注交接和执行动效记录见 [实施与验收](docs/AGENT_HARNESS_IMPLEMENTATION_2026-10-07.md)及[架构设计](docs/AGENT_HARNESS_ARCHITECTURE_2026-10-07.md)。

实现与验收状态见 [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md)。当前属于实施中的 V1，未宣称双平台完整验收。

2026-10-02 已完成本机预览部署并配置本项目的 Codex MCP 入口；重启后的当前会话接入与演示步骤见 [本机部署记录](docs/LOCAL_DEPLOYMENT.md)。

## 运行

需要 Node 24 或更新的受支持版本。发布包直接运行预构建资产；开发源码先执行 `pnpm install` 与 `pnpm run build`。

```text
node scripts/start-canvas.mjs --data-root "/absolute/project/directory"
```

该入口用于 MCP，由客户端维护 stdin/stdout；正常结束 stdin 后退出。页面入口通过 `canvas_open` 返回。手动查看页面时使用：

```text
node scripts/start-canvas.mjs --http-only --data-root "/absolute/project/directory" --port 4317
```

项目默认保存在本机用户数据目录的 `agent-visual-canvas/default-project`，位于插件安装目录之外。`AGENT_CANVAS_PROJECT_DIR` 或 `--data-root` 可指定项目位置。每个副本只允许一个写服务；多个页面可以共享同一入口。

## 客户端配置

在目标机器上生成包含该机 Node 与插件绝对路径的安装片段：

```text
node scripts/configure-client.mjs "/absolute/project/directory" "/absolute/config-output"
```

输出 `codex-mcp.toml` 和 `claude-mcp.json`，不会修改现有客户端配置。输出目录里的同名文件存在时拒绝覆盖。Windows 参数采用同样的参数数组和绝对路径，支持空格与中文目录。

Codex 提供便携 `plugin.json` / `mcp.json` 和 `.codex-plugin/plugin.json` 兼容包装。包装中的相对脚本路径仍需在实际宿主核对；当前推荐由上述生成器输出该机的绝对路径配置，以保证启动不依赖宿主工作目录。客户端安装和既有会话交接仍需宿主验收。

## 交互

Agent 通过类型化工具维护状态。用户在当前图选择对象、连线或区域，连续保存独立意见；跨图暂存后批量交接。Agent 读取冻结上下文，逐条回答或修改，界面保留各条结果和版本来源。

执行请求、任务显示状态和实际执行结果分别记录。宿主原生标注 API 缺失时使用批次引用；普通 stdio 不承诺自动唤起新一轮模型或中断任意对话。

发布包附带 `examples/collaboration-demo.avcanvas`，包含 18 个对象、6 张图和跨图表示，可在历史面板导入为独立副本。历史面板也支持读取指定修订、只读比较、恢复为新修订，以及项目包下载和上传；导入后会显示新副本位置，当前服务仍附着原副本。

## 数据与恢复

项目内容位于所选目录的 `.agent-canvas/`。保留 `project.sqlite`、manifest 与 `assets`；运行时连接信息和可重建缓存无需跨机携带。使用一致快照项目包迁移；导入建立独立副本，不覆盖原项目，不自动重发旧执行请求。

软件包版本、数据格式、扩展版本和内容修订分别管理。更新保留上一发布包和项目内容；恢复历史生成新修订。具体通过的恢复场景、性能结果及未验证能力以阶段验收记录为准。
