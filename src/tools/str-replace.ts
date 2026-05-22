import { readFile, writeFile } from "node:fs/promises";
import type { Tool, ToolResult } from "../types.js";

export function strReplaceTool(): Tool {
	return {
		name: "str_replace",
		description:
			"Replace an exact string in a file with a new string. The old_string must appear exactly once in the file (unless replace_all is true). Use this for surgical edits instead of rewriting entire files.",
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "Absolute or relative path to the file",
				},
				old_string: {
					type: "string",
					description:
						"The exact text to find in the file. Must be unique unless replace_all is true.",
				},
				new_string: {
					type: "string",
					description:
						"The replacement text. Use empty string to delete the old_string.",
				},
				replace_all: {
					type: "boolean",
					description:
						"If true, replace all occurrences of old_string. Default: false.",
				},
			},
			required: ["path", "old_string", "new_string"],
		},
		async execute(args: Record<string, unknown>): Promise<ToolResult> {
			const filePath = args.path as string;
			const oldString = args.old_string as string;
			const newString = args.new_string as string;
			const replaceAll = (args.replace_all as boolean) ?? false;

			if (!filePath) {
				return error("Missing path argument");
			}
			if (oldString === undefined || oldString === null) {
				return error("Missing old_string argument");
			}
			if (newString === undefined || newString === null) {
				return error("Missing new_string argument");
			}
			if (oldString === newString) {
				return error("old_string and new_string are identical");
			}

			try {
				const content = await readFile(filePath, "utf-8");

				const count = countOccurrences(content, oldString);

				if (count === 0) {
					return error(
						`old_string not found in ${filePath}. Make sure it matches exactly (including whitespace and indentation).`,
					);
				}

				if (count > 1 && !replaceAll) {
					return error(
						`old_string appears ${count} times in ${filePath}. Provide more context to make it unique, or set replace_all=true.`,
					);
				}

				let updated: string;
				if (replaceAll) {
					updated = content.split(oldString).join(newString);
				} else {
					const idx = content.indexOf(oldString);
					updated =
						content.slice(0, idx) +
						newString +
						content.slice(idx + oldString.length);
				}

				await writeFile(filePath, updated, "utf-8");

				const replacements = replaceAll ? count : 1;
				return {
					content: [
						{
							type: "text",
							text: `Replaced ${replacements} occurrence${replacements > 1 ? "s" : ""} in ${filePath}`,
						},
					],
				};
			} catch (err) {
				return error(
					err instanceof Error ? err.message : String(err),
				);
			}
		},
	};
}

function countOccurrences(haystack: string, needle: string): number {
	let count = 0;
	let pos = 0;
	while (true) {
		pos = haystack.indexOf(needle, pos);
		if (pos === -1) break;
		count++;
		pos += needle.length;
	}
	return count;
}

function error(text: string): ToolResult {
	return { content: [{ type: "text", text }], isError: true };
}
