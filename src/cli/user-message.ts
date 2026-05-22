/**
 * Renders a user message as a styled card with border and background.
 */

import { t } from "./theme.js";

export function renderUserMessage(text: string): string {
	const lines = text.split("\n");
	const maxLen = Math.max(...lines.map((l) => stripAnsi(l).length), 20);
	const width = Math.min(maxLen + 2, process.stdout.columns - 6 || 74);

	const top = `  ${t.borderAccent("┌")} ${t.accentBright("You")} ${t.borderAccent("─".repeat(Math.max(0, width - 6)))}`;
	const bottom = `  ${t.borderAccent("└" + "─".repeat(width))}`;

	const body = lines.map((line) => {
		const padded = line + " ".repeat(Math.max(0, width - 2 - stripAnsi(line).length));
		return `  ${t.borderAccent("│")} ${t.userMsgBg(t.userMsgText(padded))}`;
	});

	return [top, ...body, bottom].join("\n");
}

function stripAnsi(str: string): string {
	return str.replace(/\x1b\[[0-9;]*m/g, "");
}
