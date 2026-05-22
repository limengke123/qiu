/**
 * Markdown terminal renderer powered by marked + marked-terminal.
 * Supports syntax highlighting, tables, and emoji.
 */

import { marked } from "marked";
import { markedTerminal } from "marked-terminal";

marked.use(
	markedTerminal({
		showSectionPrefix: false,
		reflowText: true,
		width: Math.min(process.stdout.columns || 80, 100) - 4,
		tab: 2,
	}) as any,
);

/**
 * Render markdown text for terminal display using marked-terminal.
 */
export function renderMarkdown(text: string): string {
	if (!text.trim()) return "";
	try {
		const rendered = marked.parse(text, { async: false }) as string;
		return rendered.trimEnd();
	} catch {
		return text;
	}
}
