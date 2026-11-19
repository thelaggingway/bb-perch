import { launchEnvironment, readLaunch, type LaunchOptions } from "./settings.ts";
import { readPerchUsageCached } from "./usage.ts";
import { experimental_killPortableProcess, experimental_spawnPortableProcess } from "@get-bb/plugin-sdk/provider-bridge";

export const installCommand = "npm install -g perchai-cli";
export const loginCommand = "perch login";

export function runPerch(
  args: string[],
  { cwd, input, signal, env, executable = "perch", captureStderr = false, doneWhen }: {
    cwd?: string; input?: string; signal: AbortSignal; env?: NodeJS.ProcessEnv; executable?: string; captureStderr?: boolean;
    /** Resolve early and stop Perch once stdout so far satisfies this check. */
    doneWhen?: (stdout: string) => boolean;
  },
): Promise<{ code: number; stdout: string; stderr?: string }> {
  signal.throwIfAborted();
  const child = experimental_spawnPortableProcess({
    command: executable, args,
    cwd,
    env,
    stdio: ["pipe", "pipe", captureStderr ? "pipe" : "ignore"],
  });
  return new Promise((resolve, reject) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    const abort = () => {
      stop();
      reject(signal.reason);
    };
    const stop = () => {
      experimental_killPortableProcess(child, "SIGKILL");
    };
    signal.addEventListener("abort", abort, { once: true });
    const append = (chunks: Buffer[]) => (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 16 * 1024 * 1024) {
        stop();
        reject(new Error("Perch exceeded the 16 MiB output limit."));
        return;
      }
      chunks.push(chunk);
      if (doneWhen && chunks === stdout) {
        const text = Buffer.concat(stdout).toString("utf8");
        if (doneWhen(text)) {
          signal.removeEventListener("abort", abort);
          stop();
          resolve({ code: 0, stdout: text });
        }
      }
    };
    child.stdout!.on("data", append(stdout));
    child.stderr?.on("data", append(stderr));
    child.stdin!.on("error", () => {});
    child.stdin!.end(input);
    child.once("error", (error: NodeJS.ErrnoException) => {
      signal.removeEventListener("abort", abort);
      reject(error.code === "ENOENT"
        ? new Error(executable === "perch"
          ? `Perch is missing from PATH. Run ${installCommand} on this machine.`
          : "The configured Perch executable was not found on this machine.")
        : new Error("Could not launch Perch."));
    });
    child.once("close", (code) => {
      signal.removeEventListener("abort", abort);
      resolve({ code: code ?? 1, stdout: Buffer.concat(stdout).toString("utf8"),
        ...(captureStderr ? { stderr: Buffer.concat(stderr).toString("utf8") } : {}),
      });
    });
  });
}

export async function readStatus(
  cwd?: string,
  outerSignal?: AbortSignal,
  launch: LaunchOptions = readLaunch(),
  timeoutMs = 5_000,
) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = outerSignal ? AbortSignal.any([outerSignal, timeout]) : timeout;
  const { stdout, code } = await runPerch(["status"], {
    cwd, signal, executable: launch.executable,
    env: { ...process.env, ...launchEnvironment(launch), PERCH_LANG: "en" },
  });
  const version = stdout.match(/Perch CLI (\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/i)?.[1] ?? null;
  // The status line can contain an account email and app URL. Never return either.
  if (/\b(?:not signed in|signed out|sign in with|perch login)\b/i.test(stdout)) {
    // `perch status` reports "Not signed in" once the short-lived access token
    // has expired, because it never refreshes it. A local /usage run does
    // refresh it (no model call), so let that decide.
    const usage = await readPerchUsageCached(launch).catch(() => undefined);
    return { version, signedIn: usage?.status === "ok" };
  }
  if (/\bSigned in\b/i.test(stdout) && code === 0) return { version, signedIn: true };
  throw new Error("Perch did not return a recognized sign-in status.");
}
