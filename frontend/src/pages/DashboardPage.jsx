import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  configuredContractId,
  configuredNetworkPassphrase,
  formatDate,
  formatMinutes,
  getNetworkLabel,
  hasContractConfig,
  parseError,
  readDashboard,
  readLeaderboard,
  readRecentSessions,
  readContractEvents,
  shortAddress,
} from "../lib/sleepSync";
import { sharedWallet, walletListeners } from "../components/Navbar";

// Sub-components

function StatCard({ label, value, note, accent = "", loading = false }) {
  return (
    <div className={`stat-card ${accent}`} aria-label={`${label}: ${value}`}>
      <div className="stat-label">{label}</div>
      {loading
        ? <div className="skeleton skel-value" style={{ marginBottom: "0.375rem" }} />
        : <span className="stat-value">{value}</span>
      }
      {loading
        ? <div className="skeleton skel-text-sm" />
        : <span className="stat-note">{note}</span>
      }
    </div>
  );
}

function RecoveryDial({ score, progress }) {
  const s = Number(score || 0);
  const circumference = 2 * Math.PI * 45;
  const offset = circumference - (circumference * s) / 100;
  return (
    <div className="recovery-dial-wrap">
      <div className="recovery-dial" aria-label={`Recovery score: ${s}%`} role="meter" aria-valuenow={s} aria-valuemin={0} aria-valuemax={100}>
        <svg className="dial-svg" viewBox="0 0 100 100" aria-hidden="true">
          <circle className="dial-track" cx="50" cy="50" r="45" fill="none" stroke="white" strokeWidth="3" />
          <circle
            cx="50" cy="50" r="45"
            fill="none"
            stroke="url(#dial-grad)"
            strokeWidth="4"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
          <defs>
            <linearGradient id="dial-grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#818CF8" />
              <stop offset="100%" stopColor="#38BDF8" />
            </linearGradient>
          </defs>
        </svg>
        <div className="dial-core">
          <span className="dial-score">{s}%</span>
          <span className="dial-label">Recovery</span>
          {progress != null && (
            <span className="dial-sub">{progress}% weekly goal</span>
          )}
        </div>
      </div>
    </div>
  );
}

