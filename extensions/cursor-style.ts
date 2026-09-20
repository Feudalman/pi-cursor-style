/**
 * Cursor Style - restyle the main editor's fake cursor.
 *
 * The editor's fake cursor is rendered as a reverse-video block
 * (`\x1b[7m<grapheme>\x1b[0m`), hardcoded in pi-tui. This extension wraps the
 * default editor and post-processes its render output, swapping that block
 * for a bar / underline / colorized block / hardware caret while preserving
 * cell width (so alignment and the IME cursor marker are unaffected).
 *
 * Configure with the /cursor-style command (applies immediately):
 *
 *   /cursor-style                     show current config and usage
 *   /cursor-style bar                 block | bar | underline | hardware
 *   /cursor-style color #ff5f00       hex | 0-255 | theme:<token> | none
 *
 * Or edit ~/.pi/agent/cursor-style.json directly (then /reload):
 *
 *   { "style": "bar", "color": "#00aaff" }
 *
 *   style: "block" | "bar" | "underline" | "hardware"  (default "block")
 *   color: "#rrggbb" | 0-255 | "theme:<token>"  (default "#00aaff"; "none" disables)
 *
 *   "hardware" hides the fake cursor entirely and shows the terminal's own
 *   caret instead (VS Code-style: no cell taken, characters never move).
 *   Requires pi's showHardwareCursor; /cursor-style hardware offers to
 *   enable it in settings.json. Caret shape follows the terminal's cursor
 *   settings.
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
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface CursorStyleConfig {
	style: "block" | "bar" | "underline" | "hardware";
	color: string | undefined; // undefined = built-in default (blue); "none" = terminal default
	/**
	 * Who turned pi's showHardwareCursor on:
	 * - "extension": this extension did (via /cursor-style hardware).
	 *   Switching back to a software style turns it off again.
	 * - "user": the user did, e.g. for IME positioning. Never touched.
	 * - undefined: unknown (legacy installs from before this field
	 *   existed). The first switch back to a software style asks once
	 *   and records the answer.
	 */
	hardwareCursorOwner: "extension" | "user" | undefined;
}

/** Fallback color when the config omits "color". */
const DEFAULT_COLOR = "#00aaff";

/** Matches the editor's fake cursor: reverse video around one grapheme. */
const CURSOR_RE = /\x1b\[7m([^\x1b]*)\x1b\[0m/g;

const CONFIG_PATH = join(homedir(), ".pi", "agent", "cursor-style.json");
const SETTINGS_PATH = join(homedir(), ".pi", "agent", "settings.json");

function loadConfig(): CursorStyleConfig {
	try {
		const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Partial<CursorStyleConfig>;
		const style =
			raw.style === "bar" ||
			raw.style === "underline" ||
			raw.style === "hardware" ||
			raw.style === "block"
				? raw.style
				: "block";
		const color = typeof raw.color === "string" && raw.color.length > 0 ? raw.color : DEFAULT_COLOR;
		const owner =
			raw.hardwareCursorOwner === "extension" || raw.hardwareCursorOwner === "user"
				? raw.hardwareCursorOwner
				: undefined;
		return { style, color: color === "none" ? undefined : color, hardwareCursorOwner: owner };
	} catch {
		return { style: "block", color: DEFAULT_COLOR, hardwareCursorOwner: undefined };
	}
}

function saveConfig(cfg: CursorStyleConfig): void {
	writeFileSync(
		CONFIG_PATH,
		`${JSON.stringify({ style: cfg.style, color: cfg.color, hardwareCursorOwner: cfg.hardwareCursorOwner }, null, "\t")}\n`,
	);
}

/** Live config: mutated by /cursor-style, read on every render. */
const activeCfg = loadConfig();

function isHardwareCursorEnabled(): boolean {
	if (process.env.PI_HARDWARE_CURSOR === "1") return true;
	try {
		const settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) as {
			showHardwareCursor?: boolean;
		};
		return settings.showHardwareCursor === true;
	} catch {
		return false;
	}
}

function writeSettingsShowHardwareCursor(enabled: boolean): boolean {
	try {
		let settings: Record<string, unknown> = {};
		try {
			settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) as Record<string, unknown>;
		} catch {
			// missing or invalid settings file — start fresh
		}
		settings.showHardwareCursor = enabled;
		writeFileSync(SETTINGS_PATH, `${JSON.stringify(settings, null, "\t")}\n`);
		return true;
	} catch {
		return false;
	}
}

