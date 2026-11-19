import { definePluginApp, experimental_useRpcQuery, useBbNavigate, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import { settingsContract, type TerminalAction } from "./contract.ts";
import "./perch-settings.css";

function PerchAccount({ terminalPanel = false }: { terminalPanel?: boolean }) {
  const account = experimental_useRpcQuery({ contract: settingsContract, method: "accountStatus", input: null });
  const rpc = useRpc<typeof settingsContract>();
  const navigate = useBbNavigate();
  const sdk = useSdk();
  const [opening, setOpening] = useState<TerminalAction>();
  const [notice, setNotice] = useState<string>();

  async function open(action: TerminalAction) {
    setOpening(action);
    setNotice(undefined);
    try {
      const { terminalId } = await rpc.call("openTerminal", { action });
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
          ? <><strong>{account.data.signedIn ? "Signed in" : "Signed out"}</strong>
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

function PerchAccountSettings() {
  return <PerchAccount />;
}

function PerchTerminals() {
  return <div className="perch-terminal-panel"><PerchAccount terminalPanel /></div>;
}

export default definePluginApp((app) => {
  app.slots.settingsSection({ id: "account", title: "Perch account", component: PerchAccountSettings });
  app.slots.navPanel({ id: "terminals", title: "Perch terminals", icon: "Bird", path: "terminals", component: PerchTerminals });
});
