import { View, div, svg, image } from "gpui-kit";
import { h_flex, ScrollHandle } from "gpui-base";
import { spaces, panes, terminals, run, exec, hc, checking, openOverlay, theme, window, shared, setShared, layout, settings } from "herdr";

// The Run list popup (mods/run-commands): its width, and its gap below the Run button
// (the 26 px button sits in the 42 px bar: 10 puts the popup just under the bar's border).
const RUN_W = 260;
const RUN_GAP = 10;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// Same as the agents mod: drops a status glyph, keeps a leading bracket or quote.
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}\p{Ps}\p{Pi}]+/u, "").replace(/^\[ [!.] \] /, "").trim();

// A tab Herdr named (unnamed, or after its program) follows its agent's live
// title, as the agents list does; a name the person gave stays.
function label(tab, lead) {
  const prog = lead?.program?.name;
  const base = tab.named ? tab.name : prog ?? "Terminal";
  if (!lead?.program?.agent) return base;
  const live = clean(lead.title);
  // clean() would strip a path's leading ~ or /: test the title with only its status glyph gone.
  const path = /^[~/]|^[A-Za-z]:\\/.test((lead.title ?? "").replace(/^[^\p{L}\p{N}~/]+/u, ""));
  const telling = live && live !== lead.terminal && live !== prog && !path && !live.includes("@") && live.toLowerCase() !== lead.program.key;
  return (tab.name === prog || !tab.named) && telling ? live : base;
}

// Copy of run-commands' resolveProject: a space's project is its git repo's common
// .git dir (worktrees share it), else its folder, on its machine.
const resolving = new Set();
async function resolveProject(space) {
  if (resolving.has(space.id) || checking()) return;
  resolving.add(space.id);
  const on = space.machine ?? null;
  let key = JSON.stringify([on, space.folder || "~"]);
  try {
    const r = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { ...(space.folder ? { cwd: space.folder } : {}), on });
    if (r.code === 0) key = JSON.stringify([on, r.stdout.replace(/\n$/, "")]);
  } catch {}
  const map = shared("run-commands.project") ?? {};
  if (map[space.id] !== key) setShared("run-commands.project", { ...map, [space.id]: key });
  const all = shared("run-commands") ?? {};
  if (Array.isArray(all[space.id])) {
    const merged = [...(all[key] ?? [])];
    for (const c of all[space.id]) if (!merged.some((m) => m.name === c.name && m.cmd === c.cmd)) merged.push(c);
    const next = { ...all, [key]: merged };
    delete next[space.id];
    setShared("run-commands", next);
  }
  const lasts = shared("run-commands.last") ?? {};
  if (space.id in lasts) {
    const next = { ...lasts };
    if (Number.isInteger(next[space.id]) && !Number.isInteger(next[key])) next[key] = next[space.id];
    delete next[space.id];
    setShared("run-commands.last", next);
  }
}

// run-commands' firstLine and shellArgv, for the copied block below.
const firstLine = (cmd) => {
  const lines = cmd.split("\n").map((l) => l.trim()).filter(Boolean);
  return (lines[0] ?? "") + (lines.length > 1 ? " …" : "");
};
const shellArgv = (cmd) => ["zsh", "-ic", cmd];

// ---- Runs: copied from run-commands (down to showRun): keep both in step.
// Herdr labels the terminals it starts with herdr.space (the space's id on its own
// machine, no "machine/" prefix) and wraps ours as
//   <shell> -lic '"$@"; exec "$0" -li' <shell> zsh -ic <cmd>
// so a run's argv ends with shellArgv(cmd). When the command ends on its own (it
// finished, failed, crashed) a login shell takes over that same process and the tab
// stays with its output; Ctrl-C ends the whole terminal, and its tab closes.
const STOPS = "run-commands.stopping"; // { [runKey]: when asked }: tabs-cjvnjde does them
const STARTS = "run-commands.started"; // { [runKey]: when }: running until its terminal shows
const STOP_WAIT = 5000; // after Ctrl-C, how long it gets before its terminal is killed
const START_GRACE = 3000; // the shells load their rc files before the command shows
const runKey = (space, cmd) => JSON.stringify([space.id, cmd]);
const machineOfAddress = (a) => (a.includes("/") ? a.slice(0, a.indexOf("/")) : null);

