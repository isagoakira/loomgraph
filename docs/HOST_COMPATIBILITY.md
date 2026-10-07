# 宿主兼容性与发行途径审计

审计日期：2026-10-02  
审计范围：本机 Codex CLI / Claude Code、插件清单与 MCP 启动路径。  
边界：本文件只记录只读检查结果和根代理的配置建议；没有修改用户级 Codex/Claude 配置，没有安装插件，没有执行现有 MCP 列表命令，也没有启动新的模型会话。

## 结论

当前包的便携 Agent Plugins 入口在结构上是正确的：根目录 `plugin.json` 与 `mcp.json` 使用公开 Agent Plugins 1.0.0 schema，根 `mcp.json` 的 stdio 服务也满足规范要求。Codex 还保留了官方支持的 `.codex-plugin/plugin.json` 兼容入口。

初次审计发现 Claude Code 缺少 `.claude-plugin/plugin.json`。根代理随后补齐该文件，并将 `.mcp.json` 脚本入口改为 `${CLAUDE_PLUGIN_ROOT}/scripts/start-canvas.mjs`。2026-10-02 实际运行 `claude plugin validate` 已通过，只有未提供作者资料的提示；实际 Claude 加载和对话交接仍待验证。以下逐项审计保留修复前的历史结果。

Codex 兼容 manifest 现单独引用根 `mcp.json`，避免把 Claude 专用路径变量交给 Codex。便携入口继续按插件根 cwd 解析相对脚本；实际 Codex 加载尚未验收，已验证的绝对路径配置仍是本机直接接入途径。

相对脚本参数存在两个层次：

- 根 `mcp.json` 的 `args: ["scripts/start-canvas.mjs"]` 对遵循 Agent Plugins 规范的客户端是可行的，因为 stdio 的 `cwd` 省略时必须默认为插件根；但 `command: "node"` 仍依赖宿主的可执行文件搜索路径，不能代表 Node 版本已被插件固定。
- 根 `.mcp.json` 现为 Claude 插件入口，使用 `${CLAUDE_PLUGIN_ROOT}/scripts/start-canvas.mjs`。Codex 兼容 manifest 引用独立的根 `mcp.json`。修复前的普通相对参数从插件根启动成功，从 `/tmp` 启动得到 `MODULE_NOT_FOUND`；该历史测试不评价当前 Claude 占位符加载结果。直接接入时已验证的 `configure-client.mjs` 绝对路径输出可避免 cwd 依赖，实际宿主加载仍需验收。

## 本机环境快照

| 项目 | 只读结果 |
| --- | --- |
| 平台 | macOS `darwin arm64` |
| Codex 可执行文件 | `/opt/homebrew/bin/codex` |
| Codex CLI | `codex-cli 0.146.0` |
| Claude Code 可执行文件 | `/opt/homebrew/bin/claude` |
| Claude Code | `2.1.226` |
| 当前默认 Node | `/opt/homebrew/Cellar/node/26.8.1/bin/node`，`v26.8.1` |
| 插件声明的 Node 下限 | `package.json`：`>=24` |

另有已保存的 Node 24.21.0 macOS ARM64 运行证据：`docs/evidence/execution-node24-macos.json`。该证据覆盖构建后 `start-canvas.mjs` 的真实 MCP stdio handshake、工具发现、执行回执和 stdin EOF 释放；它不等价于 Codex 或 Claude Code 整轮宿主验收。

本轮只读取了 CLI 的版本和 help。Codex 的 MCP help 确认了 `codex mcp add <name> -- <command>...` 形态，插件 help 确认了 `codex plugin marketplace add <source>`；Claude 的 help 确认了 `claude mcp add ... -- <command> [args...]`、`--mcp-config`、`--plugin-dir` 和 `claude plugin validate <path>`。没有调用 `codex mcp list` 或 `claude mcp list`，因此没有读取现有连接配置或参数。

## 官方路径和启动语义

### 便携 Agent Plugins / Codex

