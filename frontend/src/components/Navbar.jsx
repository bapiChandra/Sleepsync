import { useState, useEffect } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  configuredNetworkPassphrase,
  connectWallet,
  discoverWalletState,
  getNetworkLabel,
  shortAddress,
  parseError
} from "../lib/sleepSync";

const emptyWallet = {
  account: "",
  networkPassphrase: "",
  isConnecting: false,
  error: ""
};

// Shared wallet state is lifted into a module-level singleton pattern
// so it survives route changes. Components read from this.
export let sharedWallet = emptyWallet;
export const walletListeners = new Set();

export function notifyWalletChange(next) {
  sharedWallet = next;
  walletListeners.forEach(fn => fn(next));
}

export default function Navbar() {
  const [wallet, setWallet] = useState(sharedWallet);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const listener = (next) => setWallet(next);
    walletListeners.add(listener);
    return () => walletListeners.delete(listener);
  }, []);

  useEffect(() => {
    async function sync() {
      try {
        const next = await discoverWalletState();
        const updated = { ...next, isConnecting: false, error: "" };
        notifyWalletChange(updated);
        setWallet(updated);
      } catch {}
    }
    sync();
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  async function handleConnect() {
    const loading = { ...wallet, isConnecting: true, error: "" };
    notifyWalletChange(loading);
    setWallet(loading);
    try {
      const next = await connectWallet();
      const updated = { ...emptyWallet, ...next, isConnecting: false };
      notifyWalletChange(updated);
      setWallet(updated);
      navigate("/dashboard");
    } catch (err) {
      const errState = { ...wallet, isConnecting: false, error: parseError(err) };
      notifyWalletChange(errState);
      setWallet(errState);
    }
  }

  const navLinks = [
    { to: "/dashboard", label: "Dashboard", icon: "" },
    { to: "/log",       label: "Log Sleep",  icon: "" },
    { to: "/staking",   label: "Staking",    icon: "⬡" },
    { to: "/activity",  label: "Activity",   icon: "" },
    { to: "/settings",  label: "Settings",   icon: "" },
  ];

  const networkLabel = wallet.networkPassphrase
    ? getNetworkLabel(wallet.networkPassphrase)
    : getNetworkLabel(configuredNetworkPassphrase);

  return (
    <>
      <nav className={`navbar${scrolled ? " scrolled" : ""}`}>
        {/* Brand */}
        <NavLink to="/" className="navbar-brand" onClick={() => setMobileOpen(false)}>
          <div className="brand-icon">
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.94 11A8.26 8.26 0 0 1 21 12a9 9 0 1 1-9-9 8.26 8.26 0 0 1 1 .06"/>
              <path d="m9 11 3 3L22 4"/>
            </svg>
          </div>
          <span>SleepSync</span>
        </NavLink>

        {/* Desktop Nav */}
        <ul className="navbar-nav" role="navigation" aria-label="Main navigation">
          {navLinks.map(({ to, label, icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
              >
                <span className="nav-icon" aria-hidden="true">{icon}</span>
                {label}
              </NavLink>
            </li>
          ))}
        </ul>

        {/* Right actions */}
        <div className="navbar-right">
          <span className="network-badge" title={`Connected to ${networkLabel}`}>
            <span className="network-dot" aria-hidden="true" />
            {networkLabel}
          </span>

          <button
            id="navbar-connect-btn"
            className={`btn ${wallet.account ? "btn-ghost btn-sm" : "btn-primary btn-sm"}`}
            onClick={handleConnect}
            disabled={wallet.isConnecting}
            aria-label={wallet.account ? "Wallet connected" : "Connect wallet"}
          >
            {wallet.isConnecting
              ? "Connecting…"
              : wallet.account
                ? shortAddress(wallet.account)
                : "Connect Wallet"}
          </button>

          {/* Hamburger */}
          <button
            className="hamburger"
            aria-label="Toggle navigation"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(v => !v)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </nav>

      {/* Mobile Nav */}
      <div className={`mobile-nav${mobileOpen ? " open" : ""}`} role="dialog" aria-modal="true" aria-label="Mobile navigation">
        {navLinks.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
            onClick={() => setMobileOpen(false)}
          >
            <span className="nav-icon" aria-hidden="true">{icon}</span>
            {label}
          </NavLink>
        ))}
        <button
          className="btn btn-primary btn-sm w-full"
          onClick={() => { setMobileOpen(false); handleConnect(); }}
          disabled={wallet.isConnecting}
          style={{ marginTop: "0.75rem" }}
        >
          {wallet.isConnecting ? "Connecting…" : wallet.account ? shortAddress(wallet.account) : "Connect Wallet"}
        </button>
      </div>
    </>
  );
}
