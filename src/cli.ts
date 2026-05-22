#!/usr/bin/env node

/**
 * Qiu CLI - minimal agent REPL for local LLMs.
 * Features: drag-and-drop images, spinner animation, status bar, markdown output.
 */

import * as readline from "node:readline";
import { Agent } from "./agent.js";
import { ConfigManager } from "./config-manager.js";
import { SessionStore } from "./session-store.js";
import { defaultTools } from "./tools/index.js";
import { Spinner } from "./cli/spinner.js";
import { renderStatusBar } from "./cli/status-bar.js";
import { renderToolStart, renderToolEnd } from "./cli/tool-card.js";
import { handlePaste, type AttachedImage } from "./cli/paste-handler.js";
import type {
	AgentEvent,
	ImageContent,
	Message,
	TextContent,
	UserMessage,
} from "./types.js";

// ── ANSI ──

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";
const YELLOW = "\x1b[33m";
const CLEAR_LINE = "\x1b[2K\r";

// Bracketed paste mode
const PASTE_MODE_ON = "\x1b[?2004h";
const PASTE_MODE_OFF = "\x1b[?2004l";
const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

// ── CLI arg parsing ──

interface CliArgs {
	model?: string;
	baseUrl?: string;
	apiKey?: string;
	systemPrompt?: string;
	contextTokens?: number;
	resume?: string | true;
	subcommand?: "config" | "sessions";
}

function parseArgs(): CliArgs {
	const args = process.argv.slice(2);
	const result: CliArgs = {};

	for (let i = 0; i < args.length; i++) {
		switch (args[i]) {
			case "config":
				result.subcommand = "config";
				break;
			case "sessions":
				result.subcommand = "sessions";
				break;
			case "--model":
			case "-m":
				result.model = args[++i];
				break;
			case "--base-url":
			case "-u":
				result.baseUrl = args[++i];
				break;
			case "--api-key":
			case "-k":
				result.apiKey = args[++i];
				break;
			case "--system":
			case "-s":
				result.systemPrompt = args[++i];
				break;
			case "--context-tokens":
			case "-c":
				result.contextTokens = parseInt(args[++i], 10) || undefined;
				break;
			case "--resume":
			case "-r": {
				const next = args[i + 1];
				if (next && !next.startsWith("-")) {
					result.resume = args[++i];
				} else {
					result.resume = true;
				}
				break;
			}
			case "--help":
			case "-h":
				printHelp();
				process.exit(0);
		}
	}

	return result;
}

function printHelp(): void {
	console.log(`
${BOLD}qiu${RESET} - Minimal agent for local LLMs

${BOLD}Usage:${RESET}
  qiu [options]
  qiu config                  Show effective configuration
  qiu sessions                List saved sessions

${BOLD}Options:${RESET}
  -m, --model <id>            Model ID (default: qwen2.5:7b)
  -u, --base-url <url>        API base URL (default: http://localhost:11434)
  -k, --api-key <key>         API key (or set QIU_API_KEY / OPENAI_API_KEY)
  -s, --system <prompt>       System prompt
  -c, --context-tokens <n>    Max context window tokens
  -r, --resume [id]           Resume last session (or specify session ID)
  -h, --help                  Show this help

${BOLD}REPL:${RESET}
  Type your message and press Enter. Drag image files directly into terminal.
  
${BOLD}Commands:${RESET}
  /save         Show current session info
  /sessions     List saved sessions
  /load <id>    Load a saved session
  /config       Show effective configuration
  /reset        Clear and start new session
  /help         Show this help
  Ctrl+C        Exit
`);
}

// ── Main ──

