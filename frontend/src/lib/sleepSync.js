import { Networks } from "@creit.tech/stellar-wallets-kit";
import * as FreighterAPI from "@stellar/freighter-api";
import { contract as StellarContract, rpc, scValToNative } from "@stellar/stellar-sdk";
import { sleepSyncConfig } from "./contract-config";

const networkLabels = {
  "Public Global Stellar Network ; September 2015": "Stellar Mainnet",
  "Test SDF Network ; September 2015": "Stellar Testnet",
  standalone: "Stellar Local"
};

// Wallet adapter using Freighter API (most common Stellar wallet)
export const kit = {
  async getPublicKey() {
    const result = await FreighterAPI.requestAccess();
    if (result.error) throw new Error(result.error.message || "Wallet access denied");
    return result.address;
  },
  async sign({ xdr, network }) {
    const result = await FreighterAPI.signTransaction(xdr, { networkPassphrase: network });
    if (result.error) throw new Error(result.error.message || "Transaction signing failed");
    return { signedXDR: result.signedTxXdr };
  }
};

export const configuredContractId =
  import.meta.env.VITE_CONTRACT_ID || sleepSyncConfig.fallbackContractId || "";
export const configuredRewardContractId =
  import.meta.env.VITE_REWARD_CONTRACT_ID || "";
export const configuredNetworkPassphrase =
  import.meta.env.VITE_STELLAR_NETWORK_PASSPHRASE ||
  "Test SDF Network ; September 2015";
export const configuredRpcUrl =
  import.meta.env.VITE_STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";

function getRpcServer() {
  return new rpc.Server(configuredRpcUrl);
}

function normalizeDashboard(dashboard) {
  return {
    displayName: dashboard.display_name,
    weeklyGoalMinutes: Number(dashboard.weekly_goal_minutes),
    totalMinutes: Number(dashboard.total_minutes),
    minutesThisWeek: Number(dashboard.minutes_this_week),
    sessionCount: Number(dashboard.session_count),
    onTimeSessionCount: Number(dashboard.on_time_session_count),
    currentStreak: Number(dashboard.current_streak),
    createdAt: Number(dashboard.created_at),
    goalReachedThisWeek: Boolean(dashboard.goal_reached_this_week),
    consistencyScore: Number(dashboard.consistency_score),
    recoveryScore: Number(dashboard.recovery_score)
  };
}

function normalizeSession(index, session) {
  return {
    id: `${index}-${session.timestamp}`,
    sleepType: session.sleep_type,
    minutesSlept: Number(session.minutes_slept),
    sleptOnTime: Boolean(session.slept_on_time),
    timestamp: Number(session.timestamp),
    streakAfterLog: Number(session.streak_after_log),
    recoveryScoreAfterLog: Number(session.recovery_score_after_log)
  };
}

async function buildClient(account = "") {
  if (!hasContractConfig()) {
    throw new Error(
      "No contract ID is configured yet. Deploy the Soroban contract, then run `npm run export:frontend`."
    );
  }

  return StellarContract.Client.from({
    contractId: configuredContractId,
    rpcUrl: configuredRpcUrl,
    networkPassphrase: configuredNetworkPassphrase,
    publicKey: account || undefined,
    signTransaction: async (xdr, opts) => {
      const { signedXDR } = await kit.sign({
        xdr,
        network: opts?.networkPassphrase || configuredNetworkPassphrase
      });
      return signedXDR;
    }
  });
}

async function buildRewardClient(account = "") {
  if (!configuredRewardContractId) {
    throw new Error("No reward contract ID configured");
  }

  return StellarContract.Client.from({
    contractId: configuredRewardContractId,
    rpcUrl: configuredRpcUrl,
    networkPassphrase: configuredNetworkPassphrase,
    publicKey: account || undefined,
    signTransaction: async (xdr, opts) => {
      const { signedXDR } = await kit.sign({
        xdr,
        network: opts?.networkPassphrase || configuredNetworkPassphrase
      });
      return signedXDR;
    }
  });
}

async function getWalletSnapshot() {
  try {
    const publicKey = await kit.getPublicKey();
    return {
      account: publicKey,
      network: "testnet",
      networkPassphrase: configuredNetworkPassphrase,
      rpcUrl: configuredRpcUrl
    };
  } catch (error) {
    throw new Error(parseError(error));
  }
}