/** The live TUI, captured when the editor factory runs (null in print/RPC modes). */
let tuiRef: { setShowHardwareCursor: (enabled: boolean) => void } | undefined;

async function enableHardwareCursorSetting(ctx: {
	ui: { confirm: (t: string, m: string) => Promise<boolean>; notify: (m: string, t: "info" | "warning") => void };
}): Promise<boolean> {
	const ok = await ctx.ui.confirm(
		"Enable hardware cursor?",
		'"hardware" needs pi\'s showHardwareCursor (the terminal caret). Turn it on now? It is turned back off automatically when you switch to another style.',
	);
	if (!ok) return false;
	if (!writeSettingsShowHardwareCursor(true)) {
		ctx.ui.notify("Could not write ~/.pi/agent/settings.json", "warning");
		return false;
	}
	activeCfg.hardwareCursorOwner = "extension";
	saveConfig(activeCfg);
	tuiRef?.setShowHardwareCursor(true); // applies immediately, no restart
	return true;
}

/**
 * Reconcile showHardwareCursor when switching back to a software style:
 * - extension-owned: turn it off (settings + live TUI).
 * - user-owned: never touch it.
 * - unknown (legacy): settings currently on -> ask once, record the answer;
 *   settings already off -> just clear the stale marker.
 */
