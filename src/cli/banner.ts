/**
 * Startup banner with gradient ASCII art logo.
 */

import gradient from "gradient-string";
import chalk from "chalk";
import { t } from "./theme.js";

const LOGO = `
   ██████╗ ██╗██╗   ██╗
  ██╔═══██╗██║██║   ██║
  ██║   ██║██║██║   ██║
  ██║▄▄ ██║██║██║   ██║
  ╚██████╔╝██║╚██████╔╝
   ╚══▀▀═╝ ╚═╝ ╚═════╝`;

export function renderBanner(modelId: string, baseUrl: string): string {
	const g = gradient(t.gradient);
	const logo = g.multiline(LOGO);

	const modelInfo = `  ${t.dim("model")} ${t.statusModel(modelId)}  ${t.dim("·")}  ${t.dim(baseUrl)}`;

	const hints = t.dim(
		"  Enter send · / commands · drop files to attach · Ctrl+C exit",
	);

	const separator = t.border("  " + "─".repeat(56));

	return [
		"",
		logo,
		"",
		modelInfo,
		separator,
		hints,
		"",
	].join("\n");
}
