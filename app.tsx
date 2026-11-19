import { definePluginApp, experimental_useRpcQuery, useBbNavigate, useRpc, useSdk, useSettings } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import { settingsContract, type TerminalAction } from "./contract.ts";
import { exactModels } from "./exact-models.ts";
import { defaults } from "./options.ts";
import { keys } from "./settings.ts";
import "./perch-settings.css";

function PerchAccount({ terminalPanel = false }: { terminalPanel?: boolean }) {
  const account = experimental_useRpcQuery({ contract: settingsContract, method: "accountStatus", input: null });
  const rpc = useRpc<typeof settingsContract>();
  const navigate = useBbNavigate();
  const sdk = useSdk();
  const [opening, setOpening] = useState<TerminalAction>();
  const [notice, setNotice] = useState<string>();
  // Sign-in finishes in a separate terminal, so re-check Perch until it reports
  // signed in (or five minutes pass) instead of showing the status from before.
  const [watchUntil, setWatchUntil] = useState(0);
  const refetch = account.refetch;
  const signedIn = account.data?.signedIn;

  useEffect(() => {
    if (!watchUntil || signedIn) return;
    const timer = setInterval(() => {
      if (Date.now() > watchUntil) setWatchUntil(0);
      else void refetch();
    }, 4_000);
    return () => clearInterval(timer);
  }, [watchUntil, signedIn, refetch]);

  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === "visible") void refetch(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refetch]);

  async function open(action: TerminalAction) {
    setOpening(action);
    setNotice(undefined);
    try {
      const { terminalId } = await rpc.call("openTerminal", { action });
      if (action === "login" || action === "interactive" || action === "shell") setWatchUntil(Date.now() + 5 * 60_000);
      if (!await navigate.experimental_openTerminal({ terminalId })) {
        await sdk.terminals.close({ terminalId, mode: "force" });
        setNotice("Could not reveal the Perch terminal. Try again from this panel.");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not open the Perch terminal.");
    } finally {
      setOpening(undefined);
    }
  }

  function action(id: TerminalAction, label: string) {
    return <button type="button" disabled={opening !== undefined} onClick={() => void open(id)}>
      {opening === id ? "Opening…" : label}
    </button>;
  }

  return <div className="perch-account">
    <div className="perch-account-row">
      <p role="status">
        {account.data
          ? <><strong>{account.data.signedIn ? "Signed in" : watchUntil ? "Waiting for sign-in…" : "Signed out"}</strong>
            {" · "}{account.data.machine}{account.data.version && ` · Perch ${account.data.version}`}</>
          : account.error
            ? "Perch status is unavailable. Check the executable on the primary machine."
            : "Checking Perch on the primary machine…"}
      </p>
      <button type="button" disabled={account.isFetching} onClick={() => void account.refetch()}>Refresh status</button>
    </div>
    {!terminalPanel && <div className="perch-account-actions">
      <button type="button" onClick={() => navigate.toPluginPanel("terminals")}>Open Perch terminals</button>
    </div>}
    {terminalPanel && <div className="perch-account-actions">
      {action("login", "Sign in")}
      {action("update", "Update Perch")}
      {action("interactive", "Open Perch")}
    </div>}
    {terminalPanel && <div className="perch-account-routing">
      <h3>Account model routing</h3>
      <div className="perch-account-actions">
        {action("byokList", "BYOK providers")}
        {action("byokStatus", "BYOK status")}
        {action("byolmStatus", "Local model status")}
        {action("subList", "Subscriptions")}
        {action("shell", "Open routing shell")}
      </div>
    </div>}
    {notice && <p role="status">{notice}</p>}
  </div>;
}

const roostTiers = [
  ["standard", "Roost Standard"],
  ["standard-max", "Roost Standard 1M"],
  ["pro", "Roost Pro"],
  ["pro-max", "Roost Pro 1M"],
] as const;
const tiers = [...new Set(exactModels.map((model) => model[3]))];

function ModelOptions() {
  return <>{tiers.map((tier) => <optgroup key={tier} label={tier}>
    {exactModels.filter((model) => model[3] === tier).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
  </optgroup>)}</>;
}

// bb's built-in settings dropdown does not scroll, so the long model lists use
// native selects here and write the same plugin settings.
function DefaultModels() {
  const { values } = useSettings();
  const rpc = useRpc<typeof settingsContract>();
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string>();
  const model = String(values?.[keys.model] ?? defaults.model);
  const subagent = String(values?.[keys.subagent] ?? defaults.subagent);

  async function save(input: { model?: string; subagent?: string }) {
    setSaving(true);
    setNotice(undefined);
    try {
      await rpc.call("setDefaultModels", input);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save the model.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="perch-models">
    <h3>Default models</h3>
    <label>
      <span>Default model</span>
      <select value={model} disabled={saving || !values} onChange={(event) => void save({ model: event.target.value })}>
        <optgroup label="Roost (Perch picks the model)">
          {roostTiers.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </optgroup>
        <ModelOptions />
      </select>
    </label>
    <label>
      <span>Default sub-agent model <small>(Perch threads in bb only)</small></span>
      <select value={subagent} disabled={saving || !values} onChange={(event) => void save({ subagent: event.target.value })}>
        <option value="inherit">Inherit main model</option>
        <ModelOptions />
      </select>
    </label>
    {notice && <p role="status">{notice}</p>}
  </div>;
}

function PerchAccountSettings() {
  return <><PerchAccount /><DefaultModels /></>;
}

function PerchTerminals() {
  return <div className="perch-terminal-panel"><PerchAccount terminalPanel /></div>;
}

export default definePluginApp((app) => {
  app.slots.settingsSection({ id: "account", title: "Perch account", component: PerchAccountSettings });
  app.slots.navPanel({ id: "terminals", title: "Perch terminals", icon: "Bird", path: "terminals", component: PerchTerminals });
});
