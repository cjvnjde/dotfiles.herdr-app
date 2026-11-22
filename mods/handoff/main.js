// Handoff: start a new Claude Code session from an existing one.
//
// Opened by the right-click menu (menu-handoff) and the agents list
// (agents-handoff) with props { terminal, mode: "summary" | "full" }.
//
// summary (default): a throwaway fork of the agent's session
//   (`claude -p --resume <id> --fork-session --no-session-persistence`) writes a
//   handoff summary; edit it, add the new task, and Start opens a new tab with a
//   fresh `claude` whose first message is that summary plus the task.
// full: opens a new tab with `claude --resume <id> --fork-session` at once.
//
// Session id: the terminal's `claude.session` label (set by the SessionStart
// hook ~/.claude/hooks/herdr-app-session-label.sh), else Claude's
// ~/.claude/sessions/<pid>.json for the terminal's foreground process.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea } from "gpui-base";
import { run, hc, exec, focused, props, closeOverlay, theme, home, readTextFile } from "herdr";

const SUMMARY_PROMPT = `Write a handoff summary of this session for another engineer (a fresh AI coding agent with none of this context) who will start a related side task in the same repository.

Include, concisely:
- Goal: what this session was working on and why.
- Done so far: what was changed or found (name the key files, functions, commands).
- Decisions and constraints: choices made, conventions, things ruled out and why.
- Current state: what works, what is unfinished, any failing tests or known bugs.
- Useful pointers: important paths, commands to run, gotchas.

Output only the summary in Markdown, no preamble. Do not use any tools.`;

const SUMMARY_TIMEOUT = 600000;

// claude comes from mise, which puts it on PATH only once an interactive shell
// reaches its first prompt; exec and `zsh -lic "claude …"` run before that.
// So find its absolute path in a login shell, with mise's environment applied.
const FIND_CLAUDE = 'command -v mise >/dev/null 2>&1 && eval "$(mise hook-env -s zsh 2>/dev/null)"; whence -p claude';
const HERDR_SETTINGS = "~/.claude/env/herdr-app.json";

async function findClaude(machine) {
  const r = await exec("zsh", ["-lic", FIND_CLAUDE], { on: machine, timeout: 20000 });
  const path = r.stdout.trim().split("\n").filter((l) => l.startsWith("/")).pop();
  if (!path) throw new Error(`Couldn't find claude in a login shell${machine ? ` on ${machine}` : ""}: ${(r.stderr || r.stdout).trim().slice(-300)}`);
  return path;
}

async function resolve() {
  const f = focused();
  const address = (props() ?? {}).terminal ?? f?.terminal ?? f?.agent;
  if (!address) throw new Error("No agent selected. Right-click a Claude terminal or use the agents list.");
  const r = await hc(["get", address, "--json"]);
  if (r.code !== 0) throw new Error(`hc get ${address}: ${r.stderr || r.stdout}`);
  const t = JSON.parse(r.stdout);
  const machine = address.includes("/") ? address.split("/")[0] : null;
  const fg = t.foreground ?? {};
  const isClaude = t.status?.app === "claude-code" || /(^|\/)claude$/.test(fg.argv?.[0] ?? fg.name ?? "");
  if (!isClaude) throw new Error(`${address} isn't running Claude Code.`);
  let sessionId = t.labels?.["claude.session"] ?? null;
  if (!sessionId && fg.pid) {
    const dir = machine ? "~/.claude/sessions" : `${home()}/.claude/sessions`;
    const text = await readTextFile(`${dir}/${fg.pid}.json`, { on: machine });
    if (text) sessionId = JSON.parse(text).sessionId ?? null;
  }
  if (!sessionId) throw new Error(`Couldn't find the Claude session for ${address}. Restart that agent so the SessionStart hook labels it.`);
  const claude = await findClaude(machine);
  // The settings the agent runs with (its --settings), else the herdr-app one if present.
  const argv = fg.argv ?? [];
  const at = argv.indexOf("--settings");
  let settings = at >= 0 ? argv[at + 1] : null;
  if (!settings && !machine) {
    const p = HERDR_SETTINGS.replace("~", home());
    if (await readTextFile(p)) settings = p;
  }
  return {
    address,
    machine,
    sessionId,
    claude,
    settings,
    cwd: fg.cwd ?? t.cwd,
    space: t.labels?.["herdr.space"] ?? f?.space,
    title: t.title ?? t.labels?.where ?? address,
  };
}

