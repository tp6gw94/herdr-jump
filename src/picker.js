import { spawn } from "node:child_process";
import * as net from "node:net";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";

const modes = new Set(["all", "workspace", "tab", "pane", "agent"]);

const list = (snapshot, key) =>
  Array.isArray(snapshot?.[key]) ? snapshot[key] : [];

const text = (value, fallback) =>
  typeof value === "string" && value.length > 0 ? value : fallback;

const lower = (value) => String(value ?? "").toLocaleLowerCase();

const paneName = (pane) =>
  text(pane.terminal_title_stripped, text(pane.terminal_title, pane.pane_id));

const matchesPrefix = (value, query) => lower(value).startsWith(lower(query));

const candidateName = (value) =>
  typeof value === "string" ? value : value?.name;

export { matchesPrefix };

export function shortestUniquePrefix(value, candidates) {
  const target = candidateName(value);
  const values = Array.isArray(candidates) ? candidates : [];
  const names = values.map(candidateName);
  const targetIndex =
    typeof value === "object" && value !== null
      ? values.indexOf(value)
      : names.findIndex((name) => name === target);
  const parts = Array.from(String(target ?? ""));

  if (parts.length === 0) return null;

  for (let length = 1; length <= parts.length; length += 1) {
    const prefix = parts.slice(0, length).join("");
    const collides = names.some(
      (name, index) => index !== targetIndex && matchesPrefix(name, prefix),
    );
    if (!collides) return prefix;
  }

  return null;
}

