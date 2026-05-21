import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Tool, ToolResult } from "../types.js";

export function writeFileTool(): Tool {
	return {
		name: "write_file",
		description:
			"Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Parent directories are created automatically.",
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "Absolute or relative path to the file",
				},
				content: {
					type: "string",
					description: "The content to write to the file",
				},
			},
			required: ["path", "content"],
		},
		async execute(args: Record<string, unknown>): Promise<ToolResult> {
			const filePath = args.path as string;
			const content = args.content as string;

			if (!filePath) {
				return {
					content: [{ type: "text", text: "Missing path argument" }],
					isError: true,
				};
			}
			if (content === undefined || content === null) {
				return {
					content: [
						{ type: "text", text: "Missing content argument" },
					],
					isError: true,
				};
			}

			try {
				await mkdir(dirname(filePath), { recursive: true });
				await writeFile(filePath, content, "utf-8");
				return {
					content: [
						{
							type: "text",
							text: `Successfully wrote ${content.length} bytes to ${filePath}`,
						},
					],
				};
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
