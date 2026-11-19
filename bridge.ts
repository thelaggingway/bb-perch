import {
  createBridgeIo,
  createBridgeLineHandler,
  experimental_defineProviderBridge,
  isRecord,
  initializeParamsSchema,
  experimental_resolveExecutablePath,
  providerMaintenanceParamsSchema,
  PROVIDER_BRIDGE_PROTOCOL_VERSION,
  THREAD_DELTA_GRAMMAR_V3,
  type InitializeResult,
  type ProviderHealthResult,
  modelListParamsSchema,
  threadResumeParamsSchema,
  threadStartParamsSchema,
  turnStartParamsSchema,
  turnSteerParamsSchema,
  type BridgeExecutionOptions,
} from "@get-bb/plugin-sdk/provider-bridge";
import {
  experimental_acpProviderBridge as acp,
  experimental_registerAcpDialect,
} from "@get-bb/plugin-sdk/provider-bridge/acp";
import { modelCatalog, resolveSettings } from "./options.ts";
import { executableEnv, settingsEnv } from "./proxy.ts";
import { launchEnvironment, readDefaults, readLaunch, type LaunchOptions } from "./settings.ts";
import { installCommand, loginCommand, readStatus } from "./process.ts";
import { readPerchUsageCached } from "./usage.ts";

experimental_registerAcpDialect({
  id: "perch",
  maintenance: {
    loginCommand,
    installer: () => ({ command: "npm", args: ["install", "-g", "perchai-cli"], displayCommand: installCommand }),
    readAccount: async () => (await readStatus()).signedIn ? { email: null } : null,
    readUsage: async () => {
      const usage = await readPerchUsageCached();
      if (usage.status === "error") return { supported: true, usage: { ...usage, accountEmail: null, planLabel: null } };
      if (usage.status !== "ok") return { supported: true, usage };
      const { planLabel, windows } = usage;
      return {
        supported: true,
        usage: {
          status: "ok", accountEmail: null, planLabel,
          windows: windows.map(({ label, usedPercent, resetsAt, cost }) => ({ label, usedPercent, resetsAt, ...(cost ? { cost } : {}) })),
        },
      };
    },
  },
});

export const bridgeOptions = {
  acpDialect: "perch",
  acpLaunchSpec: { displayName: "Perch", command: "perch", args: ["acp"], env: {} },
};

const executionSchemas = {
  "thread/start": threadStartParamsSchema,
  "thread/resume": threadResumeParamsSchema,
  "turn/start": turnStartParamsSchema,
  "turn/steer": turnSteerParamsSchema,
};

const planGenerations = new Map<string, number>();

function acpOptions(
  options: BridgeExecutionOptions,
  threadId: string,
  startsTurn: boolean,
): BridgeExecutionOptions {
  const raw = isRecord(options.providerOptions?.perchSettings) ? options.providerOptions.perchSettings : {};
  const settings = resolveSettings(options, readDefaults(raw));
  const perch = readLaunch(raw);
  const planning = settings.plan || settings.selections.mode === "plan" || settings.selections.chat === "plan";
  const planGeneration = planning ? planGenerations.get(threadId) ?? 0 : undefined;
  // Perch can leave Plan after an approval. Each subsequent planning turn
  // must open in Plan again, even when all of the picker choices are unchanged.
  if (startsTurn) {
    if (planGeneration === undefined) planGenerations.delete(threadId);
    else planGenerations.set(threadId, planGeneration + 1);
  }
  // bb's generic ACP runtime rejects "auto" and automatically approves native
  // requests in "full". Leave Perch in charge of deciding when to ask.
  const launch = {
    ...bridgeOptions.acpLaunchSpec,
    command: "node",
    args: ["--input-type=module", "-e", `import { runPerchProxy } from ${JSON.stringify(import.meta.url)}; runPerchProxy();`],
  };
  return {
    ...options,
    model: settings.selections.model,
    reasoningLevel: settings.selections.effort,
    permissionMode: "accept-edits",
    permissionScope: "workspace",
    approvalReviewer: "user",
    permissionEscalation: options.permissionEscalation ?? "ask",
    envVars: {
      ...options.envVars,
      ...launchEnvironment(perch),
      [executableEnv]: perch.executable,
      [settingsEnv]: JSON.stringify({ ...settings, planGeneration }),
    },
    providerOptions: { ...options.providerOptions, ...bridgeOptions, acpLaunchSpec: launch },
  };
}

