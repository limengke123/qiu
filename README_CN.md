# qiu

[English](README.md) | 面向本地大语言模型的极简 Agent 框架

## 功能特性

- 带流式输出的交互式 REPL
- 支持本地模型（通过 Ollama）和远程 API（OpenAI 等）
- 内置工具：读取文件、写入文件、执行 Shell 命令
- 基于事件架构，提供完整的类型定义
- **会话管理** - 保存、加载和恢复对话会话
- **丰富的 CLI 界面** - 彩色横幅、进度条、Markdown 渲染、旋转动画
- **图片附件** - 直接将图片拖放到终端中
- **配置管理** - 用户级和项目级配置，支持回退链

## 快速开始

### 环境要求

- Node.js >= 20.0.0

### 安装

```bash
npm install
```

### 构建

```bash
npm run build
```

这将把 TypeScript 源代码编译到 `dist/` 目录。

### 运行

**开发模式**（无需构建）：

```bash
npm run dev
```

**使用已构建的 CLI**：

```bash
node dist/cli.js [options]
```

### 参数选项

```
-m, --model <id>            模型 ID（默认：qwen2.5:7b）
-u, --base-url <url>        API 基础 URL（默认：http://localhost:11434）
-k, --api-key <key>         API 密钥（或设置 QIU_API_KEY / OPENAI_API_KEY）
-s, --system <prompt>       系统提示词
-c, --context-tokens <n>    最大上下文窗口 token 数
-r, --resume [id]           恢复上次会话（或指定会话 ID）
--config                    显示有效配置
--sessions                  列出保存的会话
-h, --help                  显示帮助信息
```

### 使用示例

**使用 Ollama（本地模型）**：
```bash
qiu --model qwen2.5:7b
```

**使用 Qwen3.6-35B-A3B-4bit**：
```bash
npm run dev -- --model Qwen3.6-35B-A3B-4bit -u http://127.0.0.1:8099
```

**使用 OpenAI**：
```bash
qiu -m gpt-4o-mini -u https://api.openai.com -k sk-...
```

**使用环境变量**：
```bash
export QIU_API_KEY=sk-...
export QIU_BASE_URL=https://api.openai.com
qiu --model gpt-4o-mini
```

**恢复之前的会话**：
```bash
qiu --resume              # 恢复最新会话
qiu --resume <session-id> # 恢复特定会话
```

## REPL 命令

- 输入任意消息与 Agent 交互
- **直接拖放**图片文件到终端以附加图片
- `/reset` - 清除对话历史（新会话）
- `/save` - 显示当前会话信息
- `/sessions` - 列出已保存的会话
- `/load <id>` - 加载已保存的会话
- `/config` - 显示有效配置
- `/messages` - 显示上下文中的消息数量
- `/help` - 显示可用命令
- `Ctrl+C` - 退出

## 项目结构

```
src/
├── agent.ts              # AI Agent 核心逻辑
├── agent-loop.ts         # Agent 循环控制
├── cli.ts                # CLI 命令行界面（主入口）
├── event-stream.ts       # 事件流处理
├── index.ts              # 主入口文件
├── provider.ts           # AI 模型提供商
├── cli/                  # CLI 渲染组件
│   ├── banner.ts         # 彩色欢迎横幅
│   ├── markdown.ts       # Markdown 渲染
│   ├── separator.ts      # 带统计的回合分隔线
│   ├── spinner.ts        # 带耗时显示的旋转动画
│   ├── status-bar.ts     # 状态栏（cwd, tokens, 进度, 会话, 模型）
│   ├── tool-card.ts      # 带样式边框的工具执行卡片
│   ├── theme.ts          # 集中式主题/样式系统
│   └── user-message.ts   # 用户消息卡片
├── tools/                # 内置工具
│   ├── index.ts
│   ├── read-file.ts
│   ├── shell.ts
│   └── write-file.ts
└── types.ts              # 类型定义
```