const annotateCandidates = (candidates) => {
  const counts = new Map();
  for (const candidate of candidates) {
    const key = lower(candidate.name);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return candidates.map((candidate) => {
    const isDuplicate = counts.get(lower(candidate.name)) > 1;
    return {
      ...candidate,
      shortestUniquePrefix: shortestUniquePrefix(candidate, candidates),
      isDuplicate,
      disambiguation: isDuplicate
        ? { kind: candidate.kind, breadcrumb: candidate.breadcrumb }
        : null,
    };
  });
};

const addCandidate = (
  candidates,
  kind,
  id,
  name,
  breadcrumb,
  depth,
  hostingPaneId = null,
  agent_status,
) => {
  const candidate = { kind, id, name, breadcrumb, depth, hostingPaneId };
  if (kind === "agent" && agent_status !== undefined) candidate.agent_status = agent_status;
  candidates.push(candidate);
};

const groupBy = (items, key) => {
  const groups = new Map();
  for (const item of items) {
    const value = item[key];
    const group = groups.get(value) ?? [];
    group.push(item);
    groups.set(value, group);
  }
  return groups;
};

export function buildCandidates(snapshot, mode = "all") {
  if (!modes.has(mode)) throw new Error(`Unknown picker mode: ${mode}`);

  const workspaces = list(snapshot, "workspaces");
  const tabs = list(snapshot, "tabs");
  const panes = list(snapshot, "panes");
  const agents = list(snapshot, "agents");
  const tabsByWorkspace = groupBy(tabs, "workspace_id");
  const panesByTab = groupBy(panes, "tab_id");
  const agentsByPane = groupBy(agents, "pane_id");
  const workspaceById = new Map(workspaces.map((workspace) => [workspace.workspace_id, workspace]));
  const tabById = new Map(tabs.map((tab) => [tab.tab_id, tab]));
  const paneById = new Map(panes.map((pane) => [pane.pane_id, pane]));
  const candidates = [];

  const workspaceLabel = (workspace) => text(workspace.label, workspace.workspace_id);
  const tabLabel = (tab) => text(tab.label, tab.tab_id);
  const workspaceFor = (item) => workspaceById.get(item.workspace_id);
  const tabFor = (item) => tabById.get(item.tab_id);
  const workspaceContext = (item) => workspaceLabel(workspaceFor(item) ?? item);
  const tabContext = (item) => `${workspaceContext(item)} › ${tabLabel(item)}`;
  const tabBreadcrumb = (item) => `${tabLabel(item)} · ${workspaceContext(item)}`;
  const paneContext = (item) => {
    const tab = tabFor(item);
    return tab ? tabContext(tab) : workspaceContext(item);
  };
  const paneBreadcrumb = (item) => `${paneName(item)} · ${paneContext(item)}`;
  const agentBreadcrumb = (item) => {
    const pane = paneById.get(item.pane_id);
    const context = pane
      ? `${paneContext(pane)} › ${paneName(pane)}`
      : paneContext(item);
    return `${item.agent} · ${context}`;
  };

  if (mode === "workspace" || mode === "all") {
    for (const workspace of workspaces) {
      addCandidate(
        candidates,
        "workspace",
        workspace.workspace_id,
        workspaceLabel(workspace),
        workspaceLabel(workspace),
        0,
      );

      if (mode !== "all") continue;
      for (const tab of tabsByWorkspace.get(workspace.workspace_id) ?? []) {
        addCandidate(candidates, "tab", tab.tab_id, tabLabel(tab), tabBreadcrumb(tab), 1);
        for (const pane of panesByTab.get(tab.tab_id) ?? []) {
          addCandidate(candidates, "pane", pane.pane_id, paneName(pane), paneBreadcrumb(pane), 2);
          for (const agent of agentsByPane.get(pane.pane_id) ?? []) {
            if (typeof agent.agent !== "string" || agent.agent.length === 0) continue;
            addCandidate(
              candidates,
              "agent",
              agent.pane_id,
              agent.agent,
              agentBreadcrumb(agent),
              3,
              agent.pane_id,
              agent.agent_status,
            );
          }
        }
      }
    }
  }

  if (mode === "tab") {
    for (const tab of tabs) {
      addCandidate(candidates, "tab", tab.tab_id, tabLabel(tab), tabBreadcrumb(tab), 0);
    }
  }

  if (mode === "pane") {
    for (const pane of panes) {
      addCandidate(candidates, "pane", pane.pane_id, paneName(pane), paneBreadcrumb(pane), 0);
    }
  }

  if (mode === "agent") {
    for (const agent of agents) {
      if (typeof agent.agent !== "string" || agent.agent.length === 0) continue;
      addCandidate(
        candidates,
        "agent",
        agent.pane_id,
        agent.agent,
        agentBreadcrumb(agent),
        0,
        agent.pane_id,
        agent.agent_status,
      );
    }
  }

  return annotateCandidates(candidates);
}

export const labelKeys = "asdfghjklqwertyuiopzxcvbnm";

export function assignLabels(candidates) {
  const values = Array.isArray(candidates) ? candidates : [];
  return values.map((candidate, index) => ({
    ...candidate,
    label: labelKeys[index % labelKeys.length],
  }));
}

const RESERVED_PAGE_ROWS = 2;
const DEFAULT_TERMINAL_ROWS = 24;
const DEFAULT_PAGE_SIZE = DEFAULT_TERMINAL_ROWS - RESERVED_PAGE_ROWS;

const normalizePageSize = (value) =>
  Number.isFinite(value) ? Math.max(1, Math.floor(value)) : DEFAULT_PAGE_SIZE;

const pageCountFor = (matches, size) =>
  Math.max(1, Math.ceil(matches.length / size));

const clampPage = (page, pageCount) =>
  Number.isInteger(page) ? Math.min(Math.max(page, 0), pageCount - 1) : 0;

export function pageSizeForRows(rows) {
  const terminalRows = Number.isInteger(rows) && rows > 0
    ? rows
    : DEFAULT_TERMINAL_ROWS;
  return Math.max(1, terminalRows - RESERVED_PAGE_ROWS);
}

export function pageSlice(candidates, page, size) {
  const values = Array.isArray(candidates) ? candidates : [];
  const pageSize = normalizePageSize(size);
  const currentPage = clampPage(page, pageCountFor(values, pageSize));
  return values.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
}

export function createPickerState(candidates) {
  const values = Array.isArray(candidates) ? candidates : [];
  return {
    candidates: values,
    matches: assignLabels(values),
    page: 0,
    history: [],
    automaticTarget: null,
    cancelled: false,
  };
}

const keyName = (key) =>
  typeof key === "string" ? key : key?.key ?? key?.name;

export function reducePicker(state, key, size) {
  if (!state || state.cancelled) return state;

  const input = keyName(key);
  const pageSize = normalizePageSize(size);
  const matches = Array.isArray(state.matches) ? state.matches : [];
  const pageCount = pageCountFor(matches, pageSize);
  const page = clampPage(state.page, pageCount);

  if (input === "PageUp" || input === "pageup") {
    if (page === 0) return state;
    return { ...state, page: page - 1 };
  }
  if (input === "PageDown" || input === "pagedown") {
    if (page === pageCount - 1) return state;
    return { ...state, page: page + 1 };
  }
  if (input === "Backspace" || input === "backspace") {
    const history = Array.isArray(state.history) ? state.history : [];
    if (history.length === 0) return state;
    return {
      ...state,
      matches: history.at(-1),
      page: 0,
      history: history.slice(0, -1),
      automaticTarget: null,
    };
  }
  if (input === "Escape" || input === "Esc" || input === "escape") {
    return { ...state, automaticTarget: null, cancelled: true };
  }

  const filtered = matches.filter((candidate) => candidate.label === input);
  if (filtered.length === 0) return state;

  const nextMatches = assignLabels(filtered);
  return {
    ...state,
    matches: nextMatches,
    page: 0,
    history: [...(Array.isArray(state.history) ? state.history : []), matches],
    automaticTarget: nextMatches.length === 1 ? nextMatches[0] : null,
  };
}

const normalizeLabel = (value) => {
  if (typeof value !== "string" || value.length !== 1) return "";
  const label = value.toLocaleLowerCase();
  return labelKeys.includes(label) ? label : "";
};

const normalizePageKey = (value) => {
  if (typeof value !== "string") return "";
  const name = value.toLocaleLowerCase();
  if (name === "pageup" || value === "\u001b[5~") return "PageUp";
  if (name === "pagedown" || value === "\u001b[6~") return "PageDown";
  return "";
};

export function normalizeKey(key, sequence) {
  if (typeof key === "string") {
    if (key === "\u007f") return "Backspace";
    if (key === "\u001b" || key === "\u0003") return "Esc";
    return normalizePageKey(key) || normalizeLabel(key);
  }

  const name = typeof key?.name === "string" ? key.name.toLocaleLowerCase() : "";
  const input = sequence ?? key?.sequence;
  if (key?.ctrl) return name === "c" || input === "\u0003" ? "Esc" : "";
  if (name === "backspace" || input === "\u007f") return "Backspace";
  if (name === "escape" || input === "\u001b") return "Esc";
  return normalizePageKey(name)
    || normalizePageKey(input)
    || normalizePageKey(key?.key)
    || normalizeLabel(name)
    || normalizeLabel(input)
    || normalizeLabel(key?.key);
}

export function targetToRequest(candidate) {
  if (!candidate || typeof candidate !== "object" || typeof candidate.id !== "string") {
    throw new Error("Invalid picker target");
  }

  if (candidate.kind === "workspace") {
    return { transport: "cli", argv: ["workspace", "focus", candidate.id] };
  }
  if (candidate.kind === "tab") {
    return { transport: "cli", argv: ["tab", "focus", candidate.id] };
  }
  if (candidate.kind === "pane") {
    return {
      transport: "socket",
      request: { method: "pane.focus", params: { pane_id: candidate.id } },
    };
  }
  if (candidate.kind === "agent") {
    const paneId = candidate.hostingPaneId ?? candidate.id;
    return {
      transport: "socket",
      request: { method: "pane.focus", params: { pane_id: paneId } },
    };
  }
  throw new Error(`Unknown picker target kind: ${candidate.kind}`);
}

const ansi = {
  clear: "\u001b[2J\u001b[H",
  hideCursor: "\u001b[?25l",
  showCursor: "\u001b[?25h",
  reset: "\u001b[0m",
  prefix: "\u001b[31m",
  prefixOff: "\u001b[39m",
  error: "\u001b[31m",
  errorOff: "\u001b[39m",
};

const kindIcons = {
  workspace: "󰉋",
  tab: "󰓩",
  pane: "",
  agent: "󰚩",
};

const agentStatusIcons = {
  working: "󰔟",
  idle: "󰏤",
  blocked: "󰌾",
  done: "󰄬",
  unknown: "󰋗",
};

const agentStatusIcon = (status) =>
  typeof status === "string" && Object.hasOwn(agentStatusIcons, status)
    ? agentStatusIcons[status]
    : agentStatusIcons.unknown;

const renderRow = (candidate) => {
  const label = `${ansi.prefix}${candidate.label}${ansi.prefixOff}`;
  const target = candidate.kind === "agent"
    ? `${candidate.name} ${agentStatusIcon(candidate.agent_status)}${candidate.breadcrumb.slice(candidate.name.length)}`
    : candidate.breadcrumb;
  return `${"  ".repeat(candidate.depth ?? 0)}${label} ${kindIcons[candidate.kind]} ${target}`;
};

export function renderPicker(state, mode, error = "", size = DEFAULT_PAGE_SIZE) {
  const matches = Array.isArray(state?.matches) ? state.matches : [];
  const pageSize = normalizePageSize(size);
  const pageCount = pageCountFor(matches, pageSize);
  const page = clampPage(state?.page, pageCount);
  const visible = pageSlice(matches, page, pageSize);
  const lines = [`${ansi.clear}Jump: ${mode} · Page ${page + 1}/${pageCount} · PgUp/PgDn`];

  if (visible.length === 0) {
    lines.push("No matches");
  } else {
    visible.forEach((candidate) => {
      lines.push(renderRow(candidate));
    });
  }

  if (error) {
    const message = String(error instanceof Error ? error.message : error).replace(/\s+/g, " ");
    lines.push(`${ansi.error}Error: ${message}${ansi.errorOff}`);
  }
  return `${lines.join("\n")}${ansi.reset}`;
}

const requiredEnv = (env, name) => {
  const value = env?.[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const SOCKET_REQUEST_TIMEOUT_MS = 1500;

const runProcess = (command, argv, env) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, argv, {
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      const detail = stderr.trim() || `Herdr command failed${signal ? ` (${signal})` : ""}`;
      reject(new Error(detail));
    });
  });

