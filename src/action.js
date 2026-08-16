import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const actionIds = new Set(["jump", "workspace", "tab", "pane", "agent"]);

const requiredEnv = (env, name) => {
  const value = env?.[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
};

export async function runAction({ env = process.env, executor = execFile } = {}) {
  const command = requiredEnv(env, "HERDR_BIN_PATH");
  const plugin = requiredEnv(env, "HERDR_PLUGIN_ID");
  const actionId = requiredEnv(env, "HERDR_PLUGIN_ACTION_ID");
  if (!actionIds.has(actionId)) {
    throw new Error(`Unsupported HERDR_PLUGIN_ACTION_ID: ${actionId}`);
  }
  const args = [
    "plugin",
    "pane",
    "open",
    "--plugin",
    plugin,
    "--entrypoint",
    actionId,
  ];

  return new Promise((resolve, reject) => {
    executor(command, args, { env, shell: false, stdio: "inherit" }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

const main = async () => {
  try {
    await runAction();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  }
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main();
}
