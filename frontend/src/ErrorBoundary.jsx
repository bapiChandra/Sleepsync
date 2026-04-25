import { Component } from "react";
import { reportRuntimeError } from "./lib/runtime-monitor";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false
    };
  }

  static getDerivedStateFromError() {
    return {
      hasError: true
    };
  }

  componentDidCatch(error, errorInfo) {
    reportRuntimeError(error, {
      source: "react.error-boundary",
      componentStack: errorInfo.componentStack
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="crash-shell">
          <section className="crash-card">
            <p className="kicker">Runtime recovery</p>
            <h1>SleepSync hit an unexpected client error.</h1>
            <p className="lead">
              Reload the page to recover. If you configured `VITE_ERROR_TRACKING_URL`, the
              failure details were also reported for follow-up.
            </p>
            <button className="button button-primary" onClick={() => window.location.reload()}>
              Reload app
            </button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
