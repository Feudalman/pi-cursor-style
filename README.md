# pi-cursor-style

[English](README.md) | [简体中文](README.zh-CN.md)

Restyle the [pi](https://github.com/earendil-works/pi) input editor's cursor: a **bar**, an **underline**, or a **colorized block** — instead of the default reverse-video block.

```
default block   my text▮rest        reverse-video block (swapped fg/bg)
bar             my text▏rest          narrow beam between characters, colorizable
underline       my text̲r̲est           character stays visible
hardware        my text│rest          terminal's own caret; no cell taken, characters never move
```

pi draws its own "fake cursor" hardcoded as reverse video, so neither themes nor settings can change it. This extension wraps the default editor and rewrites the cursor cell on every frame — width-preserving, and the hidden IME cursor marker is left untouched, so input-method candidate windows still track correctly.

## Install

With pi's package manager (recommended):

```bash
pi install git:github.com/Feudalman/pi-cursor-style
```

Or from npm once published:

```bash
pi install npm:pi-cursor-style
```

Or manually: copy [`extensions/cursor-style.ts`](extensions/cursor-style.ts) to `~/.pi/agent/extensions/`.

## Quick start

Once installed, configure with the built-in `/cursor-style` command — changes apply immediately, no restart:

```
/cursor-style bar                  # switch style: block | bar | underline | hardware
/cursor-style color #ff5f00        # any hex, 0-255 index, theme:<token>, or "none"
/cursor-style                      # show current config
```

`/cursor-style hardware` additionally offers to enable pi's `showHardwareCursor` in `~/.pi/agent/settings.json` for you (one confirm dialog, restart once).

## Configure

Create `~/.pi/agent/cursor-style.json`:

```jsonc
{
	"style": "bar",          // "block" | "bar" | "underline" | "hardware"   (default "block")
	"color": "#00aaff"       // default "#00aaff"; see forms below; "none" disables color
}
```

Omit the file entirely for plain `block` + `#00aaff`.

Color forms:

| Value | Meaning |
|-------|---------|
| `"#ff5f00"` | any hex RGB |
| `"208"` | xterm 256-color index |
| `"theme:accent"` | an active-theme token; follows theme switches live |
| `"none"` | no color; terminal default foreground |

When `"color"` is omitted, the built-in default `"#00aaff"` (blue) applies.

Style behavior:

- `block` — the default reverse-video block; with a `color` it becomes a block filled with that color
- `bar` — a narrow `▏` beam inserted **between** characters, so the text at the cursor stays visible (like the default block, which wraps rather than hides the character). The inserted column is borrowed from the line's trailing padding; a completely full line falls back to the reverse-video block. At end of line the beam sits after the last character
- `underline` — underlines the character and keeps it visible; blank cells (end of line) use `▁` because terminals trim underlines on blanks
- `hardware` — the VS Code look: hides the fake cursor entirely and shows the terminal's own hardware caret at the caret cell. No cell is taken, so characters never move or get covered, and the caret is pixel-rendered by your terminal. Requires pi's `showHardwareCursor` (`"showHardwareCursor": true` in `~/.pi/agent/settings.json`, or `PI_HARDWARE_CURSOR=1`); the extension warns at startup if it is off. The shape (beam/block/underline) and color come from your terminal's cursor settings, e.g. VS Code's `terminal.integrated.cursorStyle: "line"`

Re-run `/reload` (or restart pi) after editing the config. Invalid style falls back to `block`; an unparsable color falls back to no color.

## Scope and limitations

- Restyles the **main input editor only**. Single-line inputs (the search boxes in `/model`, `/resume`, etc.) are constructed inside pi's core and cannot be replaced by an extension.
- The extension post-processes render output and matches the cursor sequence `\x1b[7m<grapheme>\x1b[0m`. If a future pi release changes that format, this extension needs a matching update.
- Working status spinner, thinking-level border colors, bash mode, autocomplete, and history all keep working: the wrapper extends pi's own `CustomEditor` with `embedWorkingStatus: true`.

## Compatibility

Verified against pi `0.86.0`. Uses only public extension APIs (`session_start`, `ctx.ui.setEditorComponent`), guarded so print/RPC modes are skipped.

## How it works

1. On `session_start`, replace the editor via `ctx.ui.setEditorComponent()`.
2. The wrapper calls `super.render(width)` and rewrites each rendered line, swapping the reverse-video cursor cell for the configured style.
3. Cell width is preserved (the inserted beam borrows a trailing pad column; underline keeps the glyph), so padding and borders stay aligned. The zero-width IME cursor marker emitted before the cursor is passed through untouched.

## License

[MIT](LICENSE)
