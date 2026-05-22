/**
 * Braille spinner animation for terminal.
 */

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL_MS = 80;

const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const CLEAR_LINE = "\x1b[2K\r";

export class Spinner {
	private frame = 0;
	private timer: NodeJS.Timeout | null = null;
	private message = "";
	private running = false;

	start(message = "Thinking..."): void {
		this.message = message;
		this.running = true;
		this.frame = 0;
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
		const spinner = `${CYAN}${FRAMES[this.frame]}${RESET}`;
		process.stdout.write(`${CLEAR_LINE}${spinner} ${DIM}${this.message}${RESET}`);
	}
}