export default class Handoff extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.mode = (props() ?? {}).mode === "full" ? "full" : "summary";
    this.state = "resolving"; // resolving | summarizing | ready | error
    this.error = "";
    this.src = null;
    this.summary = TextareaState.new({ placeholder: "Handoff summary…" });
    this.summary.set_soft_wrap(true);
    this.task = TextareaState.new({ placeholder: "What should the new agent do? (optional)" });
    this.task.set_auto_grow(2, 6);
    this.task.set_soft_wrap(true);
    cx.spawn(async (cx) => {
      try {
        this.src = await resolve();
        if (this.mode === "full") return this.startFull();
        cx.notify();
        await this.summarize(cx);
      } catch (e) {
        this.state = "error";
        this.error = String(e?.message ?? e);
        cx.notify();
      }
    });
  }

  async summarize(cx) {
    this.state = "summarizing";
    cx.notify();
    // env -u: the throwaway run must not relabel any terminal through the hook.
    const r = await exec("env", ["-u", "HC_TERMINAL_ID", this.src.claude, "-p",
      "--resume", this.src.sessionId, "--fork-session", "--no-session-persistence",
      SUMMARY_PROMPT], { cwd: this.src.cwd, on: this.src.machine, timeout: SUMMARY_TIMEOUT });
    if (r.code !== 0 || !r.stdout.trim()) throw new Error(`claude -p failed (${r.code}): ${(r.stderr || r.stdout).trim().slice(-600)}`);
    this.summary.set_value(r.stdout.trim());
    this.state = "ready";
    this.task.focus();
    cx.notify();
  }

  claudeArgv(extra) {
    return [this.src.claude, ...(this.src.settings ? ["--settings", this.src.settings] : []), ...extra];
  }

  newTab(argv, task) {
    const args = { argv, folder: this.src.cwd };
    if (this.src.space) args.space = this.src.space;
    if (task) args.task = task;
    this.close();
    run("tab.new", args);
  }

  startSummary() {
    const task = this.task.value().trim();
    const message = [
      "You are continuing related work from another agent session. Here is its handoff summary:",
      "",
      "<handoff>",
      this.summary.value().trim(),
      "</handoff>",
      "",
      task ? `New task: ${task}` : "Read the summary, then wait for my instructions.",
    ].join("\n");
    this.newTab(this.claudeArgv([]), message);
  }

  startFull() {
    this.newTab(this.claudeArgv(["--resume", this.src.sessionId, "--fork-session"]), this.task.value().trim() || undefined);
  }

  close() {
    const id = (props() ?? {}).overlay;
    if (id) closeOverlay(id);
  }

  key(e, cx) {
    if (e.key === "escape") { this.close(); cx.stop_propagation(); }
    if (e.key === "enter" && (e.modifiers?.platform || e.modifiers?.control) && this.state === "ready") {
      this.startSummary(); cx.stop_propagation();
    }
  }

  render() {
    const t = theme();
    const full = this.mode === "full";
    const ready = this.state === "ready";
    const failed = this.state === "error";
    const busy = this.state === "resolving" || this.state === "summarizing";

    const kbd = (text) => h_flex().h(18).px(5).items_center().rounded(4).border_1().border_color(t.border)
      .bg(t.raised).text_size(10.5).text_color(t.dim).child(text);
    const label = (text, hint) => h_flex().items_center().pb(6)
      .child(div().flex_1().text_size(11).font_medium().text_color(t.muted).child(text))
      .when(Boolean(hint), (el) => el.child(div().text_size(10.5).text_color(t.dim).child(hint)));
    const button = (id, text, primary, enabled, action) => h_flex().id(id).h(28).px(12).items_center().rounded(7)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12).font_medium()
      .when(enabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)).on_click(() => action()))
      .when(!enabled, (el) => el.opacity(0.45))
      .child(text);
    const box = (el) => el.w_full().px(10).py(8).rounded(8).border_1().border_color(t.input).bg(t.background)
      .text_size(12.5).text_color(t.foreground);
    const spinner = () => div().text_color(t.working).frames(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], 90);

    const where = this.src
      ? [this.src.title, String(this.src.cwd ?? "").replace(home(), "~")].filter(Boolean).join(" · ")
      : "Claude Code";
    const header = h_flex().gap(10).items_center()
      .child(h_flex().flex_none().size(28).items_center().justify_center().rounded(7)
        .bg(t.raised).border_1().border_color(t.border)
        .child(svg("mods/handoff/handoff.svg").size(14).text_color(t.accent)))
      .child(v_flex().flex_1().min_w(0)
        .child(div().text_size(14).font_semibold().child(full ? "Fork session" : "New session from summary"))
        .child(div().text_size(11).text_color(t.dim).truncate().child(where)))
      .child(kbd("Esc"));

    const status = busy
      ? (this.state === "resolving" ? (full ? "Forking the session…" : "Finding the agent's session…")
        : "Summarizing in a throwaway fork; the agent isn't touched…")
      : "";

    const body = v_flex().flex_1().min_h(0).pt(14);
    if (full) {
      body.child(failed
        ? div().text_size(12.5).text_color(t.blocked).child(this.error)
        : h_flex().gap(8).items_center().text_size(12.5).text_color(t.muted).child(spinner()).child(status));
    } else {
      body.child(label("Handoff summary", ready ? "editable" : null));
      if (failed) {
        body.child(box(v_flex()).flex_1().min_h(0).child(div().text_size(12.5).text_color(t.blocked).child(this.error)));
      } else if (busy) {
        const bar = (w, delay) => div().h(8).w(w).rounded(4).bg(t.raised)
          .loop("opacity", { from: 0.35, to: 1, period: 1400 + delay });
        body.child(box(v_flex()).flex_1().min_h(0).gap(10)
          .child(h_flex().gap(8).items_center().pb(4).text_size(12).text_color(t.muted).child(spinner()).child(status))
          .child(bar(220, 0)).child(bar(480, 120)).child(bar(430, 240)).child(bar(500, 360)).child(bar(300, 480)));
      } else {
        body.child(box(Textarea.new(this.summary)).flex_1().min_h(0));
      }
      if (!failed) {
        body.child(div().pt(12).child(label("New task", "optional")))
          .child(box(Textarea.new(this.task)));
      }
    }

    const showFooter = !full || failed;
    return v_flex().id("handoff").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .size_full().p(16).bg(t.popover).text_color(t.foreground)
      .child(header)
      .child(body)
      .when(showFooter, (el) => el.child(h_flex().mt(14).pt(12).gap(8).items_center().border_t_1().border_color(t.border)
        .child(h_flex().flex_1().gap(6).items_center().text_size(11).text_color(t.dim)
          .when(ready, (el) => el.child(kbd("⌘↩")).child("start")))
        .child(button("ho-cancel", full ? "Close" : "Cancel", false, true, () => this.close()))
        .when(!full, (el) => el.child(button("ho-start", "Start session", true, ready, () => this.startSummary())))));
  }
}
