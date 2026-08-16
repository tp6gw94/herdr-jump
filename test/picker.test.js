import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import * as net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assignLabels,
  buildCandidates,
  createPickerState,
  pageSizeForRows,
  pageSlice,
  labelKeys,
  normalizeKey,
  reducePicker,
  renderPicker,
  runPicker,
  sendSocketRequest,
  targetToRequest,
} from "../src/picker.js";

const snapshot = {
  workspaces: [
    { workspace_id: "w1", label: "AA" },
    { workspace_id: "w2", label: "AB" },
  ],
  tabs: [
    { tab_id: "t1", workspace_id: "w1", label: "tab-1" },
    { tab_id: "t2", workspace_id: "w1", label: "tab-2" },
    { tab_id: "t3", workspace_id: "w2", label: "tab-1" },
  ],
  panes: [
    {
      pane_id: "p1",
      workspace_id: "w1",
      tab_id: "t1",
      terminal_title_stripped: "foo",
      terminal_title: "ignored title",
    },
    {
      pane_id: "p2",
      workspace_id: "w1",
      tab_id: "t2",
      terminal_title: "bar",
    },
    {
      pane_id: "p3",
      workspace_id: "w2",
      tab_id: "t3",
      terminal_title_stripped: "foo",
    },
    {
      pane_id: "p4",
      workspace_id: "w2",
      tab_id: "t3",
    },
  ],
  agents: [
    {
      pane_id: "p1",
      workspace_id: "w1",
      tab_id: "t1",
      agent: "pi",
    },
  ],
};

const candidate = (id, name = id) => ({
  kind: "pane",
  id,
  name,
  breadcrumb: name,
  depth: 0,
  hostingPaneId: null,
});

class FakeStdin extends EventEmitter {
  constructor() {
    super();
    this.isRaw = false;
    this.events = [];
  }

  setRawMode(value) {
    this.events.push(`raw:${value}`);
    this.isRaw = value;
  }

  removeListener(event, listener) {
    if (event === "keypress") this.events.push("remove");
    return super.removeListener(event, listener);
  }

