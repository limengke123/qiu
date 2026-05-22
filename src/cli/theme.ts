/**
 * Unified color theme for the CLI.
 * All color tokens are defined here for consistency.
 */

import chalk from "chalk";

export const t = {
	// Brand
	accent: chalk.hex("#7C3AED"),       // violet
	accentBright: chalk.hex("#A78BFA"), // lighter violet
	gradient: ["#06b6d4", "#7c3aed", "#db2777"] as [string, string, string],

	// Semantic
	success: chalk.hex("#10B981"),
	error: chalk.hex("#EF4444"),
	warning: chalk.hex("#F59E0B"),
	info: chalk.hex("#3B82F6"),

	// Text
	text: chalk.white,
	dim: chalk.gray,
	muted: chalk.hex("#6B7280"),
	bold: chalk.bold,
	italic: chalk.italic,
	underline: chalk.underline,

	// UI elements
	border: chalk.hex("#374151"),
	borderAccent: chalk.hex("#7C3AED"),
	borderSuccess: chalk.hex("#10B981"),
	borderError: chalk.hex("#EF4444"),

	// Backgrounds (for box-drawing regions — used with bgHex)
	userMsgBg: chalk.bgHex("#1E1B4B"),
	userMsgText: chalk.hex("#E0E7FF"),
	toolBg: chalk.bgHex("#0F172A"),
	toolSuccessBg: chalk.bgHex("#022C22"),
	toolErrorBg: chalk.bgHex("#1C0A0A"),

	// Markdown
	heading: chalk.hex("#06B6D4").bold,
	codespan: chalk.hex("#E879F9"),
	codeBlock: chalk.hex("#A3E635"),
	codeBlockBorder: chalk.hex("#374151"),
	link: chalk.hex("#3B82F6").underline,
	blockquote: chalk.hex("#9CA3AF").italic,
	listBullet: chalk.hex("#7C3AED"),
	hr: chalk.hex("#374151"),

	// Spinner
	spinner: chalk.hex("#06B6D4"),
	spinnerText: chalk.hex("#9CA3AF"),

	// Status bar
	statusDim: chalk.hex("#6B7280"),
	statusModel: chalk.hex("#A78BFA"),
	statusSession: chalk.hex("#06B6D4"),
	progressFilled: chalk.hex("#10B981"),
	progressEmpty: chalk.hex("#374151"),
};

export const CLEAR_LINE = "\x1b[2K\r";
export const HIDE_CURSOR = "\x1b[?25l";
export const SHOW_CURSOR = "\x1b[?25h";