## 内置工具

| 工具 | 功能 | 核心实现 |
|------|------|----------|
| `shell` | 执行 Shell 命令 | 使用 `child_process.execFile()` |
| `read_file` | 读取文件内容 | 使用 `fs/promises.readFile()` |
| `write_file` | 写入文件 | 使用 `fs/promises.writeFile()`，自动创建目录 |

## 代码流程与核心组件

本节详细解释代码架构和核心组件。

### 项目概览

`qiu` 是一个**极简的 AI Agent 框架**，专为本地部署的大语言模型（如 Ollama）设计，同时也支持远程 API（OpenAI 等）。它提供命令行交互界面（REPL），可以让 AI 模型**自动调用工具**（读取/写入文件、执行 Shell 命令）来帮助用户完成任务。

**关键特性：**
- 流式输出（Streaming），实时显示 AI 回复
- 支持本地模型（Ollama）和远程 API（OpenAI 等）
- 内置三种工具：shell 命令执行、读取文件、写入文件
- 基于事件驱动架构
- 会话管理、丰富的 CLI 界面、图片附件、配置管理

---

### 核心代码流程

整个程序由 **CLI 入口 → Agent 核心 → Agent Loop 循环 → Provider 流式通信** 构成。

#### 流程图：

```
用户输入
   ↓
CLI (cli.ts) 解析参数，创建 Agent 实例，启动 REPL 交互
   ↓
Agent.prompt() (agent.ts) 接收用户消息
   ↓
Agent.run() 调用 runAgentLoop()
   ↓
Agent 循环 (agent-loop.ts):
   1. 调用 AI 模型获取回复（流式）
   2. 如果回复中包含工具调用（tool call），执行工具
   3. 将工具结果作为上下文再次发送给 AI
   4. 重复直到 AI 不再调用工具或达到最大轮次
   ↓
Provider (provider.ts) 与 OpenAI 兼容 API 通信
   ↓
EventStream (event-stream.ts) 管理事件流
```

---

### 核心代码详解

#### 1. **CLI 入口 (`src/cli.ts`)** — 程序入口点

```typescript
// 核心流程：
// 1. 解析命令行参数 (model, base-url, api-key, system prompt)
// 2. 创建 Agent 实例，配置模型和工具
// 3. 订阅事件，实现流式输出到终端
// 4. 启动 REPL 交互式命令行
```

**关键代码段：**
- **参数解析** (第 49-99 行)：手动解析 `--model`、`--base-url`、`-k`、`-c`、`--resume` 等参数
- **Agent 实例化** (第 157-169 行)：创建 Agent 并配置默认系统提示和工具
- **事件监听** (第 213-301 行)：订阅 agent 事件，实现：
  - `message_delta`：实时打印 AI 回复文本
  - `message_end`：清除原始流式输出，用 Markdown 重新渲染
  - `tool_start` / `tool_end`：显示工具执行状态
  - `context_truncated`：上下文截断警告
- **REPL 交互** (第 395-455 行)：使用 Node.js `readline` 模块，处理命令和 `Ctrl+C`
- **子命令**：`config` 和 `sessions` 子命令

**新增功能：**
- 富 CLI 界面：横幅、进度条、Markdown 渲染、旋转动画
- 拖放图片支持（括号粘贴模式）
- 会话管理（保存、加载、恢复）
- 配置管理系统

#### 2. **Agent 核心 (`src/agent.ts`)** — Agent 类

```typescript
class Agent {
  // 属性
  public messages: Message[] = [];  // 对话历史（transcript）
  public tools: Tool[];             // 可用工具列表
  
  // 核心方法
  async prompt(input: string | Message | Message[]): Promise<Message[]>
  // 接收用户输入，启动 Agent 运行流程
  
  subscribe(listener: (event: AgentEvent) => void): () => void
  // 订阅事件，返回取消订阅函数
  
  reset(): void  // 清空对话历史
  abort(): void  // 中止当前运行
}
```

