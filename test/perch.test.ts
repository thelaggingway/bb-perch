import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, test, vi } from "vitest";
import {
  experimental_createBridgeJsonRpcTestHarness as createHarness,
  experimental_runBridgeConformance as runConformance,
  experimental_formatConformanceReport as formatReport,
  type BridgeJsonRpcObject,
} from "@get-bb/plugin-sdk/provider-bridge/testing";
import { experimental_providerBridge as bridge } from "../bridge.ts";
import { executeCommand } from "../host-commands.ts";
import { modelCatalog, perchConfiguration, resolveSettings } from "../options.ts";

const workspace = mkdtempSync(join(tmpdir(), "fake-bb-perch-"));
const originalPath = process.env.PATH;
beforeAll(() => {
  symlinkSync(fileURLToPath(new URL("fake-perch.mjs", import.meta.url)), join(workspace, "perch"));
  process.env.PATH = [workspace, originalPath].join(delimiter);
  process.env.FAKE_PERCH_STATE = workspace;
});
afterAll(() => {
  process.env.PATH = originalPath;
  delete process.env.FAKE_PERCH_STATE;
  rmSync(workspace, { recursive: true, force: true });
});

test("maps Roost, permission inheritance and explicit planning", () => {
  const settings = (input: Parameters<typeof resolveSettings>[0]) => perchConfiguration(resolveSettings(input)).file;
  for (const [id, expected] of [["standard", "standard"], ["standard-max", "standard_max"], ["pro", "pro"], ["pro-max", "pro_max"]]) {
    assert.equal(settings({ model: id }).roostChoice, expected);
  }
  assert.equal(new Set(modelCatalog.map(({ id }) => id)).size, modelCatalog.length);
  assert.equal(settings({ permissionMode: "full" }).permissionMode, "take_the_wheel");
  assert.equal(settings({ permissionMode: "auto" }).permissionMode, "auto_review");
  assert.equal(settings({ permissionMode: "accept-edits" }).permissionMode, "default");
  assert.equal(settings({ permissionMode: "full", sessionOptions: { mode: "default" } }).permissionMode, "default");
  assert.equal(settings({ permissionMode: "full", promptMode: "plan" }).permissionMode, "plan");
  assert.equal(settings({ permissionMode: "full", promptMode: "plan" }).chatMode, "plan");
});

test("one-off runs use stdin and argv, and report bounded structured output", async () => {
  const signal = AbortSignal.timeout(2_000);
  const task = "--model pro\n$HOME; $(echo nope)";
  const command = await executeCommand({
    kind: "run", cwd: workspace, task, thread: "cli-42", model: "standard 1m",
    effort: "off", permission: "plan", skill: ["x", "y"], attach: ["some file.pdf"],
  }, signal);
  assert.equal(command.exitCode, 0);
  const payload = JSON.parse(command.stdout!);
  assert.deepEqual(JSON.parse(payload.assistantText), {
    input: task, cwd: workspace,
    args: ["-", "--json", "--thread", "cli-42", "--model", "standard 1m",
      "--effort", "off", "--permission", "plan", "--skill", "x", "--skill", "y",
      "--attach", join(workspace, "some file.pdf")],
  });
  assert.equal(payload.threadId, "cli-42");
  const fresh = await executeCommand({ kind: "run", cwd: workspace, task: "hello" }, signal);
  assert.match(JSON.parse(fresh.stdout!).threadId, /^cli-bb-[0-9a-f-]{36}$/);
  assert.equal(payload.model, "fake");
  assert.deepEqual(payload.usage, { inputTokens: 11 });
  assert.equal(payload.events, undefined);
  assert.deepEqual(JSON.parse((await executeCommand({ kind: "status", cwd: workspace }, signal)).stdout!), {
    version: "2.4.138", signedIn: true,
  });
  assert.equal((await executeCommand({ kind: "skills", cwd: workspace, name: "one-skill" }, signal)).stdout?.trim(), "one-skill");
});

test("provider bridge passes the SDK protocol conformance suite", { timeout: 20_000 }, async () => {
  const harness = createHarness(bridge.handleLine);
  try {
    const report = await runConformance({
      transport: { send: bridge.handleLine, takeMessages: harness.takeMessages },
      providerId: "perch",
      session: { cwd: workspace, promptInput: [{ type: "text", text: "hello", mentions: [] }] },
      timeoutMs: 4_000,
    });
    assert.ok(report.passed, formatReport(report));
  } finally {
    harness.restore();
  }
});

