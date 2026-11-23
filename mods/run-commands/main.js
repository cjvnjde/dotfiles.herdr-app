// Run commands: saved shell commands per project ("pnpm run dev"), started from the
// top bar's Run button. Picking one opens a new tab in the space and runs it in an
// interactive zsh (aliases, mise, PATH as in your terminal); the shell stays open
// after the command ends.
//
// A project is the space's git repo (its common .git dir, so every worktree of a
// repo shares one list), else its folder, on its machine. resolveProject() maps
// space ids to project keys in shared("run-commands.project").
// Commands: shared("run-commands") = { [project]: [{ name, cmd }] }.
// Last started: shared("run-commands.last") = { [project]: index }; the top bar
// (tabs-cjvnjde) shows it and the dropdown opens with it selected.
// tabs-cjvnjde has a copy of resolveProject/projectOf: keep both in step.
//
// props: none -> the dropdown (popup); { add: true, space } -> the add dialog.

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { theme, spaces, run, exec, checking, openOverlay, closeOverlay, props, shared, setShared, settings } from "herdr";

const KEY = "run-commands";
const LAST = "run-commands.last";
const PROJ = "run-commands.project";
const PLAY = "mods/run-commands/play.svg";
const ROW = 28;

const projectOf = (space) => (shared(PROJ) ?? {})[space.id] ?? null;
const commandsOf = (project) => (project ? (shared(KEY) ?? {})[project] : null) ?? [];
const saveCommands = (project, list) => setShared(KEY, { ...(shared(KEY) ?? {}), [project]: list });
const lastOf = (project) => {
  const i = (shared(LAST) ?? {})[project];
  return Number.isInteger(i) && i < commandsOf(project).length ? i : null;
};
const setLast = (project, i) => setShared(LAST, { ...(shared(LAST) ?? {}), [project]: i });

// Finds the space's project and records it; moves commands saved under the
// space id (the old per-space storage) into the project's list.
const resolving = new Set();
export async function resolveProject(space) {
  if (resolving.has(space.id) || checking()) return;
  resolving.add(space.id);
  const on = space.machine ?? null;
  let key = JSON.stringify([on, space.folder || "~"]);
  try {
    const r = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { ...(space.folder ? { cwd: space.folder } : {}), on });
    if (r.code === 0) key = JSON.stringify([on, r.stdout.replace(/\n$/, "")]);
  } catch {}
  const map = shared(PROJ) ?? {};
  if (map[space.id] !== key) setShared(PROJ, { ...map, [space.id]: key });
  const all = shared(KEY) ?? {};
  if (Array.isArray(all[space.id])) {
    const merged = [...(all[key] ?? [])];
    for (const c of all[space.id]) if (!merged.some((m) => m.name === c.name && m.cmd === c.cmd)) merged.push(c);
    const next = { ...all, [key]: merged };
    delete next[space.id];
    setShared(KEY, next);
  }
  const lasts = shared(LAST) ?? {};
  if (space.id in lasts) {
    const next = { ...lasts };
    if (Number.isInteger(next[space.id]) && !Number.isInteger(next[key])) next[key] = next[space.id];
    delete next[space.id];
    setShared(LAST, next);
  }
}

const firstLine = (cmd) => {
  const lines = cmd.split("\n").map((l) => l.trim()).filter(Boolean);
  return (lines[0] ?? "") + (lines.length > 1 ? " …" : "");
};

// An interactive zsh, so aliases and PATH match a terminal (the dotfiles' .zshrc
// loads mise & co. up front for a -c command). tabs-cjvnjde has a copy.
const shellArgv = (cmd) => ["zsh", "-ic", cmd];

function start(space, c, i) {
  const project = projectOf(space);
  if (project && Number.isInteger(i)) setLast(project, i);
  run("tab.new", { name: c.name || firstLine(c.cmd), space: space.id, argv: shellArgv(c.cmd) });
}

