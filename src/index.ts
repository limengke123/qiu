// Core
export { Agent } from "./agent.js";
export type { AgentOptions } from "./agent.js";

// Loop
export { runAgentLoop } from "./agent-loop.js";

// Provider
export { streamChat } from "./provider.js";
export type { ProviderStream, StreamOptions } from "./provider.js";

// Event stream
export { EventStream } from "./event-stream.js";

// Tools
export { defaultTools, shellTool, readFileTool, writeFileTool, strReplaceTool, globTool, grepTool } from "./tools/index.js";

// Types
export type {
	AgentConfig,
	AgentEvent,
	AssistantMessage,
	ImageContent,
	JsonSchema,
	Message,
	Model,
	ProviderEvent,
	StopReason,
	TextContent,
	Tool,
	ToolCall,
	ToolResult,
	ToolResultMessage,
	Usage,
	UserMessage,
} from "./types.js";