export function hasContractConfig() {
  return Boolean(configuredContractId);
}



export function getNetworkLabel(networkPassphrase) {
  return networkLabels[networkPassphrase] || "Custom Stellar Network";
}

export function shortAddress(value = "") {
  if (!value) {
    return "Not connected";
  }

  if (value.length <= 14) {
    return value;
  }

  return `${value.slice(0, 6)}...${value.slice(-6)}`;
}

export function formatMinutes(totalMinutes) {
  const minutes = Number(totalMinutes || 0);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  if (!hours) {
    return `${minutes}m`;
  }

  if (!remainder) {
    return `${hours}h`;
  }

  return `${hours}h ${remainder}m`;
}

export function formatDate(unixSeconds) {
  if (!unixSeconds) {
    return "No sleep sessions logged yet";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(Number(unixSeconds) * 1000));
}

export function getExplorerLink(networkPassphrase, hash) {
  if (!hash) {
    return "";
  }

  if (networkPassphrase === "Test SDF Network ; September 2015") {
    return `https://stellar.expert/explorer/testnet/tx/${hash}`;
  }

  if (networkPassphrase === "Public Global Stellar Network ; September 2015") {
    return `https://stellar.expert/explorer/public/tx/${hash}`;
  }

  return "";
}

export function parseError(error) {
  const candidates = [
    error?.message,
    error?.error?.message,
    error?.detail,
    error?.response?.data?.detail,
    error?.toString?.()
  ].filter(Boolean);

  const message = candidates[0] || "Something unexpected happened.";
  
  if (message.includes("reading 'switch'") || message.includes("switch")) {
    return "Transaction simulation failed. Please check your inputs and try again.";
  }
  
  return message;
}

export async function discoverWalletState() {
  try {
    // Try to get existing Freighter address without prompting
    const result = await FreighterAPI.getAddress();
    if (!result.error && result.address) {
      return {
        account: result.address,
        network: "testnet",
        networkPassphrase: configuredNetworkPassphrase,
        rpcUrl: configuredRpcUrl
      };
    }
  } catch (e) {
    // No active session — that's OK
  }
  return { account: "", network: "", networkPassphrase: "", rpcUrl: configuredRpcUrl };
}

export async function connectWallet() {
  // Request access via Freighter (prompts user to unlock/approve)
  const result = await FreighterAPI.requestAccess();
  if (result.error) throw new Error(result.error.message || "Wallet connection failed");
  return {
    account: result.address,
    network: "testnet",
    networkPassphrase: configuredNetworkPassphrase,
    rpcUrl: configuredRpcUrl
  };
}

export async function readDashboard(account) {
  const client = await buildClient();
  const hasProfileTx = await client.has_profile({ sleeper: account });

  if (!hasProfileTx.result) {
    return null;
  }

  const dashboardTx = await client.get_dashboard({ sleeper: account });
  return normalizeDashboard(dashboardTx.result);
}

export async function readRecentSessions(account, limit = 5) {
  const client = await buildClient();
  const countTx = await client.get_session_count({ sleeper: account });
  const count = Number(countTx.result || 0);

  if (!count) {
    return [];
  }

  const indexes = Array.from({ length: Math.min(count, limit) }, (_, idx) => count - idx - 1);
  const sessionResults = await Promise.all(
    indexes.map(async (index) => {
      const sessionTx = await client.get_session({ sleeper: account, index });
      return normalizeSession(index, sessionTx.result);
    })
  );

  return sessionResults;
}

export async function readLeaderboard() {
  const client = await buildClient();
  const tx = await client.get_leaderboard();
  if (!tx.result) {
    return [];
  }
  return tx.result.map((entry) => ({
    sleeper: entry.sleeper,
    displayName: entry.displayName || entry.display_name,
    recoveryScore: Number(entry.recovery_score)
  }));
}

async function submitTransaction(assembledTx) {
  const sentTx = await assembledTx.signAndSend();
  return {
    hash:
      sentTx.sendTransactionResponse?.hash ||
      sentTx.getTransactionResponse?.txHash ||
      "",
    result: sentTx.result
  };
}