export default class RunCommands extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.add = Boolean(p.add);
    this.handle = cx.focus_handle();
    if (!this.add) {
      const space = spaces().find((s) => s.active);
      if (space) resolveProject(space);
      this.sel = null; // null: the last used one
      this.handle.focus();
      return;
    }
    this.name = InputState.new({ placeholder: "Name" });
    this.cmd = TextareaState.new({ placeholder: "pnpm run dev" });
    this.cmd.set_soft_wrap(true);
    this.focusedInput = "name";
    this.name.on("change", (_e, cx) => cx.notify());
    this.cmd.on("change", (_e, cx) => cx.notify());
    this.name.on("submit", () => this.cmd.focus());
    // A textarea's submit is its ⌘↩ / Ctrl-↩ (Enter itself adds a line).
    this.cmd.on("submit", () => this.submit());
    this.name.on("focus", (_e, cx) => { this.focusedInput = "name"; cx.notify(); });
    this.cmd.on("focus", (_e, cx) => { this.focusedInput = "cmd"; cx.notify(); });
    this.name.focus();
    cx.timer.after(300, () => this.name.focus());
  }

  close() { closeOverlay(props()?.overlay); }

  submit() {
    const cmd = this.cmd.value().trim();
    if (!cmd) { this.cmd.focus(); return; }
    const project = props()?.project;
    if (!project) return;
    const list = [...commandsOf(project), { name: this.name.value().trim(), cmd }];
    saveCommands(project, list);
    setLast(project, list.length - 1);
    this.close();
  }

  selected(project, list) {
    const i = this.sel ?? lastOf(project) ?? 0;
    return Math.max(0, Math.min(i, list.length - 1));
  }

  key(e, cx) {
    if (e.key === "escape") { this.close(); cx.stop_propagation(); return; }
    if (this.add && e.key === "enter" && (e.modifiers.platform || e.modifiers.control)) { this.submit(); cx.stop_propagation(); return; }
    if (this.add || e.modifiers.control || e.modifiers.platform || e.modifiers.alt) return;
    const space = spaces().find((s) => s.active);
    const project = space && projectOf(space);
    if (!project) return;
    const list = commandsOf(project);
    if ((e.key === "down" || e.key === "up") && list.length) {
      this.sel = (this.selected(project, list) + (e.key === "down" ? 1 : list.length - 1)) % list.length;
      cx.notify(); cx.stop_propagation(); return;
    }
    const i = e.key === "enter" ? this.selected(project, list) : /^[1-9]$/.test(e.key) ? Number(e.key) - 1 : -1;
    const c = list[i];
    if (c) { this.close(); start(space, c, i); cx.stop_propagation(); }
  }

  render() {
    return this.add ? this.renderAdd() : this.renderMenu();
  }

  renderMenu() {
    const t = theme();
    const space = spaces().find((s) => s.active);
    const project = space ? projectOf(space) : null;
    const list = commandsOf(project);
    const sel = this.selected(project, list);

    const row = (c, i) => h_flex().id(`rc-${i}`).h(ROW).pl(8).pr(4).gap(8).rounded(6).items_center().flex_none()
      .when(i === sel, (el) => el.bg(t.selected))
      .on_mouse_move((_e, cx) => { if (this.sel !== i) { this.sel = i; cx.notify(); } })
      .on_click(() => { this.close(); start(space, c, i); })
      .tooltip(c.cmd)
      .child(svg(PLAY).size(11).flex_none().text_color(t.working))
      .child(div().flex_1().min_w(0).truncate().child(c.name || firstLine(c.cmd)))
      .child(h_flex().id(`rc-del-${i}`).size(20).flex_none().items_center().justify_center().rounded(5)
        .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.blocked))
        .when(i !== sel, (el) => el.opacity(0))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          const last = lastOf(project);
          saveCommands(project, list.filter((_, j) => j !== i));
          if (last !== null) setLast(project, last === i ? null : last > i ? last - 1 : last);
          this.sel = null;
        })
        .child(svg("mods/pane/close.svg").size(10)));

    const add = h_flex().id("rc-add").h(ROW).px(8).gap(8).rounded(6).items_center().flex_none()
      .text_color(t.muted).hover((s) => s.bg(t.selected).text_color(t.foreground))
      .on_click(() => {
        if (!project) return;
        this.close();
        openOverlay({ mod: "run-commands", kind: "dialog", width: 460, height: 280, props: { add: true, project } });
      })
      .child(div().w(11).flex_none().text_center().child("+")).child("Add command…");

    return v_flex().id("run-commands").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .size_full().bg(t.popover).p(4).text_size(12.8).text_color(t.foreground)
      .when(list.length > 0, (el) => el
        .child(v_flex().id("rc-list").max_h(ROW * 12).overflow_y_scrollbar().children(list.map(row)))
        .child(div().h(1).mx(4).my(4).flex_none().bg(t.border)))
      .child(add);
  }

  renderAdd() {
    const t = theme();
    const mono = settings().font_family;
    const frame = (el, k) => el.rounded(8).border_1().border_color(this.focusedInput === k ? t.accent : t.input)
      .bg(t.background).text_size(12.8).text_color(t.foreground);
    const button = (id, text, primary, action) => h_flex().id(id).h(28).px(12).items_center().rounded(7)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12).font_medium()
      .cursor_pointer().hover((s) => s.opacity(0.88)).on_click(() => action())
      .child(text);
    return v_flex().id("run-commands-add").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .size_full().p(14).gap(10).bg(t.popover).text_color(t.foreground)
      .child(h_flex().gap(10).items_center()
        .child(h_flex().flex_none().size(34).items_center().justify_center().rounded(8).bg(t.raised).border_1().border_color(t.border)
          .child(svg(PLAY).size(13).text_color(t.working)))
        .child(frame(Input.new(this.name), "name").flex_1().h(34).px(10)))
      .child(frame(Textarea.new(this.cmd), "cmd").flex_1().min_h(0).w_full().px(10).py(8)
        .when(Boolean(mono), (el) => el.font_family(mono)))
      .child(h_flex().gap(8).justify_end()
        .child(button("rc-cancel", "Cancel", false, () => this.close()))
        .child(button("rc-save", "Add", true, () => this.submit())));
  }
}
