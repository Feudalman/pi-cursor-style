/**
 * Cursor Style - restyle the main editor's fake cursor.
 *
 * The editor's fake cursor is rendered as a reverse-video block
 * (`\x1b[7m<grapheme>\x1b[0m`), hardcoded in pi-tui. This extension wraps the
 * default editor and post-processes its render output, swapping that block
 * for a bar / underline / colorized block while preserving cell width (so
 * alignment and the IME cursor marker are unaffected).
 *
 * Configuration: ~/.pi/agent/cursor-style.json
 *   { "style": "bar" }
 *   { "style": "underline", "color": "#ff5f00" }
 *
 *   style: "block" | "bar" | "underline"        (default "block")
 *   color: "#rrggbb" | 0-255 | "theme:<token>"  (default "#00aaff"; "none" disables)
 *
 * "theme:<token>" resolves against the active theme (e.g. "theme:accent")
 * and follows theme switches live. Re-run /reload after editing the config.
 *
 * Scope: the main input editor only. Single-line inputs (search boxes in
 * /model, /resume, etc.) are constructed inside the core and cannot be
 * restyled by an extension.
 */

import {
	CustomEditor,
	type ExtensionAPI,
	type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface CursorStyleConfig {
	style: "block" | "bar" | "underline";
	color: string | undefined; // undefined = built-in default (blue); "none" = terminal default
}

/** Fallback color when the config omits "color". */
const DEFAULT_COLOR = "#00aaff";

/** Matches the editor's fake cursor: reverse video around one grapheme. */
const CURSOR_RE = /\x1b\[7m([^\x1b]*)\x1b\[0m/g;

const CONFIG_PATH = join(homedir(), ".pi", "agent", "cursor-style.json");

function loadConfig(): CursorStyleConfig {
	try {
		const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Partial<CursorStyleConfig>;
		const style =
			raw.style === "bar" || raw.style === "underline" || raw.style === "block" ? raw.style : "block";
		const color = typeof raw.color === "string" && raw.color.length > 0 ? raw.color : DEFAULT_COLOR;
		return { style, color: color === "none" ? undefined : color };
	} catch {
		return { style: "block", color: DEFAULT_COLOR };
	}
}

function hexToColorize(hex: string): ((text: string) => string) | undefined {
	const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
	if (!m) return undefined;
	const n = Number.parseInt(m[1], 16);
	const ansi = `\x1b[38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m`;
	return (text) => `${ansi}${text}\x1b[39m`;
}

class CursorStyleEditor extends CustomEditor {
	private readonly cfg: CursorStyleConfig;
	private readonly themeRef: { fg: (color: string, text: string) => string } | undefined;

	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		cfg: CursorStyleConfig,
		themeRef: { fg: (color: string, text: string) => string } | undefined,
	) {
		super(tui, theme, keybindings, { embedWorkingStatus: true });
		this.cfg = cfg;
		this.themeRef = themeRef;
	}

	render(width: number): string[] {
		const lines = super.render(width);
		if (this.cfg.style === "block" && !this.cfg.color) return lines;
		return lines.map((line) => this.processLine(line));
	}

	private processLine(line: string): string {
		if (this.cfg.style !== "bar") {
			return line.replace(CURSOR_RE, (_match, ch: string) => this.restyle(ch));
		}
		// Bar: insert the beam BETWEEN characters so the character at the
		// cursor stays visible (matching how the default block wraps a
		// character without hiding it). Insertion needs one extra column,
		// borrowed from the line's trailing padding; a completely full
		// line falls back to the reverse-video block to avoid overflow.
		const canBorrow = line.endsWith(" ");
		let borrowed = false;
		const out = line.replace(CURSOR_RE, (_match, ch: string) => {
			if (ch === " ") {
				// End-of-line cursor: the beam takes the cursor cell itself.
				return this.paintBar();
			}
			if (canBorrow) {
				borrowed = true;
				return this.paintBar() + ch;
			}
			return `\x1b[7m${ch}\x1b[0m`;
		});
		return borrowed ? out.replace(/ $/, "") : out;
	}

	private paintBar(): string {
		const colorize = this.resolveColorize();
		return colorize ? colorize("▏") : `\x1b[1m▏\x1b[22m`;
	}

	private restyle(ch: string): string {
		const colorize = this.resolveColorize();
		switch (this.cfg.style) {
			case "underline": {
				// Keep the character visible; blank cells use a dedicated
				// glyph because terminals trim underlines on blanks.
				const glyph = ch === " " ? "▁" : ch;
				const styled = colorize ? colorize(glyph) : glyph;
				return `\x1b[4m${styled}\x1b[24m`;
			}
			default:
				// Colorized block: set fg inside reverse video, so the
				// terminal fills the cell with that color.
				return `\x1b[7m${colorize ? colorize(ch) : ch}\x1b[0m`;
		}
	}

	private resolveColorize(): ((text: string) => string) | undefined {
		const color = this.cfg.color;
		if (!color) return undefined;
		if (color.startsWith("theme:")) {
			const token = color.slice("theme:".length);
			if (!this.themeRef) return undefined;
			return (text) => {
				try {
				return this.themeRef!.fg(token, text);
			} catch {
				return text;
			}
		};
		}
		if (/^\d+$/.test(color)) {
			const idx = Number.parseInt(color, 10);
			if (idx >= 0 && idx <= 255) return (text) => `\x1b[38;5;${idx}m${text}\x1b[39m`;
			return undefined;
		}
		return hexToColorize(color);
	}
}

export default function (pi: ExtensionAPI) {
	const cfg = loadConfig();

	pi.on("session_start", async (_event, ctx) => {
		// Editor replacement exists in interactive mode only; in print/RPC
		// modes ctx.ui has no setEditorComponent, so probe before calling.
		if (typeof ctx.ui.setEditorComponent !== "function") return;
		ctx.ui.setEditorComponent(
			(tui, theme, keybindings) => new CursorStyleEditor(tui, theme, keybindings, cfg, ctx.ui.theme),
		);
	});
}
