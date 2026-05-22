/**
 * Tool execution card with colored borders, background, and status icons.
 */

import figures from "figures";
import { t } from "./theme.js";

function termWidth(): number {
	return process.stdout.columns || 80;
}

function truncLine(text: string, maxWidth: number): string {
	const stripped = stripAnsi(text);
	if (stripped.length <= maxWidth) return text;
	return text.slice(0, maxWidth - 3) + "...";
}

function stripAnsi(str: string): string {
	return str.replace(/\x1b\[[0-9;]*m/g, "");
}

export function renderToolStart(
	toolName: string,
	args: Record<string, unknown>,
): string {
	const width = Math.min(termWidth() - 2, 72);
	const label = ` ${toolName} `;
	const icon = ` ${figures.hamburger}`;
	const borderLen = Math.max(0, width - 2 - label.length - icon.length);

	const lines: string[] = [];
	lines.push(
		`  ${t.borderAccent("┌─")}${t.accent.bold(label)}${t.borderAccent("─".repeat(borderLen))}${t.dim(icon)}`,
	);

	const argsStr = formatToolArgs(args);
	if (argsStr) {
		for (const line of argsStr.split("\n")) {
			lines.push(`  ${t.borderAccent("│")} ${t.toolBg(` ${truncLine(line, width - 5)} `)}`);
		}
	}

	return lines.join("\n");
}

export function renderToolEnd(
	result: string,
	isError: boolean,
): string {
	const width = Math.min(termWidth() - 2, 72);
	const borderFn = isError ? t.borderError : t.borderSuccess;
	const bgFn = isError ? t.toolErrorBg : t.toolSuccessBg;
	const border = "─".repeat(width - 1);

	const lines: string[] = [];
	lines.push(`  ${borderFn("├" + border)}`);

	const icon = isError
		? t.error(figures.cross)
		: t.success(figures.tick);

	const resultLines = result.split("\n");
	const maxLines = 12;
	const shown = resultLines.slice(0, maxLines);

	for (let i = 0; i < shown.length; i++) {
		const prefix = i === 0 ? icon : " ";
		const content = truncLine(shown[i], width - 6);
		lines.push(`  ${borderFn("│")} ${prefix} ${bgFn(` ${content} `)}`);
	}

	if (resultLines.length > maxLines) {
		lines.push(`  ${borderFn("│")}   ${t.dim(`... (${resultLines.length - maxLines} more lines)`)}`);
	}

	lines.push(`  ${borderFn("└" + border)}`);
	return lines.join("\n");
}

function formatToolArgs(args: Record<string, unknown>): string {
	const entries = Object.entries(args);
	if (entries.length === 0) return "";

	if (entries.length === 1) {
		const [, val] = entries[0];
		const str = String(val);
		return str.length > 200 ? str.slice(0, 197) + "..." : str;
	}

	return entries
		.map(([k, v]) => {
			const val = String(v);
			return `${t.dim(k + ":")} ${val.length > 80 ? val.slice(0, 77) + "..." : val}`;
		})
		.join("\n");
}
