/**
 * Configuration management for qiu.
 *
 * Resolution order (highest to lowest priority):
 *  1. CLI arguments
 *  2. Environment variables (QIU_MODEL, QIU_BASE_URL, QIU_API_KEY, etc.)
 *  3. Project config  (./qiu.json in working directory)
 *  4. User config     (~/.config/qiu/config.json)
 *  5. Built-in defaults
 */

import {
	readFileSync,
	writeFileSync,
	mkdirSync,
	existsSync,
	unlinkSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import type { Model } from "./types.js";

// ── Config schemas ──

export interface UserConfig {
	model?: string;
	baseUrl?: string;
	apiKey?: string;
	systemPrompt?: string;
	maxContextTokens?: number;
	temperature?: number;
	maxTokens?: number;
	maxTurns?: number;
}

export interface ProjectConfig extends UserConfig {
	tools?: Record<string, boolean>;
}

export interface ResolvedConfig {
	model: Model;
	systemPrompt: string;
	maxContextTokens?: number;
	maxTurns: number;
	tools?: Record<string, boolean>;
	sources: ConfigSources;
}

export interface ConfigSources {
	userConfigPath: string;
	projectConfigPath: string;
	userConfig: UserConfig | null;
	projectConfig: ProjectConfig | null;
}

// ── Defaults ──

const DEFAULTS: Required<
	Pick<UserConfig, "model" | "baseUrl" | "systemPrompt" | "maxTurns">
> = {
	model: "qwen2.5:7b",
	baseUrl: "http://localhost:11434",
	systemPrompt:
		"You are a helpful coding assistant. You have access to tools for reading files, writing files, and executing shell commands. Use them when needed to help the user.",
	maxTurns: 50,
};

// ── Path resolution ──

function configHome(): string {
	return process.env.XDG_CONFIG_HOME
		? resolve(process.env.XDG_CONFIG_HOME)
		: join(homedir(), ".config");
}

function userConfigPath(): string {
	return join(configHome(), "qiu", "config.json");
}

function findProjectConfig(startDir: string): string {
	let dir = resolve(startDir);
	const root = dirname(dir) === dir ? dir : undefined;

	while (true) {
		const candidate = join(dir, "qiu.json");
		if (existsSync(candidate)) return candidate;

		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}

	return join(resolve(startDir), "qiu.json");
}

// ── File I/O ──

function readJson<T>(path: string): T | null {
	if (!existsSync(path)) return null;
	try {
		const raw = readFileSync(path, "utf-8");
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object") return parsed as T;
	} catch {
		// malformed JSON
	}
	return null;
}

function writeJson(path: string, data: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

// ── Environment variable extraction ──

function fromEnv(): Partial<UserConfig> {
	const cfg: Partial<UserConfig> = {};

	if (process.env.QIU_MODEL) cfg.model = process.env.QIU_MODEL;
	if (process.env.QIU_BASE_URL) cfg.baseUrl = process.env.QIU_BASE_URL;
	if (process.env.QIU_API_KEY) cfg.apiKey = process.env.QIU_API_KEY;
	else if (process.env.OPENAI_API_KEY)
		cfg.apiKey = process.env.OPENAI_API_KEY;
	if (process.env.QIU_SYSTEM_PROMPT)
		cfg.systemPrompt = process.env.QIU_SYSTEM_PROMPT;
	if (process.env.QIU_MAX_CONTEXT_TOKENS)
		cfg.maxContextTokens = parseInt(
			process.env.QIU_MAX_CONTEXT_TOKENS,
			10,
		);
	if (process.env.QIU_TEMPERATURE)
		cfg.temperature = parseFloat(process.env.QIU_TEMPERATURE);
	if (process.env.QIU_MAX_TOKENS)
		cfg.maxTokens = parseInt(process.env.QIU_MAX_TOKENS, 10);
	if (process.env.QIU_MAX_TURNS)
		cfg.maxTurns = parseInt(process.env.QIU_MAX_TURNS, 10);

	return cfg;
}

// ── ConfigManager ──

export class ConfigManager {
	private _userPath: string;
	private _projectPath: string;
	private _projectDir: string;

	constructor(projectDir: string = process.cwd()) {
		this._projectDir = resolve(projectDir);
		this._userPath = userConfigPath();
		this._projectPath = findProjectConfig(this._projectDir);
	}

	get userPath(): string {
		return this._userPath;
	}

	get projectPath(): string {
		return this._projectPath;
	}

	/**
	 * Resolve the final effective config by merging all sources.
	 */
	resolve(cliOverrides: Partial<UserConfig> = {}): ResolvedConfig {
		const user = readJson<UserConfig>(this._userPath);
		const project = readJson<ProjectConfig>(this._projectPath);
		const env = fromEnv();

		// Merge: CLI > env > project > user > defaults
		const model =
			cliOverrides.model ??
			env.model ??
			project?.model ??
			user?.model ??
			DEFAULTS.model;

		const baseUrl = (
			cliOverrides.baseUrl ??
			env.baseUrl ??
			project?.baseUrl ??
			user?.baseUrl ??
			DEFAULTS.baseUrl
		).replace(/\/$/, "");

		const apiKey =
			cliOverrides.apiKey ?? env.apiKey ?? user?.apiKey ?? undefined;

		const systemPrompt =
			cliOverrides.systemPrompt ??
			env.systemPrompt ??
			project?.systemPrompt ??
			user?.systemPrompt ??
			DEFAULTS.systemPrompt;

		const maxContextTokens =
			cliOverrides.maxContextTokens ??
			env.maxContextTokens ??
			project?.maxContextTokens ??
			user?.maxContextTokens ??
			undefined;

		const temperature =
			cliOverrides.temperature ??
			env.temperature ??
			project?.temperature ??
			user?.temperature ??
			undefined;

		const maxTokens =
			cliOverrides.maxTokens ??
			env.maxTokens ??
			project?.maxTokens ??
			user?.maxTokens ??
			undefined;

		const maxTurns =
			cliOverrides.maxTurns ??
			env.maxTurns ??
			project?.maxTurns ??
			user?.maxTurns ??
			DEFAULTS.maxTurns;

		return {
			model: {
				id: model,
				baseUrl,
				apiKey,
				temperature,
				maxTokens,
			},
			systemPrompt,
			maxContextTokens,
			maxTurns,
			tools: project?.tools,
			sources: {
				userConfigPath: this._userPath,
				projectConfigPath: this._projectPath,
				userConfig: user,
				projectConfig: project,
			},
		};
	}

	/**
	 * Save to user-level config. Merges with existing values.
	 */
	saveUser(config: Partial<UserConfig>): void {
		const existing = readJson<UserConfig>(this._userPath) ?? {};
		const merged = { ...existing };

		for (const [k, v] of Object.entries(config)) {
			if (v !== undefined) {
				(merged as Record<string, unknown>)[k] = v;
			}
		}

		writeJson(this._userPath, merged);
	}

	/**
	 * Save to project-level config. Merges with existing values.
	 */
	saveProject(config: Partial<ProjectConfig>): void {
		const existing = readJson<ProjectConfig>(this._projectPath) ?? {};
		const merged = { ...existing };

		for (const [k, v] of Object.entries(config)) {
			if (v !== undefined) {
				(merged as Record<string, unknown>)[k] = v;
			}
		}

		writeJson(this._projectPath, merged);
	}

	/**
	 * Delete a key from user config. Pass null to delete the entire file.
	 */
	deleteUser(key?: keyof UserConfig): void {
		if (!key) {
			if (existsSync(this._userPath)) unlinkSync(this._userPath);
			return;
		}
		const existing = readJson<UserConfig>(this._userPath);
		if (!existing) return;
		delete (existing as Record<string, unknown>)[key];
		writeJson(this._userPath, existing);
	}

	/**
	 * Delete a key from project config. Pass null to delete the entire file.
	 */
	deleteProject(key?: keyof ProjectConfig): void {
		if (!key) {
			if (existsSync(this._projectPath)) unlinkSync(this._projectPath);
			return;
		}
		const existing = readJson<ProjectConfig>(this._projectPath);
		if (!existing) return;
		delete (existing as Record<string, unknown>)[key];
		writeJson(this._projectPath, existing);
	}

	/**
	 * Check if a project config exists in the directory tree.
	 */
	hasProjectConfig(): boolean {
		return existsSync(this._projectPath);
	}

	/**
	 * Check if a user config exists.
	 */
	hasUserConfig(): boolean {
		return existsSync(this._userPath);
	}
}

// ── Convenience: create a singleton for the current project ──

let _default: ConfigManager | undefined;

export function getConfigManager(
	projectDir?: string,
): ConfigManager {
	if (!_default || projectDir) {
		_default = new ConfigManager(projectDir);
	}
	return _default;
}
