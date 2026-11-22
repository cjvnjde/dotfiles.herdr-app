// Run commands: saved shell commands per space ("pnpm run dev"), started from the
// top bar's Run button. Picking one opens a new tab in the space and runs it in
// an interactive zsh (aliases, mise, PATH as in your terminal); the shell stays
// open after the command ends.
//
// props: none -> the dropdown (popup); { add: true, space } -> the add dialog.
// Stored in shared("run-commands"): { [spaceId]: [{ name, cmd }] }.

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { theme, spaces, run, openOverlay, closeOverlay, props, shared, setShared, settings } from "herdr";

const KEY = "run-commands";
const PLAY = "mods/run-commands/play.svg";

const commandsOf = (spaceId) => (shared(KEY) ?? {})[spaceId] ?? [];
function saveCommands(spaceId, list) {
  setShared(KEY, { ...(shared(KEY) ?? {}), [spaceId]: list });
}

const firstLine = (cmd) => {
  const lines = cmd.split("\n").map((l) => l.trim()).filter(Boolean);
  return (lines[0] ?? "") + (lines.length > 1 ? " …" : "");
};

export function start(space, c) {
  run("tab.new", { name: c.name || firstLine(c.cmd), space: space.id, argv: ["zsh", "-ic", c.cmd] });
}

export default class RunCommands extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.add = Boolean(p.add);
    this.handle = cx.focus_handle();
    if (!this.add) { this.handle.focus(); return; }
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
    const space = props()?.space;
    saveCommands(space, [...commandsOf(space), { name: this.name.value().trim(), cmd }]);
    this.close();
  }

  key(e, cx) {
    if (e.key === "escape") { this.close(); cx.stop_propagation(); return; }
    if (this.add && e.key === "enter" && (e.modifiers.platform || e.modifiers.control)) { this.submit(); cx.stop_propagation(); return; }
    if (this.add || e.modifiers.control || e.modifiers.platform || e.modifiers.alt) return;
    const space = spaces().find((s) => s.active);
    const c = /^[1-9]$/.test(e.key) && space ? commandsOf(space.id)[Number(e.key) - 1] : null;
    if (c) { this.close(); start(space, c); cx.stop_propagation(); }
  }

  render() {
    return this.add ? this.renderAdd() : this.renderMenu();
  }

  renderMenu() {
    const t = theme();
    const space = spaces().find((s) => s.active);
    const list = space ? commandsOf(space.id) : [];
    const mono = settings().font_family;

    const row = (c, i) => h_flex().id(`rc-${i}`).min_h(c.name ? 40 : 31).py(4).px(9).gap(10).rounded(7).items_center().flex_none()
      .hover((s) => s.bg(t.selected))
      .on_click(() => { this.close(); start(space, c); })
      .child(svg(PLAY).size(12).flex_none().text_color(t.working))
      .child(v_flex().flex_1().min_w(0)
        .when(Boolean(c.name), (el) => el.child(div().truncate().child(c.name)))
        .child(div().truncate().text_size(c.name ? 11 : 12.5).text_color(c.name ? t.dim : t.foreground)
          .when(Boolean(mono), (el) => el.font_family(mono)).child(firstLine(c.cmd))))
      .child(div().text_size(11).text_color(t.dim).child(i < 9 ? String(i + 1) : ""))
      .child(h_flex().id(`rc-del-${i}`).size(20).flex_none().items_center().justify_center().rounded(5)
        .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.blocked))
        .on_click((_e, cx) => { cx.stop_propagation(); saveCommands(space.id, list.filter((_, j) => j !== i)); })
        .child(svg("mods/pane/close.svg").size(11)));

    const menu = v_flex().id("run-commands").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .size_full().min_h(0).bg(t.popover).p(5).text_size(12.8).text_color(t.foreground)
      .child(div().px(9).pt(6).pb(4).text_size(11).text_color(t.dim).truncate()
        .child(space ? `Run in ${space.name}` : "Run"));
    if (!space) return menu.child(div().px(9).py(6).text_color(t.dim).child("Open a space first."));
    return menu
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar()
        .children(list.map(row))
        .when(list.length === 0, (el) => el.child(div().px(9).py(6).text_color(t.dim).child("No commands for this space yet."))))
      .child(div().h(1).mx(4).my(5).bg(t.border))
      .child(h_flex().id("rc-add").h(31).px(9).gap(10).rounded(7).items_center().flex_none()
        .hover((s) => s.bg(t.selected))
        .on_click(() => {
          this.close();
          openOverlay({ mod: "run-commands", kind: "dialog", width: 460, height: 280, props: { add: true, space: space.id } });
        })
        .child(div().w(12).text_color(t.dim).child("+")).child("Add command…"));
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