function runsOf(space, cmd) {
  if (!space) return [];
  const id = space.id.slice(space.id.lastIndexOf("/") + 1);
  const on = space.machine ?? null;
  return terminals().filter((t) => {
    const a = t.argv;
    return t.state === "live" && t.labels?.["herdr.space"] === id && machineOfAddress(t.address) === on
      && Array.isArray(a) && a.length >= 3 && a[a.length - 1] === cmd && a[a.length - 2] === "-ic" && a[a.length - 3] === "zsh";
  });
}

// Something other than the terminal's own shell is in front: the command (or, after
// it ended, whatever was typed into that shell). Not reported: counted as running.
const busy = (t) => !t.foreground?.pid || t.foreground.pid !== t.pid;

// "running", "stopping", "ended" (its tab is still open), or null (no tab).
function runState(space, cmd) {
  const k = runKey(space, cmd), now = Date.now();
  const ts = runsOf(space, cmd);
  const asked = (shared(STOPS) ?? {})[k];
  if (ts.length && Number.isFinite(asked) && now - asked < STOP_WAIT + 5000) return "stopping";
  if (ts.some(busy) || now - ((shared(STARTS) ?? {})[k] ?? 0) < START_GRACE) return "running";
  return ts.length ? "ended" : null;
}
const isLive = (state) => state === "running" || state === "stopping";

// Starts it in a new tab. A tab left from an earlier run (its command ended) goes:
// that's what kept piling up tabs.
function startRun(space, c) {
  for (const t of runsOf(space, c.cmd)) run("terminal.kill", { terminal: t.address });
  const now = Date.now();
  const starts = Object.fromEntries(Object.entries(shared(STARTS) ?? {}).filter(([, at]) => now - at < START_GRACE));
  setShared(STARTS, { ...starts, [runKey(space, c.cmd)]: now });
  run("tab.new", { name: c.name || firstLine(c.cmd), space: space.id, argv: shellArgv(c.cmd) });
}

// tabs-cjvnjde stops it (it's always shown; a popup's work ends when it closes).
function askStop(space, cmd) {
  setShared(STOPS, { ...(shared(STOPS) ?? {}), [runKey(space, cmd)]: Date.now() });
}

function showRun(space, cmd) {
  const t = runsOf(space, cmd)[0];
  if (!t) return;
  const on = machineOfAddress(t.address), label = t.labels?.["herdr.tab"];
  const tab = panes().find((p) => p.terminal === t.address)?.tab ?? (label ? (on ? `${on}/${label}` : label) : null);
  if (tab) run("tab.select", { id: tab });
}
// ---- end of the copied block

export default class Tabs extends View {
  init(_props, cx) {
    this.pressed = null;
    this.scroll = ScrollHandle.new();
    try { this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}"); } catch { this.panels = {}; }
    if (!this.panels || typeof this.panels !== "object" || Array.isArray(this.panels)) this.panels = {};
    this.swipe = { acc: 0, steps: 0, at: 0, last: 0 };
    this.stopping = new Set(); // runKeys being stopped here
    if (checking()) return;
    // Stop requests, and the Run button's state: a command ending doesn't redraw mods
    // on its own, so look twice a second and redraw on a change.
    cx.timer.every(500, (cx) => {
      this.serveStops(cx);
      const sig = this.runSig();
      if (sig !== this.sig) { this.sig = sig; cx.notify(); }
    });
  }

  // The shown space's commands' run states, as one string to compare.
  runSig() {
    const space = spaces().find((p) => p.active);
    const project = space ? (shared("run-commands.project") ?? {})[space.id] : null;
    const list = project ? ((shared("run-commands") ?? {})[project] ?? []) : [];
    return JSON.stringify(list.map((c) => runState(space, c.cmd)));
  }

