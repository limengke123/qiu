/**
 * Context window management: estimate token usage and trim/summarize
 * messages to stay within the model's context limit.
 */

import type {
	AssistantMessage,
	ContextWindowConfig,
	Message,
	TextContent,
	ToolCall,
	ToolResultMessage,
	UserMessage,
} from "./types.js";

export type { ContextWindowConfig };

export interface FitResult {
	messages: Message[];
	truncated: boolean;
	droppedCount: number;
	estimatedTokens: number;
}

/**
 * Fit messages into the available context budget.
 *
 * Strategy "truncate": keeps recent messages, replaces dropped ones with a
 * short marker. Always preserves the latest user message and any pending
 * tool results to avoid breaking the conversation flow.
 *
 * Strategy "summarize": calls the summarizer on dropped messages and injects
 * the summary as a system-like user message at the start.
 */
export async function fitContext(
	systemPrompt: string | undefined,
	messages: Message[],
	config: ContextWindowConfig,
): Promise<FitResult> {
	const reserved = config.reservedOutputTokens ?? 4096;
	const budget = config.maxContextTokens - reserved;

	const systemTokens = systemPrompt ? estimateTokens(systemPrompt) : 0;
	const available = budget - systemTokens;

	if (available <= 0) {
		return {
			messages,
			truncated: false,
			droppedCount: 0,
			estimatedTokens: systemTokens + sumMessageTokens(messages),
		};
	}

	const totalTokens = sumMessageTokens(messages);
	if (totalTokens <= available) {
		return {
			messages,
			truncated: false,
			droppedCount: 0,
			estimatedTokens: systemTokens + totalTokens,
		};
	}

	// Need to trim. Work backwards from the end keeping messages until budget.
	const kept: Message[] = [];
	let usedTokens = 0;
	let splitIndex = messages.length;

	for (let i = messages.length - 1; i >= 0; i--) {
		const msgTokens = estimateMessageTokens(messages[i]);
		if (usedTokens + msgTokens > available) {
			splitIndex = i + 1;
			break;
		}
		usedTokens += msgTokens;
		kept.unshift(messages[i]);

		if (i === 0) {
			splitIndex = 0;
		}
	}

	// Ensure we don't break tool_result <-> assistant pairing.
	// If the first kept message is a toolResult, backtrack to include
	// its corresponding assistant message.
	while (
		kept.length > 0 &&
		kept[0].role === "toolResult" &&
		splitIndex > 0
	) {
		splitIndex--;
		const msg = messages[splitIndex];
		kept.unshift(msg);
		usedTokens += estimateMessageTokens(msg);
	}

	const dropped = messages.slice(0, splitIndex);
	const droppedCount = dropped.length;

	if (droppedCount === 0) {
		return {
			messages,
			truncated: false,
			droppedCount: 0,
			estimatedTokens: systemTokens + totalTokens,
		};
	}

	const strategy = config.strategy ?? "truncate";

	let prefix: Message[];

	if (strategy === "summarize" && config.summarizer) {
		const summary = await config.summarizer(dropped);
		prefix = [
			{
				role: "user",
				content: `[Context summary of ${droppedCount} earlier messages]\n${summary}`,
				timestamp: dropped[0]?.timestamp ?? Date.now(),
			} satisfies UserMessage,
		];
	} else {
		prefix = [
			{
				role: "user",
				content: `[${droppedCount} earlier messages truncated to fit context window]`,
				timestamp: dropped[0]?.timestamp ?? Date.now(),
			} satisfies UserMessage,
		];
	}

	const result = [...prefix, ...kept];

	return {
		messages: result,
		truncated: true,
		droppedCount,
		estimatedTokens: systemTokens + sumMessageTokens(result),
	};
}

// ── Token estimation ──

/**
 * Estimate token count for a string using chars/3.5 heuristic.
 * This approximation works reasonably for English and code across
 * most tokenizers (GPT, Llama, Qwen).
 */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 3.5);
}

export function estimateMessageTokens(msg: Message): number {
	const overhead = 4; // role + formatting tokens

	if (msg.role === "user") {
		if (typeof msg.content === "string") {
			return overhead + estimateTokens(msg.content);
		}
		let tokens = overhead;
		for (const part of msg.content) {
			if (part.type === "text") {
				tokens += estimateTokens(part.text);
			} else {
				// Image: rough fixed cost
				tokens += 85;
			}
		}
		return tokens;
	}

	if (msg.role === "assistant") {
		let tokens = overhead;
		for (const part of msg.content) {
			if (part.type === "text") {
				tokens += estimateTokens(part.text);
			} else {
				// ToolCall: name + serialized args
				tokens +=
					estimateTokens(part.name) +
					estimateTokens(JSON.stringify(part.arguments));
			}
		}
		return tokens;
	}

	if (msg.role === "toolResult") {
		let tokens = overhead + estimateTokens(msg.toolName);
		for (const part of msg.content) {
			tokens += estimateTokens(part.text);
		}
		return tokens;
	}

	return overhead;
}

function sumMessageTokens(messages: Message[]): number {
	let total = 0;
	for (const msg of messages) {
		total += estimateMessageTokens(msg);
	}
	return total;
}
