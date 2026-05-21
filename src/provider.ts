/**
 * OpenAI-compatible streaming provider using raw fetch + SSE parsing.
 * Works with Ollama, llama.cpp, vLLM, LM Studio, OpenAI, etc.
 */

import { parse as parsePartialJson } from "partial-json";
import { EventStream } from "./event-stream.js";
import type {
	AssistantMessage,
	Message,
	Model,
	ProviderEvent,
	TextContent,
	Tool,
	ToolCall,
	Usage,
} from "./types.js";

export type ProviderStream = EventStream<ProviderEvent, AssistantMessage>;

export interface StreamOptions {
	signal?: AbortSignal;
	temperature?: number;
	maxTokens?: number;
}

interface OpenAIToolCallDelta {
	index: number;
	id?: string;
	function?: {
		name?: string;
		arguments?: string;
	};
}

interface OpenAIChunk {
	id?: string;
	model?: string;
	choices?: Array<{
		delta?: {
			content?: string | null;
			tool_calls?: OpenAIToolCallDelta[];
		};
		finish_reason?: string | null;
	}>;
	usage?: {
		prompt_tokens?: number;
		completion_tokens?: number;
		total_tokens?: number;
	};
}

function buildMessages(
	systemPrompt: string | undefined,
	messages: Message[],
): unknown[] {
	const out: unknown[] = [];

	if (systemPrompt) {
		out.push({ role: "system", content: systemPrompt });
	}

	for (const msg of messages) {
		if (msg.role === "user") {
			const content =
				typeof msg.content === "string"
					? msg.content
					: msg.content.map((c) =>
							c.type === "text"
								? { type: "text", text: c.text }
								: {
										type: "image_url",
										image_url: {
											url: `data:${c.mimeType};base64,${c.data}`,
										},
									},
						);
			out.push({ role: "user", content });
		} else if (msg.role === "assistant") {
			const text = msg.content
				.filter((c): c is TextContent => c.type === "text")
				.map((c) => c.text)
				.join("");
			const toolCalls = msg.content.filter(
				(c): c is ToolCall => c.type === "toolCall",
			);

			const assistantMsg: Record<string, unknown> = {
				role: "assistant",
				content: text || null,
			};
			if (toolCalls.length > 0) {
				assistantMsg.tool_calls = toolCalls.map((tc) => ({
					id: tc.id,
					type: "function",
					function: {
						name: tc.name,
						arguments: JSON.stringify(tc.arguments),
					},
				}));
			}
			out.push(assistantMsg);
		} else if (msg.role === "toolResult") {
			out.push({
				role: "tool",
				tool_call_id: msg.toolCallId,
				content: msg.content.map((c) => c.text).join("\n"),
			});
		}
	}

	return out;
}

function buildTools(tools: Tool[]): unknown[] {
	return tools.map((t) => ({
		type: "function",
		function: {
			name: t.name,
			description: t.description,
			parameters: t.parameters,
		},
	}));
}

function mapStopReason(
	reason: string | null | undefined,
): AssistantMessage["stopReason"] {
	switch (reason) {
		case "stop":
		case "end":
			return "stop";
		case "length":
			return "length";
		case "function_call":
		case "tool_calls":
			return "toolUse";
		default:
			return "stop";
	}
}

/**
 * Stream a chat completion from an OpenAI-compatible endpoint.
 */
