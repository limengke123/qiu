# qiu

Minimal agent framework for local LLMs.

## Features

- Interactive REPL with streaming output
- Support for local models (via Ollama) and remote APIs (OpenAI, etc.)
- Built-in tools: read files, write files, execute shell commands
- Event-based architecture with comprehensive type definitions

## Getting Started

### Prerequisites

- Node.js >= 20.0.0

### Installation

```bash
npm install
```

### Building

```bash
npm run build
```

This compiles the TypeScript source to the `dist/` directory.

### Running

**Development mode** (without building):

```bash
npm run dev
```

**Using the built CLI**:

```bash
node dist/cli.js [options]
```

### Options

```
-m, --model <id>       Model ID (default: qwen2.5:7b)
-u, --base-url <url>   API base URL (default: http://localhost:11434)
-k, --api-key <key>    API key (or set QIU_API_KEY / OPENAI_API_KEY)
-s, --system <prompt>  System prompt
-h, --help             Show this help
```

### Examples

**Using Ollama (local)**:
```bash
qiu --model qwen2.5:7b
```

**Using Qwen3.6-35B-A3B-4bit**:
```bash
npm run dev -- --model Qwen3.6-35B-A3B-4bit -u http://127.0.0.1:8099
```

**Using OpenAI**:
```bash
qiu -m gpt-4o-mini -u https://api.openai.com -k sk-...
```

**Using environment variables**:
```bash
export QIU_API_KEY=sk-...
export QIU_BASE_URL=https://api.openai.com
qiu --model gpt-4o-mini
```

## REPL Commands

- Type any message to interact with the agent
- `/reset` - Clear the conversation history
- `/messages` - Show the number of messages in context
- `Ctrl+C` - Exit

## Project Structure

```
src/
├── agent.ts           # AI Agent core logic
├── agent-loop.ts      # Agent loop control
├── cli.ts             # CLI interface
├── event-stream.ts    # Event stream handling
├── index.ts           # Main entry point
├── provider.ts        # AI model provider
├── tools/             # Built-in tools
│   ├── index.ts
│   ├── read-file.ts
│   ├── shell.ts
│   └── write-file.ts
└── types.ts           # Type definitions
```

## Code Flow and Core Components

This section explains the code architecture and core components in detail.

### Overview

`qiu` is a **minimal AI Agent framework** designed for locally deployed large language models (such as Ollama), while also supporting remote APIs (OpenAI, etc.). It provides a command-line interface (REPL) that allows AI models to **automatically call tools** (read/write files, execute Shell commands) to help users complete tasks.

**Key Features:**
- Streaming output, displaying AI responses in real-time
- Supports local models (Ollama) and remote APIs (OpenAI, etc.)
- Built-in three tools: shell command execution, file reading, file writing
- Event-driven architecture

---

### Core Code Flow

The entire program consists of **CLI entry → Agent core → Agent Loop → Provider streaming communication**.

#### Flowchart:

```
User Input
   ↓
CLI (cli.ts) parses parameters, creates Agent instance, starts REPL interaction
   ↓
Agent.prompt() (agent.ts) receives user messages
   ↓
Agent.run() calls runAgentLoop()
   ↓
Agent Loop (agent-loop.ts):
   1. Calls AI model to get response (streaming)
   2. If response contains tool calls, executes tools
   3. Adds tool results as context and sends to AI again
   4. Repeats until AI stops calling tools or max turns reached
   ↓
Provider (provider.ts) communicates with OpenAI-compatible API
   ↓
EventStream (event-stream.ts) manages event streams
```

---

### Core Code Details

#### 1. **CLI Entry (`src/cli.ts`)** — Program Entry Point

```typescript
// Core flow:
// 1. Parse command-line parameters (model, base-url, api-key, system prompt)
// 2. Create Agent instance, configure model and tools
// 3. Subscribe to events, implement streaming output to terminal
// 4. Start REPL interactive command line
```

**Key Code Sections:**
- **Parameter parsing** (lines 22-64): Manually parse `--model`, `--base-url`, `-k` parameters
- **Agent instantiation** (lines 108-114): Create Agent and configure default system prompt and tools
- **Event listening** (lines 122-179): Subscribe to agent events, implement:
  - `message_delta`: Print AI response text in real-time
  - `tool_start` / `tool_end`: Display tool execution status
  - `message_end`: Handle error messages
- **REPL interaction** (lines 182-229): Use Node.js `readline` module, handle `/reset` and `/messages` commands

#### 2. **Agent Core (`src/agent.ts`)** — Agent Class

```typescript
class Agent {
  // Properties
  public messages: Message[] = [];  // Conversation history (transcript)
  public tools: Tool[];             // List of available tools
  
  // Core methods
  async prompt(input: string | Message | Message[]): Promise<Message[]>
  // Accepts user input, starts Agent execution flow
  
  subscribe(listener: (event: AgentEvent) => void): () => void
  // Subscribe to events, returns unsubscribe function
  
  reset(): void  // Clear conversation history
  abort(): void  // Abort current execution
}
```

**Key Design:**
- Uses **observer pattern** to manage event listeners
- Maintains complete conversation history `messages` array
- Supports concurrency control: `activeRun` prevents duplicate processing
- Supports lifecycle hooks: `beforeToolCall` and `afterToolCall` allow intercepting/modifying tool calls

#### 3. **Agent Loop (`src/agent-loop.ts`)** — Core Loop Logic

```typescript
async function runAgentLoop(
  prompts: Message[],      // User input
  context: Message[],      // Conversation history
  config: AgentConfig,     // Configuration
  emit: AgentEventSink,    // Event emitter
): Promise<Message[]>
```

