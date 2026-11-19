---
name: perch
description: Run Perch from bb for a one-off task, resume its native thread, inspect skills and sign-in, or configure a Perch agent thread.
---

Use `bb perch run 'TASK'` for one Perch turn. The result is JSON with
`assistantText`, `threadId`, `status`, and model and token counts when Perch
reports them. Pass `--thread <threadId>` to continue the same Perch conversation
on the same machine and account. Use `--help` for model, effort, permission,
chat mode, persona, repeatable skill IDs, and attachments.

`bb perch status` checks the execution machine. For an interactive sign-in,
the human can run `bb perch login` to open Perch's login in a bb terminal.
Do not run login as part of an unattended workflow. `bb perch skills` lists
Perch's skills and `bb perch skills <name>` shows one.

Inside a bb thread, these commands default to that thread's machine and the
invoking directory. Outside a thread, use `--host` when the primary machine is
not the intended target. Use an absolute `--cwd` for a different directory,
and give attachment paths on the selected machine.

For an ongoing agent thread use provider `perch`. Check `bb provider models
perch` for model IDs, reasoning levels and thread options. In bb's reasoning
picker, `none` means Off. Select Chat mode, Persona, Perch permission,
sub-agent model, local tools or orchestration effort from the thread options.
Use `bb thread options <bb-thread-id> --set <id>=<value>` to change one for the
next turn. A model or effort remains subject to Perch account and adapter
support. Queue a new turn to change settings during a running turn.

Use `bb plugin config perch` to inspect defaults. **Plugin default**
(`configured` in bb) follows the current setting. Explicit model, effort,
and thread options take precedence. `bb perch run` follows the defaults
for its native flags. Sub-agent model and orchestration effort apply to ACP
threads. Use `--local-tools on|off` to override the one-shot preference.

`bb perch catalog` reports installed CLI names and the bundled ACP snapshot.
Sign-in, updates, and model-routing status are available in Settings → Perch
through explicit terminal actions. Keep credential values out of plugin
settings and command arguments.
