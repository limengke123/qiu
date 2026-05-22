#!/usr/bin/env node

/**
 * Qiu CLI — polished agent REPL for local LLMs.
 */

import * as readline from "node:readline";
import chalk from "chalk";
import figures from "figures";
import { Agent } from "./agent.js";
import { ConfigManager } from "./config-manager.js";
import { SessionStore } from "./session-store.js";
import { defaultTools } from "./tools/index.js";
import { Spinner } from "./cli/spinner.js";
import { renderStatusBar } from "./cli/status-bar.js";
import { renderToolStart, renderToolEnd } from "./cli/tool-card.js";
import { renderBanner } from "./cli/banner.js";
import { renderUserMessage } from "./cli/user-message.js";
import { renderMarkdown } from "./cli/markdown.js";
import { renderSeparator, type TurnStats } from "./cli/separator.js";
import { handlePaste, type AttachedImage } from "./cli/paste-handler.js";
import { t, SHOW_CURSOR } from "./cli/theme.js";
import type {
	AgentEvent,
	ImageContent,
	Message,
	TextContent,
	UserMessage,
} from "./types.js";

// Bracketed paste
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
${chalk.bold("qiu")} — Minimal agent for local LLMs

${chalk.bold("Usage:")}
  qiu [options]
  qiu config                  Show effective configuration
  qiu sessions                List saved sessions