公开 Agent Plugins 规范要求：

- 插件根必须有 `plugin.json`；固定的 MCP 组件路径是根 `mcp.json`。
- 根 `mcp.json` 必须有 `$schema`、`mcpServers`，每个服务必须声明 `type`。
- stdio `command` 是单个可执行 token；可使用裸命令名，或使用以 `./` 开头的插件内路径。
- 省略 stdio `cwd` 时，客户端必须使用插件根作为子进程 cwd。
- `args`、`env`、`cwd` 支持 `${PLUGIN_ROOT}` 和 `${PLUGIN_DATA}` 展开；`command` 不做占位符展开。
- 裸 `command` 的 PATH 参与方式由客户端决定，插件不能依赖特定 PATH 内容。因此 `command: "node"` 合法，但 Node 是否存在、版本是否满足 `>=24` 仍需宿主检查。

官方 OpenAI/Codex 插件文档确认：根 `plugin.json` / `mcp.json` 是推荐的便携布局；`.codex-plugin/plugin.json` 仍作为兼容 fallback 支持。Codex 本地发行入口包括：

- 仓库 marketplace：`$REPO_ROOT/.agents/plugins/marketplace.json`，插件目录通常位于仓库 `./plugins/` 下。
- 个人 marketplace：`~/.agents/plugins/marketplace.json`。
- Codex CLI：`codex plugin marketplace add ./path/to/marketplace`，或 GitHub shorthand、HTTPS/SSH Git 源；插件的安装和刷新由 marketplace 管理。
- ChatGPT/Codex 桌面本地 marketplace：官方文档说明本地插件会安装到 `~/.codex/plugins/cache/$MARKETPLACE_NAME/$PLUGIN_NAME/$VERSION/`；本地版本使用 `local` 版本目录。

这些是发行入口，不代表本项目已经完成 marketplace 添加或安装；本轮没有执行会修改配置的命令。

### Claude Code

Claude Code 官方文档要求 Claude 插件目录使用：

- `.claude-plugin/plugin.json`：Claude 插件 manifest；`claude plugin validate <path>` 也按此路径查找。
- 根 `.mcp.json`：插件提供的 MCP server 配置。插件启用后，Claude Code 自动管理其 MCP server 生命周期。
- 插件内 stdio 配置可以使用 `${CLAUDE_PLUGIN_ROOT}` 引用安装后的插件根；官方示例把脚本参数写成 `${CLAUDE_PLUGIN_ROOT}/server.js`。
- `claude --plugin-dir <path>` 可做会话级目录加载；正式安装则通过 Claude marketplace 的 `.claude-plugin/marketplace.json`。
- 项目级 `.mcp.json` 需要交互式审批；插件提供的 `.mcp.json` 属于插件生命周期，不等同于项目根的共享配置。
- `claude mcp add` 的 stdio 命令和参数要放在 `--` 之后；JSON 配置接受 `type: "stdio"`。

Claude 官方文档还说明，stdio server 会收到稳定的 `CLAUDE_PROJECT_DIR`；本项目启动参数已经明确传入绝对 `--data-root`，所以服务本身不需要用该变量决定项目目录。当前本机 Claude Code `2.1.226` 低于官方文档中“HTTP 失败后自动尝试 SSE”要求的 `2.1.265`，但该差异只影响远程 HTTP/SSE fallback，本项目使用本地 stdio。

## 当前文件逐项审计

