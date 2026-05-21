import { readFile } from "node:fs/promises";
import type { Tool, ToolResult } from "../types.js";

const MAX_SIZE = 100_000;

export function readFileTool(): Tool {
	return {
		name: "read_file",
		description:
			"Read the contents of a file. Returns the file content as text. Supports an optional offset and limit for reading portions of large files.",
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "Absolute or relative path to the file",
				},
				offset: {
					type: "integer",
					description:
						"Line number to start reading from (1-based). Optional.",
				},
				limit: {
					type: "integer",
					description: "Maximum number of lines to read. Optional.",
				},
			},
			required: ["path"],
		},
		async execute(args: Record<string, unknown>): Promise<ToolResult> {
			const filePath = args.path as string;
			if (!filePath) {
				return {
					content: [{ type: "text", text: "Missing path argument" }],
					isError: true,
				};
			}

			try {
				const raw = await readFile(filePath, "utf-8");

				let lines = raw.split("\n");
				const totalLines = lines.length;

				const offset = (args.offset as number | undefined) ?? 1;
				const limit = args.limit as number | undefined;

				if (offset > 1 || limit) {
					const start = Math.max(0, offset - 1);
					lines = limit
						? lines.slice(start, start + limit)
						: lines.slice(start);
				}

				const numbered = lines
					.map(
						(line, i) =>
							`${String(offset + i).padStart(6)}|${line}`,
					)
					.join("\n");

				let text = numbered;
				if (text.length > MAX_SIZE) {
					text =
						text.slice(0, MAX_SIZE) +
						`\n\n... (truncated, file has ${totalLines} lines)`;
				}

				return { content: [{ type: "text", text }] };
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text:
								error instanceof Error
									? error.message
									: String(error),
						},
					],
					isError: true,
				};
			}
		},
	};
}
