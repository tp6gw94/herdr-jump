# Herdr Jump

Keyboard navigation for Herdr workspaces, tabs, panes, and agents.


![demo](assets/demo.gif)

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
type = "plugin_action"
command = "herdr.jump.jump"
description = "Herdr Jump"

[[keys.command]]
key = "prefix+alt+w"
type = "plugin_action"
command = "herdr.jump.workspace"
description = "Herdr Workspace"

[[keys.command]]
key = "prefix+alt+t"
type = "plugin_action"
command = "herdr.jump.tab"
description = "Herdr Tab"

[[keys.command]]
key = "prefix+alt+p"
type = "plugin_action"
command = "herdr.jump.pane"
description = "Herdr Pane"

[[keys.command]]
key = "prefix+alt+a"
type = "plugin_action"
command = "herdr.jump.agent"
description = "Herdr Agent"
```

Reload Herdr:

```sh
herdr server reload-config
```

With the default `ctrl+b` prefix, press `Ctrl+B`, then `Alt+J`, `Alt+W`, `Alt+T`, `Alt+P`, or `Alt+A`.

## Development

```sh
npm test
npm run check
herdr plugin link .
```

The plugin uses no npm dependencies.

## License

[MIT](LICENSE)