${chalk.bold("Options:")}
  -m, --model <id>            Model ID (default: qwen2.5:7b)
  -u, --base-url <url>        API base URL (default: http://localhost:11434)
  -k, --api-key <key>         API key (or set QIU_API_KEY / OPENAI_API_KEY)
  -s, --system <prompt>       System prompt
  -c, --context-tokens <n>    Max context window tokens
  -r, --resume [id]           Resume last session (or specify session ID)
  -h, --help                  Show this help

${chalk.bold("REPL:")}
  Type your message and press Enter. Drag image files directly into terminal.

${chalk.bold("Commands:")}
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
				`  ${t.success(figures.play)} Resumed ${t.statusSession(sessionId)} ${t.dim(`"${session.meta.title}" (${session.messages.length} msgs)`)}`,
			);
		} else if (cliArgs.resume !== true) {
			console.log(t.error(`Session not found: ${cliArgs.resume}`));
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

	// ── Banner ──
	console.log(renderBanner(resolved.model.id, resolved.model.baseUrl));

	// Spinner + streaming state
	const spinner = new Spinner();
	let isStreaming = false;
	let firstDelta = true;
	let streamBuffer = "";
	let turnStartTime = 0;
	let lastTurnStats: TurnStats | undefined;

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
					process.stdout.write(`\n  ${t.accentBright(figures.pointer)} `);
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
						console.log(`\n  ${t.error(figures.cross + " " + msg.errorMessage)}`);
					} else if (streamBuffer) {
						// Clear raw stream output, re-render with markdown
						const rendered = renderMarkdown(streamBuffer);
						if (rendered !== streamBuffer.trimEnd()) {
							// Move cursor up and clear the streamed lines, redraw rendered
							const rawLines = streamBuffer.split("\n").length;
							process.stdout.write("\r");
							for (let i = 0; i < rawLines; i++) {
								process.stdout.write("\x1b[2K\x1b[1A");
							}
							process.stdout.write("\x1b[2K\r");
							console.log(`\n${rendered}`);
						} else {
							process.stdout.write("\n");
						}
					}
				}
				break;

			case "tool_start":
				spinner.stop();
				if (isStreaming) {
					process.stdout.write("\n");
					isStreaming = false;
				}
				console.log(renderToolStart(event.toolName, event.args));
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
					`  ${t.warning(`${figures.warning} context trimmed: dropped ${event.droppedCount} msgs (~${event.estimatedTokens} tokens)`)}`,
				);
				break;

			case "turn_end": {
				const elapsed = Date.now() - turnStartTime;
				const msg = event.message;
				lastTurnStats = {
					inputTokens: msg.usage.input || undefined,
					outputTokens: msg.usage.output || undefined,
					durationMs: elapsed,
				};
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
		process.stdout.write(PASTE_MODE_OFF + SHOW_CURSOR);
	});
	process.on("SIGINT", () => {
		process.stdout.write(PASTE_MODE_OFF + SHOW_CURSOR);
		console.log(`\n  ${t.dim("bye")}`);
		process.exit(0);
	});

	// Pending image attachments from drag-and-drop
	let pendingImages: AttachedImage[] = [];

	// Paste detection
	if (process.stdin.isTTY) {
		process.stdin.setRawMode(false);
	}

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
				`\n  ${t.accent("📎")} ${chalk.white(result.image.filename)} ${t.dim(`(${result.image.mimeType}, ${sizeMB}MB)`)}`,
			);
			rl.prompt();
		} else if (result.text) {
			rl.write(result.text);
		}
	}

	const promptUser = (): void => {
		// Separator with stats (after first turn)
		if (lastTurnStats) {
			console.log(renderSeparator(lastTurnStats));
			lastTurnStats = undefined;
		}

		// Status bar
		const statusLine = renderStatusBar({
			messages: agent.messages,
			modelId: resolved.model.id,
			sessionId,
			maxContextTokens: resolved.maxContextTokens,
		});
		console.log(statusLine);

		rl.setPrompt(`  ${t.accent(figures.pointer)} `);
		rl.prompt();
	};

	rl.on("line", async (input: string) => {
		const trimmed = input.trim();

		if (!trimmed && pendingImages.length === 0) {
			promptUser();
			return;
		}

		try {
			const handled = await handleCommand(
				trimmed,
				agent,
				store,
				sessionId,
				(id) => { sessionId = id; },
				resolved,
			);
			if (handled) {
				console.log();
				promptUser();
				return;
			}

			// Show user message card
			console.log(renderUserMessage(trimmed));

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
				`  ${t.error(figures.cross)} ${t.error(error instanceof Error ? error.message : String(error))}`,
			);
		}

		console.log();
		promptUser();
	});

	rl.on("close", () => {
		process.stdout.write(PASTE_MODE_OFF + SHOW_CURSOR);
		console.log(`\n  ${t.dim("bye")}`);
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
		console.log(`  ${t.dim("Conversation reset. New session started.")}`);
		return true;
	}

	if (input === "/messages") {
		console.log(
			`  ${t.dim(`${agent.messages.length} messages${sessionId ? ` (session: ${sessionId})` : ""}`)}`,
		);
		return true;
	}

	if (input === "/help") {
		console.log(`
${chalk.bold("Commands:")}
  ${chalk.bold("/save")}              Show current session info
  ${chalk.bold("/sessions")}          List saved sessions
  ${chalk.bold("/load <id>")}         Load a saved session
  ${chalk.bold("/config")}            Show effective configuration
  ${chalk.bold("/reset")}             Clear and start new session
  ${chalk.bold("/messages")}          Show message count
  ${chalk.bold("/help")}              Show this help

${t.dim("Tip: Drag image files directly into the terminal to attach them.")}`);
		return true;
	}

	if (input === "/config") {
		runConfigCommand();
		return true;
	}

	if (input === "/save") {
		if (!sessionId) {
			console.log(`  ${t.dim("No active session. Send a message first.")}`);
		} else {
			const session = store.load(sessionId);
			console.log(
				`  ${t.success(figures.tick)} Session ${t.statusSession(sessionId)} "${session.meta.title}" (${session.meta.messageCount} msgs)`,
			);
			console.log(`  ${t.dim(`${store.directory}/${sessionId}.jsonl`)}`);
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
			console.log(`  ${t.error("Usage: /load <session-id>")}`);
			return true;
		}
		if (!store.exists(targetId)) {
			console.log(`  ${t.error(`Session not found: ${targetId}`)}`);
			return true;
		}
		const session = store.load(targetId);
		agent.messages = session.messages;
		setSessionId(session.meta.id);
		console.log(
			`  ${t.success(figures.play)} Loaded ${t.statusSession(session.meta.id)} "${session.meta.title}" (${session.messages.length} msgs)`,
		);
		return true;
	}

	if (input.startsWith("/")) {
		console.log(
			`  ${t.error(`Unknown command: ${input.split(" ")[0]}`)} ${t.dim("(type /help)")}`,
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
		console.log(`  ${t.dim("No saved sessions.")}`);
		return;
	}

	console.log(`\n${chalk.bold("  Sessions:")}\n`);
	for (const s of sessions) {
		const date = new Date(s.updatedAt).toLocaleString();
		const title = s.title.length > 36 ? s.title.slice(0, 33) + "..." : s.title;
		console.log(
			`  ${t.statusSession(s.id)}  ${chalk.white(title.padEnd(36))}  ${t.dim(`${s.model}  ${s.messageCount} msgs  ${date}`)}`,
		);
	}
	console.log(`\n  ${t.dim(`Resume: qiu --resume <id>  or  /load <id>`)}\n`);
}

function runConfigCommand(): void {
	const mgr = new ConfigManager();
	const resolved = mgr.resolve();
	const src = resolved.sources;

	console.log(`\n${chalk.bold("  qiu config")}\n`);
	console.log(`  ${t.dim("user config")}     ${src.userConfigPath}${src.userConfig ? ` ${t.success(figures.tick)}` : ""}`);
	console.log(`  ${t.dim("project config")}  ${src.projectConfigPath}${src.projectConfig ? ` ${t.success(figures.tick)}` : ""}`);
	console.log();
	console.log(`  ${chalk.bold("Effective:")}`);
	console.log(`  model             ${t.statusModel(resolved.model.id)}`);
	console.log(`  base-url          ${resolved.model.baseUrl}`);
	console.log(`  api-key           ${resolved.model.apiKey ? "***" + resolved.model.apiKey.slice(-4) : t.dim("(none)")}`);
	console.log(`  system-prompt     ${t.dim(truncate(resolved.systemPrompt, 50))}`);
	console.log(`  max-context       ${resolved.maxContextTokens ?? t.dim("(unlimited)")}`);
	console.log(`  temperature       ${resolved.model.temperature ?? t.dim("(auto)")}`);
	console.log(`  max-tokens        ${resolved.model.maxTokens ?? t.dim("(auto)")}`);
	console.log(`  max-turns         ${resolved.maxTurns}`);
	console.log();
	console.log(`  ${t.dim("Config files: ~/.config/qiu/config.json or ./qiu.json")}`);
	console.log(`  ${t.dim("Env vars: QIU_MODEL, QIU_BASE_URL, QIU_API_KEY, ...")}\n`);
}

// ── Helpers ──

function truncate(s: string, max: number): string {
	const oneLine = s.replace(/\n/g, " ");
	if (oneLine.length <= max) return oneLine;
	return oneLine.slice(0, max - 3) + "...";
}

main().catch((error) => {
	process.stdout.write(PASTE_MODE_OFF + SHOW_CURSOR);
	console.error(error);
	process.exit(1);
});
