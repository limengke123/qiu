/**
 * Renders a turn separator line with token statistics.
 */

import figures from "figures";
import { t } from "./theme.js";

export interface TurnStats {
	inputTokens?: number;
	outputTokens?: number;
	durationMs?: number;
}

function formatTokens(n: number): string {
	if (n >= 1000) return (n / 1000).toFixed(1) + "k";
	return String(n);
}

export function renderSeparator(stats?: TurnStats): string {
	const cols = process.stdout.columns || 80;
	const width = Math.min(cols - 4, 72);

	if (!stats) {
		return `  ${t.hr("─".repeat(width))}`;
	}

	const parts: string[] = [];
	if (stats.inputTokens != null) {
		parts.push(`${figures.arrowUp}${formatTokens(stats.inputTokens)}`);
	}
	if (stats.outputTokens != null) {
		parts.push(`${figures.arrowDown}${formatTokens(stats.outputTokens)}`);
	}
	if (stats.durationMs != null) {
		parts.push(`${(stats.durationMs / 1000).toFixed(1)}s`);
	}

	const label = parts.length > 0 ? ` ${parts.join(" · ")} ` : "";
	const sideLen = Math.max(0, Math.floor((width - label.length) / 2));
	const left = "─".repeat(sideLen);
	const right = "─".repeat(Math.max(0, width - sideLen - label.length));

	return `  ${t.hr(left)}${t.dim(label)}${t.hr(right)}`;
}
