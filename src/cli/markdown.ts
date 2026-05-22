/**
 * Simple markdown terminal renderer.
 * Handles: headings, bold, italic, inline code, code blocks with borders, lists.
 */

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const ITALIC = "\x1b[3m";
const UNDERLINE = "\x1b[4m";
const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";

/**
 * Render a complete markdown string for terminal display.
 * Processes block-level elements (headings, code blocks, lists)
 * and inline formatting (bold, italic, code).
 */
export function renderMarkdown(text: string): string {
	const lines = text.split("\n");
	const output: string[] = [];
	let inCodeBlock = false;
	let codeLang = "";
	let codeLines: string[] = [];

	for (const line of lines) {
		// Code block boundaries
		if (line.trimStart().startsWith("```")) {
			if (!inCodeBlock) {
				inCodeBlock = true;
				codeLang = line.trimStart().slice(3).trim();
				codeLines = [];
			} else {
				// End code block — render it
				output.push(renderCodeBlock(codeLines, codeLang));
				inCodeBlock = false;
				codeLang = "";
				codeLines = [];
			}
			continue;
		}

		if (inCodeBlock) {
			codeLines.push(line);
			continue;
		}

		// Headings
		const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
		if (headingMatch) {
			output.push("");
			output.push(`${BOLD}${UNDERLINE}${headingMatch[2]}${RESET}`);
			continue;
		}

		// Horizontal rules
		if (/^[-*_]{3,}\s*$/.test(line)) {
			const width = Math.min(process.stdout.columns || 80, 60);
			output.push(`${DIM}${"─".repeat(width)}${RESET}`);
			continue;
		}

		// List items
		const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/);
		if (listMatch) {
			const indent = listMatch[1];
			const content = renderInline(listMatch[3]);
			output.push(`${indent}${DIM}•${RESET} ${content}`);
			continue;
		}

		// Regular paragraph line
		output.push(renderInline(line));
	}

	// If we ended inside a code block, flush it
	if (inCodeBlock && codeLines.length > 0) {
		output.push(renderCodeBlock(codeLines, codeLang));
	}

	return output.join("\n");
}

function renderCodeBlock(lines: string[], lang: string): string {
	const width = Math.min(process.stdout.columns || 80, 72);
	const border = "─".repeat(width - 2);

	const parts: string[] = [];
	const langLabel = lang ? ` ${lang} ` : "";
	parts.push(`${DIM}┌${langLabel}${border.slice(langLabel.length)}┐${RESET}`);

	for (const line of lines) {
		const trimmed = line.length > width - 4
			? line.slice(0, width - 7) + "..."
			: line;
		parts.push(`${DIM}│${RESET} ${GREEN}${trimmed}${RESET}`);
	}

	parts.push(`${DIM}└${border}┘${RESET}`);
	return parts.join("\n");
}

/**
 * Render inline markdown formatting.
 */
function renderInline(text: string): string {
	// Bold: **text** or __text__
	text = text.replace(/\*\*(.+?)\*\*/g, `${BOLD}$1${RESET}`);
	text = text.replace(/__(.+?)__/g, `${BOLD}$1${RESET}`);

	// Italic: *text* or _text_ (avoid matching inside bold)
	text = text.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, `${ITALIC}$1${RESET}`);
	text = text.replace(/(?<!_)_([^_]+?)_(?!_)/g, `${ITALIC}$1${RESET}`);

	// Inline code: `code`
	text = text.replace(/`([^`]+?)`/g, `${CYAN}$1${RESET}`);

	// Links: [text](url)
	text = text.replace(
		/\[([^\]]+)\]\(([^)]+)\)/g,
		`${MAGENTA}$1${RESET}${DIM}($2)${RESET}`,
	);

	return text;
}