export function streamChat(
	model: Model,
	systemPrompt: string | undefined,
	messages: Message[],
	tools: Tool[],
	options?: StreamOptions,
): ProviderStream {
	const stream = new EventStream<ProviderEvent, AssistantMessage>(
		(event) => event.type === "done" || event.type === "error",
		(event) =>
			event.type === "done" ? event.message : (event as Extract<ProviderEvent, { type: "error" }>).message,
	);

	void (async () => {
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			model: model.id,
			usage: { input: 0, output: 0, total: 0 },
			stopReason: "stop",
			timestamp: Date.now(),
		};

		try {
			const baseUrl = model.baseUrl.replace(/\/$/, "");
			const url = `${baseUrl}/v1/chat/completions`;

			const body: Record<string, unknown> = {
				model: model.id,
				messages: buildMessages(systemPrompt, messages),
				stream: true,
				stream_options: { include_usage: true },
			};

			if (tools.length > 0) {
				body.tools = buildTools(tools);
			}

			const temperature =
				options?.temperature ?? model.temperature;
			if (temperature !== undefined) {
				body.temperature = temperature;
			}

			const maxTokens = options?.maxTokens ?? model.maxTokens;
			if (maxTokens !== undefined) {
				body.max_tokens = maxTokens;
			}

			const headers: Record<string, string> = {
				"Content-Type": "application/json",
			};
			if (model.apiKey) {
				headers["Authorization"] = `Bearer ${model.apiKey}`;
			}

			const response = await fetch(url, {
				method: "POST",
				headers,
				body: JSON.stringify(body),
				signal: options?.signal,
			});

			if (!response.ok) {
				const errorBody = await response.text();
				throw new Error(
					`API error ${response.status}: ${errorBody}`,
				);
			}

			if (!response.body) {
				throw new Error("Response body is null");
			}

			stream.push({ type: "start", partial: output });

			// Track streaming tool call state
			const toolCallPartials = new Map<
				number,
				{ id: string; name: string; partialArgs: string }
			>();

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed || !trimmed.startsWith("data: "))
						continue;

					const data = trimmed.slice(6);
					if (data === "[DONE]") continue;

					let chunk: OpenAIChunk;
					try {
						chunk = JSON.parse(data);
					} catch {
						continue;
					}

					if (chunk.usage) {
						output.usage = {
							input: chunk.usage.prompt_tokens ?? 0,
							output: chunk.usage.completion_tokens ?? 0,
							total: chunk.usage.total_tokens ?? 0,
						};
					}

					const choice = chunk.choices?.[0];
					if (!choice) continue;

					if (choice.finish_reason) {
						output.stopReason = mapStopReason(
							choice.finish_reason,
						);
					}

					const delta = choice.delta;
					if (!delta) continue;

					// Text content
					if (delta.content) {
						let textBlock = output.content.find(
							(c): c is TextContent => c.type === "text",
						);
						if (!textBlock) {
							textBlock = { type: "text", text: "" };
							output.content.push(textBlock);
						}
						textBlock.text += delta.content;
						stream.push({
							type: "text_delta",
							delta: delta.content,
							partial: output,
						});
					}

					// Tool calls
					if (delta.tool_calls) {
						for (const tc of delta.tool_calls) {
							let partial = toolCallPartials.get(tc.index);

							if (!partial) {
								partial = {
									id: tc.id ?? "",
									name: tc.function?.name ?? "",
									partialArgs: "",
								};
								toolCallPartials.set(tc.index, partial);

								const toolCall: ToolCall = {
									type: "toolCall",
									id: partial.id,
									name: partial.name,
									arguments: {},
								};
								output.content.push(toolCall);

								stream.push({
									type: "toolcall_start",
									index: tc.index,
									partial: output,
								});
							}

							if (tc.id && !partial.id) {
								partial.id = tc.id;
							}
							if (tc.function?.name && !partial.name) {
								partial.name = tc.function.name;
							}

							if (tc.function?.arguments) {
								partial.partialArgs +=
									tc.function.arguments;

								// Update the tool call in output.content
								const toolCallBlock = output.content.find(
									(c): c is ToolCall =>
										c.type === "toolCall" &&
										c.id === partial!.id,
								);
								if (toolCallBlock) {
									toolCallBlock.id = partial.id;
									toolCallBlock.name = partial.name;
									try {
										toolCallBlock.arguments =
											parsePartialJson(
												partial.partialArgs,
											) as Record<string, unknown>;
									} catch {
										// keep previous
									}
								}

								stream.push({
									type: "toolcall_delta",
									index: tc.index,
									delta: tc.function.arguments,
									partial: output,
								});
							}
						}
					}
				}
			}

			// Finalize tool calls
			for (const [index, partial] of toolCallPartials) {
				const toolCallBlock = output.content.find(
					(c): c is ToolCall =>
						c.type === "toolCall" && c.id === partial.id,
				);
				if (toolCallBlock) {
					try {
						toolCallBlock.arguments = JSON.parse(
							partial.partialArgs,
						);
					} catch {
						try {
							toolCallBlock.arguments = parsePartialJson(
								partial.partialArgs,
							) as Record<string, unknown>;
						} catch {
							// leave as-is
						}
					}
					stream.push({
						type: "toolcall_end",
						index,
						toolCall: toolCallBlock,
						partial: output,
					});
				}
			}

			if (options?.signal?.aborted) {
				throw new Error("Request was aborted");
			}

			stream.push({ type: "done", message: output });
			stream.end();
		} catch (error) {
			output.stopReason = options?.signal?.aborted
				? "aborted"
				: "error";
			output.errorMessage =
				error instanceof Error
					? error.message
					: String(error);
			stream.push({ type: "error", message: output });
			stream.end();
		}
	})();

	return stream;
}