| 文件 | 当前内容/官方含义 | 当前判断 |
| --- | --- | --- |
| [`plugin.json`](../plugin.json) | 根便携 manifest，声明 Agent Plugins 1.0.0 schema、`name`、`version`、`description`。 | 公开 plugin schema 结构正确；没有 `extensions.com.openai`，因此 OpenAI-specific 部分依靠兼容 overlay。 |
| [`mcp.json`](../mcp.json) | 根便携 MCP 配置；`type: "stdio"`、`command: "node"`、`args: ["scripts/start-canvas.mjs"]`。 | 公开 MCP schema 结构正确。对规范客户端，省略 cwd 应落到插件根；Node 可执行路径和版本仍是宿主责任。 |
| [`.codex-plugin/plugin.json`](../.codex-plugin/plugin.json) | Codex 兼容 manifest；`skills`、`mcpServers`、界面字段均使用 `./` 相对插件根路径。 | 与 OpenAI 文档所述 compatibility fallback 形态一致；没有 Claude manifest 语义。实际 Codex marketplace 安装/加载尚未验证。 |
| [`.mcp.json`](../.mcp.json) | Claude 插件 MCP 配置；`type: "stdio"`、`command: "node"`、`args: ["${CLAUDE_PLUGIN_ROOT}/scripts/start-canvas.mjs"]`。 | 已按 Claude 插件路径表达修复；manifest 校验通过，实际 Claude 插件加载 / 交接仍待验证。 |
| [`.claude-plugin/plugin.json`](../.claude-plugin/plugin.json) | Claude 插件 manifest，声明名称、版本和说明。 | 已补齐；本机 `claude plugin validate` 通过。 |
| [`scripts/start-canvas.mjs`](../scripts/start-canvas.mjs) | 入口随后端 `import.meta.url` 解析 `dist/server/index.mjs`，注入 `--stdio`、默认端口和默认项目目录。 | 找到脚本后，后端 bundle 的解析不依赖启动 cwd；问题集中在宿主如何解析 `args` 中的脚本路径。 |
| [`scripts/configure-client.mjs`](../scripts/configure-client.mjs) | 输出 `codex-mcp.toml` 和 `claude-mcp.json`；使用当前 Node 的 `process.execPath`、脚本绝对路径、绝对 `--data-root` 和 `--port 0`；用 `wx` 拒绝覆盖；不直接应用到客户端。 | 当前本机直接接入的可靠路径。换机器、移动插件或更换 Node 后必须重新生成。 |

## 修复前的相对路径实测

使用同一个临时数据目录，只改变子进程 cwd，执行的命令为 `node scripts/start-canvas.mjs --data-root <temporary-root> --port 0`：

| cwd | 结果 |
| --- | --- |
| 插件根 `/Users/Zhuanz1/Desktop/file/AutoResearch/plugins/agent-visual-canvas` | 退出码 `0`；stderr 显示 HTTP 在 `127.0.0.1` 随机端口监听，随后因 stdio EOF 正常关闭。 |
| `/tmp` | 退出码 `1`；Node 报 `Cannot find module '/private/tmp/scripts/start-canvas.mjs'`。 |

这证明脚本自身已处理“找到入口之后”的路径，但不能把 `.mcp.json` 的普通相对 `args` 宣称成跨宿主可靠。便携 Agent Plugins 规范通过默认 plugin-root cwd 解决这一点；Claude 兼容文件则应显式使用其插件占位符或直接使用本机绝对配置。

## 具体可靠的发行途径

1. **当前本机直接接入（推荐用于开发验收）**：先在插件根执行 `pnpm run build`，再执行 `node scripts/configure-client.mjs <absolute-project-directory> <absolute-output-directory>`。把生成的 `codex-mcp.toml` 或 `claude-mcp.json` 作为人工审阅后的客户端配置输入。它不依赖客户端 cwd，也不需要把 Node 或插件路径硬编码进仓库；根代理保留实际配置写入和审批权。
2. **Codex/ChatGPT 本地 marketplace（用于可重复安装）**：补齐并维护 repo 或个人 marketplace，使用根便携 `plugin.json` + 根 `mcp.json`；安装后由 Codex 从缓存副本加载。需要对当前 `codex-cli 0.146.0` 做一次实际 marketplace refresh、插件启用和工具发现验收。
   这条路径是本地/团队发行路径；OpenAI 官方公共插件提交文档对本地 MCP 要求公开 HTTPS endpoint，当前本地 stdio 服务不能据此宣称已经满足公共目录发布条件。
