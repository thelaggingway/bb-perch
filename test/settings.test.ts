import { expect, test } from "vitest";
import { configured, modelCatalog, perchConfiguration, resolveSettings } from "../options.ts";
import { launchEnvironment, readDefaults, readLaunch, settingsDescriptors } from "../settings.ts";
import { buildRunArgs } from "../host-commands.ts";

test("catalog defaults leave model, effort and options under plugin control", () => {
  const model = modelCatalog.find((entry) => entry.isDefault)!;
  expect(model.id).toBe(configured);
  expect(model.defaultReasoningEffort).toBe(configured);
  expect(model.sessionOptions?.every((option) => option.value === configured)).toBe(true);
  const defaults = readDefaults({
    defaultModel: "gemini-4-hydrogen", defaultEffort: "none", defaultPersona: "quill",
    defaultPermission: "auto_review", defaultChat: "ask", defaultLocalTools: "off",
    defaultSubagent: "glm-5.3-flash", defaultOrchestration: "on",
  });
  const configuredTurn = perchConfiguration(resolveSettings({
    model: configured, reasoningLevel: configured,
    sessionOptions: { persona: configured },
  }, defaults));
  expect(configuredTurn.file).toMatchObject({
    manualModelOptionId: "gemini-gemini-4-hydrogen", personaId: "quill",
    permissionMode: "auto_review", chatMode: "ask", cliLocalTools: false,
    subagentModelOptionId: "openrouter-z-ai-glm-5-3-flash-crusoe-pro",
    effort: { level: "off", orchestration: true },
  });
  expect(configuredTurn.configOptions.find(({ id }) => id === "persona")?.currentValue).toBe(configured);
  const override = perchConfiguration(resolveSettings({
    model: "standard", reasoningLevel: "high", promptMode: "plan",
    sessionOptions: { persona: "saffron", localTools: "on" },
  }, defaults));
  expect(override.file).toMatchObject({
    manualModelOptionId: null, personaId: "saffron", cliLocalTools: true,
    permissionMode: "plan", chatMode: "plan", effort: { level: "high" },
  });
});

test("one-shot defaults translate to native flags and explicit flags take precedence", () => {
  const defaults = readDefaults({
    defaultModel: "standard-max", defaultEffort: "none", defaultPermission: "auto_review",
    defaultChat: "ask", defaultPersona: "quill", defaultLocalTools: "off",
  });
  expect(buildRunArgs({ kind: "run", task: "hi", model: "pro", persona: "saffron" }, "cli-1", defaults))
    .toEqual(["run", "-", "--json", "--thread", "cli-1", "--model", "pro", "--effort", "off",
      "--permission", "auto_review", "--mode", "ask", "--persona", "saffron", "--no-local-tools"]);
  expect(buildRunArgs({ kind: "run", task: "hi", localTools: "on" }, "cli-1", defaults))
    .toEqual(["run", "-", "--json", "--thread", "cli-1", "--model", "standard 1m", "--effort", "off",
      "--permission", "auto_review", "--mode", "ask", "--persona", "quill"]);
});

test("launch options use verified Perch environment values", () => {
  expect(launchEnvironment(readLaunch({}))).toEqual({});
  expect(launchEnvironment(readLaunch({
    gitAttribution: "off", cliHistory: "off", language: "ja", executable: "/opt/perch",
  }))).toEqual({ PERCH_GIT_ATTRIBUTION: "off", PERCH_CLI_HISTORY: "0", PERCH_LANG: "ja" });
  expect(readLaunch({ executable: "./perch" }).executable).toBe("perch");
});

test("native catalog diagnostics are parsed without copying unrelated output", async () => {
  const { catalogFromUsageError } = await import("../catalog.ts");
  expect(catalogFromUsageError(
    "Unknown model: __bb_catalog_probe__. Try a tier (standard, standard 1m, pro, pro 1m), auto, or a named model (glm-5.3-flash, gemini-4-hydrogen).\n\nPerch CLI",
  )).toEqual(["glm-5.3-flash", "gemini-4-hydrogen"]);
  expect(catalogFromUsageError("Unknown model: another. Try a named model (unexpected).")).toBeUndefined();
});

test("account actions use fixed terminal argv and keep credentials out of settings", async () => {
  const { terminalSpec } = await import("../terminals.ts");
  const launch = readLaunch({ executable: "/opt/Perch CLI/perch", cliHistory: "off" });
  expect(terminalSpec("byokStatus", launch, false).start.argv?.slice(4))
    .toEqual(["/opt/Perch CLI/perch", '{"PERCH_CLI_HISTORY":"0"}', "byok", "status"]);
  expect(terminalSpec("update", readLaunch(), false).start.argv?.at(-1)).toBe("update");
  expect(terminalSpec("shell", launch, false).start).toEqual({ mode: "shell" });
});

type Field = { type: string; experimental_schema?: { safeParse(value: string): { success: boolean } } };
const fields = settingsDescriptors as unknown as Record<string, Field>;

test("long model lists are validated text settings, not bb dropdowns", () => {
  for (const key of ["defaultModel", "defaultSubagent"]) {
    expect(fields[key]!.type).toBe("string");
    expect(fields[key]!.experimental_schema!.safeParse("glm-5.3-flash").success).toBe(true);
    expect(fields[key]!.experimental_schema!.safeParse("not-a-model").success).toBe(false);
  }
  expect(fields.defaultModel!.experimental_schema!.safeParse("pro-max").success).toBe(true);
  expect(fields.defaultSubagent!.experimental_schema!.safeParse("pro-max").success).toBe(false);
  expect(fields.defaultEffort!.type).toBe("select");
});
