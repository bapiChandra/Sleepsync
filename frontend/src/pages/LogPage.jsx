import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  configuredNetworkPassphrase,
  hasContractConfig,
  logSession,
  parseError,
  readDashboard,
  formatMinutes,
  getNetworkLabel,
  shortAddress,
} from "../lib/sleepSync";
import { sharedWallet, walletListeners } from "../components/Navbar";

const sleepTypes = [
  "Night Sleep",
  "Nap",
  "Wind Down",
  "Sleep Recovery",
  "Deep Rest",
  "Early Bedtime",
  "Screen-Free Night",
];

const emptyTx = { status: "idle", message: "", hash: "" };

export default function LogPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [wallet, setWallet] = useState(sharedWallet);
  const [txState, setTxState] = useState(emptyTx);
  const [form, setForm] = useState({
    sleepType: "Night Sleep",
    minutesSlept: "420",
    sleptOnTime: true,
  });

  useEffect(() => {
    const l = (w) => setWallet(w);
    walletListeners.add(l);
    return () => walletListeners.delete(l);
  }, []);

  const wrongNetwork =
    Boolean(wallet.networkPassphrase) &&
    wallet.networkPassphrase !== configuredNetworkPassphrase;

  const ready = Boolean(wallet.account) && hasContractConfig() && !wrongNetwork;

  const dashQ = useQuery({
    queryKey: ["dashboard", wallet.account],
    queryFn: () => readDashboard(wallet.account),
    enabled: ready,
  });

  const logMutation = useMutation({
    mutationFn: async ({ sleepType, minutesSlept, sleptOnTime }) => {
      setTxState({ status: "pending", message: "Logging your sleep on Stellar…", hash: "" });
      const result = await logSession(wallet.account, sleepType, minutesSlept, sleptOnTime);
      await queryClient.invalidateQueries({ queryKey: ["dashboard", wallet.account] });
      await queryClient.invalidateQueries({ queryKey: ["sessions", wallet.account] });
      await queryClient.invalidateQueries({ queryKey: ["events"] });
      setTxState({ status: "success", message: "Sleep session recorded on-chain! ", hash: result?.hash || "" });
      return result;
    },
    onError: (err) => {
      setTxState({ status: "error", message: parseError(err), hash: "" });
    }
  });

  function handleSubmit(e) {
    e.preventDefault();
    const sleepType = form.sleepType.trim();
    const minutesSlept = Number(form.minutesSlept);

    if (!sleepType) {
      setTxState({ status: "error", message: "Choose a session type.", hash: "" });
      return;
    }
    if (Number.isNaN(minutesSlept) || minutesSlept < 5 || minutesSlept > 480) {
      setTxState({ status: "error", message: "Duration must be 5–480 minutes.", hash: "" });
      return;
    }

    logMutation.mutate({ sleepType, minutesSlept, sleptOnTime: form.sleptOnTime });
  }

  const dash = dashQ.data;
  const weeklyPct = dash?.weeklyGoalMinutes
    ? Math.min(100, Math.round((dash.minutesThisWeek / dash.weeklyGoalMinutes) * 100))
    : 0;

  const tipMinutes = {
    "Night Sleep": 480,
    "Nap": 30,
    "Wind Down": 45,
    "Sleep Recovery": 540,
    "Deep Rest": 420,
    "Early Bedtime": 480,
    "Screen-Free Night": 450,
  };

  return (
    <main className="log-page animate-in" id="main-content" tabIndex={-1}>
      <div className="container-sm">
        <header className="page-header">
          <h1 className="page-title">Log Sleep Session</h1>
          <p className="page-subtitle">Record your rest on the Soroban blockchain</p>
        </header>

        {/* Status Banner */}
        {txState.message && (
          <div className={`status-toast ${txState.status}`} role={txState.status === "error" ? "alert" : "status"} aria-live="polite">
            <span className="status-dot" aria-hidden="true" />
            <span>{txState.message}</span>
            {txState.hash && (
              <a
                href={`https://stellar.expert/explorer/testnet/tx/${txState.hash}`}
                target="_blank"
                rel="noreferrer"
                className="event-link"
                style={{ flexShrink: 0 }}
              >
                View tx →
              </a>
            )}
          </div>
        )}

        <div className="log-grid">
          {/* Form */}
          <div className="panel">
            <div className="panel-head">
              <div className="section-eyebrow">New Entry</div>
              <h2 className="panel-title">Session Details</h2>
            </div>

            {dashQ.isSuccess && !dashQ.data ? (
              <div className="text-center" style={{ padding: "1.5rem 0" }}>
                <p className="text-muted" style={{ marginBottom: "1.25rem" }}>
                  You need an on-chain Sleep Profile before you can log sleep sessions.
                </p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => navigate("/settings")}
                >
                  Create Profile
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} id="log-session-form" noValidate>
              <div className="form-group mb-3">
                <label className="form-label" htmlFor="sleep-type">Session Type</label>
                <select
                  id="sleep-type"
                  className="form-input"
                  value={form.sleepType}
                  onChange={(e) => setForm(f => ({ ...f, sleepType: e.target.value }))}
                  required
                >
                  {sleepTypes.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              <div className="form-group mb-3">
                <label className="form-label" htmlFor="minutes-slept">
                  Duration (minutes) · Recommended: {tipMinutes[form.sleepType]}m
                </label>
                <input
                  id="minutes-slept"
                  type="number"
                  className="form-input"
                  min="5"
                  max="480"
                  step="5"
                  value={form.minutesSlept}
                  onChange={(e) => setForm(f => ({ ...f, minutesSlept: e.target.value }))}
                  required
                  aria-describedby="minutes-hint"
                />
                <span id="minutes-hint" className="text-faint" style={{ fontSize: "0.78rem" }}>
                  Enter 5–480 minutes
                </span>
              </div>

              <div className="form-toggle mb-3">
                <label htmlFor="slept-on-time">Bedtime goal met?</label>
                <input
                  id="slept-on-time"
                  type="checkbox"
                  checked={form.sleptOnTime}
                  onChange={(e) => setForm(f => ({ ...f, sleptOnTime: e.target.checked }))}
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary w-full"
                disabled={logMutation.isPending || !wallet.account || !hasContractConfig()}
                aria-busy={logMutation.isPending}
                style={{ minHeight: "48px" }}
              >
                {logMutation.isPending ? "Logging…" : "Log Sleep Session "}
              </button>

              {!wallet.account && (
                <p className="text-faint" style={{ fontSize: "0.8125rem", marginTop: "0.75rem", textAlign: "center" }}>
                  Connect your wallet to log a session.
                </p>
              )}
            </form>
            )}
          </div>

          {/* Side Info */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            {/* Weekly progress */}
            {dash && (
              <div className="panel">
                <div className="panel-head">
                  <div className="section-eyebrow">Weekly Goal</div>
                  <h2 className="panel-title">{weeklyPct}% Complete</h2>
                </div>
                <div className="progress-bar-wrap">
                  <div className="progress-bar-header">
                    <span className="progress-bar-label">{formatMinutes(dash.minutesThisWeek)} logged</span>
                    <span className="progress-bar-pct">of {formatMinutes(dash.weeklyGoalMinutes)}</span>
                  </div>
                  <div className="progress-track" role="progressbar" aria-valuenow={weeklyPct} aria-valuemin={0} aria-valuemax={100}>
                    <div className="progress-fill" style={{ width: `${weeklyPct}%` }} />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginTop: "1.25rem" }}>
                  <div className="stat-card" style={{ padding: "0.875rem 1rem" }}>
                    <div className="stat-label">Streak</div>
                    <span className="stat-value" style={{ fontSize: "1.5rem" }}>{dash.streakDays}d</span>
                  </div>
                  <div className="stat-card accent-emerald" style={{ padding: "0.875rem 1rem" }}>
                    <div className="stat-label">Recovery</div>
                    <span className="stat-value" style={{ fontSize: "1.5rem" }}>{dash.recoveryScore}%</span>
                  </div>
                </div>
              </div>
            )}

            {/* Tips */}
            <div className="panel">
              <div className="panel-head">
                <div className="section-eyebrow">Sleep Tips</div>
                <h2 className="panel-title">Optimize your rest</h2>
              </div>
              <ul style={{ display: "flex", flexDirection: "column", gap: "0.75rem", listStyle: "none" }}>
                {[
                  { icon: "", tip: "Aim for 7–9 hours of night sleep consistently." },
                  { icon: "", tip: "Keep your bedtime within a 30-minute window." },
                  { icon: "", tip: "Avoid screens 1 hour before bed for better recovery." },
                  { icon: "", tip: "Hit your weekly goal to earn SLEEP token rewards!" },
                ].map(({ icon, tip }) => (
                  <li key={tip} style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
                    <span style={{ fontSize: "1.1rem", flexShrink: 0 }} aria-hidden="true">{icon}</span>
                    <span className="text-muted" style={{ fontSize: "0.875rem", lineHeight: 1.5 }}>{tip}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
