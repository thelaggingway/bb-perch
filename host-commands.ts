import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { isRecord } from "@get-bb/plugin-sdk/provider-bridge";
import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { hostContract, type PerchCommand } from "./contract.ts";
import { loginCommand, readStatus, runPerch } from "./process.ts";

const limit = 48_000;
function bounded(text: string) {
  return text.length > limit ? text.slice(0, limit) + "\n[output truncated]" : text;
}

export async function executeCommand(command: PerchCommand, signal: AbortSignal) {
  const cwd = command.cwd;
  if (cwd && !isAbsolute(cwd)) {
    return { exitCode: 2, stderr: "Use an absolute --cwd on the execution machine." };
  }
  if (command.kind === "status") {
    const status = await readStatus(cwd, signal);
    return {
      exitCode: 0,
      stdout: JSON.stringify({ ...status, ...(status.signedIn ? {} : { loginCommand }) }),
    };
  }
  if (command.kind === "skills") {
    const result = await runPerch(command.name ? ["skills", command.name] : ["skills"], { cwd, signal });
    return result.code === 0
      ? { exitCode: 0, stdout: bounded(result.stdout) }
      : { exitCode: result.code, stderr: "Perch could not load the requested skills." };
  }

  // Native perch run otherwise reuses the cwd-derived interactive thread ID.
  const threadId = command.thread ?? `cli-bb-${randomUUID()}`;
  const args = ["run", "-", "--json", "--thread", threadId];
  for (const name of ["model", "effort", "permission", "mode", "persona"] as const) {
    const value = command[name];
    if (value !== undefined) args.push(`--${name}`, value);
  }
  for (const skill of command.skill ?? []) args.push("--skill", skill);
  for (const attachment of command.attach ?? []) {
    args.push("--attach", resolve(cwd ?? process.cwd(), attachment));
  }
  const result = await runPerch(args, { cwd, input: command.task, signal });
  let payload: unknown;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    return {
      exitCode: result.code || 1,
      stderr: "Perch did not return run JSON. Check bb perch status and the supplied options.",
    };
  }
  if (!isRecord(payload)) return { exitCode: 1, stderr: "Invalid Perch run response." };
  const context = isRecord(payload.contextSnapshot) ? payload.contextSnapshot : {};
  const usage = isRecord(context.turnApiUsage) ? context.turnApiUsage : {};
  const string = (value: unknown, length = 256) => typeof value === "string" ? value.slice(0, length) : undefined;
  const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;
  const ok = result.code === 0 && payload.ok === true;
  return {
    exitCode: ok ? 0 : result.code || 1,
    stdout: JSON.stringify({
      ok,
      status: string(payload.status),
      threadId: string(payload.threadId),
      runId: string(payload.runId),
      durationMs: number(payload.durationMs),
      assistantText: typeof payload.assistantText === "string" ? bounded(payload.assistantText) : undefined,
      model: string(context.modelId),
      modelLabel: string(context.modelLabel),
      usage: {
        inputTokens: number(usage.inputTokens),
        outputTokens: number(usage.outputTokens),
        totalTokens: number(usage.totalTokens),
      },
    }),
  };
}

export const hostEntry = experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    command: (command, context) =>
      executeCommand(command, AbortSignal.any([context.signal, context.lifecycle.signal])),
  },
});
