/**
 * Conversation persistence using JSONL files.
 *
 * Each session is stored as a single .jsonl file:
 *   Line 1: metadata (id, title, model, timestamps)
 *   Line 2+: message objects (appended incrementally)
 *
 * Storage location: ~/.local/share/qiu/sessions/ (or XDG_DATA_HOME)
 */

import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type { Message } from "./types.js";

// ── Types ──

export interface SessionMeta {
	id: string;
	title: string;
	model: string;
	createdAt: number;
	updatedAt: number;
	messageCount: number;
}

export interface Session {
	meta: SessionMeta;
	messages: Message[];
}

// ── SessionStore ──

export class SessionStore {
	private dir: string;

	constructor(baseDir?: string) {
		this.dir = baseDir ?? defaultSessionDir();
		mkdirSync(this.dir, { recursive: true });
	}

	get directory(): string {
		return this.dir;
	}

	/**
	 * Create a new session and return its ID.
	 */
	create(model: string, title?: string): string {
		const id = randomUUID().slice(0, 8);
		const meta: SessionMeta = {
			id,
			title: title ?? "untitled",
			model,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			messageCount: 0,
		};

		const filePath = this.filePath(id);
		writeFileSync(filePath, JSON.stringify(meta) + "\n", "utf-8");
		return id;
	}

	/**
	 * Append messages to a session. Updates metadata.
	 */
	append(sessionId: string, messages: Message[]): void {
		const filePath = this.filePath(sessionId);
		if (!existsSync(filePath)) {
			throw new Error(`Session not found: ${sessionId}`);
		}

		const lines = messages
			.map((msg) => JSON.stringify(msg))
			.join("\n");

		appendFileSync(filePath, lines + "\n", "utf-8");

		this.updateMeta(sessionId, (meta) => {
			meta.updatedAt = Date.now();
			meta.messageCount += messages.length;
			if (meta.title === "untitled") {
				const firstUser = messages.find((m) => m.role === "user");
				if (firstUser) {
					meta.title = extractTitle(firstUser);
				}
			}
		});
	}

	/**
	 * Load a session by ID.
	 */
	load(sessionId: string): Session {
		const filePath = this.filePath(sessionId);
		if (!existsSync(filePath)) {
			throw new Error(`Session not found: ${sessionId}`);
		}

		const raw = readFileSync(filePath, "utf-8");
		const lines = raw.split("\n").filter((l) => l.trim());

		if (lines.length === 0) {
			throw new Error(`Session file is empty: ${sessionId}`);
		}

		const meta = JSON.parse(lines[0]) as SessionMeta;
		const messages: Message[] = [];

		for (let i = 1; i < lines.length; i++) {
			try {
				messages.push(JSON.parse(lines[i]) as Message);
			} catch {
				// skip malformed lines
			}
		}

		return { meta, messages };
	}

	/**
	 * List all sessions, sorted by updatedAt descending (most recent first).
	 */
	list(limit = 20): SessionMeta[] {
		if (!existsSync(this.dir)) return [];

		const files = readdirSync(this.dir).filter((f) =>
			f.endsWith(".jsonl"),
		);

		const metas: SessionMeta[] = [];

		for (const file of files) {
			try {
				const raw = readFileSync(join(this.dir, file), "utf-8");
				const firstLine = raw.split("\n")[0];
				if (firstLine) {
					metas.push(JSON.parse(firstLine) as SessionMeta);
				}
			} catch {
				// skip corrupt files
			}
		}

		metas.sort((a, b) => b.updatedAt - a.updatedAt);
		return metas.slice(0, limit);
	}

	/**
	 * Get the most recent session ID, or null if none exists.
	 */
	latest(): string | null {
		const sessions = this.list(1);
		return sessions.length > 0 ? sessions[0].id : null;
	}

	/**
	 * Delete a session.
	 */
	delete(sessionId: string): boolean {
		const filePath = this.filePath(sessionId);
		if (!existsSync(filePath)) return false;
		unlinkSync(filePath);
		return true;
	}

	/**
	 * Check if a session exists.
	 */
	exists(sessionId: string): boolean {
		return existsSync(this.filePath(sessionId));
	}

	private filePath(id: string): string {
		return join(this.dir, `${id}.jsonl`);
	}

	private updateMeta(
		sessionId: string,
		updater: (meta: SessionMeta) => void,
	): void {
		const filePath = this.filePath(sessionId);
		const raw = readFileSync(filePath, "utf-8");
		const newlineIdx = raw.indexOf("\n");

		const metaLine = newlineIdx === -1 ? raw : raw.slice(0, newlineIdx);
		const rest = newlineIdx === -1 ? "" : raw.slice(newlineIdx);

		const meta = JSON.parse(metaLine) as SessionMeta;
		updater(meta);

		writeFileSync(filePath, JSON.stringify(meta) + rest, "utf-8");
	}
}

// ── Helpers ──

function defaultSessionDir(): string {
	const dataHome = process.env.XDG_DATA_HOME
		? resolve(process.env.XDG_DATA_HOME)
		: join(homedir(), ".local", "share");
	return join(dataHome, "qiu", "sessions");
}

function extractTitle(msg: Message): string {
	if (msg.role !== "user") return "untitled";
	const text =
		typeof msg.content === "string"
			? msg.content
			: msg.content
					.filter((c) => c.type === "text")
					.map((c) => (c as { text: string }).text)
					.join(" ");

	const cleaned = text.replace(/\n/g, " ").trim();
	return cleaned.length > 60 ? cleaned.slice(0, 57) + "..." : cleaned;
}

// ── Singleton ──

let _default: SessionStore | undefined;

export function getSessionStore(): SessionStore {
	if (!_default) {
		_default = new SessionStore();
	}
	return _default;
}
