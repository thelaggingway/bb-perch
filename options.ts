import type { AvailableModel } from "@get-bb/plugin-sdk/provider-bridge";
import { z } from "zod";
import { exactModels } from "./exact-models.ts";

const roost = [
  ["standard", "Roost Standard"],
  ["standard-max", "Roost Standard 1M"],
  ["pro", "Roost Pro"],
  ["pro-max", "Roost Pro 1M"],
] as const;

const exact = new Map<string, (typeof exactModels)[number]>(
  exactModels.map((model) => [model[0], model]),
);
const modelNames = [...roost.map(([id, label]) => ({ value: id, name: label })),
  ...exactModels.map(([id, label]) => ({ value: id, name: label }))];

export const reasoning = [
  ["none", "Off"],
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
  ["xhigh", "Extra high"],
  ["max", "Max"],
  ["ultra", "Ultra"],
] as const;
export const efforts = ["off", "low", "medium", "high", "xhigh", "max", "ultra"] as const;
export const permissions = ["default", "auto_review", "take_the_wheel", "plan"] as const;
export const chatModes = ["ask", "agents", "plan"] as const;
export const personas = ["saffron", "quill"] as const;

const defaults = {
  model: "standard",
  effort: "high",
  mode: "inherit",
  chat: "agents",
  persona: "saffron",
  subagent: "inherit",
  localTools: "on",
  orchestration: "off",
} as const;

const names = (values: readonly string[]) =>
  values.map((value) => ({ value, name: value[0].toUpperCase() + value.slice(1) }));

const selections = [
  { id: "model", name: "Model", category: "model", options: modelNames },
  { id: "effort", name: "Effort", category: "thought_level", options: reasoning.map(([value, name]) => ({ value, name })) },
  { id: "mode", name: "Perch permission", options: [
    { value: "inherit", name: "Use bb permission" },
    { value: "default", name: "Default" },
    { value: "auto_review", name: "Auto Review" },
    { value: "take_the_wheel", name: "Take the Wheel" },
    { value: "plan", name: "Plan (read-only)" },
  ] },
  { id: "chat", name: "Chat mode", options: names(chatModes) },
  { id: "persona", name: "Persona", options: names(personas) },
  { id: "subagent", name: "Sub-agent model", options: [
    { value: "inherit", name: "Inherit main model" },
    ...modelNames.filter(({ value }) => exact.has(value)),
  ] },
  { id: "localTools", name: "Local tools", options: names(["on", "off"]) },
  { id: "orchestration", name: "Orchestration effort", options: names(["off", "on"]) },
] as const;

type OptionId = keyof typeof defaults;
type Options = Record<OptionId, string>;
const runOptions = z.object({
  selections: z.record(z.string(), z.string()),
  permission: z.enum(permissions),
  plan: z.boolean(),
});

export function resolveSettings(input: {
  model?: string;
  reasoningLevel?: string;
  permissionMode?: string;
  promptMode?: string;
  sessionOptions?: Record<string, unknown>;
}) {
  const requested = { ...input.sessionOptions, model: input.model, effort: input.reasoningLevel };
  const settings: Options = { ...defaults };
  for (const { id, options } of selections) {
    const selection = (requested as Record<string, unknown>)[id];
    if (options.some((option) => option.value === selection)) settings[id] = selection as string;
  }
  const permission = input.permissionMode === "full" ? "take_the_wheel"
    : input.permissionMode === "auto" ? "auto_review" : "default";
  return { selections: settings, permission, plan: input.promptMode === "plan" };
}

export function perchConfiguration(input: unknown) {
  const { selections: requested, permission, plan } = runOptions.parse(input);
  const options = { ...defaults, ...requested } as Options;
  const effort = options.effort === "none" ? "off" : options.effort;
  return {
    file: {
      version: 1,
      roostChoice: exact.has(options.model) ? "standard" : options.model.replace(/-/g, "_"),
      manualModelOptionId: exact.get(options.model)?.[2] ?? null,
      subagentModelOptionId: exact.get(options.subagent)?.[2] ?? null,
      effort: { level: effort, orchestration: options.orchestration === "on" },
      permissionMode: plan ? "plan" : options.mode === "inherit" ? permission : options.mode,
      chatMode: plan ? "plan" : options.chat,
      personaId: options.persona,
      cliLocalTools: options.localTools === "on",
    },
    configOptions: selections.map(({ options: values, ...option }) => ({
      ...option, type: "select", currentValue: options[option.id], options: values,
    })),
  };
}

const sessionOptions = selections.filter((option) => !("category" in option))
  .map(({ id, name, options }) => ({
    id, label: name, type: "select" as const, value: defaults[id],
    values: options.map(({ value, name }) => ({ id: value, label: name })),
  }));

export const modelCatalog: AvailableModel[] = modelNames.map(({ value, name }) => ({
  id: value,
  model: value,
  isDefault: value === "standard",
  displayName: name,
  description: exact.has(value) ? `Perch ${exact.get(value)![3]} catalog` : "Perch Roost routing",
  reasoningDiscovery: "known" as const,
  supportedReasoningEfforts: reasoning.map(([reasoningEffort, label]) => ({
    reasoningEffort, label, description: label,
  })),
  defaultReasoningEffort: "high",
  sessionOptions,
}));
