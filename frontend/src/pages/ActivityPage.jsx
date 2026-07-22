import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  configuredContractId,
  configuredNetworkPassphrase,
  hasContractConfig,
  readContractEvents,
  readRecentSessions,
  readLeaderboard,
  formatDate,
  formatMinutes,
  getNetworkLabel,
  shortAddress,
} from "../lib/sleepSync";
import { sharedWallet, walletListeners } from "../components/Navbar";

export default function ActivityPage() {
  const [wallet, setWallet] = useState(sharedWallet);
  const [tab, setTab] = useState("events");

  useEffect(() => {
    const l = (w) => setWallet(w);
    walletListeners.add(l);
    return () => walletListeners.delete(l);
  }, []);

  const ready = Boolean(wallet.account) && hasContractConfig();

  const eventsQ = useQuery({
    queryKey: ["events", configuredContractId],
    queryFn: () => readContractEvents(20),
    enabled: hasContractConfig(),
    staleTime: 8_000,
    refetchInterval: 12_000,
  });

  const sessionsQ = useQuery({
    queryKey: ["sessions-all", wallet.account],
    queryFn: () => readRecentSessions(wallet.account, 20),
    enabled: ready,
  });

  const leaderboardQ = useQuery({
    queryKey: ["leaderboard", configuredContractId],
    queryFn: () => readLeaderboard(),
    enabled: ready,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const tabs = [
    { id: "events", label: "Live Events", icon: "" },
    { id: "sessions", label: "My Sessions", icon: "" },
    { id: "leaderboard", label: "Rankings", icon: "" },
  ];

  return (
    <main className="dashboard-page animate-in" id="main-content" tabIndex={-1}>
      <div className="container">
        <header className="page-header">
          <h1 className="page-title">Activity</h1>
          <p className="page-subtitle">Explore on-chain sleep data, sessions, and rankings</p>
        </header>

        {/* Tab Nav */}
        <div role="tablist" aria-label="Activity tabs" style={{ display: "flex", gap: "0.25rem", marginBottom: "1.5rem", borderBottom: "1px solid var(--color-border)", paddingBottom: "0" }}>
          {tabs.map(({ id, label, icon }) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              aria-controls={`tabpanel-${id}`}
              id={`tab-${id}`}
              className="btn btn-ghost btn-sm"
              style={{
                borderRadius: "var(--radius-sm) var(--radius-sm) 0 0",
                borderBottom: tab === id ? "2px solid var(--color-primary)" : "2px solid transparent",
                color: tab === id ? "var(--color-primary)" : "var(--color-text-2)",
                background: tab === id ? "rgba(129,140,248,0.08)" : "transparent",
              }}
              onClick={() => setTab(id)}
            >
              <span aria-hidden="true">{icon}</span> {label}
            </button>
          ))}
        </div>

        {/* Events Tab */}
        <div role="tabpanel" id="tabpanel-events" aria-labelledby="tab-events" hidden={tab !== "events"}>
          <div className="panel">
            <div className="panel-head">
              <div className="section-eyebrow">Real-time</div>
              <h2 className="panel-title">Soroban Contract Events</h2>
              <p className="panel-subtitle">Auto-refreshing every 12s</p>
            </div>
            {eventsQ.isLoading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {[1,2,3,4].map(i => (
                  <div key={i} className="event-item">
                    <div className="skeleton skel-text" style={{ marginBottom: "0.5rem" }} />
                    <div className="skeleton skel-text-sm" />
                  </div>
                ))}
              </div>
            ) : eventsQ.data?.length ? (
              <div className="event-feed">
                {eventsQ.data.map((ev) => (
                  <article className="event-item" key={ev.id}>
                    <div className="event-name">{ev.label}</div>
                    <div className="event-meta">{shortAddress(ev.sleeper)} · {new Date(ev.occurredAt).toLocaleString()}</div>
                    <p className="event-summary">{ev.summary}</p>
                    <div className="event-footer">
                      <span className="event-ledger">Ledger #{ev.ledger}</span>
                      <a className="event-link" href={`https://stellar.expert/explorer/testnet/tx/${ev.txHash}`} target="_blank" rel="noreferrer">
                        View tx →
                      </a>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-icon" aria-hidden="true"></div>
                <p>No recent contract events found.</p>
              </div>
            )}
          </div>
        </div>

        {/* Sessions Tab */}
        <div role="tabpanel" id="tabpanel-sessions" aria-labelledby="tab-sessions" hidden={tab !== "sessions"}>
          <div className="panel">
            <div className="panel-head">
              <div className="section-eyebrow">History</div>
              <h2 className="panel-title">Your Sleep Sessions</h2>
            </div>
            {!wallet.account ? (
              <div className="empty-state">
                <div className="empty-icon" aria-hidden="true"></div>
                <p>Connect your wallet to view your sessions.</p>
              </div>
            ) : sessionsQ.isLoading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {[1,2,3].map(i => (
                  <div className="session-item" key={i}>
                    <div className="skeleton skel-text" />
                    <div className="skeleton" style={{ width: 80, height: 22, borderRadius: 12 }} />
                  </div>
                ))}
              </div>
            ) : sessionsQ.data?.length ? (
              <div className="session-list">
                {sessionsQ.data.map((s) => (
                  <article className="session-item" key={s.id}>
                    <div>
                      <div className="session-type">{s.sleepType}</div>
                      <div className="session-date" aria-label={`Date: ${formatDate(s.timestamp)}`}>{formatDate(s.timestamp)}</div>
                    </div>
                    <div className="session-badges">
                      <span className="badge primary">{formatMinutes(s.minutesSlept)}</span>
                      <span className={`badge ${s.sleptOnTime ? "emerald" : "amber"}`}>{s.sleptOnTime ? "On time" : "Late"}</span>
                      <span className="badge accent">Recovery {s.recoveryScoreAfterLog}</span>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-icon" aria-hidden="true"></div>
                <p>No sessions yet. Head to Log Sleep to get started!</p>
              </div>
            )}
          </div>
        </div>

        {/* Leaderboard Tab */}
        <div role="tabpanel" id="tabpanel-leaderboard" aria-labelledby="tab-leaderboard" hidden={tab !== "leaderboard"}>
          <div className="panel">
            <div className="panel-head">
              <div className="section-eyebrow">Global Rankings</div>
              <h2 className="panel-title">Leaderboard</h2>
              <p className="panel-subtitle">Top sleepers by total on-chain duration</p>
            </div>
            {!wallet.account ? (
              <div className="empty-state">
                <div className="empty-icon" aria-hidden="true"></div>
                <p>Connect your wallet to view rankings.</p>
              </div>
            ) : leaderboardQ.isLoading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {[1,2,3,4,5].map(i => (
                  <div className="lb-item" key={i}>
                    <div className="skeleton" style={{ width: 28, height: 28, borderRadius: "50%" }} />
                    <div style={{ flex: 1 }}>
                      <div className="skeleton skel-text" style={{ marginBottom: "0.25rem" }} />
                      <div className="skeleton skel-text-sm" />
                    </div>
                    <div className="skeleton" style={{ width: 60, height: 16, borderRadius: 4 }} />
                  </div>
                ))}
              </div>
            ) : leaderboardQ.data?.length ? (
              <div className="lb-list">
                {leaderboardQ.data.map((entry, i) => (
                  <div className="lb-item" key={entry.sleeper}>
                    <div className={`lb-rank ${i === 0 ? "top-1" : i === 1 ? "top-2" : i === 2 ? "top-3" : ""}`}>
                      {i === 0 ? "" : i === 1 ? "" : i === 2 ? "" : `#${i + 1}`}
                    </div>
                    <div className="lb-info">
                      <div className="lb-name">{entry.displayName || "Anonymous"}</div>
                      <div className="lb-addr">{entry.sleeper}</div>
                    </div>
                    <div className="lb-score">{formatMinutes(entry.totalMinutes)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-icon" aria-hidden="true"></div>
                <p>No rankings yet. Be the first to log sleep!</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