test("model and effort changes reopen the original native session and forward attachments", { timeout: 15_000 }, async () => {
  const image = join(workspace, "image.png");
  writeFileSync(image, "test image");
  const harness = createHarness(bridge.handleLine);
  const threadId = "thr_perch_options";
  const first = {
    model: "gemini-4-hydrogen",
    reasoningLevel: "none",
    permissionMode: "auto", approvalReviewer: "automatic", permissionScope: "workspace", permissionEscalation: "ask",
    sessionOptions: { persona: "quill", chat: "ask", localTools: "off" },
  };
  const second = {
    ...first,
    model: "glm-5.3-flash",
    reasoningLevel: "high",
    sessionOptions: { ...first.sessionOptions, orchestration: "on", subagent: "gemini-4-hydrogen" },
  };
  let providerThreadId = "";
  let next = 1;
  async function request(method: string, params: BridgeJsonRpcObject) {
    const id = next++;
    harness.sendRequest(id, method, params);
    const response = await harness.waitForResponse(id);
    assert.equal(response.error, undefined, JSON.stringify(response.error));
    return response.result as Record<string, unknown>;
  }
  async function turn(options: BridgeJsonRpcObject, askApproval = false) {
    const from = harness.messages.length;
    await request("turn/start", {
      threadId, providerThreadId, options, clientRequestId: `creq_perch${String(next).padStart(5, "2")}`,
      input: [
        { type: "text", text: askApproval ? "approval-test" : "hello", mentions: [] },
        { type: "localImage", path: image },
        { type: "localFile", path: image, name: "attached file" },
      ],
    });
    if (askApproval) {
      const interaction = await vi.waitFor(() => {
        const message = harness.messages.slice(from).find((value) => value.method === "interaction/request");
        assert.ok(message, "BB should receive Perch's approval request even under Full");
        return message;
      });
      bridge.handleLine(JSON.stringify({ jsonrpc: "2.0", id: interaction.id, result: { decision: "deny" } }));
    }
    await vi.waitFor(() => {
      assert.ok(harness.messages.slice(from).some((message) => {
        const params = message.params as { deltas?: Array<{ kind: string }> } | undefined;
        return params?.deltas?.some((delta) => delta.kind === "turn.boundary");
      }));
    });
    const messages = harness.takeMessages();
    const payloads = messages.flatMap((message) => {
      const params = message.params as { deltas?: Array<{ kind: string; text?: string }> } | undefined;
      return params?.deltas?.flatMap((delta) =>
        delta.kind === "item.textDelta" && delta.text?.startsWith('{"config":') ? [JSON.parse(delta.text)] : [],
      ) ?? [];
    });
    assert.equal(payloads.length, 1, JSON.stringify(messages).slice(-2500));
    return { messages, payload: payloads[0] };
  }
  try {
    const start = await request("thread/start", { threadId, cwd: workspace, instructionMode: "append", options: first });
    providerThreadId = String(start.providerThreadId);
    assert.equal(start.sessionRestorable, true);
    const initial = await turn(first);
    assert.deepEqual(initial.payload.contentTypes, ["text", "image", "resource_link"]);
    assert.deepEqual(initial.payload.config, {
      version: 1, roostChoice: "standard", manualModelOptionId: "gemini-gemini-4-hydrogen",
      subagentModelOptionId: null, effort: { level: "off", orchestration: false },
      permissionMode: "auto_review", chatMode: "ask", personaId: "quill", cliLocalTools: false,
    });
    const changed = await turn(second);
    assert.equal(changed.payload.config.manualModelOptionId, "openrouter-z-ai-glm-5-3-flash-crusoe-pro");
    assert.deepEqual(changed.payload.config.effort, { level: "high", orchestration: true });
    assert.equal(changed.payload.config.subagentModelOptionId, "gemini-gemini-4-hydrogen");
    assert.notEqual(changed.payload.configPath, initial.payload.configPath);
    const replaced = changed.messages.find((message) => message.method === "session/replaced");
    assert.ok(replaced, "settings change should rebuild its native session");
    const replacement = replaced.params as { providerThreadId?: string; contextLost?: boolean };
    assert.equal(replacement.providerThreadId, providerThreadId);
    assert.equal(replacement.contextLost, false);
    const plan = { ...second, sessionOptions: { ...second.sessionOptions, mode: "plan" } };
    const planned = await turn(plan);
    const plannedAgain = await turn(plan);
    assert.equal(planned.payload.config.permissionMode, "plan");
    assert.equal(plannedAgain.payload.config.permissionMode, "plan");
    assert.notEqual(planned.payload.configPath, plannedAgain.payload.configPath);
    const strict = await turn({
      ...second,
      permissionMode: "full", permissionScope: "full", approvalReviewer: null, permissionEscalation: null,
      sessionOptions: { ...second.sessionOptions, mode: "default" },
    }, true);
    assert.equal(strict.payload.config.permissionMode, "default");
    assert.equal(strict.payload.decision, "deny");
  } finally {
    if (providerThreadId) await request("thread/stop", { threadId, providerThreadId, intent: "release", activeTurnId: null });
    harness.restore();
  }
});
