import { experimental_killPortableProcess, experimental_spawnPortableProcess } from "@get-bb/plugin-sdk/provider-bridge";

export const installCommand = "npm install -g perchai-cli";
export const loginCommand = "perch login";

export function runPerch(
  args: string[],
  { cwd, input, signal, env }: { cwd?: string; input?: string; signal: AbortSignal; env?: NodeJS.ProcessEnv },
): Promise<{ code: number; stdout: string }> {
  signal.throwIfAborted();
  const child = experimental_spawnPortableProcess({
    command: "perch", args,
    cwd,
    env,
    stdio: ["pipe", "pipe", "ignore"],
  });
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    const abort = () => {
      stop();
      reject(signal.reason);
    };
    const stop = () => {
      experimental_killPortableProcess(child, "SIGKILL");
    };
    signal.addEventListener("abort", abort, { once: true });
    child.stdout!.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 16 * 1024 * 1024) {
        stop();
        reject(new Error("Perch exceeded the 16 MiB output limit."));
        return;
      }
      chunks.push(chunk);
    });
    child.stdin!.on("error", () => {});
    child.stdin!.end(input);
    child.once("error", (error: NodeJS.ErrnoException) => {
      signal.removeEventListener("abort", abort);
      reject(error.code === "ENOENT"
        ? new Error(`Perch is missing from PATH. Run ${installCommand} on this machine.`)
        : new Error("Could not launch Perch."));
    });
    child.once("close", (code) => {
      signal.removeEventListener("abort", abort);
      resolve({ code: code ?? 1, stdout: Buffer.concat(chunks).toString("utf8") });
    });
  });
}

export async function readStatus(cwd?: string, outerSignal?: AbortSignal) {
  const timeout = AbortSignal.timeout(5_000);
  const signal = outerSignal ? AbortSignal.any([outerSignal, timeout]) : timeout;
  const { stdout, code } = await runPerch(["status"], {
    cwd, signal, env: { ...process.env, PERCH_LANG: "en" },
  });
  const version = stdout.match(/Perch CLI (\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/i)?.[1] ?? null;
  // The status line can contain an account email and app URL. Never return either.
  if (/\b(?:not signed in|signed out|sign in with|perch login)\b/i.test(stdout)) {
    return { version, signedIn: false };
  }
  if (/\bSigned in\b/i.test(stdout) && code === 0) return { version, signedIn: true };
  throw new Error("Perch did not return a recognized sign-in status.");
}
