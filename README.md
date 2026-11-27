# herdr-app

My setup for the [Herdr](https://herdr.dev) desktop app (`herdr-app`): the **cjvnjde** layout,
its mods and `settings.json`. This folder is a module of `~/dotfiles`.

> **For agents:** read this whole file before changing anything here, then read
> `~/.config/herdr-app/AGENTS.md`. That file is Herdr's own manual, and it changes with the version.

## Install

```sh
cd ~/dotfiles && bash setup.sh herdr-app   # 'herdr-app' must be listed in ~/dotfiles/.modules
# or run this module on its own:
bash ~/dotfiles/herdr-app/setup.sh enable
```

Then pick the layout once: `herdr-app do layout.switch '{"name":"cjvnjde"}'` (or press `cmd-shift-l`).

| Command | What it does |
|---|---|
| `setup.sh enable` | links every item below into `~/.config/herdr-app` (an existing file is moved to `<name>.bak`) |
| `setup.sh disable` | removes those links |
| `setup.sh reload [mod \| path ...]` | re-creates the links so the running app picks up edits (see below) |

## How it's linked (and why reload exists)

Herdr owns most of `~/.config/herdr-app`: it rewrites the shipped mods and layouts, `AGENTS.md` and the
`*.d.ts` files on every start, and keeps its state there. So **the folder itself is never linked**.
`setup.sh` links each of our items one by one:

- every folder in `mods/` → `~/.config/herdr-app/mods/<name>`
- every `layouts/*.json|svg|png` and `themes/*.json` → the same path there
- `settings.json`, plus `keys.json` and `programs.json` if they're added here

New mods, layouts and themes are picked up automatically; `setup.sh` never needs editing for them.

**Live reload doesn't see edits behind a symlink.** Herdr's file watcher only notices when a link is
replaced. After editing a file here, run:

```sh
bash ~/dotfiles/herdr-app/setup.sh reload             # everything
bash ~/dotfiles/herdr-app/setup.sh reload run-commands layouts/cjvnjde.json
```

## Where Herdr's documentation is

Every file below is written by Herdr itself, reflects the installed version, and is **never edited or committed**:

| Where | What |
|---|---|
| `~/.config/herdr-app/AGENTS.md` | **the manual**: files, layouts, mods, commands, the `herdr` module, overlays, keys, settings, sharing |
| `~/.config/herdr-app/herdr.d.ts` | the `herdr` module's types: `spaces()`, `agents()`, `run()`, `openOverlay()`, `shared()`, … |
| `~/.config/herdr-app/gpui-kit.d.ts` | UI elements: `div()`, `h_flex()`, styles, `.frames()`, `.loop()`, inputs, lists |
| `herdr-app --skill` / `hc --skill` | manuals for driving the window / herdr-core (terminals, agents, machines) |
| `herdr-app commands` | every app command with its arguments (works without a window) |
| `~/.config/herdr-app/mods/<shipped>/` | Herdr's own mods (`spaces`, `tabs`, `menu`, `agents`, …): the best examples |

Herdr also copies `gpui-kit.d.ts` and `jsconfig.json` into each mod folder, so they show up here
too. They're in `.gitignore`.

## What's here

| Item | Based on | What it does |
|---|---|---|
| `layouts/cjvnjde.json` | `main` | the layout: sidebar (machine select, spaces, agents), tab bar, panes, Files/Changes panel. Uses the mods below in place of the shipped ones |
| `mods/machine-select` | new | the sidebar's machine button: a select: a popup list (**All machines**, This computer, each machine), one shown at a time; picking a row closes it. Sets shared `sidebar.machines` (unset = every machine, else a one-item list: `"local"` or a machine's name). Only shown once another machine is added (see `spaces-cjvnjde`) |
| `mods/spaces-cjvnjde` | `spaces` | the spaces list, filtered by `sidebar.machines`; also hides the `machine-select` layout block (`layout.hide`) while this computer is the only machine, and shows it again when one is added |
| `mods/agents-cjvnjde` | `agents` | the agents list, filtered by `sidebar.machines`; split by machine when more than one is shown |
| `mods/tabs-cjvnjde` | `tabs` | the tab bar; **+** opens `new-menu-cjvnjde`; **▶ <last command>** reruns the project's last used Run command, its chevron opens `run-commands` under the button (right edges lined up). While one runs in the space it shows **● <name>** (click: its tab) and **■** (stop); it also does every stop (`run-commands.stopping`), since it's always shown: Ctrl-C, up to 5 s, then `terminal.kill` |
| `mods/new-menu-cjvnjde` | `new-menu` | the **+** menu: installed agents only; `HIDDEN` at the top lists keys never shown (`goose` is pressly/goose here, not the agent) |
| `mods/run-commands` | new | Run dropdown and Add dialog (`props.add`): saved commands per **project** in shared `run-commands` (key: `[machine, git common dir]`, so all worktrees of a repo share them; else `[machine, folder]`), mapped from space ids in `run-commands.project`; each started in a new tab via `zsh -ic` (the dotfiles' `.zshrc` skips its deferred init when `ZSH_EXECUTION_STRING` is set, so mise is on PATH); the last one started is `run-commands.last` (an index), preselected in the dropdown (↑/↓, ↩, 1-9). A command's tab is found from its terminal (`herdr.space` label + argv ending in `zsh -ic <cmd>`); running = something other than that terminal's own shell in front. Running rows show ● and ■, picking one shows its tab; running one whose command ended replaces its old tab. `tabs-cjvnjde` has copies of `resolveProject` and the runs block: keep both in step |
| `settings.json` | | zoom, sounds, fonts and theme for every layout (the settings screen writes this file too) |

Shared state these mods use (in `~/.config/herdr-app/shared.json`, **not** in this repo):
`sidebar.machines`, `run-commands`, `run-commands.last`, `run-commands.project`, `run-commands.started`, `run-commands.stopping`, `agents.sort`, `new-menu.agents`, `space.colors`,
`sidebar.width`, `sidebar.collapsed`, `workspace.panels`. Saved Run commands therefore don't travel
between machines, and neither do panel sizes (`layouts/.state/`).

## Changing things (workflow for agents)

1. **Edit the files here**, in `~/dotfiles/herdr-app`, not through `~/.config/herdr-app`. The two
   paths are the same files, but working here keeps git and the right paths in view.
2. **Check every mod you touch**: `herdr-app check ~/.config/herdr-app/mods/<name>`. It loads the
   mod once with no props, so it never runs a dialog's other states (`run-commands` with
   `{add: true}`). Read those code paths with extra care.
