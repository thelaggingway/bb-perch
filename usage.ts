import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPerch } from "./process.ts";
import { launchEnvironment, readLaunch, type LaunchOptions } from "./settings.ts";

export type UsageWindow = {
  label: string;
  usedPercent: number;
  resetsAt: string | null;
  cost?: { usedUsdCents: number; limitUsdCents: number };
  detail?: string;
};

export type PerchUsage =
  | { status: "ok"; planLabel: string | null; windows: UsageWindow[]; activity: string | null }
  | { status: "unauthenticated" }
  | { status: "not_installed" }
  | { status: "error"; message: string };

const number = (text: string) => Number(text.replace(/,/g, ""));
// Perch prices Perch Tokens at 1,000 PT per US dollar ("75,000 PT (up to $75 ...)").
const ptToCents = (pt: number) => Math.round(pt / 10);

function resetsAt(text: string, now: number) {
  const match = text.match(/resets in ((?:\d+\s*[dhm]\s*)+)/i);
  if (!match) return null;
  let ms = 0;
  for (const [, amount, unit] of match[1].matchAll(/(\d+)\s*([dhm])/gi)) {
    ms += Number(amount) * { d: 86_400_000, h: 3_600_000, m: 60_000 }[unit.toLowerCase() as "d" | "h" | "m"];
  }
  return new Date(now + ms).toISOString();
}

/**
 * Parses the text of Perch's `/usage` command. Section rows (Roost, Manual,
 * Month) are followed by indented rolling windows such as 5h and Weekly,
 * which are labelled with their section.
 */
export function parseUsage(text: string, now = Date.now()): Extract<PerchUsage, { status: "ok" }> {
  const lines = text.split("\n").map((line) => line.replace(/^\s*-\s*/, "").trim());
  const planLabel = lines.find((line) => line.startsWith("Plan:"))?.match(/^Plan:\s*([^·]+)/)?.[1].trim() ?? null;
  const activity = lines.find((line) => /^Activity\s/.test(line))?.replace(/^Activity\s+/, "") ?? null;
  const windows: UsageWindow[] = [];
  let section = "";
  for (const line of lines) {
    if (line.startsWith("Usage this session")) break;
    const row = line.match(/^(\S+)\s{2,}(.*)$/);
    if (!row || row[1] === "Plan:" || row[1] === "Activity") continue;
    const [, name, rest] = row;
    const body = rest.replace(/[█░]+/g, "").trim();
    const rolling = /^\d+[hd]$|^weekly$|^daily$|^monthly$/i.test(name);
    if (!rolling) section = name;
    const label = rolling && section ? `${section} · ${name}` : name;

    const pair = body.match(/([\d,]+)\s*PT\s*\/\s*([\d,]+)\s*PT/);
    const left = body.match(/([\d,]+)\s*of\s*([\d,]+)\s*PT left/);
    const percent = body.match(/(\d+(?:\.\d+)?)%/);
    let used: number | undefined;
    let limit: number | undefined;
    if (pair) [used, limit] = [number(pair[1]), number(pair[2])];
    else if (left) [used, limit] = [number(left[2]) - number(left[1]), number(left[2])];
    const usedPercent = percent ? Number(percent[1]) : used !== undefined && limit ? (used / limit) * 100 : undefined;
    // Rows without a percentage (such as "Roost  Unlimited monthly") have no meter.
    if (usedPercent === undefined) continue;
    windows.push({
      label,
      usedPercent: Math.min(100, Math.max(0, Math.round(usedPercent * 10) / 10)),
      resetsAt: resetsAt(body, now),
      // Only "used / limit" rows are paid allowance; bonus pools are promotional PT.
      ...(pair && used !== undefined && limit ? { cost: { usedUsdCents: ptToCents(used), limitUsdCents: ptToCents(limit) } } : {}),
      detail: body.replace(/\s*·\s*/g, " · ").slice(0, 200),
    });
  }
  return { status: "ok", planLabel, windows, activity };
}

/**
 * Runs Perch's own `/usage` command. It is answered locally from the account
 * meter and makes no model call. The plugin never reads Perch's credentials.
 * A dedicated folder keeps these runs out of project folders and chats.
 */
export async function readPerchUsage(launch: LaunchOptions = readLaunch(), signal?: AbortSignal): Promise<PerchUsage> {
  const cwd = join(tmpdir(), "bb-perch-usage");
  mkdirSync(cwd, { recursive: true, mode: 0o700 });
  const timeout = AbortSignal.timeout(20_000);
  let result;
  try {
    result = await runPerch(["run", "/usage", "--json"], {
      cwd,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      executable: launch.executable,
      env: {
        ...process.env, ...launchEnvironment(launch), PERCH_LANG: "en",
        // The perch launcher re-runs itself in a child process unless the heap
        // limit is already raised. Raising it here keeps one process, so
        // stopping it below cannot leave an orphan behind.
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --max-old-space-size=4096`.trim(),
      },
      // Perch prints the answer within a second but keeps running for about
      // 20 seconds afterwards, so stop it once the JSON is complete.
      doneWhen: (stdout) => {
        try {
          return typeof JSON.parse(stdout) === "object";
        } catch {
          return false;
        }
      },
    });
  } catch (error) {
    if (error instanceof Error && /missing from PATH|not found/.test(error.message)) return { status: "not_installed" };
    return { status: "error", message: "Perch did not answer the usage request." };
  }
  let payload: { ok?: unknown; assistantText?: unknown } | undefined;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    // Not JSON: usually a sign-in prompt.
  }
  const text = typeof payload?.assistantText === "string" ? payload.assistantText : "";
  if (!text.includes("Perch Tokens")) {
    if (/sign in|perch login|not signed/i.test(text + result.stdout)) return { status: "unauthenticated" };
    return { status: "error", message: "Perch returned no usage data." };
  }
  return parseUsage(text);
}

let cached: { at: number; value: Promise<PerchUsage> } | undefined;

/** Shares one Perch run between callers for 60 seconds. */
export function readPerchUsageCached(launch?: LaunchOptions) {
  const now = Date.now();
  if (!cached || now - cached.at > 60_000) {
    const entry = { at: now, value: readPerchUsage(launch) };
    cached = entry;
    // Retry failures on the next call instead of holding them for a minute.
    void entry.value.then((value) => { if (value.status !== "ok" && cached === entry) cached = undefined; });
  }
  return cached.value;
}
