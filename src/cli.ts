#!/usr/bin/env node

/**
 * Qiu CLI - minimal agent REPL for local LLMs.
 *
 * Usage:
 *   qiu --model <model-id> [--base-url <url>] [--api-key <key>]
 *
 * Commands:
 *   /image <path> [prompt]  Attach an image file to your message
 *   /reset                  Clear conversation history
 *   /messages               Show message count
 *   /help                   Show commands
 */

import * as readline from "node:readline";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { Agent } from "./agent.js";
import { defaultTools } from "./tools/index.js";
import type {
	AgentEvent,
	ImageContent,
	Message,
	Model,
	TextContent,
	UserMessage,
} from "./types.js";

// ── CLI arg parsing ──

function parseArgs(): {
	model: string;
	baseUrl: string;
	apiKey?: string;
	systemPrompt?: string;
	contextTokens?: number;
} {
	const args = process.argv.slice(2);
	let model = "qwen2.5:7b";
	let baseUrl = "http://localhost:11434";
	let apiKey: string | undefined;
	let systemPrompt: string | undefined;
	let contextTokens: number | undefined;

	for (let i = 0; i < args.length; i++) {
		switch (args[i]) {
			case "--model":
			case "-m":
				model = args[++i] ?? model;
				break;
			case "--base-url":
			case "-u":
				baseUrl = args[++i] ?? baseUrl;
				break;
			case "--api-key":
			case "-k":
				apiKey = args[++i];
				break;
			case "--system":
			case "-s":
				systemPrompt = args[++i];
				break;
			case "--context-tokens":
			case "-c":
				contextTokens = parseInt(args[++i], 10) || undefined;
				break;
			case "--help":
			case "-h":
				printHelp();
				process.exit(0);
		}
	}

	apiKey = apiKey ?? process.env.QIU_API_KEY ?? process.env.OPENAI_API_KEY;
	baseUrl = baseUrl ?? process.env.QIU_BASE_URL;

	return { model, baseUrl, apiKey, systemPrompt, contextTokens };
}

function printHelp(): void {
	console.log(`
qiu - Minimal agent for local LLMs

Usage:
  qiu [options]

Options:
  -m, --model <id>            Model ID (default: qwen2.5:7b)
  -u, --base-url <url>        API base URL (default: http://localhost:11434)
  -k, --api-key <key>         API key (or set QIU_API_KEY / OPENAI_API_KEY)
  -s, --system <prompt>       System prompt
  -c, --context-tokens <n>    Max context window tokens (enables auto-truncation)
  -h, --help                  Show this help

REPL Commands:
  /image <path> [prompt]      Send an image with optional text
  /reset                      Clear conversation history
  /messages                   Show message count
  /help                       Show this help

Examples:
  qiu --model qwen2.5:7b
  qiu --model llava:13b
  qiu -m gpt-4o-mini -u https://api.openai.com -k sk-...
  
  > /image ./screenshot.png What's in this image?
  > /image /path/to/diagram.jpg Explain this architecture
`);
}

// ── ANSI helpers ──

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";

// ── Image handling ──

const MIME_MAP: Record<string, string> = {
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".png": "image/png",
	".gif": "image/gif",
	".webp": "image/webp",
	".bmp": "image/bmp",
	".svg": "image/svg+xml",
};

async function loadImage(
	filePath: string,
): Promise<{ data: string; mimeType: string; size: number } | string> {
	const resolved = resolve(filePath);

	try {
		await stat(resolved);
	} catch {
		return `File not found: ${resolved}`;
	}

	const ext = extname(resolved).toLowerCase();
	const mimeType = MIME_MAP[ext];
	if (!mimeType) {
		return `Unsupported image format: ${ext} (supported: ${Object.keys(MIME_MAP).join(", ")})`;
	}

	try {
		const buf = await readFile(resolved);
		const data = buf.toString("base64");
		return { data, mimeType, size: buf.length };
	} catch (err) {
		return `Failed to read image: ${err instanceof Error ? err.message : String(err)}`;
	}
}

function parseImageCommand(input: string): {
	path: string;
	prompt: string;
} | null {
	const match = input.match(/^\/image\s+(\S+)(?:\s+(.+))?$/s);
	if (!match) return null;
	return {
		path: match[1],
		prompt: match[2]?.trim() ?? "Describe this image.",
	};
}

// ── Main ──