3. **Reload**: `bash ~/dotfiles/herdr-app/setup.sh reload <name>`.
4. **Look**: `herdr-app status` lists errors. An invalid file leaves a `<name>.error` next to it
   (`layout.error`, `settings.error`, …) and the app keeps the last good version.
   `herdr-app shot /path/out.png` saves the window as a PNG; crop it with
   `sips -c <h> <w> --cropOffset <y> <x> in.png --out out.png` (Retina: 2 px per point).
5. Popup and dialog sizes are set **by the caller** (`openOverlay({ width, height })`), not by the mod
   itself. So is a popup's place: it opens at the pointer (pushed back inside the window) unless
   given `at: { x, y }`, its top left in window points. To hang one under a button, take the
   button's `e.bounds` in its `on_mouse_down` (see the Run button in `tabs-cjvnjde`).

### Changing a shipped mod or layout

Herdr's own mods and layouts are read-only: they're replaced on every start, and an edited one is moved
aside to `<name>-edited`. To change one:

```sh
herdr-app do mod.clone '{"name":"files","as":"files-cjvnjde"}'   # creates ~/.config/herdr-app/mods/files-cjvnjde
mv ~/.config/herdr-app/mods/files-cjvnjde ~/dotfiles/herdr-app/mods/
bash ~/dotfiles/herdr-app/setup.sh enable                          # links it back
```

Then point `layouts/cjvnjde.json` (or the mod that opens it) at the new name, and `reload`.
Name copies `<name>-cjvnjde`. `mod.clone` already rewrites the clone's own `mods/<name>/` asset paths.
Clones never get Herdr's updates. After a Herdr update, compare a clone with the shipped
`~/.config/herdr-app/mods/<name>/main.js` (its `cloned_from` in `mod.json` says which version) and
carry over what matters.

### Adding a new mod or layout

Create `mods/<name>/main.js` and `mods/<name>/mod.json` here (`{ "place": "none" }` for one that is
only opened as a popup or dialog, or shown by a layout block). Then run `setup.sh enable` and
`herdr-app check`. Use it from the layout (`"content": { "mod": "<name>" }`) or open it with
`openOverlay({ mod: "<name>", ... })`. A new layout goes in `layouts/<name>.json` and needs
`setup.sh enable` too.

### Mod-writing gotchas seen here

- No `setTimeout`, DOM or HTML: use `cx.timer`, `cx.spawn`, `.frames()`, `.loop()` and `.spin()` for animation.
- Never keep a `cx` for later; every callback gets its own.
- `InputState` / `TextareaState` belong in `init`, never in `render`.
- A popup sizes itself to its content, so a `flex_1()` child gets zero height and disappears.
  Give scrolling lists in popups a `max_h(...)` instead (this hid the Run list).
- A `TextareaState`'s `change` event can't be relied on to redraw: don't enable or disable buttons
  from it. Check the value when the button is pressed.
- `exec()` doesn't get mise's PATH. Run through `zsh -ic` (see `shellArgv` in `mods/run-commands`).
- Use `theme()` colors only, so light and dark themes both work.

## Escape hatch

`ctrl-alt-shift-escape` always works: it sets aside the shown layout and `keys.json` and goes back to
`main`. To undo everything: `bash ~/dotfiles/herdr-app/setup.sh disable`.
