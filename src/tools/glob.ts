import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Tool, ToolResult } from "../types.js";

const MAX_RESULTS = 200;

export function globTool(): Tool {
	return {
		name: "glob",
		description:
			"Find files by name pattern using glob matching. Returns matching file paths sorted by modification time (newest first).",
		parameters: {
			type: "object",
			properties: {
				pattern: {
					type: "string",
					description:
						'Glob pattern to match file names against. Examples: "*.ts", "src/**/*.test.ts", "**/*.json"',
				},
				directory: {
					type: "string",
					description:
						"Directory to search in. Defaults to current working directory.",
				},
			},
			required: ["pattern"],
		},
		async execute(args: Record<string, unknown>): Promise<ToolResult> {
			const pattern = args.pattern as string;
			const directory = (args.directory as string) || process.cwd();

			if (!pattern) {
				return error("Missing pattern argument");
			}

			try {
				const regex = globToRegex(pattern);
				const results: { path: string; mtime: number }[] = [];

				await walk(directory, directory, regex, results);

				results.sort((a, b) => b.mtime - a.mtime);

				const limited = results.slice(0, MAX_RESULTS);
				const paths = limited.map((r) => r.path);

				let text = paths.join("\n") || "No files matched.";
				if (results.length > MAX_RESULTS) {
					text += `\n\n(showing ${MAX_RESULTS} of ${results.length} matches)`;
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

async function walk(
	root: string,
	dir: string,
	regex: RegExp,
	results: { path: string; mtime: number }[],
): Promise<void> {
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}

	for (const entry of entries) {
		const fullPath = join(dir, entry.name);

		if (entry.name.startsWith(".") || entry.name === "node_modules") {
			continue;
		}

		if (entry.isDirectory()) {
			await walk(root, fullPath, regex, results);
		} else if (entry.isFile()) {
			const rel = relative(root, fullPath);
			if (regex.test(rel)) {
				try {
					const s = await stat(fullPath);
					results.push({ path: rel, mtime: s.mtimeMs });
				} catch {
					results.push({ path: rel, mtime: 0 });
				}
			}
		}
	}
}

function globToRegex(pattern: string): RegExp {
	let re = "";
	let i = 0;

	while (i < pattern.length) {
		const c = pattern[i];

		if (c === "*") {
			if (pattern[i + 1] === "*") {
				if (pattern[i + 2] === "/") {
					re += "(?:.+/)?";
					i += 3;
				} else {
					re += ".*";
					i += 2;
				}
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
				const alternatives = pattern.slice(i + 1, close).split(",");
				re += "(?:" + alternatives.map(escapeRegex).join("|") + ")";
				i = close + 1;
			} else {
				re += escapeRegexChar(c);
				i++;
			}
		} else {
			re += escapeRegexChar(c);
			i++;
		}
	}

	return new RegExp("^(?:" + re + ")$");
}

function escapeRegexChar(c: string): string {
	return /[.*+?^${}()|[\]\\]/.test(c) ? "\\" + c : c;
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function error(text: string): ToolResult {
	return { content: [{ type: "text", text }], isError: true };
}
