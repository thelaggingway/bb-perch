import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { chatModes, efforts, permissions, personas } from "./options.ts";

const value = z.string().trim().min(1).max(4096).refine((value) => !value.startsWith("-"));
const path = z.string().min(1).max(16_384);
const command = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("status"), cwd: path.optional() }),
  z.object({ kind: z.literal("catalog"), cwd: path.optional() }),
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
  setDefaultModels: {
    input: z.object({ model: z.string().max(200).optional(), subagent: z.string().max(200).optional() }).strict(),
    output: z.object({ model: z.string(), subagent: z.string() }),
  },
  openTerminal: {
    input: z.object({ action: z.enum(terminalActions) }).strict(),
    output: z.object({ terminalId: z.string() }),
  },
});
