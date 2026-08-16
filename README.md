# Herdr Jump

Keyboard navigation for Herdr workspaces, tabs, panes, and agents.

## Requirements

- Herdr 0.8.0+
- Node.js 24+

## Install

```sh
herdr plugin install tp6gw94/herdr-jump
```

For local development:

```sh
herdr plugin link .
```

## Use

Open a picker:

```sh
herdr plugin pane open --plugin herdr.jump --entrypoint jump
herdr plugin pane open --plugin herdr.jump --entrypoint workspace
herdr plugin pane open --plugin herdr.jump --entrypoint tab
herdr plugin pane open --plugin herdr.jump --entrypoint pane
herdr plugin pane open --plugin herdr.jump --entrypoint agent
```

`jump` shows all targets as a workspace → tab → pane → agent tree. The focused pickers show one target type and include its parent context.

Type the red label beside a target. When a label matches multiple targets, type the next displayed label to narrow the group. The picker focuses the only remaining target automatically.

| Key | Action |
| --- | --- |
| label key | narrow or jump |
| `PageUp` / `PageDown` | change page |
| `Backspace` | restore the previous label group |
| `Esc` | cancel |

Agent rows include compact status icons: working `󰔟`, idle `󰏤`, blocked `󰌾`, done `󰄬`, and unknown `󰋗`.

## Keyboard shortcut

Add this to `~/.config/herdr/config.toml`:

```toml
[[keys.command]]
key = "prefix+alt+j"
type = "shell"
command = "\"$HERDR_BIN_PATH\" plugin pane open --plugin herdr.jump --entrypoint jump"
description = "Herdr Jump"
```

Reload Herdr:

```sh
herdr server reload-config
```

With the default `ctrl+b` prefix, press `Ctrl+B`, then `Alt+J`. Use a different `entrypoint` (`workspace`, `tab`, `pane`, or `agent`) and key when binding a focused picker.

## Development

```sh
npm test
npm run check
herdr plugin link .
```

The plugin uses no npm dependencies.
