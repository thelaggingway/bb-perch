import type { TerminalAction } from "./contract.ts";
import { launchEnvironment, type LaunchOptions } from "./settings.ts";

const actions = {
  login: { title: "Perch sign-in", args: ["login"] },
  update: { title: "Update Perch", args: ["update"] },
  interactive: { title: "Perch", args: [] },
  byokList: { title: "Perch BYOK providers", args: ["byok", "list"] },
  byokStatus: { title: "Perch BYOK status", args: ["byok", "status"] },
  byolmStatus: { title: "Perch local-model status", args: ["byolm", "status"] },
  subList: { title: "Perch subscriptions", args: ["sub", "list"] },
};

// Keep the terminal open after quick status commands so the user can read
// stdout. Arguments are separate from the fixed JavaScript source.
const terminalRunner = `
const { spawn } = require("node:child_process");
const [command, overrides, ...args] = process.argv.slice(1);
const child = spawn(command, args, { env: { ...process.env, ...JSON.parse(overrides) }, stdio: "inherit" });
child.once("error", () => console.error("Could not start the configured Perch executable."));
child.once("close", (code) => {
  process.exitCode = code ?? 1;
  console.log("\\nPress Enter to close.");
  process.stdin.resume();
  process.stdin.once("data", () => process.stdin.pause());
});
`;

export function terminalSpec(action: TerminalAction, launch: LaunchOptions, windows: boolean) {
  if (action === "shell") {
    return { title: "Perch routing shell", start: { mode: "shell" as const } };
  }
  const { title, args } = actions[action];
  const env = launchEnvironment(launch);
  if (windows && Object.keys(env).length) {
    throw new Error("Custom terminal environment settings require a Linux or macOS machine.");
  }
  const argv = windows
    ? [launch.executable, ...args]
    : ["node", "-e", terminalRunner, "--", launch.executable, JSON.stringify(env), ...args];
  return { title, start: { mode: "argv" as const, argv } };
}