  pause() {
    this.events.push("pause");
  }
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("assigns the fixed labels in stable order and repeats only after the key order", () => {
  assert.equal(labelKeys, "asdfghjklqwertyuiopzxcvbnm");
  const candidates = Array.from({ length: labelKeys.length + 2 }, (_, index) =>
    candidate(String(index)),
  );

  assert.deepStrictEqual(
    assignLabels(candidates).map(({ id, label }) => ({ id, label })),
    [
      ...labelKeys.split("").map((label, index) => ({ id: String(index), label })),
      { id: "26", label: "a" },
      { id: "27", label: "s" },
    ],
  );
});

test("calculates a deterministic page size and clamps tiny terminals", () => {
  const fallback = pageSizeForRows();

  assert.equal(pageSizeForRows(undefined), fallback);
  assert.equal(pageSizeForRows(null), fallback);
  assert.equal(pageSizeForRows(0), fallback);
  assert.equal(pageSizeForRows(-1), fallback);
  assert.equal(pageSizeForRows("24"), fallback);
  assert.equal(pageSizeForRows(5), 3);
  assert.equal(pageSizeForRows(3), 1);
  assert.equal(pageSizeForRows(1), 1);
});

test("returns one clamped visible page slice", () => {
  const matches = [0, 1, 2, 3, 4];

  assert.deepStrictEqual(pageSlice(matches, 0, 2), [0, 1]);
  assert.deepStrictEqual(pageSlice(matches, 1, 2), [2, 3]);
  assert.deepStrictEqual(pageSlice(matches, 2, 2), [4]);
  assert.deepStrictEqual(pageSlice(matches, 99, 2), [4]);
  assert.deepStrictEqual(pageSlice(matches, -1, 2), [0, 1]);
  assert.deepStrictEqual(pageSlice(matches, 0, 0), [0]);
});

test("builds an annotated All tree and flat mode candidates", () => {
  const all = buildCandidates(snapshot, "all");

  assert.deepStrictEqual(all, [
    {
      kind: "workspace",
      id: "w1",
      name: "AA",
      breadcrumb: "AA",
      depth: 0,
      hostingPaneId: null,
      shortestUniquePrefix: "AA",
      isDuplicate: false,
      disambiguation: null,
    },
    {
      kind: "tab",
      id: "t1",
      name: "tab-1",
      breadcrumb: "tab-1 · AA",
      depth: 1,
      hostingPaneId: null,
      shortestUniquePrefix: null,
      isDuplicate: true,
      disambiguation: { kind: "tab", breadcrumb: "tab-1 · AA" },
    },
    {
      kind: "pane",
      id: "p1",
      name: "foo",
      breadcrumb: "foo · AA › tab-1",
      depth: 2,
      hostingPaneId: null,
      shortestUniquePrefix: null,
      isDuplicate: true,
      disambiguation: { kind: "pane", breadcrumb: "foo · AA › tab-1" },
    },
    {
      kind: "agent",
      id: "p1",
      name: "pi",
      breadcrumb: "pi · AA › tab-1 › foo",
      depth: 3,
      hostingPaneId: "p1",
      shortestUniquePrefix: "pi",
      isDuplicate: false,
      disambiguation: null,
    },
    {
      kind: "tab",
      id: "t2",
      name: "tab-2",
      breadcrumb: "tab-2 · AA",
      depth: 1,
      hostingPaneId: null,
      shortestUniquePrefix: "tab-2",
      isDuplicate: false,
      disambiguation: null,
    },
    {
      kind: "pane",
      id: "p2",
      name: "bar",
      breadcrumb: "bar · AA › tab-2",
      depth: 2,
      hostingPaneId: null,
      shortestUniquePrefix: "b",
      isDuplicate: false,
      disambiguation: null,
    },
    {
      kind: "workspace",
      id: "w2",
      name: "AB",
      breadcrumb: "AB",
      depth: 0,
      hostingPaneId: null,
      shortestUniquePrefix: "AB",
      isDuplicate: false,
      disambiguation: null,
    },
    {
      kind: "tab",
      id: "t3",
      name: "tab-1",
      breadcrumb: "tab-1 · AB",
      depth: 1,
      hostingPaneId: null,
      shortestUniquePrefix: null,
      isDuplicate: true,
      disambiguation: { kind: "tab", breadcrumb: "tab-1 · AB" },
    },
    {
      kind: "pane",
      id: "p3",
      name: "foo",
      breadcrumb: "foo · AB › tab-1",
      depth: 2,
      hostingPaneId: null,
      shortestUniquePrefix: null,
      isDuplicate: true,
      disambiguation: { kind: "pane", breadcrumb: "foo · AB › tab-1" },
    },
    {
      kind: "pane",
      id: "p4",
      name: "p4",
      breadcrumb: "p4 · AB › tab-1",
      depth: 2,
      hostingPaneId: null,
      shortestUniquePrefix: "p4",
      isDuplicate: false,
      disambiguation: null,
    },
  ]);

  assert.deepStrictEqual(
    buildCandidates(snapshot, "tab").map(({ kind, id, name, breadcrumb, depth }) => ({
      kind,
      id,
      name,
      breadcrumb,
      depth,
    })),
    [
      { kind: "tab", id: "t1", name: "tab-1", breadcrumb: "tab-1 · AA", depth: 0 },
      { kind: "tab", id: "t2", name: "tab-2", breadcrumb: "tab-2 · AA", depth: 0 },
      { kind: "tab", id: "t3", name: "tab-1", breadcrumb: "tab-1 · AB", depth: 0 },
    ],
  );
  assert.deepStrictEqual(
    buildCandidates(snapshot, "pane").map(({ kind, id, name, breadcrumb, depth }) => ({
      kind,
      id,
      name,
      breadcrumb,
      depth,
    })),
    [
      { kind: "pane", id: "p1", name: "foo", breadcrumb: "foo · AA › tab-1", depth: 0 },
      { kind: "pane", id: "p2", name: "bar", breadcrumb: "bar · AA › tab-2", depth: 0 },
      { kind: "pane", id: "p3", name: "foo", breadcrumb: "foo · AB › tab-1", depth: 0 },
      { kind: "pane", id: "p4", name: "p4", breadcrumb: "p4 · AB › tab-1", depth: 0 },
    ],
  );
  assert.deepStrictEqual(
    buildCandidates(snapshot, "agent").map(({ kind, id, name, breadcrumb, hostingPaneId }) => ({
      kind,
      id,
      name,
      breadcrumb,
      hostingPaneId,
    })),
    [{
      kind: "agent",
      id: "p1",
      name: "pi",
      breadcrumb: "pi · AA › tab-1 › foo",
      hostingPaneId: "p1",
    }],
  );
});

test("preserves agent_status on All and Agent candidates", () => {
  const statusSnapshot = {
    ...snapshot,
    agents: snapshot.agents.map((agent) => ({ ...agent, agent_status: "blocked" })),
  };

  assert.equal(
    buildCandidates(statusSnapshot, "all").find(({ kind }) => kind === "agent").agent_status,
    "blocked",
  );
  assert.equal(
    buildCandidates(statusSnapshot, "agent").find(({ kind }) => kind === "agent").agent_status,
    "blocked",
  );
});

test("renders each agent status icon and falls back for absent or invalid statuses", () => {
  const cases = [
    ["working", "󰔟"],
    ["idle", "󰏤"],
    ["blocked", "󰌾"],
    ["done", "󰄬"],
    ["unknown", "󰋗"],
    [null, "󰋗"],
    ["invalid", "󰋗"],
    [1, "󰋗"],
  ];
  const stripAnsi = (value) => value.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

  for (const [status, icon] of cases) {
    const agent = {
      ...candidate("a1", "pi"),
      kind: "agent",
      breadcrumb: "pi · workspace › tab › pane",
      hostingPaneId: "p1",
      agent_status: status,
    };
    const row = renderPicker(createPickerState([agent]), "agent", "", 10)
      .split("\n")
      .find((line) => line.includes("pi"));

    assert.equal(stripAnsi(row), `a 󰚩 pi ${icon} · workspace › tab › pane`);
  }

  const missing = {
    ...candidate("a1", "pi"),
    kind: "agent",
    breadcrumb: "pi · workspace › tab › pane",
    hostingPaneId: "p1",
  };
  const row = renderPicker(createPickerState([missing]), "agent", "", 10)
    .split("\n")
    .find((line) => line.includes("pi"));
  assert.equal(stripAnsi(row), "a 󰚩 pi 󰋗 · workspace › tab › pane");
});

test("does not render agent status icons on non-agent rows", () => {
  const rendered = renderPicker(createPickerState([
    { ...candidate("w1", "workspace"), kind: "workspace" },
    { ...candidate("t1", "tab"), kind: "tab" },
    { ...candidate("p1", "pane"), kind: "pane" },
  ]), "all");

  for (const icon of ["󰔟", "󰏤", "󰌾", "󰄬", "󰋗"]) {
    assert.doesNotMatch(rendered, new RegExp(icon));
  }
});

test("filters repeated labels, reassigns them, and exposes a sole automatic target", () => {
  const candidates = Array.from({ length: labelKeys.length + 1 }, (_, index) =>
    candidate(String(index)),
  );
  let state = createPickerState(candidates);

  assert.deepStrictEqual(state.matches.filter(({ label }) => label === "a").map(({ id }) => id), ["0", "26"]);
  state = reducePicker(state, "a");
  assert.deepStrictEqual(state.matches.map(({ id, label }) => ({ id, label })), [
    { id: "0", label: "a" },
    { id: "26", label: "s" },
  ]);
  assert.equal(state.automaticTarget, null);

  state = reducePicker(state, "s");
  assert.equal(state.matches.length, 1);
  assert.equal(state.matches[0].id, "26");
  assert.equal(state.automaticTarget.id, "26");
});

test("pages the complete labeled set without changing labels, history, or focus", () => {
  const initial = createPickerState(Array.from({ length: 5 }, (_, index) => candidate(String(index))));
  const matches = initial.matches;
  const history = initial.history;
  const automaticTarget = initial.matches[0];
  let state = { ...initial, automaticTarget };

  state = reducePicker(state, "PageDown", 2);
  assert.equal(state.page, 1);
  assert.strictEqual(state.matches, matches);
  assert.strictEqual(state.history, history);
  assert.strictEqual(state.automaticTarget, automaticTarget);
  assert.deepStrictEqual(state.matches.map(({ id, label }) => ({ id, label })), [
    { id: "0", label: "a" },
    { id: "1", label: "s" },
    { id: "2", label: "d" },
    { id: "3", label: "f" },
    { id: "4", label: "g" },
  ]);

  state = reducePicker(state, "PageUp", 2);
  assert.equal(state.page, 0);
  assert.strictEqual(state.matches, matches);
  assert.strictEqual(state.history, history);
  assert.strictEqual(state.automaticTarget, automaticTarget);
});

test("does nothing when paging is already at either boundary", () => {
  const initial = createPickerState(Array.from({ length: 4 }, (_, index) => candidate(String(index))));

  assert.strictEqual(reducePicker(initial, "PageUp", 2), initial);
  const last = reducePicker(initial, "PageDown", 2);
  assert.equal(last.page, 1);
  assert.strictEqual(reducePicker(last, "PageDown", 2), last);
});

test("resets to page zero after filtering and Backspace restoration", () => {
  let state = createPickerState(Array.from({ length: labelKeys.length + 1 }, (_, index) =>
    candidate(String(index)),
  ));

  state = reducePicker(state, "PageDown", 1);
  assert.equal(state.page, 1);
  state = reducePicker(state, "a", 1);
  assert.equal(state.page, 0);
  assert.deepStrictEqual(state.matches.map(({ id, label }) => ({ id, label })), [
    { id: "0", label: "a" },
    { id: "26", label: "s" },
  ]);

  state = reducePicker(state, "PageDown", 1);
  assert.equal(state.page, 1);
  state = reducePicker(state, "Backspace", 1);
  assert.equal(state.page, 0);
  assert.equal(state.history.length, 0);
});

test("uses labels rather than names, including for duplicate names", () => {
  const candidates = [candidate("first", "same"), candidate("second", "same")];
  const initial = createPickerState(candidates);

  assert.deepStrictEqual(initial.matches.map(({ id, label }) => ({ id, label })), [
    { id: "first", label: "a" },
    { id: "second", label: "s" },
  ]);
  assert.equal(reducePicker(initial, "a").automaticTarget.id, "first");
  assert.equal(reducePicker(initial, "s").automaticTarget.id, "second");
});

test("an initial sole candidate still needs its visible label", () => {
  const state = createPickerState([candidate("only")]);

  assert.equal(state.automaticTarget, null);
  assert.equal(reducePicker(state, "a").automaticTarget.id, "only");
});

test("Backspace restores exact prior candidates and labels", () => {
  const candidates = Array.from({ length: labelKeys.length + 1 }, (_, index) =>
    candidate(String(index)),
  );
  const initial = createPickerState(candidates);
  const narrowed = reducePicker(initial, "a");
  const narrowedAgain = reducePicker(narrowed, "a");
  const restored = reducePicker(narrowedAgain, "Backspace");
  const restoredInitial = reducePicker(restored, "Backspace");

  assert.deepStrictEqual(restored.matches, narrowed.matches);
  assert.equal(restored.automaticTarget, null);
  assert.deepStrictEqual(restoredInitial.matches, initial.matches);
  assert.equal(restoredInitial.automaticTarget, null);
  assert.strictEqual(reducePicker(initial, "Backspace"), initial);
});

test("Esc cancels and non-displayed labels are inert", () => {
  const state = createPickerState([candidate("one"), candidate("two")]);

  assert.strictEqual(reducePicker(state, "z"), state);
  assert.strictEqual(reducePicker(state, "ArrowDown"), state);
  assert.strictEqual(reducePicker(state, "Enter"), state);
  assert.strictEqual(reducePicker(state, "A"), state);

  const cancelled = reducePicker(state, "Esc");
  assert.equal(cancelled.cancelled, true);
  assert.strictEqual(reducePicker(cancelled, "a"), cancelled);
});

test("maps every target kind to its Herdr request", () => {
  assert.deepStrictEqual(targetToRequest({ kind: "workspace", id: "w1" }), {
    transport: "cli",
    argv: ["workspace", "focus", "w1"],
  });
  assert.deepStrictEqual(targetToRequest({ kind: "tab", id: "t1" }), {
    transport: "cli",
    argv: ["tab", "focus", "t1"],
  });
  assert.deepStrictEqual(targetToRequest({ kind: "pane", id: "p1" }), {
    transport: "socket",
    request: { method: "pane.focus", params: { pane_id: "p1" } },
  });
  assert.deepStrictEqual(
    targetToRequest({ kind: "agent", id: "agent-1", hostingPaneId: "p1" }),
    {
      transport: "socket",
      request: { method: "pane.focus", params: { pane_id: "p1" } },
    },
  );
});

test("normalizes PageUp and PageDown names and terminal sequences", () => {
  assert.equal(normalizeKey({ name: "pageup" }), "PageUp");
  assert.equal(normalizeKey({ name: "PageDown" }), "PageDown");
  assert.equal(normalizeKey("\u001b[5~"), "PageUp");
  assert.equal(normalizeKey("\u001b[6~"), "PageDown");
  assert.equal(normalizeKey({ sequence: "\u001b[5~" }), "PageUp");
  assert.equal(normalizeKey({ sequence: "\u001b[6~" }), "PageDown");
});

test("normalizes only label keys, Backspace, and Esc", () => {
  assert.equal(normalizeKey({ name: "a" }), "a");
  assert.equal(normalizeKey({ name: "A" }), "a");
  assert.equal(normalizeKey({ name: "up" }), "");
  assert.equal(normalizeKey({ name: "down" }), "");
  assert.equal(normalizeKey({ name: "backspace" }), "Backspace");
  assert.equal(normalizeKey({ name: "escape" }), "Esc");
  assert.equal(normalizeKey({ name: "return" }), "");
  assert.equal(normalizeKey({ name: "c", ctrl: true }), "Esc");
  assert.equal(normalizeKey({ name: "f", sequence: "f" }), "f");
  assert.equal(normalizeKey("\r"), "");
  assert.equal(normalizeKey("\u0003"), "Esc");
});

test("renders only the visible slice and always shows its pager", () => {
  let state = createPickerState(Array.from({ length: 4 }, (_, index) => candidate(String(index))));
  state = reducePicker(state, "PageDown", 2);
  const rendered = renderPicker(state, "pane", "", 2);

  assert.match(rendered, /Page 2\/2 · PgUp\/PgDn/);
  assert.match(rendered, /\x1b\[31md\x1b\[39m  2/);
  assert.match(rendered, /\x1b\[31mf\x1b\[39m  3/);
  assert.doesNotMatch(rendered, /\x1b\[31ma\x1b\[39m  0/);
  assert.doesNotMatch(rendered, /\x1b\[31ms\x1b\[39m  1/);
});

test("renders an error frame without extra terminal rows", () => {
  const rendered = renderPicker(
    createPickerState([candidate("only")]),
    "pane",
    new Error("bad"),
    pageSizeForRows(3),
  );
  const lines = rendered
    .split("\n")
    .map((line) => line.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, ""));

  assert.deepStrictEqual(lines, [
    "Jump: pane · Page 1/1 · PgUp/PgDn",
    "a  only",
    "Error: bad",
  ]);
});

test("renders red current labels, compact kind icons, and All indentation", () => {
  const rendered = renderPicker(createPickerState([
    { ...candidate("w1", "AA"), kind: "workspace" },
    { ...candidate("t1", "tab-1"), kind: "tab", breadcrumb: "tab-1 · AA", depth: 1 },
    {
      ...candidate("p1", "pane-1"),
      kind: "pane",
      breadcrumb: "pane-1 · AA › tab-1",
      depth: 2,
    },
    {
      ...candidate("a1", "agent-1"),
      kind: "agent",
      breadcrumb: "agent-1 · AA › tab-1 › pane-1",
      depth: 3,
    },
  ]), "all");

  assert.doesNotMatch(rendered, /Query:/);
  assert.doesNotMatch(rendered, /\x1b\[33m/);
  assert.doesNotMatch(rendered, /(?:workspace|tab|pane|agent):/);
  assert.match(rendered, /\x1b\[31ma\x1b\[39m 󰉋 AA/);
  assert.match(rendered, /\n  \x1b\[31ms\x1b\[39m 󰓩 tab-1 · AA/);
  assert.match(rendered, /\n    \x1b\[31md\x1b\[39m  pane-1 · AA › tab-1/);
  assert.match(rendered, /\n      \x1b\[31mf\x1b\[39m 󰚩 agent-1 󰋗 · AA › tab-1 › pane-1/);
});

test("focuses once only when a label leaves one current candidate", async () => {
  const directory = await mkdtemp(join(tmpdir(), "herdr-jump-"));
  const socketPath = join(directory, "herdr.sock");
  const server = net.createServer((socket) => {
    socket.on("data", () => socket.end(JSON.stringify({ result: {} }) + "\n"));
  });

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });

  const stdin = new FakeStdin();
  const writes = [];
  const calls = [];
  let resolveFocus;
  const panes = Array.from({ length: labelKeys.length + 1 }, (_, index) => ({
    pane_id: `p${index}`,
    workspace_id: "w1",
    tab_id: "t1",
    terminal_title: `pane-${index}`,
  }));
  const picker = runPicker("pane", {
    env: { HERDR_BIN_PATH: "unused", HERDR_SOCKET_PATH: socketPath },
    stdin,
    stdout: { write: (chunk) => writes.push(chunk) },
    load: () => ({
      workspaces: [{ workspace_id: "w1", label: "W" }],
      tabs: [{ tab_id: "t1", workspace_id: "w1", label: "T" }],
      panes,
    }),
    focus: (target) => {
      calls.push(target.id);
      return new Promise((resolve) => {
        resolveFocus = resolve;
      });
    },
  });

  await tick();
  stdin.emit("keypress", "\r", { name: "return" });
  stdin.emit("keypress", "\u001b[A", { name: "up" });
  stdin.emit("keypress", "a", { name: "a" });
  await tick();
  assert.deepStrictEqual(calls, []);
  assert.match(writes.at(-1), /\x1b\[31ma\x1b\[39m  pane-0 · W › T/);
  assert.match(writes.at(-1), /\x1b\[31ms\x1b\[39m  pane-26 · W › T/);

  stdin.emit("keypress", "s", { name: "s" });
  stdin.emit("keypress", "a", { name: "a" });
  await tick();
  assert.deepStrictEqual(calls, ["p26"]);
  resolveFocus();
  assert.equal((await picker).id, "p26");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test("keeps labels after focus errors and allows retry, Backspace, and Esc", async () => {
  const stdin = new FakeStdin();
  const writes = [];
  const calls = [];
  const panes = [
    { pane_id: "p1", workspace_id: "w1", tab_id: "t1", terminal_title: "one" },
    { pane_id: "p2", workspace_id: "w1", tab_id: "t1", terminal_title: "two" },
  ];
  const picker = runPicker("pane", {
    env: { HERDR_BIN_PATH: "unused", HERDR_SOCKET_PATH: "unused" },
    stdin,
    stdout: { write: (chunk) => writes.push(chunk) },
    load: () => ({
      workspaces: [{ workspace_id: "w1", label: "W" }],
      tabs: [{ tab_id: "t1", workspace_id: "w1", label: "T" }],
      panes,
    }),
    focus: (target) => {
      calls.push(target.id);
      return Promise.reject(new Error("focus failed"));
    },
  });

  await tick();
  stdin.emit("keypress", "a", { name: "a" });
  await tick();
  assert.deepStrictEqual(calls, ["p1"]);
  assert.match(writes.at(-1), /Error: focus failed/);
  assert.match(writes.at(-1), /\x1b\[31ma\x1b\[39m  one · W › T/);

  stdin.emit("keypress", "a", { name: "a" });
  await tick();
  assert.deepStrictEqual(calls, ["p1", "p1"]);
  assert.match(writes.at(-1), /\x1b\[31ma\x1b\[39m  one · W › T/);
  stdin.emit("keypress", "\u007f", { name: "backspace" });
  await tick();
  assert.deepStrictEqual(calls, ["p1", "p1"]);
  assert.match(writes.at(-1), /\x1b\[31ma\x1b\[39m  one · W › T/);
  stdin.emit("keypress", "\u007f", { name: "backspace" });
  await tick();
  assert.deepStrictEqual(calls, ["p1", "p1"]);
  assert.match(writes.at(-1), /\x1b\[31ma\x1b\[39m  one · W › T/);
  assert.match(writes.at(-1), /\x1b\[31ms\x1b\[39m  two · W › T/);
  stdin.emit("keypress", "\u001b", { name: "escape" });

  assert.equal(await picker, null);
  assert.deepStrictEqual(calls, ["p1", "p1"]);
});

test("reads stdout rows once and pages safely when rows is absent", async () => {
  const stdin = new FakeStdin();
  const writes = [];
  let rowReads = 0;
  const stdout = {
    get rows() {
      rowReads += 1;
      return 5;
    },
    write: (chunk) => writes.push(chunk),
  };
  const panes = Array.from({ length: 4 }, (_, index) => ({
    pane_id: `p${index}`,
    workspace_id: "w1",
    tab_id: "t1",
    terminal_title: `pane-${index}`,
  }));
  const picker = runPicker("pane", {
    env: { HERDR_BIN_PATH: "unused", HERDR_SOCKET_PATH: "unused" },
    stdin,
    stdout,
    load: () => ({
      workspaces: [{ workspace_id: "w1", label: "W" }],
      tabs: [{ tab_id: "t1", workspace_id: "w1", label: "T" }],
      panes,
    }),
  });

  await tick();
  assert.equal(rowReads, 1);
  assert.match(writes.at(-1), /pane-0/);
  assert.match(writes.at(-1), /pane-1/);
  assert.match(writes.at(-1), /pane-2/);
  assert.doesNotMatch(writes.at(-1), /pane-3/);

  stdin.emit("keypress", "", { name: "pagedown" });
  await tick();
  assert.equal(rowReads, 1);
  assert.match(writes.at(-1), /Page 2\/2 · PgUp\/PgDn/);
  assert.match(writes.at(-1), /pane-3/);
  assert.doesNotMatch(writes.at(-1), /pane-0/);

  stdin.emit("keypress", "\u001b", { name: "escape" });
  assert.equal(await picker, null);

  const noRowsStdin = new FakeStdin();
  const noRowsPicker = runPicker("pane", {
    env: { HERDR_BIN_PATH: "unused", HERDR_SOCKET_PATH: "unused" },
    stdin: noRowsStdin,
    stdout: { write: () => {} },
    load: () => ({ panes }),
  });
  await tick();
  noRowsStdin.emit("keypress", "\u001b", { name: "escape" });
  assert.equal(await noRowsPicker, null);
});

test("sends popup.close after successful focus before resolving the picker", async () => {
  const directory = await mkdtemp(join(tmpdir(), "herdr-jump-"));
  const socketPath = join(directory, "herdr.sock");
  const requests = [];
  const events = [];
  const server = net.createServer((socket) => {
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const request = JSON.parse(line);
        requests.push(request);
        events.push(request.method);
        socket.end(JSON.stringify({ result: {} }) + "\n");
      }
    });
  });

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });

    const stdin = new FakeStdin();
    const picker = runPicker("pane", {
      env: { HERDR_BIN_PATH: "unused", HERDR_SOCKET_PATH: socketPath },
      stdin,
      stdout: { write: () => {} },
      load: () => ({
        workspaces: [{ workspace_id: "w1", label: "W" }],
        tabs: [{ tab_id: "t1", workspace_id: "w1", label: "T" }],
        panes: [{ pane_id: "p1", workspace_id: "w1", tab_id: "t1", terminal_title: "one" }],
      }),
      focus: () => {
        events.push("focus");
        return Promise.resolve();
      },
    });

    await tick();
    stdin.emit("keypress", "a", { name: "a" });
    assert.equal((await picker).id, "p1");
    assert.deepStrictEqual(events, ["focus", "popup.close"]);
    assert.deepStrictEqual(requests.map(({ method, params }) => ({ method, params })), [
      { method: "popup.close", params: {} },
    ]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test("pauses stdin after removing the keypress listener and restores the fake TTY", async () => {
  const stdin = new FakeStdin();
  const writes = [];
  const stdout = { write: (chunk) => writes.push(chunk) };
  const picker = runPicker("workspace", {
    env: { HERDR_BIN_PATH: "unused", HERDR_SOCKET_PATH: "unused" },
    stdin,
    stdout,
    load: () => snapshot,
  });

  await new Promise((resolve) => setImmediate(resolve));
  stdin.emit("keypress", "\u001b", { name: "escape" });

  assert.equal(await picker, null);
  assert.deepStrictEqual(stdin.events, ["raw:true", "remove", "pause", "raw:false"]);
  assert.equal(stdin.listenerCount("keypress"), 0);
  assert.match(writes.at(-1), /\x1b\[0m\x1b\[\?25h/);
});

test("allows a delayed local Unix socket response within the practical timeout", async () => {
  const directory = await mkdtemp(join(tmpdir(), "herdr-jump-"));
  const socketPath = join(directory, "herdr.sock");
  const server = net.createServer((socket) => {
    socket.on("data", () => {
      setTimeout(() => socket.end(JSON.stringify({ result: {} }) + "\n"), 150);
    });
  });

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });

    assert.deepStrictEqual(
      await sendSocketRequest(socketPath, { method: "pane.focus", params: { pane_id: "p1" } }),
      { result: {} },
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test("times out a silent local Unix socket request and destroys the client", async () => {
  const directory = await mkdtemp(join(tmpdir(), "herdr-jump-"));
  const socketPath = join(directory, "herdr.sock");
  let peer;
  const server = net.createServer((socket) => {
    peer = socket;
    socket.on("data", () => {});
  });

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });

    let deadline;
    await assert.rejects(
      Promise.race([
        sendSocketRequest(socketPath, { method: "pane.focus", params: { pane_id: "p1" } }),
        new Promise((_, reject) => {
          deadline = setTimeout(() => reject(new Error("test timeout")), 2000);
        }),
      ]),
      /Herdr socket request timed out/,
    );
    clearTimeout(deadline);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(peer?.destroyed, true);
  } finally {
    peer?.destroy();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
