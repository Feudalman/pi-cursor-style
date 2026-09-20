# pi-cursor-style

Restyle the [pi](https://github.com/earendil-works/pi) input editor's cursor: a **bar**, an **underline**, or a **colorized block** — instead of the default reverse-video block.

```
default block   my text▸▮◂rest        reverse-video block (swapped fg/bg)
bar             my text▏rest          narrow bar, colorizable
underline       my text̲r̲est           character stays visible
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

## Configure

Create `~/.pi/agent/cursor-style.json`:

```jsonc
{
	"style": "bar",          // "block" | "bar" | "underline"   (default "block")
	"color": "#ff5f00"       // optional: "#rrggbb" | 0-255 | "theme:<token>"
}
```

Color forms:

| Value | Meaning |
|-------|---------|
| `"#ff5f00"` | any hex RGB |
| `"208"` | xterm 256-color index |
| `"theme:accent"` | an active-theme token; follows theme switches live |

Style behavior:

- `block` — the default reverse-video block; with a `color` it becomes a block filled with that color
- `bar` — a narrow `▏` glyph; wide (CJK) graphemes are padded so alignment is preserved; the character under the cursor is hidden while the cursor sits on it
- `underline` — underlines the character and keeps it visible; blank cells (end of line) use `▁` because terminals trim underlines on blanks

Re-run `/reload` (or restart pi) after editing the config. Invalid config falls back to `block` silently.

## Scope and limitations

- Restyles the **main input editor only**. Single-line inputs (the search boxes in `/model`, `/resume`, etc.) are constructed inside pi's core and cannot be replaced by an extension.
- The extension post-processes render output and matches the cursor sequence `\x1b[7m<grapheme>\x1b[0m`. If a future pi release changes that format, this extension needs a matching update.
- Working status spinner, thinking-level border colors, bash mode, autocomplete, and history all keep working: the wrapper extends pi's own `CustomEditor` with `embedWorkingStatus: true`.

## Compatibility

Verified against pi `0.86.0`. Uses only public extension APIs (`session_start`, `ctx.ui.setEditorComponent`), guarded so print/RPC modes are skipped.

## How it works

1. On `session_start`, replace the editor via `ctx.ui.setEditorComponent()`.
2. The wrapper calls `super.render(width)` and rewrites each rendered line, swapping the reverse-video cursor cell for the configured style.
3. Cell width is preserved (bar pads wide graphemes; underline keeps the glyph), so padding and borders stay aligned. The zero-width IME cursor marker emitted before the cursor is passed through untouched.

## License

[MIT](LICENSE)