async function main(): Promise<void> {
	const cliArgs = parseArgs();

	if (cliArgs.subcommand === "config") {
		runConfigCommand();
		return;
	}

	if (cliArgs.subcommand === "sessions") {
		runSessionsCommand();
		return;
	}

	const cfgManager = new ConfigManager();
	const resolved = cfgManager.resolve({
		model: cliArgs.model,
		baseUrl: cliArgs.baseUrl,
		apiKey: cliArgs.apiKey,
		systemPrompt: cliArgs.systemPrompt,
		maxContextTokens: cliArgs.contextTokens,
	});

	const agent = new Agent({
		model: resolved.model,
		systemPrompt: resolved.systemPrompt,
		tools: defaultTools(),
		maxTurns: resolved.maxTurns,
		contextWindow: resolved.maxContextTokens
			? {
					maxContextTokens: resolved.maxContextTokens,
					reservedOutputTokens: 4096,
					strategy: "truncate",
				}
			: undefined,
	});

	const store = new SessionStore();
	let sessionId: string | null = null;

	// Resume
	if (cliArgs.resume) {
		const targetId =
			cliArgs.resume === true ? store.latest() : cliArgs.resume;
		if (targetId && store.exists(targetId)) {
			const session = store.load(targetId);
			agent.messages = session.messages;
			sessionId = session.meta.id;
			console.log(
				`${GREEN}↺${RESET} Resumed ${CYAN}${sessionId}${RESET} ${DIM}"${session.meta.title}" (${session.messages.length} msgs)${RESET}`,
			);
		} else if (cliArgs.resume !== true) {
			console.log(`${RED}Session not found: ${cliArgs.resume}${RESET}`);
			process.exit(1);
		}
	}

	// Auto-save on agent_end
	agent.subscribe((event) => {
		if (event.type === "agent_end" && event.messages.length > 0) {
			if (!sessionId) {
				sessionId = store.create(resolved.model.id);
			}
			store.append(sessionId, event.messages);
		}
	});

	// Header
	console.log();
	console.log(
		`  ${BOLD}qiu${RESET} ${DIM}v0.1.0${RESET}  ${CYAN}${resolved.model.id}${RESET}  ${DIM}${resolved.model.baseUrl}${RESET}`,
	);
	console.log(
		`  ${DIM}Drag images into terminal to attach. /help for commands.${RESET}`,
	);
	console.log();

	// Spinner + streaming state
	const spinner = new Spinner();
	let isStreaming = false;
	let firstDelta = true;
	let streamBuffer = "";
	let turnStartTime = 0;

	// Agent event handler
	agent.subscribe((event: AgentEvent) => {
		switch (event.type) {
			case "turn_start":
				turnStartTime = Date.now();
				break;

			case "message_start":
				if (event.message.role === "assistant") {
					firstDelta = true;
					streamBuffer = "";
					spinner.start("Thinking...");
				}
				break;

			case "message_delta":
				if (firstDelta) {
					spinner.stop();
					firstDelta = false;
					isStreaming = true;
				}
				streamBuffer += event.delta;
				process.stdout.write(event.delta);
				break;

			case "message_end":
				if (event.message.role === "assistant") {
					spinner.stop();
					isStreaming = false;

					const msg = event.message;
					if (msg.stopReason === "error") {
						console.log(`\n${RED}Error: ${msg.errorMessage}${RESET}`);
					} else if (streamBuffer) {
						// Re-render with markdown if the response is complete and wasn't streamed char by char
						process.stdout.write("\n");
					}
				}
				break;

			case "tool_start":
				spinner.stop();
				if (isStreaming) {
					process.stdout.write("\n");
					isStreaming = false;
				}
				console.log(
					renderToolStart(event.toolName, event.args),
				);
				spinner.start(`Running ${event.toolName}...`);
				break;

			case "tool_end": {
				spinner.stop();
				const text = event.result.content
					.map((c) => c.text)
					.join("\n");
				console.log(renderToolEnd(text, event.isError));
				break;
			}

			case "context_truncated":
				console.log(
					`${DIM}⚠ context trimmed: dropped ${event.droppedCount} msgs (~${event.estimatedTokens} tokens)${RESET}`,
				);
				break;

			case "turn_end": {
				const elapsed = Date.now() - turnStartTime;
				const msg = event.message;
				if (msg.usage.total > 0) {
					const secs = (elapsed / 1000).toFixed(1);
					console.log(
						`${DIM}  ↑${formatTokens(msg.usage.input)} ↓${formatTokens(msg.usage.output)} (${formatTokens(msg.usage.total)} total) ${secs}s${RESET}`,
					);
				}
				break;
			}
		}
	});

	// ── REPL with raw stdin for paste detection ──
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		terminal: true,
	});

	// Enable bracketed paste mode
	process.stdout.write(PASTE_MODE_ON);
	process.on("exit", () => {
		process.stdout.write(PASTE_MODE_OFF);
	});
	process.on("SIGINT", () => {
		process.stdout.write(PASTE_MODE_OFF);
		console.log(`\n${DIM}bye${RESET}`);
		process.exit(0);
	});

	// Pending image attachments from drag-and-drop
	let pendingImages: AttachedImage[] = [];

	// Intercept paste sequences from raw stdin
	if (process.stdin.isTTY) {
		process.stdin.setRawMode(false); // readline handles raw mode itself
	}

	// We handle paste detection via the readline line event by checking input
	// However, for proper bracketed paste detection we need to intercept stdin data
	const originalWrite = process.stdin.push.bind(process.stdin);

	let pasteBuffer = "";
	let inPaste = false;

	process.stdin.on("data", (data: Buffer) => {
		const str = data.toString();

		if (str.includes(PASTE_START)) {
			inPaste = true;
			pasteBuffer = str.split(PASTE_START)[1] || "";

			const endIdx = pasteBuffer.indexOf(PASTE_END);
			if (endIdx !== -1) {
				const content = pasteBuffer.slice(0, endIdx);
				inPaste = false;
				pasteBuffer = "";
				handlePasteContent(content, rl);
			}
			return;
		}

		if (inPaste) {
			pasteBuffer += str;
			const endIdx = pasteBuffer.indexOf(PASTE_END);
			if (endIdx !== -1) {
				const content = pasteBuffer.slice(0, endIdx);
				inPaste = false;
				pasteBuffer = "";
				handlePasteContent(content, rl);
			}
		}
	});

	function handlePasteContent(content: string, rl: readline.Interface): void {
		const result = handlePaste(content);
		if (result.type === "image") {
			pendingImages.push(result.image);
			const sizeMB = (result.image.size / 1024 / 1024).toFixed(2);
			console.log(
				`\n${MAGENTA}📎 attached: ${result.image.filename}${RESET} ${DIM}(${result.image.mimeType}, ${sizeMB}MB)${RESET}`,
			);
			// Re-show prompt
			rl.prompt();
		} else if (result.text) {
			// Simulate typing the pasted text into readline
			rl.write(result.text);
		}
	}

	const promptUser = (): void => {
		// Status bar
		const statusLine = renderStatusBar({
			messages: agent.messages,
			modelId: resolved.model.id,
			sessionId,
			maxContextTokens: resolved.maxContextTokens,
		});
		console.log(statusLine);

		rl.setPrompt(`${BOLD}❯${RESET} `);
		rl.prompt();
	};

	rl.on("line", async (input: string) => {
		const trimmed = input.trim();

		if (!trimmed && pendingImages.length === 0) {
			promptUser();
			return;
		}

		try {
			const handled = await handleCommand(trimmed, agent, store, sessionId, (id) => { sessionId = id; }, resolved);
			if (handled) {
				console.log();
				promptUser();
				return;
			}

			// Build message with any pending images
			if (pendingImages.length > 0) {
				const content: (TextContent | ImageContent)[] = [];
				for (const img of pendingImages) {
					content.push({
						type: "image",
						data: img.data,
						mimeType: img.mimeType,
					});
				}
				content.push({
					type: "text",
					text: trimmed || "Describe this image.",
				});
				pendingImages = [];

				const message: UserMessage = {
					role: "user",
					content,
					timestamp: Date.now(),
				};
				await agent.prompt(message as Message);
			} else {
				await agent.prompt(trimmed);
			}
		} catch (error) {
			spinner.stop();
			console.error(
				`${RED}${error instanceof Error ? error.message : String(error)}${RESET}`,
			);
		}

		console.log();
		promptUser();
	});

	rl.on("close", () => {
		process.stdout.write(PASTE_MODE_OFF);
		console.log(`\n${DIM}bye${RESET}`);
		process.exit(0);
	});

	promptUser();
}

