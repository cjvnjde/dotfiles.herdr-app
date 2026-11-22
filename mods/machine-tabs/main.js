// Machine tabs: All, this computer, and each machine. Picking one sets shared
// "sidebar.machine" (unset: All, "local", or a machine's name); spaces-cjvnjde and
// agents-handoff then show only that machine's spaces and agents.

import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, machines, agents, theme, shared, setShared, window, layout } from "herdr";

const KEY = "sidebar.machine";
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

export default class MachineTabs extends View {
  render() {
    const t = theme();
    const sp = spaces();
    const remote = [...new Set([
      ...machines().map((m) => m.name),
      ...sp.map((s) => s.machine),
    ].filter(Boolean))].sort();
    let pick = shared(KEY) ?? null;
    // A machine that's gone: back to All.
    if (pick && pick !== "local" && !remote.includes(pick)) { setShared(KEY, null); pick = null; }

    // Each machine's most urgent agent, for a dot on its tab.
    const spaceMachine = new Map(sp.map((s) => [s.id, s.machine ?? null]));
    const urgent = new Map();
    for (const a of agents()) {
      const m = spaceMachine.get(a.space) ?? (a.address.includes("/") ? a.address.split("/")[0] : null);
      const k = m ?? "local";
      if ((RANK[a.status] ?? 0) > (RANK[urgent.get(k)] ?? 0)) urgent.set(k, a.status);
    }
    const local = "Local";
    const tabs = [
      { key: null, label: "All", icon: "layers" },
      { key: "local", label: local, icon: "monitor" },
      ...remote.map((m) => ({ key: m, label: m, icon: "server" })),
    ];
    const compact = narrow();

    const tab = (x) => {
      const on = x.key === pick;
      const dot = x.key ? urgent.get(x.key) : null;
      return h_flex().id(`mt-${x.key ?? "all"}`).h_full().min_w(0).px(compact ? 0 : 8).gap(5).items_center().justify_center().rounded(6)
        .when(!compact, (el) => el.flex_1())
        .when(compact, (el) => el.w(22))
        .text_size(11.5).font_medium()
        .bg(on ? t.raised : t.chrome).text_color(on ? t.foreground : t.muted)
        .when(on, (el) => el.border_1().border_color(t.border))
        .when(!on, (el) => el.hover((s) => s.bg(t.hover).text_color(t.foreground)))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(() => setShared(KEY, x.key))
        .tooltip(x.key ? x.label : "All machines")
        .child(svg(`mods/workspace-chrome/${x.icon}.svg`).size(12).flex_none())
        .when(!compact, (el) => el.child(div().min_w(0).truncate().child(x.label)))
        .when(dot === "blocked" || dot === "done", (el) => el.child(div().size(6).flex_none().rounded(3).bg(t[dot])));
    };

    return h_flex().size_full().px(compact ? 4 : 10).py(5).bg(t.chrome).items_center()
      .child(h_flex().w_full().h(28).p(2).gap(2).rounded(8).bg(t.background).border_1().border_color(t.border)
        .when(compact, (el) => el.justify_center())
        .children(tabs.map(tab)));
  }
}
