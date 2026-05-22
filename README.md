# qiu

[中文文档](README_CN.md) | Minimal agent framework for local LLMs.

<div align="center">

**qiu** - A minimal AI Agent framework for local large language models with tool calling capabilities.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20.0%2B-green.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

## ✨ Features

- **Interactive REPL** with streaming output and real-time feedback
- **Multi-Provider Support** - Local models (Ollama) and remote APIs (OpenAI, etc.)
- **Built-in Tools** - Read files, write files, execute shell commands
- **Event-Driven Architecture** - Comprehensive event system with TypeScript type definitions
- **Streaming Tool Calls** - Handles partial JSON for streaming tool parameters
- **Session Management** - Save, load, and resume conversation sessions
- **Rich CLI UI** - Colorful banners, progress bars, markdown rendering, spinner animations
- **Image Attachment** - Drag and drop images directly into the terminal
- **Config Management** - User and project-level configuration with fallback chain

## 📦 Installation

### Prerequisites

- Node.js >= 20.0.0
- npm >= 9.0.0

### Quick Start

```bash
# Clone the repository
git clone https://github.com/yourusername/qiu.git
cd qiu

# Install dependencies
npm install

# Build the project
npm run build

# Run in development mode
npm run dev

# Or use the built CLI directly
node dist/cli.js
```

## 🚀 Usage

### Basic Usage

**Using Ollama (local model)**:
```bash
qiu --model qwen2.5:7b
```

**Using OpenAI**:
```bash
qiu -m gpt-4o-mini -u https://api.openai.com -k sk-...
```

### Command Line Options

```
-m, --model <id>            Model ID (default: qwen2.5:7b)
-u, --base-url <url>        API base URL (default: http://localhost:11434)
-k, --api-key <key>         API key (or set QIU_API_KEY / OPENAI_API_KEY)
-s, --system <prompt>       System prompt
-c, --context-tokens <n>    Max context window tokens
-r, --resume [id]           Resume last session (or specify session ID)
--config                    Show effective configuration
--sessions                  List saved sessions
-h, --help                  Show this help
```

### Environment Variables

For OpenAI-compatible APIs:
```bash
export QIU_API_KEY=sk-...
export QIU_BASE_URL=https://api.openai.com
qiu --model gpt-4o-mini
```

Other environment variables:
```bash
export QIU_MODEL=qwen2.5:7b
export QIU_SYSTEM="You are a helpful coding assistant"
export QIU_MAX_TURNS=10
export QIU_MAX_CONTEXT_TOKENS=128000
```

### Advanced Examples

**Custom model with specific API**:
```bash
npm run dev -- --model Qwen3.6-35B-A3B-4bit -u http://127.0.0.1:8099
```

**With system prompt**:
```bash
qiu --model claude-3-haiku --system "You are a helpful coding assistant"
```

**Resume a previous session**:
```bash
qiu --resume              # Resume latest session
qiu --resume <session-id> # Resume specific session
```

## 💻 REPL Commands

- Type any message to interact with the AI agent
- **Drag and drop** image files directly into the terminal
- `/reset` - Clear the conversation history (new session)
- `/save` - Show current session info
- `/sessions` - List saved sessions
- `/load <id>` - Load a saved session
- `/config` - Show effective configuration
- `/messages` - Show the number of messages in context
- `/help` - Show available commands
- `Ctrl+C` - Exit the application

## 📁 Project Structure

```
src/
├── agent.ts              # AI Agent core logic
├── agent-loop.ts         # Agent loop control
├── cli.ts                # CLI interface (main entry)
├── event-stream.ts       # Event stream handling
├── index.ts              # Main entry point
├── provider.ts           # AI model provider
├── cli/                  # CLI rendering components
│   ├── banner.ts         # Colorful welcome banner
│   ├── markdown.ts       # Markdown rendering
│   ├── separator.ts      # Turn separator with stats
│   ├── spinner.ts        # Spinner animation with elapsed time
│   ├── status-bar.ts     # Status bar (cwd, tokens, progress, session, model)
│   ├── tool-card.ts      # Tool execution card with styled borders
│   ├── theme.ts          # Centralized theme/styling system
│   └── user-message.ts   # User message card
├── tools/                # Built-in tools
│   ├── index.ts
│   ├── read-file.ts
│   ├── shell.ts
│   └── write-file.ts
└── types.ts              # Type definitions
```

## 🔧 Built-in Tools

| Tool | Description | Implementation |
|------|-------------|----------------|
| `shell` | Execute Shell commands | `child_process.execFile()` |
| `read_file` | Read file content | `fs/promises.readFile()` |
| `write_file` | Write files (auto-creates directories) | `fs/promises.writeFile()` |

## 🏗️ Architecture

### Core Components

1. **CLI (`cli.ts`)** - Command-line interface with rich UI (banners, progress bars, markdown)
2. **Agent (`agent.ts`)** - Core agent logic with message management
3. **Agent Loop (`agent-loop.ts`)** - Main execution loop with tool calling
4. **Provider (`provider.ts`)** - API communication layer with streaming support
5. **EventStream (`event-stream.ts`)** - Generic event stream management
6. **CLI Components** - Rich terminal rendering (theme system, markdown, spinner, status bar, tool cards, user messages, separators, banners)

### Data Flow

```
User Input → CLI → Agent → Agent Loop → Provider → Event Stream
                ↓
           Tools (shell/read/write)
```

## 🛠️ Development

### Building from Source

```bash
# Install dependencies
npm install

# Build TypeScript to JavaScript
npm run build

# Run tests (if available)
npm test
```

### Adding Custom Tools

To add a new tool, implement the `Tool` interface:

```typescript
interface Tool {
  name: string;
  description: string;
  parameters: JsonSchema;
  execute: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<ToolResult>;
}
```

## 📚 API Reference

For detailed API documentation, see the source code comments and TypeScript definitions in `src/types.ts`.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Ollama](https://ollama.com/) for local LLM support
- [OpenAI](https://openai.com/) API compatibility
- [chalk](https://github.com/chalk/chalk), [figures](https://github.com/sindresorhus/figures), [gradient-string](https://github.com/sindresorhus/gradient-string), [marked](https://github.com/markedjs/marked), [marked-terminal](https://github.com/webminor/marked-terminal) for CLI rendering
- All contributors who help make qiu better

---

**Made with ❤️ by [your-username]**
