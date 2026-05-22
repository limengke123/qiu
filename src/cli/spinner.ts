/**
 * Braille spinner animation with chalk colors and elapsed time.
 */

import { t, CLEAR_LINE } from "./theme.js";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL_MS = 80;

export class Spinner {
	private frame = 0;
	private timer: NodeJS.Timeout | null = null;
	private message = "";
	private running = false;
	private startTime = 0;

	start(message = "Thinking..."): void {
		this.message = message;
		this.running = true;
		this.frame = 0;
		this.startTime = Date.now();
		this.render();
		this.timer = setInterval(() => {
			this.frame = (this.frame + 1) % FRAMES.length;
			this.render();
		}, INTERVAL_MS);
	}

	setMessage(message: string): void {
		this.message = message;
		if (this.running) this.render();
	}

	stop(): void {
		this.running = false;
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		process.stdout.write(CLEAR_LINE);
	}

	private render(): void {
		const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
		const icon = t.spinner(FRAMES[this.frame]);
		const msg = t.spinnerText(this.message);
		const time = t.dim(`(${elapsed}s)`);
		process.stdout.write(`${CLEAR_LINE}  ${icon} ${msg} ${time}`);
	}
}