// ── Commands ──

async function handleCommand(
	input: string,
	agent: Agent,
	store: SessionStore,
	sessionId: string | null,
	setSessionId: (id: string) => void,
	resolved: { model: { id: string }; maxContextTokens?: number },
): Promise<boolean> {
	if (input === "/reset") {
		agent.reset();
		setSessionId(store.create(resolved.model.id));
		console.log(`${DIM}Conversation reset. New session started.${RESET}`);
		return true;
	}

	if (input === "/messages") {
		console.log(
			`${DIM}${agent.messages.length} messages${sessionId ? ` (session: ${sessionId})` : ""}${RESET}`,
		);
		return true;
	}

	if (input === "/help") {
		console.log(`
${BOLD}Commands:${RESET}
  ${BOLD}/save${RESET}              Show current session info
  ${BOLD}/sessions${RESET}          List saved sessions
  ${BOLD}/load <id>${RESET}         Load a saved session
  ${BOLD}/config${RESET}            Show effective configuration
  ${BOLD}/reset${RESET}             Clear and start new session
  ${BOLD}/messages${RESET}          Show message count
  ${BOLD}/help${RESET}              Show this help

${DIM}Tip: Drag image files directly into the terminal to attach them.${RESET}`);
		return true;
	}

	if (input === "/config") {
		runConfigCommand();
		return true;
	}

	if (input === "/save") {
		if (!sessionId) {
			console.log(`${DIM}No active session. Send a message first.${RESET}`);
		} else {
			const session = store.load(sessionId);
			console.log(
				`${GREEN}✓${RESET} Session ${CYAN}${sessionId}${RESET} "${session.meta.title}" (${session.meta.messageCount} msgs)`,
			);
			console.log(`${DIM}  ${store.directory}/${sessionId}.jsonl${RESET}`);
		}
		return true;
	}

	if (input === "/sessions") {
		runSessionsCommand();
		return true;
	}

	if (input.startsWith("/load")) {
		const targetId = input.slice(5).trim();
		if (!targetId) {
			console.log(`${RED}Usage: /load <session-id>${RESET}`);
			return true;
		}
		if (!store.exists(targetId)) {
			console.log(`${RED}Session not found: ${targetId}${RESET}`);
			return true;
		}
		const session = store.load(targetId);
		agent.messages = session.messages;
		setSessionId(session.meta.id);
		console.log(
			`${GREEN}↺${RESET} Loaded ${CYAN}${session.meta.id}${RESET} "${session.meta.title}" (${session.messages.length} msgs)`,
		);
		return true;
	}

	if (input.startsWith("/")) {
		console.log(
			`${RED}Unknown command: ${input.split(" ")[0]}${RESET} ${DIM}(type /help)${RESET}`,
		);
		return true;
	}

	return false;
}

