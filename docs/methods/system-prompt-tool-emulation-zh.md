# 提示词模拟模式 — 系统提示词工具协议

**两种可切换的 Anthropic 工具方法之一。** 选型说明见 [`README-zh.md`](./README-zh.md)。

这个方法把 Anthropic 工具契约序列化成纯文本并注入到 Cascade 系统提示词区域，要求模型按严格格式输出 `<tool_call>` 块；代理再在服务端解析这些块并翻译回 Anthropic `tool_use`，以此支持 Claude Code 风格的工具调用。

这是一层 **提示词级兼容层**。它不依赖 Windsurf 原生工具规划——事实上会刻意绕开——并且支持任意工具，不仅仅是 Bash。

## 短版本

1. 把传入的 Anthropic `tools[]` 转成一份文本协议。
2. 把该协议注入到 Cascade 系统提示词区域。
3. 要求模型按严格格式输出 `<tool_call>...</tool_call>` 块。
4. 代理在服务端解析这些块，翻译回 Anthropic `tool_use`。
5. 在下一轮，Anthropic `tool_result` 消息被改写为带标签的 transcript 文本，会话继续。

## 适用范围

适用于：

- `POST /v1/messages`
- Claude Code 或其他 Anthropic 兼容客户端
- 代理需要支持任意 Anthropic 工具，且不依赖上游原生工具提案的场景

不替代：

- 真正的上游原生结构化工具 API
- 下游客户端本地执行 shell / 文件操作的原生桥接（见 [原生桥接](./bash-native-bridge-reinjection-zh.md)）
- `/v1/chat/completions` 或 `/v1/responses` 上的 OpenAI 风格工具调用

## 核心思路

Anthropic 客户端期望的是结构化函数调用契约；Windsurf Cascade 暴露的是提示词导向的会话形态。本方法通过让代理同时掌握文本协议的两端来弥合这个差距：

- **注入的前置说明** 教模型如何输出工具调用
- **服务端解析器** 把这些输出翻译回结构化 Anthropic 对象

要求模型输出严格机器可读的标签：

```xml
<tool_call>{"name":"<function_name>","arguments":{...}}</tool_call>
```

服务端把该标签视为传输格式，而不是用户可见文本。

## 端到端流程

### 1. 接收 Anthropic 请求

请求载荷为标准 Anthropic Messages：`model`、`messages`、可选 `system`、可选 `tools`、可选 `tool_choice`。

若没有 `tools`，则按普通 Anthropic 文本请求处理，退出本模式。

若有 `tools`，进入提示词模拟。

### 2. 把 `tools[]` 转成提示词协议

每个 Anthropic 工具定义被改写为一段可读的文本段，包含：

- 工具名
- 描述
- JSON 参数 schema
- 明确的输出规则

注入的规则告知模型：

- 工具调用应该如何格式化
- `arguments` 必须是合法 JSON
- 允许连续输出多个工具调用
- 最后一个工具调用之后必须停止生成
- 工具结果会在下一轮以 `<tool_result ...>` 标签返回

`tool_choice` 被映射成提示词指令：

- `auto`：合适时调用工具
- `required` / `any`：必须调用至少一个工具
- 指定工具：优先调用该工具
- `none`：直接文本回答，不调用工具

### 3. 把消息历史改写成文本 transcript

Anthropic 内容块被标准化为纯文本轮次：

- assistant 的 `tool_use` 变为一行 `<tool_call>...</tool_call>`
- user 的 `tool_result` 变为 `<tool_result tool_call_id="...">...</tool_result>` 块

这让工具历史得以跨轮次保留，尽管上游模型只看到文本 transcript。

### 4. 以"原生工具关闭"发送给 Cascade

代理以下列内容向 Windsurf 转发：

- 标准化后的 transcript
- 注入的工具前置说明
- 一种 **关闭 Windsurf 自身工具规划** 的规划配置

在这里只能有一份工具行为真相。Windsurf 原生规划与提示词模拟规划不能在同一条请求路径里同时生效，否则模型可能产生混合输出，而服务端无法稳定解析。

### 5. 接收普通 assistant 文本

上游 Cascade 返回普通 assistant 文本。在本模式下，文本可能包含：

- 没有工具标签 — 正常 assistant 回答
- 一个或多个 `<tool_call>...</tool_call>` 块

此时 **还不会** 向客户端返回任何响应。

### 6. 服务端解析 `<tool_call>` 块

代理扫描返回文本中的工具标签。对每个块：

1. 解析其中的 JSON
2. 校验形状为 `{"name": "...", "arguments": {...}}`
3. 按声明的 input schema 过滤 `arguments`
4. 生成 Anthropic 风格的 tool use id
5. 从用户可见的 assistant 文本中移除原始标签

随后代理返回标准 Anthropic 响应：

- 剩余非工具文本作为 text 块返回
- 解析到的调用作为 `tool_use` 块返回
- 出现工具调用时，`stop_reason` 为 `tool_use`

