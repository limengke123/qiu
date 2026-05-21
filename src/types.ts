// ── Messages ──

export interface TextContent {
	type: "text";
	text: string;
}

export interface ImageContent {
	type: "image";
	data: string;
	mimeType: string;
}

export interface ToolCall {
	type: "toolCall";
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

export interface UserMessage {
	role: "user";
	content: string | (TextContent | ImageContent)[];
	timestamp: number;
}

export interface AssistantMessage {
	role: "assistant";
	content: (TextContent | ToolCall)[];
	model: string;
	usage: Usage;
	stopReason: StopReason;
	errorMessage?: string;
	timestamp: number;
}

export interface ToolResultMessage {
	role: "toolResult";
	toolCallId: string;
	toolName: string;
	content: TextContent[];
	isError: boolean;
	timestamp: number;
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage;

export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

export interface Usage {
	input: number;
	output: number;
	total: number;
}

// ── Model ──

export interface Model {
	id: string;
	baseUrl: string;
	apiKey?: string;
	maxTokens?: number;
	temperature?: number;
}

// ── Tools ──

export interface JsonSchema {
	type?: string;
	properties?: Record<string, JsonSchema>;
	required?: string[];
	description?: string;
	items?: JsonSchema;
	enum?: unknown[];
	[key: string]: unknown;
}

export interface ToolResult {
	content: TextContent[];
	isError?: boolean;
}

export interface Tool {
	name: string;
	description: string;
	parameters: JsonSchema;
	execute: (
		args: Record<string, unknown>,
		signal?: AbortSignal,
	) => Promise<ToolResult>;
}

// ── Agent Events ──

export type AgentEvent =
	| { type: "agent_start" }
	| { type: "agent_end"; messages: Message[] }
	| { type: "turn_start" }
	| { type: "turn_end"; message: AssistantMessage; toolResults: ToolResultMessage[] }
	| { type: "message_start"; message: Message }
	| { type: "message_delta"; delta: string }
	| { type: "message_end"; message: Message }
	| { type: "tool_start"; toolCallId: string; toolName: string; args: Record<string, unknown> }
	| { type: "tool_end"; toolCallId: string; toolName: string; result: ToolResult; isError: boolean };

// ── Stream events from provider ──

export type ProviderEvent =
	| { type: "start"; partial: AssistantMessage }
	| { type: "text_delta"; delta: string; partial: AssistantMessage }
	| { type: "toolcall_start"; index: number; partial: AssistantMessage }
	| { type: "toolcall_delta"; index: number; delta: string; partial: AssistantMessage }
	| { type: "toolcall_end"; index: number; toolCall: ToolCall; partial: AssistantMessage }
	| { type: "done"; message: AssistantMessage }
	| { type: "error"; message: AssistantMessage };

// ── Agent config ──

export interface AgentConfig {
	model: Model;
	systemPrompt?: string;
	tools?: Tool[];
	maxTurns?: number;
	signal?: AbortSignal;
	beforeToolCall?: (toolCall: ToolCall, args: Record<string, unknown>) => Promise<boolean>;
	afterToolCall?: (toolCall: ToolCall, result: ToolResult) => Promise<ToolResult>;
}
