/**
 * Core agent loop: stream assistant response -> execute tool calls -> repeat.
 */

import { fitContext } from "./context-window.js";
import { streamChat, type ProviderStream } from "./provider.js";
import type {
	AgentConfig,
	AgentEvent,
	AssistantMessage,
	Message,
	Tool,
	ToolCall,
	ToolResult,
	ToolResultMessage,
} from "./types.js";

export type AgentEventSink = (event: AgentEvent) => Promise<void> | void;

const MAX_TURNS_DEFAULT = 50;

/**
 * Run the agent loop: prompt -> stream -> tools -> repeat.
 * Returns all new messages produced during this run.
 */
export async function runAgentLoop(
	prompts: Message[],
	context: Message[],
	config: AgentConfig,
	emit: AgentEventSink,
): Promise<Message[]> {
	const newMessages: Message[] = [...prompts];
	const allMessages: Message[] = [...context, ...prompts];
	const maxTurns = config.maxTurns ?? MAX_TURNS_DEFAULT;

	await emit({ type: "agent_start" });

	for (const prompt of prompts) {
		await emit({ type: "message_start", message: prompt });
		await emit({ type: "message_end", message: prompt });
	}

	let turns = 0;

	while (turns < maxTurns) {
		turns++;
		await emit({ type: "turn_start" });

		const assistantMsg = await streamAssistantResponse(
			allMessages,
			config,
			emit,
		);
		allMessages.push(assistantMsg);
		newMessages.push(assistantMsg);

		if (
			assistantMsg.stopReason === "error" ||
			assistantMsg.stopReason === "aborted"
		) {
			await emit({
				type: "turn_end",
				message: assistantMsg,
				toolResults: [],
			});
			break;
		}

		const toolCalls = assistantMsg.content.filter(
			(c): c is ToolCall => c.type === "toolCall",
		);

		const toolResults: ToolResultMessage[] = [];

		if (toolCalls.length > 0 && config.tools) {
			for (const tc of toolCalls) {
				const resultMsg = await executeToolCall(
					tc,
					config.tools,
					config,
					emit,
				);
				allMessages.push(resultMsg);
				newMessages.push(resultMsg);
				toolResults.push(resultMsg);
			}
		}

		await emit({
			type: "turn_end",
			message: assistantMsg,
			toolResults,
		});

		// Continue only if there were tool calls
		const hasToolCalls = toolCalls.length > 0;
		if (!hasToolCalls) break;

		if (config.signal?.aborted) break;
	}

	await emit({ type: "agent_end", messages: newMessages });
	return newMessages;
}

async function streamAssistantResponse(
	messages: Message[],
	config: AgentConfig,
	emit: AgentEventSink,
): Promise<AssistantMessage> {
	let effectiveMessages = messages;

	if (config.contextWindow) {
		const fitResult = await fitContext(
			config.systemPrompt,
			messages,
			config.contextWindow,
		);
		effectiveMessages = fitResult.messages;

		if (fitResult.truncated) {
			await emit({
				type: "context_truncated",
				droppedCount: fitResult.droppedCount,
				estimatedTokens: fitResult.estimatedTokens,
			});
		}
	}

	const providerStream = streamChat(
		config.model,
		config.systemPrompt,
		effectiveMessages,
		config.tools ?? [],
		{
			signal: config.signal,
			temperature: config.model.temperature,
			maxTokens: config.model.maxTokens,
		},
	);

	let started = false;

	for await (const event of providerStream) {
		switch (event.type) {
			case "start":
				started = true;
				await emit({
					type: "message_start",
					message: event.partial,
				});
				break;
			case "text_delta":
				await emit({ type: "message_delta", delta: event.delta });
				break;
			case "done":
				await emit({ type: "message_end", message: event.message });
				return event.message;
			case "error": {
				if (!started) {
					await emit({
						type: "message_start",
						message: event.message,
					});
				}
				await emit({
					type: "message_end",
					message: event.message,
				});
				return event.message;
			}
		}
	}

	// Fallback: stream ended without done/error event
	const result = await providerStream.result();
	if (!started) {
		await emit({ type: "message_start", message: result });
	}
	await emit({ type: "message_end", message: result });
	return result;
}

async function executeToolCall(
	toolCall: ToolCall,
	tools: Tool[],
	config: AgentConfig,
	emit: AgentEventSink,
): Promise<ToolResultMessage> {
	const tool = tools.find((t) => t.name === toolCall.name);

	await emit({
		type: "tool_start",
		toolCallId: toolCall.id,
		toolName: toolCall.name,
		args: toolCall.arguments,
	});

	let result: ToolResult;
	let isError = false;

	if (!tool) {
		result = {
			content: [
				{
					type: "text",
					text: `Tool "${toolCall.name}" not found`,
				},
			],
			isError: true,
		};
		isError = true;
	} else {
		try {
			// beforeToolCall hook: return false to block
			if (config.beforeToolCall) {
				const allowed = await config.beforeToolCall(
					toolCall,
					toolCall.arguments,
				);
				if (!allowed) {
					result = {
						content: [
							{
								type: "text",
								text: "Tool execution was blocked",
							},
						],
						isError: true,
					};
					isError = true;
					await emit({
						type: "tool_end",
						toolCallId: toolCall.id,
						toolName: toolCall.name,
						result,
						isError,
					});
					return {
						role: "toolResult",
						toolCallId: toolCall.id,
						toolName: toolCall.name,
						content: result.content,
						isError,
						timestamp: Date.now(),
					};
				}
			}

			result = await tool.execute(
				toolCall.arguments,
				config.signal,
			);
			isError = result.isError ?? false;

			// afterToolCall hook
			if (config.afterToolCall) {
				result = await config.afterToolCall(toolCall, result);
				isError = result.isError ?? false;
			}
		} catch (error) {
			result = {
				content: [
					{
						type: "text",
						text:
							error instanceof Error
								? error.message
								: String(error),
					},
				],
				isError: true,
			};
			isError = true;
		}
	}

	await emit({
		type: "tool_end",
		toolCallId: toolCall.id,
		toolName: toolCall.name,
		result,
		isError,
	});

	return {
		role: "toolResult",
		toolCallId: toolCall.id,
		toolName: toolCall.name,
		content: result.content,
		isError,
		timestamp: Date.now(),
	};
}
