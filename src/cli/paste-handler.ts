/**
 * Bracketed paste detection + image file path auto-detection.
 * When a user drags a file into the terminal, it arrives as a bracketed paste
 * containing the file path. We detect image paths and auto-attach them.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve, extname, basename } from "node:path";

export interface AttachedImage {
	path: string;
	filename: string;
	data: string; // base64
	mimeType: string;
	size: number;
}

const IMAGE_EXTENSIONS: Record<string, string> = {
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".png": "image/png",
	".gif": "image/gif",
	".webp": "image/webp",
	".bmp": "image/bmp",
};

/**
 * Detect if a pasted string is an image file path.
 * Handles single paths, possibly with quotes or trailing whitespace.
 */
export function detectImagePath(text: string): string | null {
	const cleaned = text
		.trim()
		.replace(/^['"]|['"]$/g, "") // strip surrounding quotes
		.replace(/\\ /g, " "); // unescape spaces

	if (!cleaned) return null;

	const ext = extname(cleaned).toLowerCase();
	if (!IMAGE_EXTENSIONS[ext]) return null;

	const resolved = resolve(cleaned);
	if (!existsSync(resolved)) return null;

	return resolved;
}

/**
 * Load an image file and return its metadata + base64 data.
 */
export function loadImageFile(filePath: string): AttachedImage | null {
	try {
		const buf = readFileSync(filePath);
		const ext = extname(filePath).toLowerCase();
		const mimeType = IMAGE_EXTENSIONS[ext];
		if (!mimeType) return null;

		return {
			path: filePath,
			filename: basename(filePath),
			data: buf.toString("base64"),
			mimeType,
			size: buf.length,
		};
	} catch {
		return null;
	}
}

/**
 * Parse bracketed paste content. Returns either an attached image
 * or the raw text to insert into the input line.
 */
export function handlePaste(content: string): {
	type: "image";
	image: AttachedImage;
} | {
	type: "text";
	text: string;
} {
	const imagePath = detectImagePath(content);
	if (imagePath) {
		const image = loadImageFile(imagePath);
		if (image) {
			return { type: "image", image };
		}
	}

	// Not an image — return as text (strip newlines for single-line input)
	return { type: "text", text: content.replace(/\r?\n/g, " ").trim() };
}