export async function loadSnapshot(env = process.env) {
  const binPath = requiredEnv(env, "HERDR_BIN_PATH");
  const output = await runProcess(binPath, ["api", "snapshot"], env);
  let response;
  try {
    response = JSON.parse(output);
  } catch (error) {
    throw new Error(`Invalid Herdr snapshot response: ${error.message}`);
  }
  if (!response?.result?.snapshot || typeof response.result.snapshot !== "object") {
    throw new Error("Herdr snapshot response missing result.snapshot");
  }
  return response.result.snapshot;
}

export function sendSocketRequest(socketPath, request) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = "";
    let settled = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      socket.setTimeout(0);
      if (error) {
        socket.destroy();
        reject(error);
      } else {
        resolve(value);
      }
    };

    socket.setTimeout(SOCKET_REQUEST_TIMEOUT_MS, () => {
      finish(new Error("Herdr socket request timed out"));
    });

    const handleResponse = (line) => {
      let response;
      try {
        response = JSON.parse(line);
      } catch (error) {
        finish(new Error(`Invalid Herdr socket response: ${error.message}`));
        return;
      }
      const responseError = response?.error ?? response?.result?.error;
      if (responseError) {
        const message = typeof responseError === "string"
          ? responseError
          : JSON.stringify(responseError);
        finish(new Error(message));
        return;
      }
      finish(null, response);
      socket.end();
    };

    socket.once("error", (error) => finish(error));
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      let newline;
      while (!settled && (newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.length > 0) handleResponse(line);
      }
    });
    socket.once("close", () => {
      if (settled) return;
      const line = buffer.trim();
      if (line) handleResponse(line);
      else finish(new Error("Herdr socket closed without a response"));
    });
    socket.once("connect", () => {
      const wireRequest = request.id === undefined ? { id: "", ...request } : request;
      const payload = `${JSON.stringify(wireRequest)}\n`;
      socket.write(payload, (error) => {
        if (error) finish(error);
      });
    });
  });
}