  // Stop requests (askStop, from the Run button or run-commands' list) are done here:
  // this bar is always shown, while a popup's work ends when it closes. Ctrl-C each
  // run still running, give it STOP_WAIT to end, then kill its terminal, which closes
  // its pane (and the tab, when that was its only pane).
  serveStops(cx) {
    for (const [k, at] of Object.entries(shared(STOPS) ?? {})) {
      if (this.stopping.has(k)) continue;
      this.stopping.add(k);
      cx.spawn(async (cx) => {
        try {
          const [spaceId, cmd] = JSON.parse(k);
          const space = spaces().find((s) => s.id === spaceId);
          if (!space || Date.now() - at > STOP_WAIT + 5000) return;
          await Promise.all(runsOf(space, cmd).filter(busy).map((t) => hc(["keys", t.address, "ctrl+c"]).catch(() => null)));
          const until = Date.now() + STOP_WAIT;
          while (Date.now() < until && runsOf(space, cmd).some(busy)) await cx.sleep(200);
          for (const t of runsOf(space, cmd)) run("terminal.kill", { terminal: t.address });
          // Until it's gone, so the button doesn't show it running again for a moment.
          const gone = Date.now() + 2000;
          while (Date.now() < gone && runsOf(space, cmd).length) await cx.sleep(100);
        } finally {
          const next = { ...(shared(STOPS) ?? {}) };
          delete next[k];
          setShared(STOPS, next);
          this.stopping.delete(k);
        }
      });
    }
  }

