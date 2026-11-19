import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
  experimental_killPortableProcess,
  experimental_spawnPortableProcess,
  isRecord,
} from "@get-bb/plugin-sdk/provider-bridge";
import { perchConfiguration } from "./options.ts";

export const settingsEnv = "BB_PERCH_SESSION_SETTINGS";

export function runPerchProxy() {
  const { file, configOptions } = perchConfiguration(JSON.parse(process.env[settingsEnv] ?? "{}"));
  const directory = mkdtempSync(join(tmpdir(), "bb-perch-"));
  const cleanup = () => rmSync(directory, { recursive: true, force: true });
  process.once("exit", cleanup);
  writeFileSync(join(directory, "cli-settings.json"), JSON.stringify(file), { mode: 0o600 });

  const env = { ...process.env, PERCH_CLI_SETTINGS_DIR: directory };
  delete (env as NodeJS.ProcessEnv)[settingsEnv];

  const child = experimental_spawnPortableProcess({
    command: "perch", args: ["acp"],
    env,
    stdio: ["pipe", "pipe", "ignore"],
  });

  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const childOutput = createInterface({ input: child.stdout!, crlfDelay: Infinity });
  const setups = new Set<unknown>();
  const initializations = new Set<unknown>();
  const send = (message: unknown) => process.stdout.write(JSON.stringify(message) + "\n");
  const reply = (id: unknown, result: unknown) => send({ jsonrpc: "2.0", id, result });
  const fail = (id: unknown, code: number, message: string) =>
    send({ jsonrpc: "2.0", id, error: { code, message } });

  input.on("line", (line) => {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      fail(null, -32700, "Invalid JSON.");
      return;
    }
    if (!isRecord(message)) return;
    switch (message.method) {
      case "initialize":
        initializations.add(message.id);
        break;
      case "session/new":
      case "session/load":
        setups.add(message.id);
        break;
      case "session/set_config_option": {
        const params = message.params;
        if (isRecord(params) && configOptions.some((option) =>
          option.id === params.configId && option.currentValue === params.value)) {
          reply(message.id, { configOptions });
        } else {
          fail(message.id, -32602, "Change this setting through the bb thread options.");
        }
        return;
      }
      case "authenticate":
        fail(message.id, -32000, "Authentication required. Run perch login in a terminal.");
        return;
    }
    if (!child.stdin!.write(line + "\n")) {
      input.pause();
      child.stdin!.once("drain", () => input.resume());
    }
  });

  childOutput.on("line", (line) => {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!isRecord(message)) return;
    if (setups.delete(message.id)) {
      if (isRecord(message.error) && message.error.code === -32000) {
        fail(message.id, -32000, "Authentication required. Run bb perch login on the execution machine.");
        return;
      }
      if (isRecord(message.result)) {
        const { modes: _modes, ...result } = message.result;
        reply(message.id, { ...result, configOptions });
        return;
      }
    }
    if (initializations.delete(message.id) && isRecord(message.result)) {
      // BB exposes the native login command via provider health. ACP never launches a browser.
      reply(message.id, { ...message.result, authMethods: [] });
      return;
    }
    if (message.method === "session/update" && isRecord(message.params)
      && isRecord(message.params.update) && message.params.update.sessionUpdate === "current_mode_update") {
      return;
    }
    if (!send(message)) {
      childOutput.pause();
      process.stdout.once("drain", () => childOutput.resume());
    }
  });

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    input.close();
    process.stdin.pause();
    child.stdin!.end();
    // Pipe EOF gives Perch a chance to exit. The fallback also covers a stuck child.
    setTimeout(() => {
      experimental_killPortableProcess(child, "SIGKILL");
    }, 150).unref();
  };
  input.once("close", stop);
  child.stdin!.on("error", () => {});
  child.once("error", (error: NodeJS.ErrnoException) => {
    process.stderr.write(error.code === "ENOENT"
      ? "Perch is missing from PATH. Install it with npm install -g perchai-cli.\n"
      : "Could not launch perch acp.\n");
  });
  child.once("close", (code) => {
    process.exitCode = stopping ? 0 : code ?? 1;
    stopping = true;
    input.close();
    process.stdin.pause();
    childOutput.close();
  });
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  process.stdout.on("error", stop);
}