// ── Subcommands ──

function runSessionsCommand(): void {
	const store = new SessionStore();
	const sessions = store.list(20);

	if (sessions.length === 0) {
		console.log(`${DIM}No saved sessions.${RESET}`);
		return;
	}

	console.log(`\n${BOLD}Sessions:${RESET}\n`);
	for (const s of sessions) {
		const date = new Date(s.updatedAt).toLocaleString();
		const title = s.title.length > 36 ? s.title.slice(0, 33) + "..." : s.title;
		console.log(
			`  ${CYAN}${s.id}${RESET}  ${title.padEnd(36)}  ${DIM}${s.model}  ${s.messageCount} msgs  ${date}${RESET}`,
		);
	}
	console.log(`\n${DIM}  Resume: qiu --resume <id>  or  /load <id>${RESET}\n`);
}

function runConfigCommand(): void {
	const mgr = new ConfigManager();
	const resolved = mgr.resolve();
	const src = resolved.sources;

	console.log(`\n${BOLD}qiu config${RESET}\n`);
	console.log(`  ${DIM}user config${RESET}     ${src.userConfigPath}${src.userConfig ? ` ${GREEN}✓${RESET}` : ""}`);
	console.log(`  ${DIM}project config${RESET}  ${src.projectConfigPath}${src.projectConfig ? ` ${GREEN}✓${RESET}` : ""}`);
	console.log();
	console.log(`${BOLD}  Effective:${RESET}`);
	console.log(`  model             ${CYAN}${resolved.model.id}${RESET}`);
	console.log(`  base-url          ${resolved.model.baseUrl}`);
	console.log(`  api-key           ${resolved.model.apiKey ? "***" + resolved.model.apiKey.slice(-4) : DIM + "(none)" + RESET}`);
	console.log(`  system-prompt     ${DIM}${truncate(resolved.systemPrompt, 50)}${RESET}`);
	console.log(`  max-context       ${resolved.maxContextTokens ?? DIM + "(unlimited)" + RESET}`);
	console.log(`  temperature       ${resolved.model.temperature ?? DIM + "(auto)" + RESET}`);
	console.log(`  max-tokens        ${resolved.model.maxTokens ?? DIM + "(auto)" + RESET}`);
	console.log(`  max-turns         ${resolved.maxTurns}`);
	console.log();
	console.log(`${DIM}  Config files: ~/.config/qiu/config.json or ./qiu.json${RESET}`);
	console.log(`${DIM}  Env vars: QIU_MODEL, QIU_BASE_URL, QIU_API_KEY, ...${RESET}\n`);
}

// ── Helpers ──

function formatTokens(n: number): string {
	if (n < 1000) return String(n);
	if (n < 10000) return (n / 1000).toFixed(1) + "k";
	if (n < 1000000) return Math.round(n / 1000) + "k";
	return (n / 1000000).toFixed(1) + "M";
}

function truncate(s: string, max: number): string {
	const oneLine = s.replace(/\n/g, " ");
	if (oneLine.length <= max) return oneLine;
	return oneLine.slice(0, max - 3) + "...";
}

main().catch((error) => {
	process.stdout.write(PASTE_MODE_OFF);
	console.error(error);
	process.exit(1);
});