**关键设计：**
- 使用**观察者模式**管理事件监听器
- 维护完整的对话历史 `messages` 数组
- 支持并发控制：`activeRun` 防止重复处理
- 支持生命周期钩子：`beforeToolCall` 和 `afterToolCall` 允许拦截/修改工具调用

#### 3. **Agent 循环 (`src/agent-loop.ts`)** — 核心循环逻辑

```typescript
async function runAgentLoop(
  prompts: Message[],      // 用户输入
  context: Message[],      // 历史对话
  config: AgentConfig,     // 配置
  emit: AgentEventSink,    // 事件发射器
): Promise<Message[]>
```

**循环逻辑：**

```typescript
while (turns < maxTurns) {
  // 1. 向 AI 模型发送消息，获取回复（流式）
  const assistantMsg = await streamAssistantResponse(allMessages, config, emit);
  
  // 2. 如果回复中有工具调用，执行工具
  const toolCalls = assistantMsg.content.filter(c => c.type === 'toolCall');
  for (const tc of toolCalls) {
    const resultMsg = await executeToolCall(tc, config.tools, config, emit);
    allMessages.push(resultMsg);  // 将工具结果加入对话历史
  }
  
  // 3. 如果没有工具调用，结束循环
  if (toolCalls.length === 0) break;
}
```

**核心函数 `streamAssistantResponse`**：
- 调用 `streamChat()` 获取流式响应
- 将 `ProviderEvent` 转换为 `AgentEvent` 并分发

**核心函数 `executeToolCall`**：
- 查找匹配的工具
- 调用 `beforeToolCall` 钩子（可阻止执行）
- 执行工具并捕获错误
- 调用 `afterToolCall` 钩子（可修改结果）

#### 4. **Provider 通信 (`src/provider.ts`)** — API 通信层

```typescript
export function streamChat(
  model: Model,
  systemPrompt: string | undefined,
  messages: Message[],
  tools: Tool[],
  options?: StreamOptions,
): ProviderStream
```

**核心功能：**
- 使用原生 `fetch()` API 发送 HTTP 请求
- 解析 **SSE (Server-Sent Events)** 流式响应
- 支持**流式工具调用解析**：使用 `partial-json` 库处理分块 JSON

**关键处理流程：**
1. 构建 OpenAI 兼容格式的请求体（第 173-206 行）
2. 使用 `response.body.getReader()` 读取流（第 228 行）
3. 逐行解析 SSE 数据，提取文本和工具调用
4. 处理**分块的工具调用参数**（第 293-358 行）：
   - 维护 `toolCallPartials` 临时存储分块的工具调用信息
   - 使用 `parsePartialJson()` 处理不完整的 JSON

#### 5. **事件流 (`src/event-stream.ts`)** — 通用事件流管理

```typescript
class EventStream<T, R = T> implements AsyncIterable<T> {
  private queue: T[] = [];
  private waiting: ((value: IteratorResult<T>) => void)[] = [];
  
  push(event: T): void        // 生产者：推送事件
  end(result?: R): void       // 结束流
  result(): Promise<R>        // 获取最终结果
}
```

**设计亮点：**
- 实现 `AsyncIterable` 接口，支持 `for-await-of` 语法
- 支持**推/拉**两种使用方式
- 消费者通过 `for await (const event of stream)` 消费事件
- 生产者通过 `stream.push(event)` 推送事件

#### 6. **CLI 组件 (`src/cli/`)** — 富终端界面

| 组件 | 功能 |
|------|------|
| `theme.ts` | 集中式主题系统，统一管理颜色和样式 |
| `banner.ts` | 彩色欢迎横幅（带渐变效果） |
| `spinner.ts` | 旋转动画 + 运行时间显示 |
| `status-bar.ts` | 状态栏（cwd、git 分支、token 统计、进度条、会话、模型） |
| `tool-card.ts` | 工具执行卡片（带边框、背景色、状态图标） |
| `markdown.ts` | Markdown 渲染（使用 `marked` 库） |
| `separator.ts` | 回合分隔线（显示统计信息） |
| `user-message.ts` | 用户消息卡片 |