async function main(): Promise<void> {
	const config = parseArgs();

	const model: Model = {
		id: config.model,
		baseUrl: config.baseUrl,
		apiKey: config.apiKey,
	};

	const agent = new Agent({
		model,
		systemPrompt:
			config.systemPrompt ??
			"You are a helpful coding assistant. You have access to tools for reading files, writing files, and executing shell commands. Use them when needed to help the user.",
		tools: defaultTools(),
		contextWindow: config.contextTokens
			? {
					maxContextTokens: config.contextTokens,
					reservedOutputTokens: 4096,
					strategy: "truncate",
				}
			: undefined,
	});

	console.log(
		`${BOLD}qiu${RESET} ${DIM}v0.1.0${RESET}  model=${CYAN}${model.id}${RESET}  base=${DIM}${model.baseUrl}${RESET}`,
	);
	console.log(
		`${DIM}Type your message. /help for commands. Ctrl+C to exit.${RESET}\n`,
	);

	agent.subscribe((event: AgentEvent) => {
		switch (event.type) {
			case "message_delta":
				process.stdout.write(event.delta);
				break;

			case "message_end":
				if (event.message.role === "assistant") {
					const msg = event.message;
					if (msg.stopReason === "error") {
						process.stdout.write(
							`\n${RED}Error: ${msg.errorMessage}${RESET}\n`,
						);
					} else {
						process.stdout.write("\n");
					}
				}
				break;

			case "tool_start":
				process.stdout.write(
					`\n${YELLOW}⚙ ${event.toolName}${RESET}${DIM}(${formatArgs(event.args)})${RESET}\n`,
				);
				break;

			case "tool_end":
				if (event.isError) {
					const text = event.result.content
						.map((c) => c.text)
						.join("\n");
					process.stdout.write(
						`${RED}✗ Error: ${truncate(text, 200)}${RESET}\n`,
					);
				} else {
					const text = event.result.content
						.map((c) => c.text)
						.join("\n");
					process.stdout.write(
						`${GREEN}✓${RESET} ${DIM}${truncate(text, 200)}${RESET}\n`,
					);
				}
				break;

			case "context_truncated":
				console.log(
					`${DIM}⚠ context trimmed: dropped ${event.droppedCount} messages (~${event.estimatedTokens} tokens remain)${RESET}`,
				);
				break;

			case "agent_end": {
				const assistantMsgs = event.messages.filter(
					(m) => m.role === "assistant",
				);
				const last = assistantMsgs[assistantMsgs.length - 1];
				if (last && last.role === "assistant" && last.usage.total > 0) {
					console.log(
						`${DIM}tokens: ${last.usage.input}→${last.usage.output} (${last.usage.total})${RESET}`,
					);
				}
				break;
			}
		}
	});

	// REPL
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	const promptUser = (): void => {
		rl.question(`${BOLD}> ${RESET}`, async (input) => {
			const trimmed = input.trim();

			if (!trimmed) {
				promptUser();
				return;
			}

			try {
				const handled = await handleCommand(trimmed, agent);
				if (!handled) {
					await agent.prompt(trimmed);
				}
			} catch (error) {
				console.error(
					`${RED}${error instanceof Error ? error.message : String(error)}${RESET}`,
				);
			}

			console.log();
			promptUser();
		});
	};

	rl.on("close", () => {
		console.log(`\n${DIM}bye${RESET}`);
		process.exit(0);
	});

	promptUser();
}

/**
 * Handle slash commands. Returns true if the input was a command.
 */
async function handleCommand(input: string, agent: Agent): Promise<boolean> {
	if (input === "/reset") {
		agent.reset();
		console.log(`${DIM}Conversation reset.${RESET}`);
		return true;
	}

	if (input === "/messages") {
		console.log(
			`${DIM}${agent.messages.length} messages in context${RESET}`,
		);
		return true;
	}

	if (input === "/help") {
		console.log(`${DIM}Commands:${RESET}`);
		console.log(`  ${BOLD}/image <path> [prompt]${RESET}  Send image with optional text`);
		console.log(`  ${BOLD}/reset${RESET}                  Clear conversation`);
		console.log(`  ${BOLD}/messages${RESET}               Show message count`);
		console.log(`  ${BOLD}/help${RESET}                   Show this help`);
		return true;
	}

	if (input.startsWith("/image")) {
		const parsed = parseImageCommand(input);
		if (!parsed) {
			console.log(
				`${RED}Usage: /image <path> [prompt]${RESET}`,
			);
			return true;
		}

		const result = await loadImage(parsed.path);
		if (typeof result === "string") {
			console.log(`${RED}${result}${RESET}`);
			return true;
		}

		const sizeMB = (result.size / 1024 / 1024).toFixed(2);
		console.log(
			`${MAGENTA}📎 ${parsed.path}${RESET} ${DIM}(${result.mimeType}, ${sizeMB}MB)${RESET}`,
		);

		const content: (TextContent | ImageContent)[] = [
			{ type: "image", data: result.data, mimeType: result.mimeType },
			{ type: "text", text: parsed.prompt },
		];

		const message: UserMessage = {
			role: "user",
			content,
			timestamp: Date.now(),
		};

		await agent.prompt(message as Message);
		return true;
	}

	// Not a command
	if (input.startsWith("/")) {
		console.log(
			`${RED}Unknown command: ${input.split(" ")[0]}. Type /help for available commands.${RESET}`,
		);
		return true;
	}

	return false;
}

function formatArgs(args: Record<string, unknown>): string {
	const entries = Object.entries(args);
	if (entries.length === 0) return "";
	if (entries.length === 1) {
		return truncate(String(entries[0][1]), 80);
	}
	return entries
		.map(([k, v]) => `${k}=${truncate(String(v), 40)}`)
		.join(", ");
}

function truncate(s: string, max: number): string {
	const oneLine = s.replace(/\n/g, "\\n");
	if (oneLine.length <= max) return oneLine;
	return oneLine.slice(0, max - 3) + "...";
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
