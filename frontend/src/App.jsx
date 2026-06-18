import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { WatchWalletChanges } from "@stellar/freighter-api";
import {
  configuredContractId,
  configuredNetworkPassphrase,
  connectWallet,
  discoverWalletState,
  formatDate,
  formatMinutes,
  getExplorerLink,
  getNetworkLabel,
  hasContractConfig,
  isFreighterInstalled,
  logSession,
  parseError,
  readContractEvents,
  readDashboard,
  readRecentSessions,
  saveProfile,
  shortAddress,
  updateWeeklyGoal
} from "./lib/sleepSync";

const sleepTypes = [
  "Night Sleep",
  "Nap",
  "Wind Down",
  "Sleep Recovery",
  "Deep Rest",
  "Early Bedtime",
  "Screen-Free Night"
];

const emptyWallet = {
  account: "",
  network: "",
  networkPassphrase: "",
  rpcUrl: "",
  isConnecting: false,
  error: ""
};

const emptyTx = {
  status: "idle",
  message: "",
  hash: ""
};

function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      SS
    </div>
  );
}

function Panel({ eyebrow, title, body, children, tone = "paper" }) {
  return (
    <section className={`panel panel-${tone}`}>
      <div className="panel-head">
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        {body ? <p>{body}</p> : null}
      </div>
      {children}
    </section>
  );
}

function MetricCard({ label, value, note, loading = false, tone = "light" }) {
  return (
    <article className={`metric-card metric-${tone}`}>
      <p>{label}</p>
      <strong className={loading ? "skeleton skeleton-metric" : ""}>{loading ? "" : value}</strong>
      <span>{loading ? <i className="skeleton skeleton-note" /> : note}</span>
    </article>
  );
}

function RecoveryDial({ value, progress }) {
  const score = Number(value || 0);
  return (
    <div className="recovery-dial" style={{ "--score": `${score}%`, "--goal": `${progress || 0}%` }}>
      <div className="dial-orbit">
        <span className="orbit-dot orbit-one" />
        <span className="orbit-dot orbit-two" />
      </div>
      <div className="dial-core">
        <p>Recovery</p>
        <strong>{score}</strong>
        <span>/100</span>
      </div>
    </div>
  );
}

function ActivitySkeleton() {
  return (
    <div className="stack-list">
      {Array.from({ length: 3 }, (_, index) => (
        <div className="session-row session-skeleton" key={index}>
          <span className="skeleton skeleton-title" />
          <span className="skeleton skeleton-note" />
        </div>
      ))}
    </div>
  );
}

function EventCard({ event }) {
  return (
    <article className="event-card">
      <div>
        <p className="event-title">{event.label}</p>
        <p className="event-meta">
          {shortAddress(event.sleeper)} - {new Date(event.occurredAt).toLocaleString()}
        </p>
      </div>
      <p>{event.summary}</p>
      <div className="event-foot">
        <span>Ledger {event.ledger}</span>
        <a href={`https://stellar.expert/explorer/testnet/tx/${event.txHash}`} target="_blank" rel="noreferrer">
          View tx
        </a>
      </div>
    </article>
  );
}