export async function focusCandidate(candidate, env = process.env) {
  const request = targetToRequest(candidate);
  if (request.transport === "cli") {
    return runProcess(requiredEnv(env, "HERDR_BIN_PATH"), request.argv, env);
  }
  return sendSocketRequest(requiredEnv(env, "HERDR_SOCKET_PATH"), request.request);
}

export async function runPicker(mode = "all", options = {}) {
  if (!modes.has(mode)) throw new Error(`Unknown picker mode: ${mode}`);

  const {
    env = process.env,
    stdin = process.stdin,
    stdout = process.stdout,
    load = loadSnapshot,
    focus = focusCandidate,
  } = options;
  const originalRawMode = Boolean(stdin.isRaw);
  const canSetRawMode = typeof stdin.setRawMode === "function";
  let keypressListener;
  let listenerAdded = false;

  try {
    requiredEnv(env, "HERDR_BIN_PATH");
    requiredEnv(env, "HERDR_SOCKET_PATH");
    if (!canSetRawMode) throw new Error("Picker requires a TTY");

    const pageSize = pageSizeForRows(stdout?.rows);
    const snapshot = await load(env);
    const candidates = buildCandidates(snapshot, mode);
    let state = createPickerState(candidates);
    let error = "";
    let focusing = false;

    readline.emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdout.write(ansi.hideCursor);

    const render = () => stdout.write(renderPicker(state, mode, error, pageSize));
    const result = await new Promise((resolve) => {
      let finished = false;
      const finish = (value) => {
        if (finished) return;
        finished = true;
        resolve(value);
      };

      keypressListener = (sequence, key) => {
        if (finished || focusing) return;
        const input = normalizeKey(key, sequence);
        const nextState = reducePicker(state, input, pageSize);
        if (nextState.cancelled) {
          state = nextState;
          finish(null);
        } else if (nextState !== state) {
          state = nextState;
          error = "";
          render();
          if (state.automaticTarget) {
            const target = state.automaticTarget;
            focusing = true;
            Promise.resolve()
              .then(() => focus(target, env))
              .then(() => sendSocketRequest(
                requiredEnv(env, "HERDR_SOCKET_PATH"),
                { method: "popup.close", params: {} },
              ))
              .then(
                () => finish(target),
                (focusError) => {
                  focusing = false;
                  state = { ...state, automaticTarget: null };
                  error = focusError;
                  render();
                },
              );
          }
        }
      };
      stdin.on("keypress", keypressListener);
      listenerAdded = true;
      render();
    });
    return result;
  } finally {
    if (listenerAdded && typeof stdin.removeListener === "function") {
      stdin.removeListener("keypress", keypressListener);
    }
    try {
      if (typeof stdin.pause === "function") stdin.pause();
    } finally {
      try {
        if (canSetRawMode) stdin.setRawMode(originalRawMode);
      } finally {
        try {
          stdout.write(`${ansi.reset}${ansi.showCursor}`);
        } catch {
          // stdout cleanup is best effort when the popup host has already closed it.
        }
      }
    }
  }
}

const main = async () => {
  try {
    await runPicker(process.argv[2] ?? "all");
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  }
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main();
}
