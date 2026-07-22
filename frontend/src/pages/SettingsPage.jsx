import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  configuredNetworkPassphrase,
  configuredContractId,
  hasContractConfig,
  parseError,
  readDashboard,
  saveProfile,
  updateWeeklyGoal,
  getExplorerLink,
  getNetworkLabel,
  shortAddress,
  formatMinutes,
} from "../lib/sleepSync";
import { sharedWallet, walletListeners } from "../components/Navbar";

const emptyTx = { status: "idle", message: "", hash: "" };

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [wallet, setWallet] = useState(sharedWallet);
  const [txState, setTxState] = useState(emptyTx);
  const [activeSection, setActiveSection] = useState("profile");

  const [profileForm, setProfileForm] = useState({ displayName: "", weeklyGoalMinutes: "3360" });
  const [goalForm, setGoalForm] = useState("3360");

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

  useEffect(() => {
    if (dashQ.data) {
      setProfileForm((f) => ({
        displayName: f.displayName || dashQ.data.displayName,
        weeklyGoalMinutes: f.weeklyGoalMinutes || String(dashQ.data.weeklyGoalMinutes),
      }));
      setGoalForm(String(dashQ.data.weeklyGoalMinutes));
    }
  }, [dashQ.data]);

  async function runMutation(fn, pending, success) {
    setTxState({ status: "pending", message: pending, hash: "" });
    try {
      const r = await fn();
      await queryClient.invalidateQueries({ queryKey: ["dashboard", wallet.account] });
      setTxState({ status: "success", message: success, hash: r?.hash || "" });
    } catch (err) {
      setTxState({ status: "error", message: parseError(err), hash: "" });
    }
  }

  const profileMutation = useMutation({
    mutationFn: () => {
      const name = profileForm.displayName.trim();
      const mins = Number(profileForm.weeklyGoalMinutes);
      if (!name) throw new Error("Display name is required.");
      if (Number.isNaN(mins) || mins < 30 || mins > 5000) throw new Error("Weekly goal must be 30–5000 mins.");
      return runMutation(
        () => saveProfile(wallet.account, name, mins),
        "Saving profile on Stellar…",
        "Profile updated on-chain! "
      );
    }
  });

  const goalMutation = useMutation({
    mutationFn: () => {
      const mins = Number(goalForm);
      if (Number.isNaN(mins) || mins < 30 || mins > 5000) throw new Error("Goal must be 30–5000 mins.");
      return runMutation(
        () => updateWeeklyGoal(wallet.account, mins),
        "Updating weekly goal…",
        "Weekly goal updated! "
      );
    }
  });

  const anyPending = profileMutation.isPending || goalMutation.isPending;
  const contractLink = configuredContractId
    ? `https://stellar.expert/explorer/testnet/contract/${configuredContractId}`
    : "";

  const sections = [
    { id: "profile", label: "Profile", icon: "" },
    { id: "goal", label: "Weekly Goal", icon: "" },
    { id: "network", label: "Network", icon: "" },
    { id: "feedback", label: "Feedback", icon: "" },
  ];

  return (
    <main className="settings-page animate-in" id="main-content" tabIndex={-1}>
      <div className="container">
        <header className="page-header">
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Manage your profile, goals, and preferences</p>
        </header>

        {txState.message && (
          <div className={`status-toast ${txState.status}`} role={txState.status === "error" ? "alert" : "status"} aria-live="polite" style={{ marginBottom: "1.5rem" }}>
            <span className="status-dot" aria-hidden="true" />
            <span>{txState.message}</span>
          </div>
        )}

        <div className="settings-grid">
          {/* Sidebar Nav */}
          <nav aria-label="Settings sections">
            <div className="settings-nav-menu">
              {sections.map(({ id, label, icon }) => (
                <button
                  key={id}
                  className={`settings-nav-item${activeSection === id ? " active" : ""}`}
                  aria-current={activeSection === id ? "true" : undefined}
                  onClick={() => setActiveSection(id)}
                >
                  <span aria-hidden="true">{icon}</span>
                  {label}
                </button>
              ))}
            </div>
          </nav>

          {/* Content */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

            {/* Profile Section */}
            {activeSection === "profile" && (
              <div className="panel animate-in">
                <div className="panel-head">
                  <div className="section-eyebrow">Profile</div>
                  <h2 className="panel-title">Sleep Profile</h2>
                  <p className="panel-subtitle">Your on-chain identity</p>
                </div>
                <form
                  id="profile-form"
                  onSubmit={(e) => { e.preventDefault(); profileMutation.mutate(); }}
                  noValidate
                >
                  <div className="form-group mb-3">
                    <label className="form-label" htmlFor="display-name">Display Name</label>
                    <input
                      id="display-name"
                      type="text"
                      className="form-input"
                      placeholder="Moon Keeper"
                      value={profileForm.displayName}
                      onChange={(e) => setProfileForm(f => ({ ...f, displayName: e.target.value }))}
                      maxLength={32}
                      required
                    />
                  </div>
                  <div className="form-group mb-3">
                    <label className="form-label" htmlFor="initial-goal">Initial Weekly Goal (minutes)</label>
                    <input
                      id="initial-goal"
                      type="number"
                      className="form-input"
                      min="30"
                      max="5000"
                      step="30"
                      value={profileForm.weeklyGoalMinutes}
                      onChange={(e) => setProfileForm(f => ({ ...f, weeklyGoalMinutes: e.target.value }))}
                    />
                    <span className="text-faint" style={{ fontSize: "0.78rem" }}>
                      {formatMinutes(Number(profileForm.weeklyGoalMinutes) || 0)} per week
                    </span>
                  </div>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={anyPending || !wallet.account || !hasContractConfig()}
                    aria-busy={profileMutation.isPending}
                    style={{ minHeight: "48px", minWidth: "160px" }}
                  >
                    {profileMutation.isPending ? "Saving…" : "Save Profile"}
                  </button>
                </form>
              </div>
            )}

            {/* Goal Section */}
            {activeSection === "goal" && (
              <div className="panel animate-in">
                <div className="panel-head">
                  <div className="section-eyebrow">Goals</div>
                  <h2 className="panel-title">Weekly Sleep Target</h2>
                  <p className="panel-subtitle">Update your on-chain weekly sleep goal</p>
                </div>
                {dashQ.data && (
                  <div className="stat-card mb-3" style={{ padding: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span className="stat-label" style={{ margin: 0 }}>Current Goal</span>
                    <span className="stat-value" style={{ fontSize: "1.5rem", color: "var(--color-primary)" }}>
                      {formatMinutes(dashQ.data.weeklyGoalMinutes)}
                    </span>
                  </div>
                )}
                <form id="goal-form" onSubmit={(e) => { e.preventDefault(); goalMutation.mutate(); }} noValidate>
                  <div className="form-group mb-3">
                    <label className="form-label" htmlFor="new-goal">New Weekly Goal (minutes)</label>
                    <input
                      id="new-goal"
                      type="number"
                      className="form-input"
                      min="30"
                      max="5000"
                      step="30"
                      value={goalForm}
                      onChange={(e) => setGoalForm(e.target.value)}
                    />
                    <span className="text-faint" style={{ fontSize: "0.78rem" }}>
                      = {formatMinutes(Number(goalForm) || 0)} per week
                    </span>
                  </div>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={anyPending || !wallet.account || !dashQ.data || !hasContractConfig()}
                    aria-busy={goalMutation.isPending}
                    style={{ minHeight: "48px", minWidth: "160px" }}
                  >
                    {goalMutation.isPending ? "Updating…" : "Update Goal"}
                  </button>
                </form>
              </div>
            )}

            {/* Network Section */}
            {activeSection === "network" && (
              <div className="panel animate-in">
                <div className="panel-head">
                  <div className="section-eyebrow">Network</div>
                  <h2 className="panel-title">Contract & Network Info</h2>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
                  {[
                    { label: "Network", value: getNetworkLabel(wallet.networkPassphrase || configuredNetworkPassphrase) },
                    { label: "Connected Address", value: wallet.account ? shortAddress(wallet.account) : "Not connected" },
                    { label: "Contract ID", value: configuredContractId ? shortAddress(configuredContractId) : "Not configured" },
                    { label: "Network Passphrase", value: configuredNetworkPassphrase.slice(0, 30) + "…" },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.875rem 1rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)" }}>
                      <span className="text-faint" style={{ fontSize: "0.8125rem" }}>{label}</span>
                      <span className="text-mono" style={{ fontSize: "0.8125rem", color: "var(--color-text-2)" }}>{value}</span>
                    </div>
                  ))}
                </div>
                {contractLink && (
                  <div style={{ marginTop: "1.25rem" }}>
                    <a href={contractLink} target="_blank" rel="noreferrer" className="btn btn-ghost">
                      View Contract on Explorer →
                    </a>
                  </div>
                )}
              </div>
            )}

            {/* Feedback Section */}
            {activeSection === "feedback" && (
              <div className="panel animate-in">
                <div className="panel-head">
                  <div className="section-eyebrow">Help us improve</div>
                  <h2 className="panel-title">Feedback</h2>
                  <p className="panel-subtitle">Share your experience with SleepSync</p>
                </div>
                <p className="text-muted mb-3" style={{ lineHeight: 1.7, fontSize: "0.9375rem" }}>
                  We're building SleepSync as a Level 5 dApp on Stellar. Your feedback helps us make it better for everyone.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  <a
                    id="feedback-form-link"
                    href="https://docs.google.com/forms/d/e/1FAIpQLSd_dummy_form_id/viewform"
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-primary"
                    style={{ width: "fit-content", minHeight: "48px" }}
                  >
                    Open Feedback Form 
                  </a>
                  <a
                    href="https://github.com"
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-ghost"
                    style={{ width: "fit-content" }}
                  >
                    View on GitHub →
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
