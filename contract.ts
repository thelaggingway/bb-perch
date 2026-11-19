import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { chatModes, efforts, permissions, personas } from "./options.ts";

const value = z.string().trim().min(1).max(4096).refine((value) => !value.startsWith("-"));
const path = z.string().min(1).max(16_384);
const command = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("status"), cwd: path.optional() }),
  z.object({ kind: z.literal("catalog"), cwd: path.optional() }),
  z.object({ kind: z.literal("usage"), cwd: path.optional() }),
  z.object({ kind: z.literal("skills"), cwd: path.optional(), name: value.optional() }),
  z.object({
    kind: z.literal("run"), cwd: path.optional(),
    task: z.string().min(1).max(128_000),
    thread: value.optional(),
    model: value.optional(),
    effort: z.enum(efforts).optional(),
    permission: z.enum(permissions).optional(),
    mode: z.enum(chatModes).optional(),
    persona: z.enum(personas).optional(),
    localTools: z.enum(["on", "off"]).optional(),
    skill: z.array(value).max(32).optional(),
    attach: z.array(path).max(32).optional(),
  }),
]).and(z.object({ runtimeSettings: z.record(z.string(), z.unknown()).optional() }));

export const hostContract = defineRpcContract({
  platform: { input: z.null(), output: z.string() },
  command: {
    input: command,
    output: z.object({
      exitCode: z.number().int(),
      stdout: z.string().optional(),
      stderr: z.string().optional(),
    }),
  },
});

export type PerchCommand = z.infer<typeof command>;

const terminalActions = ["login", "update", "interactive", "byokList", "byokStatus", "byolmStatus", "subList", "shell"] as const;
export type TerminalAction = typeof terminalActions[number];

export const settingsContract = defineRpcContract({
  accountStatus: {
    input: z.null(),
    tags: () => ["perch-account"],
    output: z.object({ machine: z.string(), version: z.string().nullable(), signedIn: z.boolean() }),
  },
  accountUsage: {
    input: z.null(),
    tags: () => ["perch-account"],
    output: z.discriminatedUnion("status", [
      z.object({
        status: z.literal("ok"),
        planLabel: z.string().nullable(),
        activity: z.string().nullable(),
        windows: z.array(z.object({
          label: z.string(),
          usedPercent: z.number(),
          resetsAt: z.string().nullable(),
          cost: z.object({ usedUsdCents: z.number(), limitUsdCents: z.number() }).optional(),
          detail: z.string().optional(),
        })),
      }),
      z.object({ status: z.literal("unauthenticated") }),
      z.object({ status: z.literal("not_installed") }),
      z.object({ status: z.literal("error"), message: z.string() }),
    ]),
  },
  setDefaultModels: {
    input: z.object({ model: z.string().max(200).optional(), subagent: z.string().max(200).optional() }).strict(),
    output: z.object({ model: z.string(), subagent: z.string() }),
  },
  openTerminal: {
    input: z.object({ action: z.enum(terminalActions) }).strict(),
    output: z.object({ terminalId: z.string() }),
  },
});

// bb's built-in "Provider usage" plugin discovers sources that implement these
// two methods. The shapes mirror the contract the built-in providers register
// in bb 0.49; the plugin SDK does not export it yet.
const usageCommon = { accountEmail: z.string().nullable(), planLabel: z.string().nullable() };
const usageState = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"), ...usageCommon,
    windows: z.array(z.object({
      kind: z.enum(["five-hour", "daily", "weekly", "custom"]),
      id: z.string().min(1),
      label: z.string().min(1),
      usedPercent: z.number().nonnegative(),
      resetsAt: z.string().nullable(),
      model: z.string().nullable(),
      cost: z.object({ usedUsdCents: z.number().nonnegative(), limitUsdCents: z.number().positive() }).nullable(),
    })),
  }),
  z.object({ status: z.literal("not_installed"), ...usageCommon }),
  z.object({ status: z.literal("unauthenticated"), ...usageCommon }),
  z.object({ status: z.literal("expired"), ...usageCommon }),
  z.object({ status: z.literal("error"), ...usageCommon, message: z.string() }),
]);
export const usageSourceContract = defineRpcContract({
  "provider-usage.v1.listResources": {
    input: z.object({}),
    output: z.object({
      label: z.string().min(1).optional(),
      resources: z.array(z.object({
        accountKey: z.string().min(1).nullable(),
        id: z.string().min(1),
        providerId: z.string().min(1),
        label: z.string().min(1),
        scope: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("shared") }),
          z.object({ kind: z.literal("host"), hostId: z.string().min(1), hostName: z.string().min(1) }),
        ]),
      })),
    }),
  },
  "provider-usage.v1.getResource": {
    input: z.object({ resourceId: z.string().min(1), refresh: z.boolean() }),
    output: z.object({
      accountKey: z.string().min(1).nullable(),
      observedAt: z.number().int().nonnegative().nullable(),
      usage: usageState,
    }),
  },
});
