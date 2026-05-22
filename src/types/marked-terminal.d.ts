declare module "marked-terminal" {
	interface TerminalRendererOptions {
		showSectionPrefix?: boolean;
		reflowText?: boolean;
		width?: number;
		tab?: number;
		emoji?: boolean;
	}

	export function markedTerminal(options?: TerminalRendererOptions): any;
	export default function TerminalRenderer(options?: TerminalRendererOptions): any;
}
