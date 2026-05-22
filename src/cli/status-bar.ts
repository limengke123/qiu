/**
 * Status bar rendering for the CLI footer.
 * Shows: cwd (git branch) | token stats | progress bar | session | model
 */

import { execSync } from "node:child_process";
import { homedir } from "node:os";
import figures from "figures";
import type { Message, AssistantMessage } from "../types.js";
import { t } from "./theme.js";

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

function renderProgressBar(percent: number, width = 10): string {
	const filled = Math.round((percent / 100) * width);
	const empty = width - filled;
	const bar = t.progressFilled("■".repeat(filled)) + t.progressEmpty("□".repeat(empty));
	return bar;
}

export function renderStatusBar(data: StatusBarData): string {
	const parts: string[] = [];

	// CWD + git branch
	const cwd = shortCwd();
	const branch = getGitBranch();
	parts.push(t.statusDim(branch ? `${cwd} (${branch})` : cwd));

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
		parts.push(t.dim(`${figures.arrowUp}${formatTokens(totalInput)} ${figures.arrowDown}${formatTokens(totalOutput)}`));
	}

	// Context usage with progress bar
	if (data.maxContextTokens) {
		const lastAssistant = [...data.messages]
			.reverse()
			.find((m): m is AssistantMessage => m.role === "assistant");
		if (lastAssistant && lastAssistant.usage.input > 0) {
			const used = lastAssistant.usage.input + lastAssistant.usage.output;
			const percent = Math.min(100, (used / data.maxContextTokens) * 100);
			const bar = renderProgressBar(percent);
			parts.push(`${bar} ${t.dim(`${percent.toFixed(0)}%/${formatTokens(data.maxContextTokens)}`)}`);
		} else {
			parts.push(t.dim(`ctx:${formatTokens(data.maxContextTokens)}`));
		}
	}

	// Session (green dot = active)
	if (data.sessionId) {
		parts.push(`${t.success(figures.bullet)} ${t.statusSession(data.sessionId.slice(0, 7))}`);
	}

	// Model
	parts.push(t.statusModel(data.modelId));

	return `  ${parts.join("  ")}`;
}
