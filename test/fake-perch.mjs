#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const [, , command, ...args] = process.argv;
if (command === "--version") {
  console.log("2.4.138");
} else if (command === "status") {
  console.log("Perch CLI 2.4.138 · Signed in");
} else if (command === "skills") {
  console.log(args[0] ?? "sample-skill");
} else if (command === "run") {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  console.log(JSON.stringify({
    ok: true, status: "completed", threadId: args[args.indexOf("--thread") + 1],
    assistantText: JSON.stringify({ input, args, cwd: process.cwd() }),
    events: [{ fakeInternalEvent: true }],
    contextSnapshot: { modelId: "fake", turnApiUsage: { inputTokens: 11 } },
  }));
} else if (command === "acp") {
  const send = (msg) => console.log(JSON.stringify({ jsonrpc: "2.0", ...msg }));
  const configPath = join(process.env.PERCH_CLI_SETTINGS_DIR, "cli-settings.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  let approval;
  for await (const line of createInterface({ input: process.stdin })) {
    const { method, id, params, result } = JSON.parse(line);
    if (id === "approval-1" && approval) {
      approval(result?.outcome?.optionId);
      approval = undefined;
      continue;
    }
    const reply = (result) => send({ id, result });
    const update = (event) => send({
      method: "session/update",
      params: { sessionId: params.sessionId, update: event },
    });
    const modes = { currentModeId: config.permissionMode, availableModes: [{ id: config.permissionMode, name: "Mode" }] };
    switch (method) {
      case "initialize":
        reply({ protocolVersion: 1, agentCapabilities: { loadSession: true,
          promptCapabilities: { image: true, embeddedContext: true } },
        authMethods: [{ id: "fake-browser-login", name: "Login" }] });
        break;
      case "session/new": {
        const sessionId = `cli-${randomUUID()}`;
        reply({ sessionId, modes });
        break;
      }
      case "session/load":
        if (existsSync(join(process.env.FAKE_PERCH_STATE, params.sessionId))) {
          update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "history" } });
          reply({ modes });
        } else {
          send({ id, error: { code: -32002, message: "Missing session" } });
        }
        break;
      case "session/prompt": {
        writeFileSync(join(process.env.FAKE_PERCH_STATE, params.sessionId), "");
        const answer = (decision) => {
          const text = JSON.stringify({ config, configPath,
            contentTypes: params.prompt.map(({ type }) => type), decision });
          update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
          reply({ stopReason: "end_turn" });
        };
        if (params.prompt.some((part) => part.text === "approval-test")) {
          approval = answer;
          send({
            id: "approval-1",
            method: "session/request_permission",
            params: {
              sessionId: params.sessionId,
              toolCall: { toolCallId: "tool1", title: "Fake command", kind: "execute", status: "pending" },
              options: [
                { optionId: "allow", name: "Allow", kind: "allow_once" },
                { optionId: "deny", name: "Deny", kind: "reject_once" },
              ],
            },
          });
        } else {
          answer();
        }
        break;
      }
      case "session/cancel":
        break;
      default:
        send({ id, error: { code: -32601, message: "Fake native Perch does not implement this method" } });
    }
  }
} else {
  process.exitCode = 1;
}
