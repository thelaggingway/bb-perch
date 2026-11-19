# Perch for bb

Run Perch in a bb thread with model, effort, and permission controls. The
plugin runs Perch's native ACP agent, with a private settings directory for
each agent process.

## Install

On the machine that will run Perch, install Node.js 22.18 or later and
`perchai-cli` if needed. This plugin was verified with bb 0.49.0,
Plugin SDK 0.6.132, and Perch 2.4.138.

From a checkout of this repository:

```sh
npm ci
bb plugin build
bb plugin install .
bb perch status
```

Install Perch with `npm install -g perchai-cli` or use bb's provider
installation action. If status shows signed out, run `bb perch login` and
complete sign-in in the bb terminal it opens. For a different enrolled machine,
pass `--host <machine>`. Run `bb plugin reload perch` after rebuilding local
changes.

Select **Perch** in the new-thread picker. Its provider ID is `perch`.
A manually registered `acp-perch` can coexist with it. If that was your only
custom ACP entry, you can remove it with
`bb plugin config provider-acp unset customAgents`. If you have other entries,
remove just the Perch entry from the Custom agents setting. Existing
`acp-perch` threads keep that provider ID.

## Thread controls

| bb control | Perch behavior |
| --- | --- |
| Model | Four Roost tiers and the named models from the Perch 2.4.138 picker catalog. |
| Reasoning | Off, Low, Medium, High, Extra high, Max, and Ultra. The CLI ID for Off in bb is `none`. |
| bb permission | Accept Edits → Default, Auto → Auto Review, Full → Take the Wheel. Perch handles tool policy and bb shows approvals it still requests. |
| Perch permission | `mode` overrides the bb mapping. It offers Default, Auto Review, Take the Wheel, and read-only Plan. |
| Chat mode | `chat` selects Ask, Agents, or Plan. bb's Plan action starts the turn with both chat and permission set to Plan. |
| Persona | `persona` selects Saffron or Quill. |
| Sub-agent model | `subagent` pins a named model or inherits the main model. |
| Local tools and orchestration effort | `localTools` and `orchestration` accept `on` and `off`. |

```sh
bb provider models perch
bb thread spawn --provider perch --model gemini-4-hydrogen \
  --reasoning-level none --permission-mode auto --option chat=ask \
  --prompt 'Reply with OK.'
bb thread options <bb-thread-id> --set persona=quill
```

Settings changes apply at the next turn boundary. The bridge reloads the
native Perch conversation when it restarts the agent. Queue a new turn when
changing settings during a live turn. A live steer uses the active ACP
process's settings.

Perch streams text, reasoning, and tool activity over ACP. bb sends local
images as image blocks and files as workspace references. bb indexes native
skills under `.perch/skills` and `.agents/skills`. Perch applies its own
account entitlements and model-specific effort mapping. The picker uses a
versioned catalog. Perch manages account-specific visibility, promotions,
BYOK, BYOLM, and subscription models in its own client.

## One-off tasks

```sh
bb perch run 'Summarize this file.' --mode ask --model 'standard 1m' \
  --effort low --attach ./notes.md
bb perch run 'Condense that to one sentence.' --thread <perch-thread-id>
bb perch skills
bb perch skills <name>
bb perch status
```

`run` returns bounded JSON with the answer, the Perch thread ID, the model, and
per-turn token usage when available. Each call starts a fresh native thread unless you supply `--thread`. Use the
returned `threadId` for continuations. Run `bb perch run --help` for all options. Inside a bb
thread, commands default to its execution machine. Outside a thread, commands
default to bb's primary machine. `--host` selects a machine explicitly, and
`--cwd` takes an absolute path on that machine.

## Current limits

Perch ACP exposes stream events, permission requests, and session load. Native
fork, compaction, interactive terminal slash commands, and subscription usage
windows have no compatible ACP operation in the tested CLI. Open a Perch
terminal for `/usage`, BYOK/BYOLM/subscription management, and other
interactive settings. The exact-model picker is a snapshot because Perch
doesn't expose a supported headless catalog command.

See [AGENTS.md](AGENTS.md) for protocol findings, test commands, and live
verification.
