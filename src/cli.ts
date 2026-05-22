#!/usr/bin/env node

/**
 * Qiu CLI - minimal agent REPL for local LLMs.
 *
 * Usage:
 *   qiu --model <model-id> [--base-url <url>] [--api-key <key>]
 *
 * Examples:
 *   qiu --model qwen2.5:7b
 *   qiu --model llama3.1 --base-url http://localhost:11434
 *   qiu --model gpt-4o-mini --base-url https://api.openai.com --api-key sk-...
 */

import * as readline from "node:readline";
import { Agent } from "./agent.js";
import { defaultTools } from "./tools/index.js";
import type { AgentEvent, Model } from "./types.js";

// ── CLI arg parsing ──

function parseArgs(): {
	model: string;
	baseUrl: string;
	apiKey?: string;
	systemPrompt?: string;
} {
	const args = process.argv.slice(2);
	let model = "qwen2.5:7b";
	let baseUrl = "http://localhost:11434";
	let apiKey: string | undefined;
	let systemPrompt: string | undefined;

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
			case "--help":
			case "-h":
				printHelp();
				process.exit(0);
		}
	}

	// Environment variable fallbacks
	apiKey = apiKey ?? process.env.QIU_API_KEY ?? process.env.OPENAI_API_KEY;
	baseUrl = baseUrl ?? process.env.QIU_BASE_URL;

	return { model, baseUrl, apiKey, systemPrompt };
}

function printHelp(): void {
	console.log(`
qiu - Minimal agent for local LLMs

Usage:
  qiu [options]

Options:
  -m, --model <id>       Model ID (default: qwen2.5:7b)
  -u, --base-url <url>   API base URL (default: http://localhost:11434)
  -k, --api-key <key>    API key (or set QIU_API_KEY / OPENAI_API_KEY)
  -s, --system <prompt>  System prompt
  -h, --help             Show this help

Examples:
  qiu --model qwen2.5:7b
  qiu --model llama3.1 --base-url http://localhost:11434
  qiu -m gpt-4o-mini -u https://api.openai.com -k sk-...
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
	});

	console.log(
		`${BOLD}qiu${RESET} ${DIM}v0.1.0${RESET}  model=${CYAN}${model.id}${RESET}  base=${DIM}${model.baseUrl}${RESET}`,
	);
	console.log(`${DIM}Type your message. Ctrl+C to exit.${RESET}\n`);

	// Event listener for streaming output
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
						// Ensure newline after streamed text
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

			if (trimmed === "/reset") {
				agent.reset();
				console.log(`${DIM}Conversation reset.${RESET}`);
				promptUser();
				return;
			}

			if (trimmed === "/messages") {
				console.log(
					`${DIM}${agent.messages.length} messages in context${RESET}`,
				);
				promptUser();
				return;
			}

			try {
				await agent.prompt(trimmed);
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
