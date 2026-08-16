import test from "node:test";
import assert from "node:assert/strict";
import { runAction } from "../src/action.js";

const env = {
  HERDR_BIN_PATH: "/path with spaces/herdr",
  HERDR_PLUGIN_ID: "herdr.jump",
};
const actionIds = ["jump", "workspace", "tab", "pane", "agent"];

test("opens every picker through Herdr without a shell", async () => {
  const calls = [];
  const executor = (command, args, options, callback) => {
    calls.push({ command, args, options });
    callback(null);
  };

  for (const actionId of actionIds) {
    const actionEnv = { ...env, HERDR_PLUGIN_ACTION_ID: actionId };
    await runAction({ env: actionEnv, executor });
  }

  assert.deepStrictEqual(calls, actionIds.map((actionId) => ({
    command: env.HERDR_BIN_PATH,
    args: [
      "plugin",
      "pane",
      "open",
      "--plugin",
      env.HERDR_PLUGIN_ID,
      "--entrypoint",
      actionId,
    ],
    options: { env: { ...env, HERDR_PLUGIN_ACTION_ID: actionId }, shell: false, stdio: "inherit" },
  })));
});

test("rejects when Herdr fails to open a picker", async () => {
  const failure = new Error("open failed");
  const executor = (_command, _args, _options, callback) => callback(failure);

  await assert.rejects(
    runAction({ env: { ...env, HERDR_PLUGIN_ACTION_ID: "jump" }, executor }),
    failure,
  );
});

test("requires the Herdr binary, plugin, and action environment", async () => {
  await assert.rejects(
    runAction({ env: { HERDR_PLUGIN_ID: env.HERDR_PLUGIN_ID }, executor: () => {} }),
    /HERDR_BIN_PATH is required/,
  );
  await assert.rejects(
    runAction({ env: { HERDR_BIN_PATH: env.HERDR_BIN_PATH }, executor: () => {} }),
    /HERDR_PLUGIN_ID is required/,
  );
  await assert.rejects(
    runAction({
      env: { ...env },
      executor: (_command, _args, _options, callback) => callback(null),
    }),
    /HERDR_PLUGIN_ACTION_ID is required/,
  );
});

test("rejects unsupported action IDs", async () => {
  await assert.rejects(
    runAction({
      env: { ...env, HERDR_PLUGIN_ACTION_ID: "unsupported" },
      executor: (_command, _args, _options, callback) => callback(null),
    }),
    /Unsupported HERDR_PLUGIN_ACTION_ID: unsupported/,
  );
});