function SessionSkeleton() {
  return (
    <div className="session-list">
      {[1, 2, 3].map(i => (
        <div className="session-item" key={i}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            <div className="skeleton skel-text" />
            <div className="skeleton skel-text-sm" />
          </div>
          <div className="skeleton" style={{ width: "80px", height: "22px", borderRadius: "12px" }} />
        </div>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const [wallet, setWallet] = useState(sharedWallet);

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

  const sessionsQ = useQuery({
    queryKey: ["sessions", wallet.account, dashQ.data?.sessionCount || 0],
    queryFn: () => readRecentSessions(wallet.account, 5),
    enabled: ready && Boolean(dashQ.data),
  });

  const leaderboardQ = useQuery({
    queryKey: ["leaderboard", configuredContractId],
    queryFn: () => readLeaderboard(),
    enabled: ready,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const eventsQ = useQuery({
    queryKey: ["events", configuredContractId],
    queryFn: () => readContractEvents(6),
    enabled: hasContractConfig(),
    staleTime: 8_000,
    refetchInterval: 12_000,
  });

  const dash = dashQ.data;

  const weeklyProgress = dash?.weeklyGoalMinutes
    ? Math.min(100, Math.round((dash.minutesThisWeek / dash.weeklyGoalMinutes) * 100))
    : 0;

  // Status message
  let statusMsg = "";
  let statusTone = "";
  if (!wallet.account) {
    statusMsg = "Connect a wallet from the top-right to load your dashboard.";
  } else if (wrongNetwork) {
    statusMsg = `Switch to ${getNetworkLabel(configuredNetworkPassphrase)} in your wallet.`;
    statusTone = "error";
  } else if (!hasContractConfig()) {
    statusMsg = "Deploy the contract and configure VITE_CONTRACT_ID to use the app.";
    statusTone = "error";
  }

  return (
    <main className="dashboard-page animate-in" id="main-content" tabIndex={-1}>
      <div className="container">
        {/* Page Header */}
        <header className="page-header">
          <h1 className="page-title">
            {dash?.displayName ? `Welcome back, ${dash.displayName} ` : "Dashboard"}
          </h1>
          <p className="page-subtitle">
            {wallet.account
              ? `${shortAddress(wallet.account)} · ${getNetworkLabel(wallet.networkPassphrase || configuredNetworkPassphrase)}`
              : "Connect your wallet to get started"}
          </p>
        </header>

        {/* Status */}
        {statusMsg && (
          <div className={`status-toast ${statusTone}`} role="status" aria-live="polite">
            <span className="status-dot" aria-hidden="true" />
            {statusMsg}
          </div>
        )}

        {/* Stats Grid */}
        <div className="stats-grid mb-3">
          <StatCard
            label="Total Sessions"
            value={dash?.sessionCount ?? "—"}
            note="On-chain records"
            accent="accent-indigo"
            loading={dashQ.isLoading}
          />
          <StatCard
            label="This Week"
            value={dash ? formatMinutes(dash.minutesThisWeek) : "—"}
            note={`Goal: ${dash ? formatMinutes(dash.weeklyGoalMinutes) : "—"}`}
            accent="accent-purple"
            loading={dashQ.isLoading}
          />
          <StatCard
            label="Current Streak"
            value={dash ? `${dash.streakDays}d` : "—"}
            note="Consecutive days"
            accent="accent-emerald"
            loading={dashQ.isLoading}
          />
          <StatCard
            label="Consistency"
            value={dash ? `${dash.consistencyScore}%` : "—"}
            note="30-day average"
            accent="accent-amber"
            loading={dashQ.isLoading}
          />
        </div>

        {/* Main Grid – Dial + Sessions */}
        <div className="main-grid mb-3">
          {/* Recovery */}
          <div className="panel">
            <div className="panel-head">
              <div className="section-eyebrow">Recovery</div>
              <h2 className="panel-title">Sleep Quality Index</h2>
            </div>
            {dashQ.isLoading
              ? <div className="recovery-dial-wrap"><div className="skeleton" style={{ width: 220, height: 220, borderRadius: "50%" }} /></div>
              : <RecoveryDial score={dash?.recoveryScore} progress={weeklyProgress} />
            }
            {dash && (
              <div className="progress-bar-wrap" style={{ marginTop: "1.25rem" }}>
                <div className="progress-bar-header">
                  <span className="progress-bar-label">Weekly Goal Progress</span>
                  <span className="progress-bar-pct">{weeklyProgress}%</span>
                </div>
                <div className="progress-track" role="progressbar" aria-valuenow={weeklyProgress} aria-valuemin={0} aria-valuemax={100}>
                  <div className="progress-fill" style={{ width: `${weeklyProgress}%` }} />
                </div>
              </div>
            )}
          </div>

          {/* Recent Sessions */}
          <div className="panel">
            <div className="panel-head">
              <div className="section-eyebrow">Sessions</div>
              <h2 className="panel-title">Recent Sleep Logs</h2>
              <p className="panel-subtitle">Latest on-chain entries</p>
            </div>
            {sessionsQ.isLoading
              ? <SessionSkeleton />
              : sessionsQ.data?.length
                ? (
                  <div className="session-list">
                    {sessionsQ.data.map((s) => (
                      <article className="session-item" key={s.id}>
                        <div>
                          <div className="session-type">{s.sleepType}</div>
                          <div className="session-date">{formatDate(s.timestamp)}</div>
                        </div>
                        <div className="session-badges">
                          <span className="badge primary">{formatMinutes(s.minutesSlept)}</span>
                          <span className={`badge ${s.sleptOnTime ? "emerald" : "amber"}`}>
                            {s.sleptOnTime ? "On time" : "Late"}
                          </span>
                        </div>
                      </article>
                    ))}
                  </div>
                )
                : (
                  <div className="empty-state">
                    <div className="empty-icon" aria-hidden="true"></div>
                    <p>{dash ? "No sessions yet — log your first sleep!" : "Create a profile to start tracking."}</p>
                  </div>
                )
            }
          </div>
        </div>

        {/* Activity Row */}
        <div className="activity-section">
          {/* Leaderboard */}
          <div className="panel">
            <div className="panel-head">
              <div className="section-eyebrow">Rankings</div>
              <h2 className="panel-title">Leaderboard</h2>
            </div>
            {leaderboardQ.isLoading
              ? <SessionSkeleton />
              : leaderboardQ.data?.length
                ? (
                  <div className="lb-list">
                    {leaderboardQ.data.map((entry, i) => (
                      <div className="lb-item" key={entry.sleeper}>
                        <div className={`lb-rank ${i === 0 ? "top-1" : i === 1 ? "top-2" : i === 2 ? "top-3" : ""}`}>
                          {i === 0 ? "" : i === 1 ? "" : i === 2 ? "" : `#${i + 1}`}
                        </div>
                        <div className="lb-info">
                          <div className="lb-name">{entry.displayName || "Anonymous"}</div>
                          <div className="lb-addr">{shortAddress(entry.sleeper)}</div>
                        </div>
                        <div className="lb-score">{formatMinutes(entry.totalMinutes)}</div>
                      </div>
                    ))}
                  </div>
                )
                : <div className="empty-state"><div className="empty-icon" aria-hidden="true"></div><p>No rankings yet.</p></div>
            }
          </div>

          {/* Live Events */}
          <div className="panel" style={{ gridColumn: "span 2" }}>
            <div className="panel-head">
              <div className="section-eyebrow">Live Feed</div>
              <h2 className="panel-title">Soroban Activity</h2>
              <p className="panel-subtitle">Real-time contract events</p>
            </div>
            {eventsQ.isLoading
              ? <SessionSkeleton />
              : eventsQ.data?.length
                ? (
                  <div className="event-feed">
                    {eventsQ.data.slice(0, 4).map((ev) => (
                      <article className="event-item" key={ev.id}>
                        <div className="event-name">{ev.label}</div>
                        <div className="event-meta">{shortAddress(ev.sleeper)} · {new Date(ev.occurredAt).toLocaleString()}</div>
                        <p className="event-summary">{ev.summary}</p>
                        <div className="event-footer">
                          <span className="event-ledger">Ledger {ev.ledger}</span>
                          <a className="event-link" href={`https://stellar.expert/explorer/testnet/tx/${ev.txHash}`} target="_blank" rel="noreferrer">
                            View tx →
                          </a>
                        </div>
                      </article>
                    ))}
                  </div>
                )
                : <div className="empty-state"><div className="empty-icon" aria-hidden="true"></div><p>No recent contract events.</p></div>
            }
          </div>
        </div>
      </div>
    </main>
  );
}
