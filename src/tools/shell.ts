import { execFile } from "node:child_process";
import type { Tool, ToolResult } from "../types.js";

const MAX_OUTPUT = 20_000;

export function shellTool(cwd?: string): Tool {
	return {
		name: "shell",
		description:
			"Execute a shell command and return its stdout/stderr. Use this for running programs, listing files, git operations, etc.",
		parameters: {
			type: "object",
			properties: {
				command: {
					type: "string",
					description: "The shell command to execute",
				},
			},
			required: ["command"],
		},
		async execute(
			args: Record<string, unknown>,
			signal?: AbortSignal,
		): Promise<ToolResult> {
			const command = args.command as string;
			if (!command) {
				return {
					content: [{ type: "text", text: "Missing command argument" }],
					isError: true,
				};
			}

			return new Promise((resolve) => {
				const proc = execFile(
					"/bin/sh",
					["-c", command],
					{
						cwd: cwd ?? process.cwd(),
						timeout: 30_000,
						maxBuffer: 1024 * 1024,
						signal,
					},
					(error, stdout, stderr) => {
						let output = "";
						if (stdout) output += stdout;
						if (stderr) output += (output ? "\n" : "") + stderr;
						if (error && !output) {
							output = error.message;
						}

						if (output.length > MAX_OUTPUT) {
							output =
								output.slice(0, MAX_OUTPUT / 2) +
								"\n\n... (truncated) ...\n\n" +
								output.slice(-MAX_OUTPUT / 2);
						}

						resolve({
							content: [
								{ type: "text", text: output || "(no output)" },
							],
							isError: error ? true : false,
						});
					},
				);
			});
		},
	};
}