export default function App() {
  const queryClient = useQueryClient();
  const freighterInstalled = isFreighterInstalled();
  const [wallet, setWallet] = useState(emptyWallet);
  const [txState, setTxState] = useState(emptyTx);
  const [profileForm, setProfileForm] = useState({
    displayName: "",
    weeklyGoalMinutes: "3360"
  });
  const [goalForm, setGoalForm] = useState("3360");
  const [sessionForm, setSessionForm] = useState({
    sleepType: "Night Sleep",
    minutesSlept: "420",
    sleptOnTime: true
  });

  useEffect(() => {
    let isMounted = true;
    let watcher = null;

    async function syncWallet() {
      try {
        const nextState = await discoverWalletState();
        if (!isMounted) {
          return;
        }
        setWallet((current) => ({
          ...current,
          ...nextState,
          isConnecting: false,
          error: ""
        }));
      } catch (error) {
        if (!isMounted) {
          return;
        }
        setWallet((current) => ({
          ...current,
          isConnecting: false,
          error: parseError(error)
        }));
      }
    }

    syncWallet();

    if (typeof window !== "undefined" && freighterInstalled) {
      watcher = new WatchWalletChanges(3000);
      watcher.watch(() => {
        setTxState(emptyTx);
        syncWallet();
      });
    }

    return () => {
      isMounted = false;
      watcher?.stop?.();
    };
  }, [freighterInstalled]);

  const wrongNetwork =
    Boolean(wallet.networkPassphrase) && wallet.networkPassphrase !== configuredNetworkPassphrase;
  const readyForReads = Boolean(wallet.account) && hasContractConfig() && !wrongNetwork;

  const dashboardQuery = useQuery({
    queryKey: ["dashboard", wallet.account, wallet.networkPassphrase],
    queryFn: () => readDashboard(wallet.account),
    enabled: readyForReads
  });

  const sessionsQuery = useQuery({
    queryKey: ["sessions", wallet.account, wallet.networkPassphrase, dashboardQuery.data?.sessionCount || 0],
    queryFn: () => readRecentSessions(wallet.account, 5),
    enabled: readyForReads && Boolean(dashboardQuery.data)
  });

  const liveEventsQuery = useQuery({
    queryKey: ["contract-events", configuredContractId],
    queryFn: () => readContractEvents(6),
    enabled: hasContractConfig(),
    staleTime: 8_000,
    refetchInterval: 12_000,
    refetchIntervalInBackground: false
  });

  useEffect(() => {
    if (!dashboardQuery.data) {
      return;
    }

    setGoalForm(String(dashboardQuery.data.weeklyGoalMinutes));
    setProfileForm((current) => ({
      displayName: current.displayName || dashboardQuery.data.displayName,
      weeklyGoalMinutes: current.weeklyGoalMinutes || String(dashboardQuery.data.weeklyGoalMinutes)
    }));
  }, [dashboardQuery.data]);

  const dashboard = dashboardQuery.data;
  const weeklyProgress = useMemo(() => {
    if (!dashboard?.weeklyGoalMinutes) {
      return 0;
    }

    return Math.min(100, Math.round((dashboard.minutesThisWeek / dashboard.weeklyGoalMinutes) * 100));
  }, [dashboard]);

  async function runLedgerAction(action, pendingMessage, successMessage) {
    if (!wallet.account) {
      throw new Error("Connect Freighter before sending a transaction.");
    }

    if (wrongNetwork) {
      throw new Error(`Switch Freighter to ${getNetworkLabel(configuredNetworkPassphrase)}.`);
    }

    setTxState({
      status: "pending",
      message: pendingMessage,
      hash: ""
    });

    try {
      const result = await action();

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard", wallet.account] }),
        queryClient.invalidateQueries({ queryKey: ["sessions", wallet.account] }),
        queryClient.invalidateQueries({ queryKey: ["contract-events"] })
      ]);

      setTxState({
        status: "success",
        message: successMessage,
        hash: result.hash
      });
    } catch (error) {
      setTxState({
        status: "error",
        message: parseError(error),
        hash: ""
      });
      throw error;
    }
  }

  const saveProfileMutation = useMutation({
    mutationFn: ({ displayName, weeklyGoalMinutes }) =>
      runLedgerAction(
        () => saveProfile(wallet.account, displayName, weeklyGoalMinutes),
        "Creating your sleep profile on Stellar...",
        "Sleep profile saved on Soroban."
      )
  });

  const updateGoalMutation = useMutation({
    mutationFn: ({ weeklyGoalMinutes }) =>
      runLedgerAction(
        () => updateWeeklyGoal(wallet.account, weeklyGoalMinutes),
        "Updating your weekly sleep goal on Stellar...",
        "Weekly sleep goal updated."
      )
  });

  const logSessionMutation = useMutation({
    mutationFn: ({ sleepType, minutesSlept, sleptOnTime }) =>
      runLedgerAction(
        () => logSession(wallet.account, sleepType, minutesSlept, sleptOnTime),
        "Logging your sleep session on Stellar...",
        "Sleep session logged."
      )
  });

  const anyMutationPending =
    saveProfileMutation.isPending || updateGoalMutation.isPending || logSessionMutation.isPending;

  async function handleConnectWallet() {
    if (!freighterInstalled) {
      setWallet((current) => ({
        ...current,
        error: "Freighter is not installed in this browser."
      }));
      return;
    }

    setWallet((current) => ({
      ...current,
      isConnecting: true,
      error: ""
    }));

    try {
      const nextState = await connectWallet();
      setWallet({
        ...emptyWallet,
        ...nextState,
        isConnecting: false
      });
    } catch (error) {
      setWallet((current) => ({
        ...current,
        isConnecting: false,
        error: parseError(error)
      }));
    }
  }

  function handleProfileSubmit(event) {
    event.preventDefault();

    const displayName = profileForm.displayName.trim();
    const weeklyGoalMinutes = Number(profileForm.weeklyGoalMinutes);

    if (!displayName) {
      setTxState({
        status: "error",
        message: "Add a display name before saving your sleep profile.",
        hash: ""
      });
      return;
    }

    if (Number.isNaN(weeklyGoalMinutes) || weeklyGoalMinutes < 30 || weeklyGoalMinutes > 5000) {
      setTxState({
        status: "error",
        message: "Weekly sleep goal must stay between 30 and 5000 minutes.",
        hash: ""
      });
      return;
    }

    saveProfileMutation.mutate({ displayName, weeklyGoalMinutes });
  }

  function handleGoalSubmit(event) {
    event.preventDefault();

    const weeklyGoalMinutes = Number(goalForm);
    if (Number.isNaN(weeklyGoalMinutes) || weeklyGoalMinutes < 30 || weeklyGoalMinutes > 5000) {
      setTxState({
        status: "error",
        message: "Pick a weekly sleep goal between 30 and 5000 minutes.",
        hash: ""
      });
      return;
    }

    updateGoalMutation.mutate({ weeklyGoalMinutes });
  }

  function handleSessionSubmit(event) {
    event.preventDefault();

    const sleepType = sessionForm.sleepType.trim();
    const minutesSlept = Number(sessionForm.minutesSlept);

    if (!sleepType) {
      setTxState({
        status: "error",
        message: "Choose a sleep session type before logging on-chain.",
        hash: ""
      });
      return;
    }

    if (Number.isNaN(minutesSlept) || minutesSlept < 5 || minutesSlept > 480) {
      setTxState({
        status: "error",
        message: "Sleep sessions must be between 5 and 480 minutes.",
        hash: ""
      });
      return;
    }

    logSessionMutation.mutate({
      sleepType,
      minutesSlept,
      sleptOnTime: sessionForm.sleptOnTime
    });
  }

  const txExplorerLink = getExplorerLink(wallet.networkPassphrase, txState.hash);
  const contractExplorerLink = configuredContractId
    ? configuredNetworkPassphrase === "Public Global Stellar Network ; September 2015"
      ? `https://lab.stellar.org/r/public/contract/${configuredContractId}`
      : `https://lab.stellar.org/r/testnet/contract/${configuredContractId}`
    : "";

  const statusMessage =
    wallet.error ||
    (!freighterInstalled
      ? "Open SleepSync in a browser with Freighter available to sign Soroban sleep logs."
      : wrongNetwork
        ? `Connected to ${getNetworkLabel(wallet.networkPassphrase)}. Switch Freighter to ${getNetworkLabel(configuredNetworkPassphrase)}.`
        : txState.message ||
          (hasContractConfig()
            ? "Ready to track sleep duration, bedtime streaks, recovery, and live Soroban activity."
            : "Deploy the Soroban contract and export the frontend config before using the app."));

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="SleepSync home">
          <BrandMark />
          <span>SleepSync</span>
        </a>
        <div className="topbar-actions">
          <span className="network-pill">
            {wallet.networkPassphrase ? getNetworkLabel(wallet.networkPassphrase) : "Stellar Testnet"}
          </span>
          {freighterInstalled ? (
            <button className="button button-primary" onClick={handleConnectWallet} disabled={wallet.isConnecting}>
              {wallet.isConnecting ? "Connecting..." : wallet.account ? shortAddress(wallet.account) : "Connect wallet"}
            </button>
          ) : null}
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <p className="kicker">On-chain sleep discipline</p>
            <h1>Rest rhythm, recorded with intent.</h1>
            <p className="lead">
              SleepSync turns duration, bedtime consistency, and weekly recovery into a public
              Stellar-backed discipline record.
            </p>
            <div className="hero-actions">
              <a className="button button-dark" href="#log-session">
                Log sleep
              </a>
              {contractExplorerLink ? (
                <a className="button button-ghost" href={contractExplorerLink} target="_blank" rel="noreferrer">
                  View contract
                </a>
              ) : null}
            </div>
          </div>

          <aside className="hero-instrument">
            <RecoveryDial value={dashboard?.recoveryScore || 0} progress={weeklyProgress} />
            <div className="instrument-copy">
              <p>Weekly goal</p>
              <strong>{dashboard ? `${weeklyProgress}%` : "Not started"}</strong>
              <span>
                {dashboard
                  ? `${formatMinutes(dashboard.minutesThisWeek)} of ${formatMinutes(dashboard.weeklyGoalMinutes)}`
                  : "Create a profile to begin"}
              </span>
            </div>
          </aside>
        </section>

        <section className="status-banner">
          <div>
            <p className="status-label">System status</p>
            <p>{statusMessage}</p>
          </div>
          <div className="status-actions">
            <span>{configuredContractId ? shortAddress(configuredContractId) : "Contract pending"}</span>
            {txExplorerLink ? (
              <a href={txExplorerLink} target="_blank" rel="noreferrer">
                Last transaction
              </a>
            ) : null}
          </div>
        </section>

        <section className="metric-rail" aria-label="Sleep metrics">
          <MetricCard
            label="Total rest"
            value={dashboard ? formatMinutes(dashboard.totalMinutes) : "0m"}
            note={dashboard ? `${dashboard.sessionCount} sessions logged` : "No sessions yet"}
            loading={dashboardQuery.isLoading}
            tone="ink"
          />
          <MetricCard
            label="This week"
            value={dashboard ? formatMinutes(dashboard.minutesThisWeek) : "0m"}
            note={
              dashboard
                ? `${Math.max(dashboard.weeklyGoalMinutes - dashboard.minutesThisWeek, 0)} minutes remaining`
                : "Set your weekly target"
            }
            loading={dashboardQuery.isLoading}
          />
          <MetricCard
            label="Bedtime streak"
            value={dashboard ? `${dashboard.currentStreak}d` : "0d"}
            note="Consecutive on-time days"
            loading={dashboardQuery.isLoading}
          />
          <MetricCard
            label="Consistency"
            value={dashboard ? `${dashboard.consistencyScore}%` : "0%"}
            note={dashboard ? `${dashboard.onTimeSessionCount} on-time logs` : "On-time logs tracked"}
            loading={dashboardQuery.isLoading}
          />
          <MetricCard
            label="Profile"
            value={dashboard?.displayName || "None"}
            note={wallet.account ? shortAddress(wallet.account) : "Wallet not connected"}
            loading={dashboardQuery.isLoading}
          />
        </section>

        {!hasContractConfig() ? (
          <Panel
            eyebrow="Deployment setup"
            title="Deploy the SleepSync contract"
            body="Build the Rust contract, deploy it with Stellar CLI, then export the contract ID for the frontend."
            tone="night"
          >
            <div className="code-stack">
              <code>stellar keys generate alice --network testnet --fund</code>
              <code>npm run contract:build</code>
              <code>npm run contract:deploy</code>
              <code>npm run export:frontend</code>
            </div>
          </Panel>
        ) : null}

        <section className="workbench">
          <Panel
            eyebrow="Profile"
            title="Sleep identity"
            body="Create the public profile tied to your wallet."
          >
            <form className="form-grid" onSubmit={handleProfileSubmit}>
              <label>
                <span>Display name</span>
                <input
                  type="text"
                  placeholder="Moon Keeper"
                  value={profileForm.displayName}
                  onChange={(event) =>
                    setProfileForm((current) => ({ ...current, displayName: event.target.value }))
                  }
                />
              </label>
              <label>
                <span>Weekly sleep goal</span>
                <input
                  type="number"
                  min="30"
                  max="5000"
                  step="5"
                  value={profileForm.weeklyGoalMinutes}
                  onChange={(event) =>
                    setProfileForm((current) => ({
                      ...current,
                      weeklyGoalMinutes: event.target.value
                    }))
                  }
                />
              </label>
              <button className="button button-dark" type="submit" disabled={anyMutationPending || !wallet.account || !hasContractConfig()}>
                {saveProfileMutation.isPending ? "Saving..." : "Save profile"}
              </button>
            </form>
          </Panel>

          <Panel eyebrow="Goal" title="Weekly target" body="Tune the sleep-minute goal for the current rhythm.">
            <form className="form-grid" onSubmit={handleGoalSubmit}>
              <label>
                <span>New target minutes</span>
                <input
                  type="number"
                  min="30"
                  max="5000"
                  step="5"
                  value={goalForm}
                  onChange={(event) => setGoalForm(event.target.value)}
                />
              </label>
              <button
                className="button button-secondary"
                type="submit"
                disabled={anyMutationPending || !wallet.account || !dashboard || !hasContractConfig()}
              >
                {updateGoalMutation.isPending ? "Updating..." : "Update target"}
              </button>
            </form>
          </Panel>

          <Panel
            eyebrow="Sleep log"
            title="Record rest"
            body="Log duration and whether the bedtime window was met."
            tone="gold"
          >
            <form className="form-grid" id="log-session" onSubmit={handleSessionSubmit}>
              <label>
                <span>Session type</span>
                <select
                  value={sessionForm.sleepType}
                  onChange={(event) =>
                    setSessionForm((current) => ({ ...current, sleepType: event.target.value }))
                  }
                >
                  {sleepTypes.map((sleepType) => (
                    <option key={sleepType} value={sleepType}>
                      {sleepType}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Minutes slept</span>
                <input
                  type="number"
                  min="5"
                  max="480"
                  step="5"
                  value={sessionForm.minutesSlept}
                  onChange={(event) =>
                    setSessionForm((current) => ({
                      ...current,
                      minutesSlept: event.target.value
                    }))
                  }
                />
              </label>
              <label className="switch-row">
                <input
                  type="checkbox"
                  checked={sessionForm.sleptOnTime}
                  onChange={(event) =>
                    setSessionForm((current) => ({
                      ...current,
                      sleptOnTime: event.target.checked
                    }))
                  }
                />
                <span>Bedtime met</span>
              </label>
              <button
                className="button button-dark"
                type="submit"
                disabled={anyMutationPending || !wallet.account || !dashboard || !hasContractConfig()}
              >
                {logSessionMutation.isPending ? "Logging..." : "Log sleep"}
              </button>
            </form>
          </Panel>
        </section>

        <section className="activity-grid">
          <Panel
            eyebrow="Session ledger"
            title="Recent sleep sessions"
            body="Latest on-chain sleep entries for the connected profile."
            tone="paper"
          >
            {sessionsQuery.isLoading ? (
              <ActivitySkeleton />
            ) : sessionsQuery.data?.length ? (
              <div className="stack-list">
                {sessionsQuery.data.map((session) => (
                  <article className="session-row" key={session.id}>
                    <div>
                      <h3>{session.sleepType}</h3>
                      <p>{formatDate(session.timestamp)}</p>
                    </div>
                    <div className="session-badges">
                      <span>{formatMinutes(session.minutesSlept)}</span>
                      <span>{session.sleptOnTime ? "On time" : "Off schedule"}</span>
                      <span>Recovery {session.recoveryScoreAfterLog}</span>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="empty-state">
                {dashboard ? "No sleep sessions logged yet." : "Create a sleep profile to populate the ledger."}
              </p>
            )}
          </Panel>

          <Panel
            eyebrow="Public feed"
            title="Soroban activity"
            body="Live contract events from the SleepSync ledger."
            tone="night"
          >
            {liveEventsQuery.isLoading ? (
              <ActivitySkeleton />
            ) : liveEventsQuery.data?.length ? (
              <div className="event-feed">
                {liveEventsQuery.data.map((event) => (
                  <EventCard event={event} key={event.id} />
                ))}
              </div>
            ) : (
              <p className="empty-state">No recent contract events in the current ledger window.</p>
            )}
          </Panel>
        </section>
      </main>
    </div>
  );
}