async function disableManagedHardwareCursor(ctx: {
	ui: {
		notify: (m: string, t: "info" | "warning") => void;
		confirm: (title: string, message: string) => Promise<boolean>;
	};
}): Promise<void> {
	// Re-read from disk as the single source of truth: the marker may have
	// been edited or removed since this session started.
	activeCfg.hardwareCursorOwner = loadConfig().hardwareCursorOwner;
	if (activeCfg.hardwareCursorOwner === "user") return;

	if (!isHardwareCursorEnabled()) {
		// Already off (user turned it off themselves); normalize the marker.
		if (activeCfg.hardwareCursorOwner === "extension") {
			activeCfg.hardwareCursorOwner = undefined;
			saveConfig(activeCfg);
		}
		return;
	}

	if (activeCfg.hardwareCursorOwner === undefined) {
		// Legacy install: showHardwareCursor is on but ownership is unknown.
		const claim = await ctx.ui.confirm(
			"Turn showHardwareCursor off?",
			'pi\'s showHardwareCursor is on (possibly enabled by an earlier version of this extension). With a software cursor style the terminal caret stacks on top of it. Turn it off?',
		);
		activeCfg.hardwareCursorOwner = claim ? "extension" : "user";
		saveConfig(activeCfg);
		if (!claim) return;
	}

	if (writeSettingsShowHardwareCursor(false)) {
		activeCfg.hardwareCursorOwner = undefined;
		saveConfig(activeCfg);
		tuiRef?.setShowHardwareCursor(false); // applies immediately, no restart
		ctx.ui.notify("showHardwareCursor turned back off.", "info");
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
	private readonly themeRef: { fg: (color: string, text: string) => string } | undefined;

	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		themeRef: { fg: (color: string, text: string) => string } | undefined,
	) {
		super(tui, theme, keybindings, { embedWorkingStatus: true });
		this.themeRef = themeRef;
	}

	render(width: number): string[] {
		const lines = super.render(width);
		const { style, color } = activeCfg;
		if (style === "block" && !color) return lines;
		return lines.map((line) => this.processLine(line, style, color));
	}

	private processLine(
		line: string,
		style: CursorStyleConfig["style"],
		color: string | undefined,
	): string {
		if (style === "hardware") {
			// Hide the fake cursor entirely: restore the bare grapheme. The
			// zero-width CURSOR_MARKER before it stays in place, so pi keeps
			// positioning the terminal's hardware cursor at the caret cell.
			// Characters never move or get covered — the VS Code look.
			return line.replace(CURSOR_RE, (_match, ch: string) => ch);
		}
		if (style !== "bar") {
			return line.replace(CURSOR_RE, (_match, ch: string) => this.restyle(ch, style, color));
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
				return this.paintBar(color);
			}
			if (canBorrow) {
				borrowed = true;
				return this.paintBar(color) + ch;
			}
			return `\x1b[7m${ch}\x1b[0m`;
		});
		return borrowed ? out.replace(/ $/, "") : out;
	}

	private paintBar(color: string | undefined): string {
		const colorize = this.resolveColorize(color);
		return colorize ? colorize("▏") : `\x1b[1m▏\x1b[22m`;
	}

	private restyle(
		ch: string,
		style: CursorStyleConfig["style"],
		color: string | undefined,
	): string {
		const colorize = this.resolveColorize(color);
		switch (style) {
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

	private resolveColorize(color: string | undefined): ((text: string) => string) | undefined {
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

const USAGE = `usage:
  /cursor-style                 show current config
  /cursor-style <style>         block | bar | underline | hardware
  /cursor-style color <value>   "#rrggbb" | 0-255 | theme:<token> | none`;

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		// Editor replacement exists in interactive mode only; in print/RPC
		// modes ctx.ui has no setEditorComponent, so probe before calling.
		if (typeof ctx.ui.setEditorComponent !== "function") return;
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			tuiRef = tui;
			return new CursorStyleEditor(tui, theme, keybindings, ctx.ui.theme);
		});
		if (activeCfg.hardwareCursorOwner === "extension" && !isHardwareCursorEnabled()) {
			// The user turned the setting off themselves; drop the stale marker.
			activeCfg.hardwareCursorOwner = undefined;
			saveConfig(activeCfg);
		}
		if (activeCfg.style === "hardware" && !isHardwareCursorEnabled()) {
			ctx.ui.notify(
				'pi-cursor-style: "hardware" needs showHardwareCursor. Run /cursor-style hardware to set it up.',
				"warning",
			);
		}
	});

	pi.registerCommand("cursor-style", {
		description: "Set the editor cursor style (block/bar/underline/hardware) and color",
		handler: async (args, ctx) => {
			if (typeof ctx.ui.setEditorComponent !== "function") return;
			const parts = args.trim().split(/\s+/).filter(Boolean);

			if (parts.length === 0) {
				ctx.ui.notify(
					`cursor style: ${activeCfg.style} | color: ${activeCfg.color ?? "(none)"}\n${USAGE}`,
					"info",
				);
				return;
			}

			if (parts[0] === "color") {
				const value = parts[1];
				if (!value || value === "none") {
					activeCfg.color = undefined;
				} else {
					activeCfg.color = value;
				}
				saveConfig(activeCfg);
				ctx.ui.notify(`cursor color: ${activeCfg.color ?? "(none)"}`, "info");
				return;
			}

			const style = parts[0];
			if (style !== "block" && style !== "bar" && style !== "underline" && style !== "hardware") {
				ctx.ui.notify(`unknown style "${style}"\n${USAGE}`, "warning");
				return;
			}
			activeCfg.style = style;
			saveConfig(activeCfg);
			ctx.ui.notify(`cursor style: ${style} (applied immediately)`, "info");

			if (style === "hardware") {
				if (!isHardwareCursorEnabled()) {
					await enableHardwareCursorSetting(ctx);
				}
			} else {
				// Leaving hardware mode: turn the auto-enabled setting back
				// off so the terminal caret does not stack on the fake cursor.
				await disableManagedHardwareCursor(ctx);
			}
		},
	});
}
