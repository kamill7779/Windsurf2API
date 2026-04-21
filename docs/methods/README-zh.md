# Anthropic 工具桥接方法

Windsurf2API 在 `POST /v1/messages` 上提供 **两种可切换的方法** 来支持 Anthropic 风格的工具调用。当前激活哪种方法由运行时配置决定；两条路径都编译进每次构建，无需重启服务即可切换。

## 可用方法

| 方法 | 适用场景 |
|---|---|
| [**原生桥接（Bash）**](./bash-native-bridge-reinjection-zh.md) | 客户端需要本地执行 Bash，并希望复用 Windsurf 已有的 `run_command` 提案链路。最小化、确定性强，仅支持 Bash。 |
| [**提示词模拟**](./system-prompt-tool-emulation-zh.md) | 需要支持任意 Anthropic 工具，不依赖 Windsurf 原生工具提案。工具覆盖面更广，但依赖模型按既定协议输出。 |

## 切换机制

- 模式由运行时配置文件决定（默认：`config/bridge-mode.json`）。
- 激活模式只作用于 `/v1/messages`；OpenAI 与 Responses 端点不受影响。
- 启用热重载后，模式切换可无需重启生效。
- 模式切换会被记录，方便观测。

示例配置：

```json
{
  "anthropicToolMode": "native_bridge",
  "hotReload": true,
  "logModeSwitch": true
}
```

`anthropicToolMode` 合法取值：

- `native_bridge`
- `prompt_emulation`

## 共同的外部契约

无论激活哪种方法，客户端看到的都是标准 Anthropic Messages 响应：

- 请求侧：`tools[]`、`tool_choice`、`messages[].content[]` 内容块
- assistant 侧：`tool_use` 块，`stop_reason: "tool_use"`
- 用户续接：`tool_result` 块

两种方法的差异仅在于 **代理内部如何向 Windsurf Cascade 上游兑现这份契约**。

## 英文版

- [`bash-native-bridge-reinjection.md`](./bash-native-bridge-reinjection.md)
- [`system-prompt-tool-emulation.md`](./system-prompt-tool-emulation.md)
- [`README.md`](./README.md)
