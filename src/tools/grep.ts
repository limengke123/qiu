import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Tool, ToolResult } from "../types.js";

const MAX_MATCHES = 100;
const MAX_FILE_SIZE = 512 * 1024; // skip files > 512KB

export function grepTool(): Tool {
	return {
		name: "grep",
		description:
			"Search file contents using a regex pattern. Returns matching lines with file paths and line numbers. Skips binary files and node_modules.",
		parameters: {
			type: "object",
			properties: {
				pattern: {
					type: "string",
					description: "Regex pattern to search for in file contents.",
				},
				directory: {
					type: "string",
					description:
						"Directory to search in. Defaults to current working directory.",
				},
				include: {
					type: "string",
					description:
						'Glob pattern to filter which files to search. Example: "*.ts", "*.{js,jsx}"',
				},
				case_insensitive: {
					type: "boolean",
					description:
						"If true, perform case-insensitive matching. Default: false.",
				},
			},
			required: ["pattern"],
		},
		async execute(args: Record<string, unknown>): Promise<ToolResult> {
			const pattern = args.pattern as string;
			const directory = (args.directory as string) || process.cwd();
			const include = args.include as string | undefined;
			const caseInsensitive =
				(args.case_insensitive as boolean) ?? false;

			if (!pattern) {
				return error("Missing pattern argument");
			}

			let regex: RegExp;
			try {
				regex = new RegExp(
					pattern,
					caseInsensitive ? "gi" : "g",
				);
			} catch (err) {
				return error(
					`Invalid regex: ${err instanceof Error ? err.message : String(err)}`,
				);
			}

			const includeRegex = include ? globToRegex(include) : null;

			try {
				const matches: string[] = [];
				await searchDir(
					directory,
					directory,
					regex,
					includeRegex,
					matches,
				);

				let text =
					matches.length > 0
						? matches.join("\n")
						: "No matches found.";

				if (matches.length >= MAX_MATCHES) {
					text += `\n\n(results capped at ${MAX_MATCHES} matches)`;
				}

				return { content: [{ type: "text", text }] };
			} catch (err) {
				return error(
					err instanceof Error ? err.message : String(err),
				);
			}
		},
	};
}

async function searchDir(
	root: string,
	dir: string,
	regex: RegExp,
	includeRegex: RegExp | null,
	matches: string[],
): Promise<void> {
	if (matches.length >= MAX_MATCHES) return;

	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}

	for (const entry of entries) {
		if (matches.length >= MAX_MATCHES) return;

		const fullPath = join(dir, entry.name);

		if (entry.name.startsWith(".") || entry.name === "node_modules") {
			continue;
		}

		if (entry.isDirectory()) {
			await searchDir(root, fullPath, regex, includeRegex, matches);
		} else if (entry.isFile()) {
			const rel = relative(root, fullPath);

			if (includeRegex && !includeRegex.test(rel)) {
				continue;
			}

			await searchFile(rel, fullPath, regex, matches);
		}
	}
}

async function searchFile(
	relPath: string,
	fullPath: string,
	regex: RegExp,
	matches: string[],
): Promise<void> {
	let content: string;
	try {
		const buf = await readFile(fullPath);
		if (buf.length > MAX_FILE_SIZE) return;
		if (isBinary(buf)) return;
		content = buf.toString("utf-8");
	} catch {
		return;
	}

	const lines = content.split("\n");
	for (let i = 0; i < lines.length; i++) {
		if (matches.length >= MAX_MATCHES) return;

		regex.lastIndex = 0;
		if (regex.test(lines[i])) {
			matches.push(`${relPath}:${i + 1}: ${lines[i]}`);
		}
	}
}

function isBinary(buf: Buffer): boolean {
	const sample = buf.subarray(0, Math.min(buf.length, 8192));
	for (let i = 0; i < sample.length; i++) {
		if (sample[i] === 0) return true;
	}
	return false;
}

function globToRegex(pattern: string): RegExp {
	let re = "";
	let i = 0;

	while (i < pattern.length) {
		const c = pattern[i];
		if (c === "*") {
			if (pattern[i + 1] === "*") {
				re += ".*";
				i += pattern[i + 2] === "/" ? 3 : 2;
			} else {
				re += "[^/]*";
				i++;
			}
		} else if (c === "?") {
			re += "[^/]";
			i++;
		} else if (c === "{") {
			const close = pattern.indexOf("}", i);
			if (close !== -1) {
				const alts = pattern.slice(i + 1, close).split(",");
				re +=
					"(?:" +
					alts.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") +
					")";
				i = close + 1;
			} else {
				re += "\\" + c;
				i++;
			}
		} else {
			re += /[.*+?^${}()|[\]\\]/.test(c) ? "\\" + c : c;
			i++;
		}
	}

	return new RegExp("^(?:" + re + ")$");
}

function error(text: string): ToolResult {
	return { content: [{ type: "text", text }], isError: true };
}