async function customExecutableHealth(launch: LaunchOptions, cwd?: string): Promise<ProviderHealthResult> {
  const installed = await experimental_resolveExecutablePath(launch.executable) !== null;
  const status = installed ? await readStatus(cwd, undefined, launch).catch(() => undefined) : undefined;
  return {
    supported: true,
    health: {
      status: !installed ? "not_installed" : !status ? "unknown" : status.signedIn ? "ready" : "unauthenticated",
      statusMessage: !installed ? "The configured Perch executable was not found." : null,
      installedVersion: status?.version ?? null,
      accountEmail: null,
      planLabel: null,
      minimumSupportedVersion: null,
      canInstall: false,
      canUpdate: false,
      loginCommand: null,
    },
  };
}

const io = createBridgeIo();

export const experimental_providerBridge = experimental_defineProviderBridge({
  ...acp,
  handleLine: createBridgeLineHandler({
    handleParsedMessage(message) {
      if (!isRecord(message) || typeof message.method !== "string"
        || (typeof message.id !== "number" && typeof message.id !== "string")) {
        acp.handleLine(JSON.stringify(message));
        return;
      }
      if (message.jsonrpc !== "2.0") {
        io.sendError(message.id, -32600, "Expected a JSON-RPC 2.0 request.");
        return;
      }
      if (message.method === "initialize") {
        if (!initializeParamsSchema.safeParse(message.params).success) {
          io.sendError(message.id, -32602, "Invalid initialize parameters.");
          return;
        }
        // The shared ACP bridge advertises tip forks unconditionally. Perch
        // only implements loadSession, which ACP negotiates for each session.
        const result: InitializeResult = {
          protocolVersion: PROVIDER_BRIDGE_PROTOCOL_VERSION,
          capabilities: {
            sessionRestore: false,
            threadArchive: false,
            threadRename: false,
            threadGoalClear: false,
            fork: "none",
            approvalEnforcedBy: "runtime",
            grammarVersions: [THREAD_DELTA_GRAMMAR_V3, THREAD_DELTA_GRAMMAR_V3],
            steerMode: "queue",
            skills: { configure: true },
            commands: { list: false },
          },
        };
        io.sendResult(message.id, result);
        return;
      }
      if (message.method === "model/list") {
        if (!modelListParamsSchema.safeParse(message.params).success) {
          io.sendError(message.id, -32602, "Invalid model/list parameters.");
          return;
        }
        io.sendResult(message.id, { models: modelCatalog, selectedOnlyModels: [] });
        return;
      }
      if (message.method === "thread/fork") {
        io.sendError(message.id, -32601, "Perch ACP does not support session forks.");
        return;
      }
      if (Object.hasOwn(executionSchemas, message.method)) {
        const method = message.method as keyof typeof executionSchemas;
        const parsed = executionSchemas[method].safeParse(message.params);
        if (!parsed.success) {
          const fields = parsed.error.issues.map((issue) => issue.path.join(".")).filter(Boolean);
          io.sendError(message.id, -32602, `Invalid ${method} parameters: ${fields.join(", ") || "params"}.`);
          return;
        }
        acp.handleLine(JSON.stringify({
          ...message,
          params: {
            ...parsed.data,
            options: acpOptions(parsed.data.options, parsed.data.threadId, method === "turn/start"),
          },
        }));
        return;
      }
      if ((message.method === "thread/stop" || message.method === "thread/discard")
        && isRecord(message.params) && typeof message.params.threadId === "string"
        && (message.method === "thread/discard" || message.params.intent === "release")) {
        planGenerations.delete(message.params.threadId);
      }
      if (message.method.startsWith("provider/")) {
        const params = isRecord(message.params) ? message.params : {};
        const raw = isRecord(params.providerOptions) && isRecord(params.providerOptions.perchMaintenance)
          ? params.providerOptions.perchMaintenance : {};
        const launch = readLaunch(raw);
        const command = launch.executable;
        if (message.method === "provider/health" && command !== "perch") {
          const parsed = providerMaintenanceParamsSchema.safeParse(params);
          if (!parsed.success) {
            io.sendError(message.id, -32602, "Invalid provider health parameters.");
            return;
          }
          const id = message.id;
          void customExecutableHealth(launch, parsed.data.cwd).then(
            (result) => io.sendResult(id, result),
            () => io.sendError(id, -32603, "Could not check the configured Perch executable."),
          );
          return;
        }
        const providerOptions = command === "perch" ? bridgeOptions : {
          acpDialect: "acp",
          acpLaunchSpec: { ...bridgeOptions.acpLaunchSpec, command },
        };
        acp.handleLine(JSON.stringify({ ...message, params: { ...params, providerOptions } }));
        return;
      }
      acp.handleLine(JSON.stringify(message));
    },
  }),
});

// The bundled host and source-mode tests both launch this module as an ACP child.
export { runPerchProxy } from "./proxy.ts";
