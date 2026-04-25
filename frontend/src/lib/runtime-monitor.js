const trackingUrl = import.meta.env.VITE_ERROR_TRACKING_URL || "";
let monitoringStarted = false;

function extractErrorDetails(error) {
  if (!error) {
    return {
      name: "UnknownError",
      message: "Unknown runtime failure"
    };
  }

  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: error.message || "Unexpected runtime error",
      stack: error.stack || ""
    };
  }

  if (typeof error === "string") {
    return {
      name: "RuntimeError",
      message: error
    };
  }

  return {
    name: "RuntimeError",
    message: JSON.stringify(error)
  };
}

function sendPayload(payload) {
  if (!trackingUrl || typeof window === "undefined") {
    return;
  }

  const body = JSON.stringify(payload);

  if (navigator.sendBeacon) {
    navigator.sendBeacon(
      trackingUrl,
      new Blob([body], {
        type: "application/json"
      })
    );
    return;
  }

  fetch(trackingUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body,
    keepalive: true
  }).catch(() => {
    // Swallow reporting failures so monitoring never breaks the UI.
  });
}

export function reportRuntimeError(error, context = {}) {
  const details = extractErrorDetails(error);
  const payload = {
    ...details,
    context,
    href: typeof window !== "undefined" ? window.location.href : "",
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    occurredAt: new Date().toISOString()
  };

  console.error("[runtime-monitor]", payload);
  sendPayload(payload);
}

export function initRuntimeMonitoring() {
  if (monitoringStarted || typeof window === "undefined") {
    return;
  }

  monitoringStarted = true;

  window.addEventListener("error", (event) => {
    reportRuntimeError(event.error || event.message, {
      source: "window.error",
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    reportRuntimeError(event.reason, {
      source: "window.unhandledrejection"
    });
  });
}
