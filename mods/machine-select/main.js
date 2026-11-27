// Machine select: which machine the sidebar shows. A button in the sidebar opens a
// list (every machine, this computer, each machine); picking one row shows just that
// and closes the list. Stored in shared "sidebar.machines": unset for every machine,
// else a list of the one key shown ("local" for this computer, else a machine's
// name). spaces-cjvnjde and agents-cjvnjde show only that. With no other machine
// the block is hidden: spaces-cjvnjde (syncMachineSelect) does that.
//
// As a layout block it draws the button; as an overlay (props().overlay) the list,
// so `mod.open {name: "machine-select"}` opens the list at the pointer too.

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { spaces, machines, agents, theme, shared, setShared, layout, props, openOverlay, closeOverlay } from "herdr";

const KEY = "sidebar.machines";
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
const ICONS = "mods/workspace-chrome";
const ROW = 28;
const GAP = 6; // between the button and the list
const MIN_W = 220;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// "local", then every other machine by name: added ones, and any a space is on.
function known() {
  const remote = [...new Set([...machines().map((m) => m.name), ...spaces().map((s) => s.machine)].filter(Boolean))].sort();
  return ["local", ...remote];
}

// The machines shown, in `all`'s order, or null for every one. Machines that are
// gone are dropped; none left, or all of them, means every machine.
function picked(all) {
  const pick = shared(KEY);
  if (!Array.isArray(pick)) return null;
  const keep = all.filter((k) => pick.includes(k));
  return keep.length && keep.length < all.length ? keep : null;
}

const label = (k) => (k === "local" ? "This computer" : k);
const iconOf = (k) => `${ICONS}/${k === "local" ? "monitor" : "server"}.svg`;
const offline = (k) => k !== "local" && machines().find((m) => m.name === k)?.layout === "unavailable";

// Each machine's most urgent agent.
function urgency() {
  const spaceMachine = new Map(spaces().map((s) => [s.id, s.machine ?? null]));
  const urgent = new Map();
  for (const a of agents()) {
    const m = spaceMachine.get(a.space) ?? (a.address.includes("/") ? a.address.split("/")[0] : null);
    const k = m ?? "local";
    if ((RANK[a.status] ?? 0) > (RANK[urgent.get(k)] ?? 0)) urgent.set(k, a.status);
  }
  return urgent;
}
// Only what needs the person gets a dot.
const attention = (s) => (s === "blocked" || s === "done" ? s : null);

export default class MachineSelect extends View {
  init(_props, cx) {
    this.menu = Boolean(props()?.overlay);
    this.bounds = null;
    if (!this.menu) return;
    this.handle = cx.focus_handle();
    const all = known();
    this.sel = all.indexOf(picked(all)?.[0]) + 1; // 0: "All machines", then each machine
    this.handle.focus();
  }

  // Shows row i's machine alone (row 0: every machine) and closes the list. The only
  // machine there is gets stored as unset, so one added later shows too.
  pick(i, all) {
    const k = all[i - 1];
    if (i > 0 && !k) return;
    setShared(KEY, k && all.length > 1 ? [k] : null);
    closeOverlay(props()?.overlay);
  }

  key(e, cx) {
    if (e.key === "escape") { closeOverlay(props()?.overlay); cx.stop_propagation(); return; }
    if (e.modifiers.control || e.modifiers.platform || e.modifiers.alt) return;
    const all = known();
    const n = all.length + 1;
    if (e.key === "down" || e.key === "up") {
      this.sel = (this.sel + (e.key === "down" ? 1 : n - 1)) % n;
      cx.notify(); cx.stop_propagation(); return;
    }
    if (e.key === "enter" || e.key === "space") { this.pick(this.sel, all); cx.stop_propagation(); }
  }

  render() {
    return this.menu ? this.renderList() : this.renderButton();
  }

  renderButton() {
    const t = theme();
    const all = known();
    const pick = picked(all);
    const shown = pick ?? all;
    const urgent = urgency();
    // Something needs you on a machine that isn't shown: a dot on the button.
    const away = all.filter((k) => !shown.includes(k)).map((k) => urgent.get(k))
      .sort((x, y) => (RANK[y] ?? 0) - (RANK[x] ?? 0))[0];
    const dot = attention(away);
    const text = pick ? shown.map(label).join(", ") : "All machines";
    const icon = pick?.length === 1 ? iconOf(pick[0]) : `${ICONS}/layers.svg`;
    const compact = narrow();

    return h_flex().size_full().px(compact ? 4 : 10).py(5).bg(t.chrome).items_center()
      .child(h_flex().id("ms-button").w_full().h(28).px(compact ? 0 : 8).gap(6).items_center().rounded(8)
        .when(compact, (el) => el.justify_center())
        .bg(t.background).border_1().border_color(t.border)
        .text_size(12).text_color(t.foreground).cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .tooltip(pick ? `Showing ${text}` : "Showing every machine")
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.bounds = e.bounds ?? null; })
        .on_click(() => this.openList(all.length))
        .child(svg(icon).size(13).flex_none().text_color(t.muted))
        .when(!compact, (el) => el.child(div().flex_1().min_w(0).truncate().child(text)))
        .when(Boolean(dot), (el) => el.child(div().size(6).flex_none().rounded(3).bg(t[dot])))
        .child(svg(`${ICONS}/chevron-down.svg`).size(compact ? 10 : 12).flex_none().text_color(t.dim)));
  }

  // Hangs the list under the button, left edges lined up (see README: popups open
  // at the pointer unless given `at`). Padding 4+4, "All machines", a divider, the rows.
  openList(count) {
    const b = this.bounds;
    openOverlay({ mod: "machine-select", kind: "popup",
      width: Math.max(MIN_W, b?.width ?? 0), height: 8 + ROW + 9 + count * ROW,
      ...(b ? { at: { x: b.x, y: b.y + b.height + GAP } } : {}) });
  }

  renderList() {
    const t = theme();
    const all = known();
    const pick = picked(all);
    const urgent = urgency();
    const sel = Math.min(this.sel, all.length);

    // The row shown now ends in a check.
    const row = (i, id, on, icon, text, extra = []) => h_flex().id(id).h(ROW).px(8).gap(8).rounded(6).items_center().flex_none()
      .when(i === sel, (el) => el.bg(t.selected))
      .on_mouse_move((_e, cx) => { if (this.sel !== i) { this.sel = i; cx.notify(); } })
      .on_click(() => this.pick(i, all))
      .child(svg(icon).size(13).flex_none().text_color(t.muted))
      .child(div().flex_1().min_w(0).truncate().child(text))
      .children(extra)
      .when(on, (el) => el.child(svg(`${ICONS}/check.svg`).size(14).flex_none().text_color(t.foreground)));

    const machineRow = (k, j) => {
      const dot = attention(urgent.get(k));
      return row(j + 1, `ms-${k}`, Boolean(pick?.includes(k)), iconOf(k), label(k), [
        offline(k) && div().flex_none().text_size(11).text_color(t.dim).child("offline"),
        dot && div().size(6).flex_none().rounded(3).bg(t[dot]),
      ].filter(Boolean));
    };

    return v_flex().id("machine-select").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .size_full().bg(t.popover).p(4).text_size(12.8).text_color(t.foreground)
      .child(row(0, "ms-all", pick === null, `${ICONS}/layers.svg`, "All machines"))
      .child(div().h(1).mx(4).my(4).flex_none().bg(t.border))
      .children(all.map(machineRow));
  }
}