export async function saveProfile(account, displayName, weeklyGoalMinutes) {
  const client = await buildClient(account);
  let tx;
  try {
    tx = await client.save_profile({
      sleeper: account,
      display_name: displayName,
      weekly_goal_minutes: Number(weeklyGoalMinutes)
    });
  } catch (err) {
    if (err.message && err.message.includes('switch')) {
      console.error("Soroban SDK switch error during simulation. Underlying error:", err);
      // We often get this when simulation fails on-chain.
      throw new Error("Transaction simulation failed on-chain. Please verify contract inputs and network state.");
    }
    throw err;
  }

  return submitTransaction(tx);
}

export async function updateWeeklyGoal(account, weeklyGoalMinutes) {
  const client = await buildClient(account);
  let tx;
  try {
    tx = await client.update_weekly_goal({
      sleeper: account,
      new_goal_minutes: Number(weeklyGoalMinutes)
    });
  } catch (err) {
    if (err.message && err.message.includes('switch')) {
      console.error("Soroban SDK switch error:", err);
      throw new Error("Transaction simulation failed. Check contract state.");
    }
    throw err;
  }

  return submitTransaction(tx);
}

export async function logSession(account, sleepType, minutesSlept, sleptOnTime) {
  const client = await buildClient(account);
  let tx;
  try {
    tx = await client.log_session({
      sleeper: account,
      sleep_type: sleepType,
      minutes_slept: Number(minutesSlept),
      slept_on_time: Boolean(sleptOnTime)
    });
  } catch (err) {
    if (err.message && err.message.includes('switch')) {
      console.error("Soroban SDK switch error:", err);
      throw new Error("Simulation failed. Make sure you have created a profile first!");
    }
    throw err;
  }

  return submitTransaction(tx);
}

export async function readStakingDashboard(account) {
  if (!configuredRewardContractId) return null;
  const client = await buildRewardClient(account);
  const balanceTx = await client.balance({ id: account });
  const stakedTx = await client.staked_balance({ id: account });
  return {
    balance: Number(balanceTx.result || 0),
    staked: Number(stakedTx.result || 0)
  };
}

export async function stakeTokens(account, amount) {
  const client = await buildRewardClient(account);
  const tx = await client.stake({
    from: account,
    amount: Number(amount)
  });
  return submitTransaction(tx);
}

export async function unstakeTokens(account, amount) {
  const client = await buildRewardClient(account);
  const tx = await client.unstake({
    from: account,
    amount: Number(amount)
  });
  return submitTransaction(tx);
}

function prettifyEventName(eventName = "") {
  return eventName
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function summarizeEventPayload(eventName, payload) {
  if (!payload || typeof payload !== "object") {
    return "Fresh contract activity captured from Soroban RPC.";
  }

  if (eventName === "profile_saved") {
    return `${payload.display_name} set a ${payload.weekly_goal_minutes} minute weekly sleep goal.`;
  }

  if (eventName === "sleep_logged") {
    const timing = payload.slept_on_time ? "on-time" : "off-schedule";
    return `${payload.sleep_type} logged for ${payload.minutes_slept} minutes (${timing}).`;
  }

  if (eventName === "weekly_goal_updated") {
    return `Weekly sleep goal changed to ${payload.weekly_goal_minutes} minutes.`;
  }

  if (eventName === "weekly_goal_reached") {
    return `Weekly sleep goal reached with ${payload.minutes_this_week} minutes and a ${payload.recovery_score} recovery score.`;
  }

  return "Fresh contract activity captured from Soroban RPC.";
}

export async function readContractEvents(limit = 6) {
  if (!hasContractConfig()) {
    return [];
  }

  const server = getRpcServer();
  const latestLedger = await server.getLatestLedger();
  const startLedger = Math.max(1, Number(latestLedger.sequence) - 320);
  const response = await server.getEvents({
    startLedger,
    filters: [
      {
        type: "contract",
        contractIds: [configuredContractId]
      }
    ],
    pagination: {
      limit
    }
  });

  return response.events
    .map((event) => {
      const eventName = scValToNative(event.topic[0]);
      const sleeper = event.topic[1] ? scValToNative(event.topic[1]) : "";
      const payload = event.value ? scValToNative(event.value) : {};

      return {
        id: event.id,
        eventName,
        label: prettifyEventName(eventName),
        sleeper,
        payload,
        summary: summarizeEventPayload(eventName, payload),
        ledger: event.ledger,
        occurredAt: event.ledgerClosedAt,
        txHash: event.txHash
      };
    })
    .reverse();
}