### 7. 接收后续 `tool_result`

当客户端下一轮发送 `tool_result` 时，代理不会尝试重放原生上游 tool result 对象。它会：

1. 把每个 `tool_result` 改写为带标签的 transcript 文本
2. 重建对话历史
3. 使用相同提示词协议发起新的上游 Cascade 请求
4. 让模型基于更新后的 transcript 继续

如果模型此时以纯文本回答，代理返回普通 Anthropic assistant 消息。如果再次输出工具标签，则循环继续。

## 提示词协议设计

协议需要对模型容易遵守，对服务端容易解析。

必要属性：

- 一个标签块内仅含一次工具调用
- JSON 在一行（逻辑上的一行）
- 明确的 `name`
- 明确的 `arguments`
- 最后一个工具调用块之后不再输出任何文本

工具调用形状：

```xml
<tool_call>{"name":"Bash","arguments":{"command":"pwd"}}</tool_call>
```

工具结果形状（透过 transcript 回注）：

```xml
<tool_result tool_call_id="toolu_123">
command output here
</tool_result>
```

真正翻译回 Anthropic 响应对象的职责在服务端。

## 为什么注入系统提示词而不是走上游工具

真正的问题在于接口不匹配：

- Anthropic 期望一套下游函数调用契约
- Windsurf Cascade 暴露的是提示词导向的会话形态
- 代理需要一份自己完全掌握的稳定契约

提示词注入之所以可行：

- 代理同时掌握提示词协议与解析器
- 客户端仍然收到标准 Anthropic 响应
- 实现被隔离在 Anthropic 端点内
- 不依赖每个工具都能得到上游原生提案

## 优势

- 支持任意 Anthropic 工具，不只是 Bash
- 保持 Anthropic 外部兼容契约
- 支持多轮工具会话
- 服务端完全掌握解析与校验
- 仅作用于 Anthropic 端点，不影响 OpenAI / Responses 路径

## 限制

- 本质上仍是提示词级模拟，不是原生函数调用；可靠性依赖模型遵守输出协议
- 畸形或不完整的工具标签必须被降级为普通文本或拒绝
- 参数校验强度受限于 input schema 的过滤能力
- OpenAI 与 Responses 上的工具输入仍是独立问题
- 必须从用户可见文本中剥离所有工具标签，任何泄漏都是显性 bug

## 建议的防护栏

- 让标签语法保持狭窄且明确
- 按声明的 input schema 过滤解析后的参数
- 始终从用户可见文本中剥离工具标签
- 记录何时进入该模式
- 记录解析到的工具名与数量
- 记录畸形标签的情形
- 将实现隔离在 `/v1/messages` 内
- 不要在同一条请求路径中混用提示词模拟与上游原生工具规划

## 验证清单

至少应验证：

1. 纯文本的 `/v1/messages` 请求行为不变。
2. 带工具的请求返回 Anthropic `tool_use`，而不是原始标签文本。
3. 后续 `tool_result` 请求能够正确产生下一条 assistant 回答。
4. `tool_choice` 各模式的行为符合预期。
5. 服务端从不向客户端泄漏原始 `<tool_call>` 文本。
6. 畸形工具标签不会让请求处理崩溃。

## 示例

### 请求

```json
{
  "model": "claude-sonnet-4-6",
  "messages": [
    { "role": "user", "content": "Use the Bash tool to print the current working directory." }
  ],
  "tools": [
    {
      "name": "Bash",
      "description": "Execute shell commands.",
      "input_schema": {
        "type": "object",
        "properties": { "command": { "type": "string" } },
        "required": ["command"]
      }
    }
  ],
  "tool_choice": { "type": "tool", "name": "Bash" }
}
```

### 第一次响应

```json
{
  "role": "assistant",
  "content": [
    { "type": "tool_use", "id": "toolu_123", "name": "Bash", "input": { "command": "pwd" } }
  ],
  "stop_reason": "tool_use"
}
```

### 后续结果

```json
{
  "role": "user",
  "content": [
    {
      "type": "tool_result",
      "tool_use_id": "toolu_123",
      "content": [{ "type": "text", "text": "/tmp/windsurf-workspace" }]
    }
  ]
}
```

### 最终响应

```json
{
  "role": "assistant",
  "content": [
    { "type": "text", "text": "The current working directory is /tmp/windsurf-workspace." }
  ],
  "stop_reason": "end_turn"
}
```

## 何时选择此模式

以下场景应选择 `prompt_emulation`：

- 需要立刻支持任意 Anthropic 工具，不仅是 Bash
- 不能指望上游对每个工具都产出原生提案
- 代理需要完全掌握工具兼容层
- 先跑通一份工作桥接比等待上游原生完美工具接口更重要

若只需要 Bash 工具，并希望命令通过 Windsurf 已验证的原生交互通道在客户端本地执行，优先选择 [`native_bridge`](./bash-native-bridge-reinjection-zh.md)。
