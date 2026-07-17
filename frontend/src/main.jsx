import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import ErrorBoundary from "./ErrorBoundary";
import * as Sentry from "@sentry/react";
import { Analytics } from "@vercel/analytics/react";
import { initRuntimeMonitoring } from "./lib/runtime-monitor";
import "./styles.css";

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN || "",
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration(),
  ],
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 20_000
    }
  }
});

initRuntimeMonitoring();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
        <Analytics />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
