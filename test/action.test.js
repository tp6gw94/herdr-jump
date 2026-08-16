import test from "node:test";
import assert from "node:assert/strict";
import { runAction } from "../src/action.js";

const env = {
  HERDR_BIN_PATH: "/path with spaces/herdr",
  HERDR_PLUGIN_ID: "herdr.jump",
};

test("opens the jump pane through Herdr without a shell", async () => {
  const calls = [];
  const executor = (command, args, options, callback) => {
    calls.push({ command, args, options });
    callback(null);
  };

  await runAction({ env, executor });

  assert.deepStrictEqual(calls, [{
    command: env.HERDR_BIN_PATH,
    args: [
      "plugin",
      "pane",
      "open",
      "--plugin",
      env.HERDR_PLUGIN_ID,
      "--entrypoint",
      "jump",
    ],
    options: { env, shell: false, stdio: "inherit" },
  }]);
});

test("rejects when Herdr fails to open the jump pane", async () => {
  const failure = new Error("open failed");
  const executor = (_command, _args, _options, callback) => callback(failure);

  await assert.rejects(runAction({ env, executor }), failure);
});

test("requires the Herdr binary and plugin environment", async () => {
  await assert.rejects(
    runAction({ env: { HERDR_PLUGIN_ID: env.HERDR_PLUGIN_ID }, executor: () => {} }),
    /HERDR_BIN_PATH is required/,
  );
  await assert.rejects(
    runAction({ env: { HERDR_BIN_PATH: env.HERDR_BIN_PATH }, executor: () => {} }),
    /HERDR_PLUGIN_ID is required/,
  );
});
