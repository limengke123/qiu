/**
 * Status bar rendering for the CLI footer.
 * Shows: cwd (git branch) | token stats | context% | session | model
 */

import { execSync } from "node:child_process";
import { homedir } from "node:os";
import type { Message, AssistantMessage } from "../types.js";

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";

export interface StatusBarData {
	messages: Message[];
	modelId: string;
	sessionId: string | null;
	maxContextTokens?: number;
}

function getGitBranch(): string | null {
	try {
		const branch = execSync("git rev-parse --abbrev-ref HEAD 2>/dev/null", {
			encoding: "utf-8",
			timeout: 500,
		}).trim();
		return branch || null;
	} catch {
		return null;
	}
}

function shortCwd(): string {
	let cwd = process.cwd();
	const home = homedir();
	if (cwd.startsWith(home)) {
		cwd = "~" + cwd.slice(home.length);
	}
	return cwd;
}

function formatTokens(n: number): string {
	if (n < 1000) return String(n);
	if (n < 10000) return (n / 1000).toFixed(1) + "k";
	if (n < 1000000) return Math.round(n / 1000) + "k";
	return (n / 1000000).toFixed(1) + "M";
}

function colorizePercent(percent: number, text: string): string {
	if (percent > 90) return `${RED}${text}${RESET}`;
	if (percent > 70) return `${YELLOW}${text}${RESET}`;
	return `${GREEN}${text}${RESET}`;
}

export function renderStatusBar(data: StatusBarData): string {
	const parts: string[] = [];

	// CWD + git branch
	const cwd = shortCwd();
	const branch = getGitBranch();
	parts.push(branch ? `${cwd} (${branch})` : cwd);

	// Token stats from assistant messages
	let totalInput = 0;
	let totalOutput = 0;
	for (const msg of data.messages) {
		if (msg.role === "assistant") {
			totalInput += msg.usage.input;
			totalOutput += msg.usage.output;
		}
	}
	if (totalInput > 0 || totalOutput > 0) {
		parts.push(`↑${formatTokens(totalInput)} ↓${formatTokens(totalOutput)}`);
	}

	// Context usage
	if (data.maxContextTokens) {
		const lastAssistant = [...data.messages]
			.reverse()
			.find((m): m is AssistantMessage => m.role === "assistant");
		if (lastAssistant && lastAssistant.usage.input > 0) {
			const used = lastAssistant.usage.input + lastAssistant.usage.output;
			const percent = Math.min(100, (used / data.maxContextTokens) * 100);
			const label = `ctx:${percent.toFixed(0)}%/${formatTokens(data.maxContextTokens)}`;
			parts.push(colorizePercent(percent, label));
		} else {
			parts.push(`ctx:${formatTokens(data.maxContextTokens)}`);
		}
	}

	// Session
	if (data.sessionId) {
		parts.push(`${CYAN}${data.sessionId}${RESET}`);
	}

	// Model
	parts.push(data.modelId);

	return `${DIM}${parts.join("  ")}${RESET}`;
}
