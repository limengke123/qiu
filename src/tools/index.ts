export { shellTool } from "./shell.js";
export { readFileTool } from "./read-file.js";
export { writeFileTool } from "./write-file.js";
export { strReplaceTool } from "./str-replace.js";

import { shellTool } from "./shell.js";
import { readFileTool } from "./read-file.js";
import { writeFileTool } from "./write-file.js";
import { strReplaceTool } from "./str-replace.js";
import type { Tool } from "../types.js";

export function defaultTools(): Tool[] {
	return [shellTool(), readFileTool(), writeFileTool(), strReplaceTool()];
}
