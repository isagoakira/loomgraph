# Loomgraph r31.2 发布前检查

日期：2026-10-09。源码构建：`persistent-agent-20261009-r31.2`。

本次将已验收的常驻 Agent 和页面控制同步到独立的 [Loomgraph 仓库](https://github.com/isagoakira/loomgraph)，包含被先前撤回的 r30 选区对话基础及 r31.2 增量。保留 Loomgraph 品牌首页、中文领域文档、插件身份与既有计划；AutoResearch 的无关改动保持原状。

## 本仓库实际检查

| 检查 | 结果 |
| --- | --- |
| 源码同步 | `src`、`tests`、作图 Skill 与开发插件内容一致 |
| 类型检查 | 通过 |
| 回归测试 | 62 个测试文件、533 项全部通过 |
| 生产构建 | 通过，实际执行 Excalidraw 字体 subset Worker 并获得有效输出 |
| 独立发行脚本 | 使用仓库内 `docs/plans`；不再读取 AutoResearch 的 `../../research` |
| 归档文件检查 | 校验 SHA-256 sidecar、完整文件集合及 981 个内容文件的哈希；归档另含 `RELEASE.json` |
| 解压后启动 | 在临时目录、独立数据目录、无随包 `node_modules` 的环境中启动 |
| 实际 stdio MCP | 客户端握手、9 个工具、`canvas_open`、`canvas_read` 通过；运行构建与 r31.2 一致 |
| HTTP 页面 | 解压后服务返回实际页面入口 |
| 清理 | MCP 子进程退出，临时项目及解压目录删除 |

检查归档 SHA-256：`c1cad7bd1cae5d072dba8604f37dba8b8bc84a34478cbbd656f8a72196b7070c`。这是 Loomgraph 仓库生成的检查包，和先前本机安装包分别记录；不是 GitHub Release 附件。检查包及原始检查报告留在本机忽略目录 `.runtime/loomgraph-publish-20261009/`，未随源码提交。

## 功能验收与发布边界

真实模型与浏览器功能验收见 [r31.2 记录](PERSISTENT_AGENT_ACCEPTANCE_2026-10-09.md)；r30 候选预览、应用与撤销证据见 [历史记录](REALTIME_AGENT_ACCEPTANCE_2026-10-08.md)。r30 已公开的选定脱敏证据一并保留，r31.2 原始运行材料仍在本机。旧记录的回环地址、PID 与安装状态属于当时的观察，其他机器需重新启动并验收。

本次发布不重启活动 MCP，不修改客户端配置或用户项目数据。Windows、真实 API 服务及本轮 Claude 页面控制未实机验收；本仓库的打包和连接检查不扩大上述功能结论。
