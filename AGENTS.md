# bb-perch development

The plugin ID and provider ID are both `perch`. The hand-registered
`acp-perch` provider is separate. Never edit its settings during installation,
reload, or testing.

## Verified contract

Findings from 2026-11-19 on Perch CLI 2.4.138 and bb 0.49.0 / Plugin SDK
0.6.132. The installed SDK declarations from `bb plugin types` are the bb
contract.

- Native ACP `initialize` reports protocol 1, `loadSession: true`, image and
  embedded-context input, and browser and terminal auth methods.
- `session/new` advertises Default, Auto Review, Take the Wheel and Plan in
  `modes`. It returns neither models nor `configOptions`. Model and effort in
  `_meta` have no handler in the installed agent. Direct stdio probes returned
  `-32601` for `session/set_config_option` and `session/set_model`, and success
  for `session/set_mode` with `plan`.
- ACP publishes no `available_commands_update`. A native ACP `/status` prompt
  produced model and tool updates, confirming that it was sent as model input.
  The registered ACP prompt handler has no slash-command dispatch. The
  interactive terminal parses commands before prompt dispatch.
- The installed bundle's `lQt` opens settings from
  `PERCH_CLI_SETTINGS_DIR/cli-settings.json`. It sets model and effort runtime
  state via `FI` and `kre`, and passes chat mode, persona, permission and local
  tools into the ACP turn. Native history uses `PERCH_CLI_STATE_DIR` (normally
  `~/.perch/threads`). These directories are independent.
- The terminal `/model` picker builds its base list from the bundled starter,
  Pro and Ultra mappings (`uie`, `die`, and `pie` in 2.4.138), then applies
  account, availability and promotion data. `exact-models.ts` records the
  stable names and settings IDs from those maps. Exclude feature-flagged,
  promotional and hidden entries. The four runtime tiers are `standard`,
  `standard_max`, `pro`, and `pro_max`. The one-shot CLI treats `auto` as an
  alias for Standard.
- `perch run - --json` accepts the task from stdin. It supports thread, cwd,
  permission, mode, persona, model, effort, repeated skills and attachments.
  The final JSON contains an event list and context snapshot. The CLI command
  returns a bounded projection and supplies a fresh thread ID by default so the
  native cwd-derived default cannot append to an interactive chat.

## Implementation and invariants

- The provider adapter uses the published bb ACP provider bridge for the native
  transcript, lifecycle, cancellation, approvals and attachment conversion.
  It implements bb model discovery and declares the actual fork capability.
- Each execution request resolves bb settings into a validated process
  configuration. The ACP bridge detects the changed launch environment and
  reloads the session. The proxy writes a mode-0600 settings file into a
  per-process temporary directory and cleans up on close. It supplies ACP
  config metadata and keeps the native stream and request IDs intact.
- Keep the user's interactive settings untouched. Never read, copy, parse,
  log, or print `cli-auth-session.json`, tokens, or credential files. Always
  use the native CLI's sign-in flow. A health probe runs `perch status` and
  returns only readiness and version. Only the explicit login command opens a
  terminal. The proxy rejects ACP authentication requests.
- Native ACP approvals must reach bb even when the selected bb permission is
  Full or Auto. Perch gets the resolved native mode. The ACP transport uses
  bb's approval-capable policy because the generic ACP bridge rejects Auto
  and auto-approves ACP requests in Full.
- Exact models and effort are requested preferences. Perch can gate models
  by account or normalize effort to an adapter's levels. Native ACP has no
  effective reasoning-budget field.
- During a live steer, the shared bridge uses its active agent process.
  Changes to settings apply to an ordinary queued turn. Changing a setting
  after a completed turn restores the native history via `session/load`. A
  new planning turn reapplies its starting settings after any prior approval.
- CLI commands resolve an execution host, use a typed host RPC, and pass
  spawn arguments as arrays. Keep one-shot task text on stdin. Bound collected
  process output and the returned answer. Native history and authorization are
  owned by Perch.

## Verification

```sh
npm ci
bb plugin types --check
npm run typecheck
npm test
bb plugin build
```

The tests put a fake `perch` first on PATH. They check the public bridge
conformance suite, option mapping, isolation, session replacement, attachment
blocks and the command wrapper. All automated calls go to the fixture.

Live bb project `proj_8vy28g455e`, 2026-11-19:

| bb thread | Requested | Perch evidence |
| --- | --- | --- |
| `thr_uu84c9dggt` | Gemini 4 Hydrogen, Off, Ask, Quill | `PONG`; native thread `cli-1795067191723`; saved `contextSnapshot.modelId = gemini-4-hydrogen`. No reasoning chunks on the first turn. |
| `thr_faf3gknguc` | GLM 5.3 Flash, High, Ask, bb Auto | `PING`; native thread `cli-1795067191787`; saved `contextSnapshot.modelId = z-ai/glm-5.3-flash`. |
| `thr_uu84c9dggt` follow-up | Same model, High, Saffron | `PONG` recalled from the prior turn; same Perch thread ID; saved persona `saffron`; four native reasoning deltas on the High turn. |

`bb perch status` reported version 2.4.138 and signed in. A one-off Standard run
returned token usage and a fresh `cli-bb-…` ID. A subsequent `--thread` run
repeated the prior reply under that same native ID.

The two initial processes had Off and High in their separate settings files.
The reasoning deltas corroborate a change in behavior. They do not measure
the upstream model's exact effort budget.
