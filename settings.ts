import { z } from "zod";
import { defaults, selections, type Options } from "./options.ts";

export const keys = {
  model: "defaultModel",
  effort: "defaultEffort",
  mode: "defaultPermission",
  chat: "defaultChat",
  persona: "defaultPersona",
  subagent: "defaultSubagent",
  localTools: "defaultLocalTools",
  orchestration: "defaultOrchestration",
} as const;

const descriptions: Partial<Record<keyof Options, string>> = {
  subagent: "Applies to ACP threads.",
  orchestration: "Applies to ACP threads.",
  mode: "Inherit follows the bb permission picker in threads and uses Default for one-shot runs.",
};

const locales = {
  inherit: "Use machine locale",
  en: "English",
  es: "Español",
  th: "ไทย",
  id: "Bahasa Indonesia",
  vi: "Tiếng Việt",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  ja: "日本語",
};

function select(label: string, values: Record<string, string>, defaultValue: string, description?: string) {
  return {
    type: "select" as const, label, options: Object.keys(values),
    experimental_optionLabels: values, default: defaultValue, description,
  };
}

const switchLabels = { inherit: "Use machine setting", off: "Off" };
const executable = z.string().max(4096).refine(
  (value) => value === "perch" || (/^(?:\/|[a-z]:[\\/]|\\\\)/i.test(value) && !/[\r\n\0]/.test(value)),
  "Enter perch or an absolute executable path.",
);

// bb's settings dropdown cannot scroll, so the two model lists (about 50
// entries each) are plain validated text fields here. The Perch account
// section renders scrollable pickers that write the same settings.
export const longLists = new Set<keyof Options>(["model", "subagent"]);

function modelField(id: keyof Options, label: string, values: string[]) {
  const allowed = new Set(values);
  return {
    type: "string" as const, label, default: defaults[id],
    description: `${descriptions[id] ? `${descriptions[id]} ` : ""}Pick it in the Perch account section, or enter a model ID such as claude-haiku-5.5.`,
    experimental_schema: z.string().refine((value) => allowed.has(value), "Enter a model ID from the Perch account picker."),
  };
}

export const settingsDescriptors = {
  ...Object.fromEntries(selections.map(({ id, name, options }) => {
    const label = id === "mode" ? "Default Perch permission" : `Default ${name.toLowerCase()}`;
    return [keys[id], longLists.has(id)
      ? modelField(id, label, options.map(({ value }) => value))
      : select(label, Object.fromEntries(options.map(({ value, name }) => [value, name])), defaults[id], descriptions[id])];
  })),
  executable: {
    type: "string" as const, label: "Perch executable", default: "perch",
    description: "Use perch from PATH or an absolute path on the execution machine.",
    experimental_schema: executable,
  },
  gitAttribution: select("Git attribution", switchLabels, "inherit", "Off disables Perch attribution on commits."),
  cliHistory: select("Terminal prompt history", switchLabels, "inherit", "Off disables interactive prompt recall and saving."),
  language: select("CLI language", locales, "inherit", "Language for Perch’s CLI interface."),
};

export function readDefaults(values: Record<string, unknown> = {}): Options {
  const options: Options = { ...defaults };
  for (const { id, options: choices } of selections) {
    const value = values[keys[id]];
    if (typeof value === "string" && choices.some((choice) => choice.value === value)) {
      options[id] = value;
    }
  }
  return options;
}

export function readLaunch(values: Record<string, unknown> = {}) {
  const binary = executable.safeParse(values.executable);
  return {
    executable: binary.success ? binary.data : "perch",
    gitAttribution: values.gitAttribution === "off" ? "off" : "inherit",
    cliHistory: values.cliHistory === "off" ? "off" : "inherit",
    language: typeof values.language === "string" && Object.hasOwn(locales, values.language)
      ? values.language : "inherit",
  };
}

export type LaunchOptions = ReturnType<typeof readLaunch>;

export function launchEnvironment(options: LaunchOptions): Record<string, string> {
  return {
    ...(options.gitAttribution === "off" ? { PERCH_GIT_ATTRIBUTION: "off" } : {}),
    ...(options.cliHistory === "off" ? { PERCH_CLI_HISTORY: "0" } : {}),
    ...(options.language !== "inherit" ? { PERCH_LANG: options.language } : {}),
  };
}