#### 7. **工具系统 (`src/tools/`)** — 内置工具

**三种内置工具：**

| 工具 | 功能 | 核心实现 |
|------|------|----------|
| `shell` | 执行 Shell 命令 | 使用 `child_process.execFile()` |
| `read_file` | 读取文件内容 | 使用 `fs/promises.readFile()` |
| `write_file` | 写入文件 | 使用 `fs/promises.writeFile()`，自动创建目录 |

**工具接口 (`types.ts`)：**
```typescript
interface Tool {
  name: string;
  description: string;
  parameters: JsonSchema;  // 工具参数的 JSON Schema
  execute: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<ToolResult>;
}
```

---

### 核心架构总结

```
┌─────────────────────────────────────────────────────┐
│                     CLI (cli.ts)                     │
│  ┌─────────────┐    ┌──────────────────────────┐   │
│  │ 参数解析     │    │ 事件监听 (订阅机制)       │   │
│  └─────────────┘    └──────────────────────────┘   │
│  ┌─────────────┐    ┌──────────────────────────┐   │
│  │ 富 CLI 界面  │    │ 会话管理                 │   │
│  └─────────────┘    └──────────────────────────┘   │
└─────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────┐
│                   Agent (agent.ts)                   │
│  ┌─────────────┐    ┌──────────────────────────┐   │
│  │ 消息管理     │    │ 生命周期钩子              │   │
│  └─────────────┘    └──────────────────────────┘   │
└─────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────┐
│              Agent Loop (agent-loop.ts)              │
│  ┌─────────────┐    ┌──────────────────────────┐   │
│  │ 循环控制     │    │ 工具执行引擎              │   │
│  └─────────────┘    └──────────────────────────┘   │
└─────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────┐
│                 Provider (provider.ts)               │
│  ┌─────────────┐    ┌──────────────────────────┐   │
│  │ API 通信     │    │ 流式响应解析              │   │
│  └─────────────┘    └──────────────────────────┘   │
└─────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────┐
│              EventStream (event-stream.ts)           │
│  ┌─────────────┐    ┌──────────────────────────┐   │
│  │ 事件队列     │    │ 异步迭代协议              │   │
│  └─────────────┘    └──────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

---

### 关键技术点

1. **流式处理**：使用 Node.js ReadableStream 和 SSE 协议实现实时输出
2. **事件驱动架构**：通过事件系统解耦各组件
3. **类型安全**：全面的 TypeScript 类型定义（Message、Tool、AgentEvent 等）
4. **工具调用**：支持模型自动决定何时调用工具，实现真正的 Agent 能力
5. **部分 JSON 解析**：使用 `partial-json` 库处理分块的工具调用参数
6. **富 CLI 界面**：集中式主题系统，提供横幅、进度条、Markdown 渲染等丰富终端体验
7. **会话管理**：支持保存、加载和恢复对话会话
8. **配置管理**：用户级和项目级配置文件，支持环境变量覆盖

---

### 总结

这是一个设计精良的**极简 AI Agent 框架**，核心亮点在于：

- **简洁**：核心功能简洁，同时通过富 CLI 界面提升用户体验
- **灵活**：支持多种 AI 后端（Ollama、OpenAI 等）
- **可扩展**：通过 `Tool` 接口轻松添加新工具
- **实用**：内置文件操作和命令执行工具，真正具备"助手"能力
- **富界面**：彩色横幅、进度条、Markdown 渲染、旋转动画等丰富的终端体验

核心流程可概括为：**用户输入 → Agent 调度 → AI 回复 → 工具执行 → 循环**，直到 AI 不再需要调用工具为止。

## 许可证

MIT