  // One tab per wheel notch. A touchpad or smooth-scrolling mouse sends many
  // small events per gesture: a short swipe or one smoothed notch (about
  // 25 px) switches one tab, a longer swipe keeps going a tab per 60 px, at
  // most one every 100 ms so each shows.
  wheel(e) {
    if (e.delta_lines) {
      if (e.delta_lines.y) run(e.delta_lines.y > 0 ? "tab.prev" : "tab.next");
      return;
    }
    const s = this.swipe, now = Date.now();
    // Phases often arrive only as moves (a macOS touchpad included): a pause
    // or a turn starts a new gesture.
    if (e.touch_phase === "started" || now - s.at > 250 || e.delta.y * s.acc < 0) Object.assign(s, { acc: 0, steps: 0 });
    s.at = now;
    s.acc += e.delta.y;
    const need = s.steps ? 60 : 20;
    if (Math.abs(s.acc) < need || now - s.last < 100) return;
    s.acc -= Math.sign(s.acc) * need;
    s.steps++;
    s.last = now;
    run(e.delta.y > 0 ? "tab.prev" : "tab.next");
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  render() {
    const t = theme();
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    const active = shown.findIndex(tab => tab.active);
    const selected = shown[active]?.id;
    if (selected !== this.selected || active !== this.selectedIndex) {
      this.selected = selected;
      this.selectedIndex = active;
      if (active >= 0) this.scroll.scroll_to_item(active);
    }
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const item = (c, i) => {
      const lead = panes().find(p => p.tab === c.id && p.program?.agent) ?? panes().find(p => p.tab === c.id);
      const program = lead?.program;
      const name = label(c, lead);
      return h_flex().id(`tab-${c.id}`).h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
        // A rename or status dot on this or an earlier tab can push the active one out.
        .when(i <= active, el => el.on_size_change((_size, cx) => { this.scroll.scroll_to_item(active); cx.notify(); }))
        .border(1).border_color(c.active ? t.border : t.chrome).bg(c.active ? t.raised : t.chrome).text_color(c.active ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(c.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).rounded(3).bg(t[c.status])))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const enabled = shared("workspace.panels") ?? ["files", "changes"];
    this.syncPanel(space, panel, body, enabled);
    const panelButton = (id, label, icon) => {
      const on = panel && !panel.hidden && body?.active === id;
      return h_flex().id(`panel-${id}`).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
        }).child(svg(icon).size(14)).child(label);
    };
    // Run commands (mods/run-commands): saved commands for this space's project (its git
    // repo, so worktrees share them), each started in a new tab. A split button: the left
    // part runs the last used command (or opens the list when there's none yet), the
    // chevron opens the list with that command selected.
    // While one runs in this space it shows that one instead (the last used if it's
    // running, else the first running; "+N" for more): a green dot and its name, which
    // shows its tab, and ■, which stops it (see serveStops).
    if (space && !(shared("run-commands.project") ?? {})[space.id]) resolveProject(space);
    const project = space ? (shared("run-commands.project") ?? {})[space.id] : null;
    const runList = project ? ((shared("run-commands") ?? {})[project] ?? []) : [];
    const lastI = project ? (shared("run-commands.last") ?? {})[project] : null;
    const states = runList.map((c) => runState(space, c.cmd));
    this.sig = JSON.stringify(states);
    const running = runList.map((_c, i) => i).filter((i) => isLive(states[i]));
    const shownI = running.includes(lastI) ? lastI : running[0] ?? (Number.isInteger(lastI) ? lastI : null);
    const cmd = shownI !== null ? runList[shownI] ?? null : null;
    const state = cmd ? states[shownI] : null;
    const more = running.filter((i) => i !== shownI).length;
    const cmdName = cmd ? (cmd.name || firstLine(cmd.cmd)) : "Run";
    // Rows of 28 in 4 px padding, plus a divider when there are any, plus "Add command…".
    // It drops down under the split button, right edges lined up; at the pointer (Herdr's
    // default) it covered the button. runAt comes from the button's last press.
    const openRun = () => openOverlay({ mod: "run-commands", kind: "popup", width: RUN_W,
      height: 8 + 28 + (runList.length ? Math.min(12, runList.length) * 28 + 9 : 0),
      ...(this.runAt ? { at: this.runAt } : {}) });
    const runPart = (id) => h_flex().id(id).h_full().gap(5).items_center().text_color(t.muted)
      .hover(s => s.bg(t.hover).text_color(t.foreground));
    const mainPart = isLive(state)
      ? runPart("run-last").px(8).max_w(200).min_w(0)
        .tooltip(`Running: ${cmd.cmd}\nClick to show its tab`)
        .on_click(() => showRun(space, cmd.cmd))
        .child(div().size(7).flex_none().rounded(4).bg(t.ansi2))
        .child(div().min_w(0).truncate().text_color(t.foreground).child(cmdName))
        .when(more > 0, el => el.child(div().flex_none().text_color(t.dim).child(`+${more}`)))
      : runPart("run-last").px(8).max_w(180).min_w(0)
        .tooltip(cmd ? (state === "ended" ? `Run ${cmd.name || cmd.cmd} again (replaces its ended tab)` : `Run ${cmd.name || cmd.cmd}`) : "Run a command")
        .on_click(() => (cmd ? startRun(space, cmd) : openRun()))
        .child(svg("mods/run-commands/play.svg").size(12).flex_none().text_color(t.working))
        .child(div().min_w(0).truncate().child(cmdName));
    const stopPart = state === "stopping"
      ? runPart("run-stop").px(5).tooltip("Stopping…")
        .child(svg("mods/workspace-chrome/spinner.svg").size(11).text_color(t.muted).spin(900))
      : runPart("run-stop").px(5).tooltip(`Stop ${cmdName} (closes its tab)`)
        .hover(s => s.text_color(t.blocked))
        .on_click((_e, cx) => { askStop(space, cmd.cmd); cx.notify(); })
        .child(svg("mods/run-commands/stop.svg").size(11));
    const runButton = h_flex().h(26).flex_none().items_center().rounded(6).overflow_hidden().text_size(12).bg(t.chrome)
      .on_mouse_down("left", (e, cx) => {
        cx.stop_propagation();
        const b = e.bounds;
        if (b) this.runAt = { x: Math.max(0, b.x + b.width - RUN_W), y: b.y + b.height + RUN_GAP };
      })
      .child(mainPart)
      .when(isLive(state), el => el.child(stopPart))
      .child(runPart("run-menu").px(4).tooltip("Run commands").on_click(openRun)
        .child(svg("mods/workspace-chrome/chevron-down.svg").size(12)));
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => this.wheel(e))
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().track_scroll(this.scroll)
        .on_size_change((_size, cx) => { if (active >= 0) { this.scroll.scroll_to_item(active); cx.notify(); } })
        .children(shown.map(item)))
      .child(button("tab-new", "+", () => openOverlay({ mod: "new-menu-cjvnjde", kind: "popup", width: 250, height: 512 })))
      .child(runButton)
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/tabs-cjvnjde/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/tabs-cjvnjde/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/tabs-cjvnjde/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
