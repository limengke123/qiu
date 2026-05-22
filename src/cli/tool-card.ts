/**
 * Tool execution card rendering with box-drawing borders.
 */

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";

function termWidth(): number {
	return process.stdout.columns || 80;
}

function truncLine(text: string, maxWidth: number): string {
	if (text.length <= maxWidth) return text;
	return text.slice(0, maxWidth - 3) + "...";
}

/**
 * Render the tool invocation header.
 */
export function renderToolStart(
	toolName: string,
	args: Record<string, unknown>,
): string {
	const width = Math.min(termWidth(), 72);
	const label = ` ${toolName} `;
	const argsStr = formatToolArgs(args);
	const borderLen = Math.max(0, width - 2 - label.length);

	const lines: string[] = [];
	lines.push(`${DIM}┌─${RESET}${YELLOW}${BOLD}${label}${RESET}${DIM}${"─".repeat(borderLen)}${RESET}`);

	if (argsStr) {
		for (const line of argsStr.split("\n")) {
			lines.push(`${DIM}│${RESET} ${CYAN}${truncLine(line, width - 4)}${RESET}`);
		}
	}

	return lines.join("\n");
}

/**
 * Render the tool result (success or error).
 */
export function renderToolEnd(
	result: string,
	isError: boolean,
): string {
	const width = Math.min(termWidth(), 72);
	const border = "─".repeat(width - 1);
	const lines: string[] = [];

	lines.push(`${DIM}├${border}${RESET}`);

	const icon = isError ? `${RED}✗${RESET}` : `${GREEN}✓${RESET}`;
	const color = isError ? RED : DIM;

	const resultLines = result.split("\n");
	const maxLines = 12;
	const shown = resultLines.slice(0, maxLines);

	for (let i = 0; i < shown.length; i++) {
		const prefix = i === 0 ? icon : " ";
		lines.push(`${DIM}│${RESET} ${prefix} ${color}${truncLine(shown[i], width - 6)}${RESET}`);
	}

	if (resultLines.length > maxLines) {
		lines.push(`${DIM}│${RESET}   ${DIM}... (${resultLines.length - maxLines} more lines)${RESET}`);
	}

	lines.push(`${DIM}└${border}${RESET}`);
	return lines.join("\n");
}

function formatToolArgs(args: Record<string, unknown>): string {
	const entries = Object.entries(args);
	if (entries.length === 0) return "";

	if (entries.length === 1) {
		const [, val] = entries[0];
		const str = String(val);
		// For shell commands, show the command directly
		return str.length > 200 ? str.slice(0, 197) + "..." : str;
	}

	return entries
		.map(([k, v]) => {
			const val = String(v);
			return `${k}: ${val.length > 80 ? val.slice(0, 77) + "..." : val}`;
		})
		.join("\n");
}
