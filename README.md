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

## License

MIT