**Loop Logic:**

```typescript
while (turns < maxTurns) {
  // 1. Send messages to AI model to get response (streaming)
  const assistantMsg = await streamAssistantResponse(allMessages, config, emit);
  
  // 2. If response contains tool calls, execute tools
  const toolCalls = assistantMsg.content.filter(c => c.type === 'toolCall');
  for (const tc of toolCalls) {
    const resultMsg = await executeToolCall(tc, config.tools, config, emit);
    allMessages.push(resultMsg);  // Add tool results to conversation history
  }
  
  // 3. If no tool calls, end the loop
  if (toolCalls.length === 0) break;
}
```

**Core function `streamAssistantResponse`**:
- Calls `streamChat()` to get streaming response
- Converts `ProviderEvent` to `AgentEvent` and dispatches

**Core function `executeToolCall`**:
- Finds matching tool
- Calls `beforeToolCall` hook (can block execution)
- Executes tool and captures errors
- Calls `afterToolCall` hook (can modify results)

#### 4. **Provider Communication (`src/provider.ts`)** — API Communication Layer

```typescript
export function streamChat(
  model: Model,
  systemPrompt: string | undefined,
  messages: Message[],
  tools: Tool[],
  options?: StreamOptions,
): ProviderStream
```

**Core Functionality:**
- Uses native `fetch()` API to send HTTP requests
- Parses **SSE (Server-Sent Events)** streaming response
- Supports **streaming tool call parsing**: Uses `partial-json` library to handle chunked JSON

**Key Processing Flow:**
1. Build OpenAI-compatible request body (lines 173-206)
2. Read stream using `response.body.getReader()` (line 228)
3. Parse SSE data line by line, extract text and tool calls
4. Handle **chunked tool call parameters** (lines 293-358):
   - Maintain `toolCallPartials` to temporarily store chunked tool call information
   - Use `parsePartialJson()` to process incomplete JSON

#### 5. **Event Stream (`src/event-stream.ts`)** — Generic Event Stream Management

```typescript
class EventStream<T, R = T> implements AsyncIterable<T> {
  private queue: T[] = [];
  private waiting: ((value: IteratorResult<T>) => void)[] = [];
  
  push(event: T): void        // Producer: push events
  end(result?: R): void       // End stream
  result(): Promise<R>        // Get final result
}
```

**Design Highlights:**
- Implements `AsyncIterable` interface, supports `for-await-of` syntax
- Supports both **push/pull** usage modes
- Consumers consume events via `for await (const event of stream)`
- Producers push events via `stream.push(event)`

#### 6. **Tool System (`src/tools/`)** — Built-in Tools

**Three Built-in Tools:**

| Tool | Function | Core Implementation |
|------|----------|---------------------|
| `shell` | Execute Shell commands | Uses `child_process.execFile()` |
| `read_file` | Read file content | Uses `fs/promises.readFile()` |
| `write_file` | Write files | Uses `fs/promises.writeFile()`, auto-creates directories |

**Tool Interface (`types.ts`):**
```typescript
interface Tool {
  name: string;
  description: string;
  parameters: JsonSchema;  // JSON Schema for tool parameters
  execute: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<ToolResult>;
}
```

---

### Core Architecture Summary

```
┌─────────────────────────────────────────────────────┐
│                     CLI (cli.ts)                     │
│  ┌─────────────┐    ┌──────────────────────────┐   │
│  │ Parameter    │    │ Event Listener (Subscrip │   │
│  │ Parsing      │    │ tion Mechanism)          │   │
│  └─────────────┘    └──────────────────────────┘   │
└─────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────┐
│                   Agent (agent.ts)                   │
│  ┌─────────────┐    ┌──────────────────────────┐   │
│  │ Message      │    │ Lifecycle Hooks          │   │
│  │ Management   │    │                          │   │
│  └─────────────┘    └──────────────────────────┘   │
└─────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────┐
│              Agent Loop (agent-loop.ts)              │
│  ┌─────────────┐    ┌──────────────────────────┐   │
│  │ Loop Control │    │ Tool Execution Engine    │   │
│  └─────────────┘    └──────────────────────────┘   │
└─────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────┐
│                 Provider (provider.ts)               │
│  ┌─────────────┐    ┌──────────────────────────┐   │
│  │ API          │    │ Streaming Response       │   │
│  │ Communication│    │ Parsing                  │   │
│  └─────────────┘    └──────────────────────────┘   │
└─────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────┐
│              EventStream (event-stream.ts)           │
│  ┌─────────────┐    ┌──────────────────────────┐   │
│  │ Event Queue  │    │ Async Iteration Protocol │   │
│  └─────────────┘    └──────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

---

### Key Technical Points

1. **Streaming Processing**: Uses Node.js ReadableStream and SSE protocol for real-time output
2. **Event-Driven Architecture**: Decouples components through event system
3. **Type Safety**: Comprehensive TypeScript type definitions (Message, Tool, AgentEvent, etc.)
4. **Tool Calls**: Supports AI automatically deciding when to call tools, enabling true Agent capabilities
5. **Partial JSON Parsing**: Uses `partial-json` library to handle chunked tool call parameters

---

### Summary

This is a **well-designed minimal AI Agent framework** with core highlights:

- **Concise**: Only 11 source files, low code volume but complete functionality
- **Flexible**: Supports multiple AI backends (Ollama, OpenAI, etc.)
- **Extensible**: Easily add new tools through `Tool` interface
- **Practical**: Built-in file operations and command execution tools, truly capable as an "assistant"

The core flow can be summarized as: **User Input → Agent Scheduling → AI Response → Tool Execution → Loop**, until the AI no longer needs to call tools.

## License

MIT
