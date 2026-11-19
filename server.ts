import { cliCommand, defineCli, PluginCliError, type BbPluginApi, type PluginCliContext } from "@get-bb/plugin-sdk";
import { hostContract, settingsContract, type PerchCommand, type TerminalAction } from "./contract.ts";
import { chatModes, configured, efforts, modelCatalog, permissions, personas, reasoning } from "./options.ts";
import { readLaunch, settingsDescriptors } from "./settings.ts";
import { terminalSpec } from "./terminals.ts";

const providerId = "perch";
const targetOptions = {
  host: { type: "string", description: "Execution machine ID or name" },
  cwd: { type: "string", description: "Absolute working directory on the execution machine" },
} as const;

export default async function perchPlugin(bb: BbPluginApi) {
  const settings = bb.settings.define(settingsDescriptors);
  const initialLaunch = readLaunch(await settings.get());
  bb.providers.register({
    id: providerId,
    displayName: "Perch",
    icon: "Bird",
    experimental_bridgeOptions: { perchMaintenance: initialLaunch },
    deriveProviderOptions: ({ settings }) => {
      // Only declared, non-secret values are forwarded. BB supplies a fresh
      // settings snapshot for each turn and excludes secret settings.
      return {
        perchSettings: Object.fromEntries(
          Object.entries(settings).filter(([key, value]) => Object.hasOwn(settingsDescriptors, key) && typeof value === "string"),
        ) as Record<string, string>,
      };
    },
    strings: {
      signInHint: "Run bb perch login on the execution machine.",
      expiredHint: "Run bb perch login on the execution machine.",
      installUrl: "https://www.perchai.app/docs/using-perch/cli",
      planModeCopy: "Perch starts in read-only planning mode.",
    },
    maintenance: { health: true, installation: true },
    capabilities: {
      supportsServiceTier: false,
      supportsNativeUserQuestion: false,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      supportsManualCompaction: false,
      fork: "none",
      permissionModes: ["accept-edits", "auto", "full"],
      reasoningLevels: reasoning.map(([id]) => id),
    },
    reasoningLevels: [{ id: configured, label: "Plugin default" }, ...reasoning.map(([id, label]) => ({ id, label }))],
    composerActions: ["plan"],
    models: {
      fallback: modelCatalog.slice(0, 5),
      scope: "host",
    },
    experimental_nativeSkillRoots: {
      user: [".perch/skills", ".agents/skills"],
      project: [".perch/skills", ".agents/skills"],
    },
  });

  const worker = bb.hosts.experimental_client({ contract: hostContract });
  async function target(ctx: PluginCliContext, host?: string) {
    if (host) {
      const hosts = await bb.sdk.hosts.list();
      const byId = hosts.find((candidate) => candidate.id === host);
      if (byId) return { hostId: byId.id };
      const byName = hosts.filter((candidate) => candidate.name === host);
      if (byName.length === 1) return { hostId: byName[0].id };
      throw new PluginCliError("Choose an enrolled machine by its exact ID.", { code: "invalid_value" });
    }
    if (ctx.threadId) {
      const thread = await bb.sdk.threads.get({ threadId: ctx.threadId, signal: ctx.signal });
      if (thread.environmentId) {
        const environment = await bb.sdk.environments.get({ environmentId: thread.environmentId, signal: ctx.signal });
        return { hostId: environment.hostId, environmentId: environment.id };
      }
    }
    const { primaryHostId } = await bb.sdk.system.config();
    if (primaryHostId) return { hostId: primaryHostId };
    throw new PluginCliError("Choose an enrolled machine with --host.", { code: "missing_required" });
  }

  async function execute(command: PerchCommand, ctx: PluginCliContext, host?: string) {
    const { hostId } = await target(ctx, host);
    return worker.call("command", { ...command, runtimeSettings: await settings.get() }, {
      hostId,
      signal: ctx.signal,
      timeoutMs: command.kind === "run" ? 15 * 60_000 : 30_000,
    });
  }

  async function openTerminal(action: TerminalAction, ctx: PluginCliContext, host?: string, cwd?: string) {
    const { hostId, environmentId } = await target(ctx, host);
    const platform = await worker.call("platform", null, { hostId, signal: ctx.signal });
    const launch = readLaunch(await settings.get());
    const terminal = await bb.sdk.terminals.create({
      rows: 30,
      cols: 100,
      scope: environmentId && !cwd
        ? { kind: "environment", environmentId }
        : { kind: "host_path", hostId, cwd: cwd ?? (host ? null : ctx.cwd ?? null) },
      ...terminalSpec(action, launch, platform === "win32"),
    });
    return { terminalId: terminal.id };
  }

  bb.rpc.register(settingsContract, {
    async accountStatus() {
      const { hostId } = await target({});
      const machine = await bb.sdk.hosts.get({ hostId });
      const result = await execute({ kind: "status" }, {}, hostId);
      if (!result.stdout || result.exitCode !== 0) throw new Error("Perch status is unavailable.");
      const { version, signedIn } = JSON.parse(result.stdout);
      return { machine: machine.name, version, signedIn };
    },
    openTerminal: ({ action }) => openTerminal(action, {}),
  });

  settings.onChange((next, previous) => {
    if (next.executable !== previous.executable) bb.rpc.experimental_invalidate(["perch-account"]);
  });

  bb.cli.register(defineCli({
    name: providerId,
    summary: "Run a Perch task, check sign-in, browse skills, or open a login terminal",
    commands: {
      run: cliCommand({
        summary: "Run one Perch turn and return bounded JSON",
        positionals: [{ name: "task", description: "Task to send", required: true }],
        options: {
          ...targetOptions,
          thread: { type: "string", description: "Continue a Perch thread ID" },
          model: { type: "string", description: "Roost tier or exact Perch model name" },
          effort: { type: "enum", values: efforts, description: "Perch thinking level" },
          permission: { type: "enum", values: permissions, description: "Perch permission mode" },
          mode: { type: "enum", values: chatModes, description: "Perch chat mode" },
          persona: { type: "enum", values: personas, description: "Perch persona" },
          "local-tools": { type: "enum", values: ["on", "off"], description: "Enable or disable Perch local tools" },
          skill: { type: "string", repeatable: true, description: "Load a Perch skill ID" },
          attach: { type: "string", repeatable: true, description: "Attach a file on the execution machine" },
        },
        run: ({ positionals, options: { host, cwd, "local-tools": localTools, ...options } }, ctx) =>
          execute({ kind: "run", task: positionals.task, cwd: cwd ?? (host ? undefined : ctx.cwd), localTools, ...options }, ctx, host),
      }),
      status: cliCommand({
        summary: "Check Perch version and sign-in on the execution machine",
        options: targetOptions,
        run: ({ options: { host, cwd } }, ctx) =>
          execute({ kind: "status", cwd: cwd ?? (host ? undefined : ctx.cwd) }, ctx, host),
      }),
      skills: cliCommand({
        summary: "List Perch skills or show one skill",
        positionals: [{ name: "name", description: "Skill ID" }],
        options: targetOptions,
        run: ({ positionals, options: { host, cwd } }, ctx) =>
          execute({ kind: "skills", name: positionals.name, cwd: cwd ?? (host ? undefined : ctx.cwd) }, ctx, host),
      }),
      catalog: cliCommand({
        summary: "Report named models advertised by the installed CLI and the bb ACP snapshot",
        options: targetOptions,
        run: ({ options: { host, cwd } }, ctx) =>
          execute({ kind: "catalog", cwd: cwd ?? (host ? undefined : ctx.cwd) }, ctx, host),
      }),
      login: cliCommand({
        summary: "Open perch login in a bb terminal",
        options: targetOptions,
        async run({ options: { host, cwd } }, ctx) {
          return { exitCode: 0, stdout: JSON.stringify(await openTerminal("login", ctx, host, cwd)) };
        },
      }),
    },
  }));
}
