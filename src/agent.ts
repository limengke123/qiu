/**
 * Stateful Agent: owns transcript, emits events, manages lifecycle.
 */

import { runAgentLoop } from "./agent-loop.js";
import type {
	AgentConfig,
	AgentEvent,
	AssistantMessage,
	Message,
	Model,
	Tool,
	ToolResult,
	ToolCall,
} from "./types.js";

export interface AgentOptions {
	model: Model;
	systemPrompt?: string;
	tools?: Tool[];
	maxTurns?: number;
	beforeToolCall?: (toolCall: ToolCall, args: Record<string, unknown>) => Promise<boolean>;
	afterToolCall?: (toolCall: ToolCall, result: ToolResult) => Promise<ToolResult>;
}

export class Agent {
	public model: Model;
	public systemPrompt: string;
	public tools: Tool[];
	public maxTurns: number;
	public messages: Message[] = [];
	public beforeToolCall?: AgentOptions["beforeToolCall"];
	public afterToolCall?: AgentOptions["afterToolCall"];

	private listeners = new Set<
		(event: AgentEvent, signal: AbortSignal) => Promise<void> | void
	>();
	private abortController?: AbortController;
	private activeRun?: Promise<void>;
	private _isStreaming = false;

	constructor(options: AgentOptions) {
		this.model = options.model;
		this.systemPrompt = options.systemPrompt ?? "";
		this.tools = options.tools?.slice() ?? [];
		this.maxTurns = options.maxTurns ?? 50;
		this.beforeToolCall = options.beforeToolCall;
		this.afterToolCall = options.afterToolCall;
	}

	get isStreaming(): boolean {
		return this._isStreaming;
	}

	/**
	 * Subscribe to agent events. Returns unsubscribe function.
	 */
	subscribe(
		listener: (event: AgentEvent, signal: AbortSignal) => Promise<void> | void,
	): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/**
	 * Send a text prompt to the agent.
	 */
	async prompt(text: string): Promise<Message[]>;
	async prompt(message: Message): Promise<Message[]>;
	async prompt(messages: Message[]): Promise<Message[]>;
	async prompt(input: string | Message | Message[]): Promise<Message[]> {
		if (this.activeRun) {
			throw new Error("Agent is already processing a prompt");
		}

		const prompts = this.normalizeInput(input);
		return this.run(prompts);
	}

	abort(): void {
		this.abortController?.abort();
	}

	async waitForIdle(): Promise<void> {
		await this.activeRun;
	}

	reset(): void {
		this.messages = [];
		this._isStreaming = false;
		this.abortController = undefined;
		this.activeRun = undefined;
	}

	private normalizeInput(input: string | Message | Message[]): Message[] {
		if (Array.isArray(input)) return input;
		if (typeof input === "string") {
			return [
				{
					role: "user",
					content: input,
					timestamp: Date.now(),
				},
			];
		}
		return [input];
	}

	private async run(prompts: Message[]): Promise<Message[]> {
		this.abortController = new AbortController();
		this._isStreaming = true;

		let resolveRun: () => void;
		this.activeRun = new Promise((r) => {
			resolveRun = r;
		});

		try {
			const config: AgentConfig = {
				model: this.model,
				systemPrompt: this.systemPrompt,
				tools: this.tools,
				maxTurns: this.maxTurns,
				signal: this.abortController.signal,
				beforeToolCall: this.beforeToolCall,
				afterToolCall: this.afterToolCall,
			};

			const newMessages = await runAgentLoop(
				prompts,
				this.messages.slice(),
				config,
				(event) => this.emit(event),
			);

			// Append new messages to transcript
			for (const msg of newMessages) {
				this.messages.push(msg);
			}

			return newMessages;
		} finally {
			this._isStreaming = false;
			this.abortController = undefined;
			resolveRun!();
			this.activeRun = undefined;
		}
	}

	private async emit(event: AgentEvent): Promise<void> {
		const signal = this.abortController?.signal;
		if (!signal) return;
		for (const listener of this.listeners) {
			await listener(event, signal);
		}
	}
}