3. **Claude Code 插件 marketplace / session-only 目录**：当前已补齐 `.claude-plugin/plugin.json`，根 `.mcp.json` 使用 `${CLAUDE_PLUGIN_ROOT}/scripts/start-canvas.mjs`，实际 `claude plugin validate` 通过。后续用 `claude --plugin-dir <path>` 或 marketplace 做宿主加载和对话交接；当前未启动 Claude 模型会话。
4. **跨机器交付**：不要复制当前机器生成的绝对路径配置；在目标机用目标机的 Node 和插件绝对路径重新运行 `configure-client.mjs`。Windows 的 `node`、路径分隔符、安装位置和 Node 24 实机仍待验证。

## 调整结果与剩余验证

按优先级排列：

1. **已新增 `.claude-plugin/plugin.json`**：声明 `name`、`version`、`description`，本机实际 `claude plugin validate` 通过。Codex 与 Claude 各自保留独立入口。
2. **已调整 `.mcp.json` 的脚本参数**：使用 `"${CLAUDE_PLUGIN_ROOT}/scripts/start-canvas.mjs"`。Codex 兼容 overlay 引用根 `mcp.json`；Claude 占位符不作为 Codex 通用语法。
3. **保留根 `mcp.json` 为便携规范入口**：可考虑将其 args 改为 `"${PLUGIN_ROOT}/scripts/start-canvas.mjs"`，这是 Agent Plugins 规范明确支持的 stdio args 展开；修改后重新跑 schema、build 和真实 stdio handshake。当前普通相对参数在规范客户端上已有明确默认 cwd 依据，不是 schema 错误。
4. **把 `configure-client.mjs` 作为本机接入主路径**：不要把生成的绝对路径写进 Git，也不要让脚本自动改用户配置。生成文件只作为根代理人工审阅后的输入。
5. **补做宿主验收**：Codex marketplace 安装/启用/工具发现，Claude `.claude-plugin` 加载/审批/工具发现，Node 24 与 Windows；这些成功前，阶段记录只能写“本机 launcher/stdio 已通过”，不能写“Codex/Claude 双宿主已验收”。

## 证据边界与官方参考

已验证：

- 本机命令路径、版本和 help 输出；
- 根 manifest / 根 MCP JSON 的字段和公开 schema 对照；
- 修复前 `claude plugin validate` 报缺少 `.claude-plugin/plugin.json`；补齐后对当前插件根校验通过；
- 相对脚本参数在插件根 cwd 成功、任意 `/tmp` cwd 失败；
- `docs/evidence/execution-node24-macos.json` 中保存的 Node 24.21.0 实际 launcher/stdio/EOF 结果；
- `configure-client.mjs` 生成的预览文件使用了绝对 Node 和绝对入口路径。

尚未验证：

- Codex 0.146.0 对本目录 marketplace 安装、兼容 overlay 选择、MCP 工具发现和重启后的加载；
- Claude Code 2.1.226 对新增 `.claude-plugin/plugin.json` 后的插件加载、审批与 stdio 工具发现；
- Windows 原生路径、Node 24 安装和宿主交接；
- 生成的客户端配置在用户实际配置中的写入结果；本轮刻意没有写入。

官方参考：

- [Agent Plugins Specification 1.0.0](https://agent-plugins.org/specification.md)
- [Agent Plugins plugin schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json)
- [Agent Plugins MCP schema](https://agent-plugins.org/schemas/1.0.0/mcp.schema.json)
- [OpenAI/Codex：Package your plugin](https://developers.openai.com/plugins/build/plugins)
- [Claude Code：Plugins overview](https://code.claude.com/docs/en/plugins/overview)
- [Claude Code：Plugin components](https://code.claude.com/docs/en/plugins/components)
- [Claude Code：MCP reference](https://code.claude.com/docs/en/mcp)

官方文档检查通过已有的 Ego TaskSpace 14 的 `p2` 页面完成；没有创建新的 TaskSpace 或页面。 
