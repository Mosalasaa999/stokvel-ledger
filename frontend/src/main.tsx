import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: "" };
  }
  static getDerivedStateFromError(err: Error) {
    return { error: err?.message || "Unexpected UI error" };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-[#0A1120] text-amber-200 p-6">
          <h2 className="text-lg font-bold mb-2">StokvelLedger Recovered Safely</h2>
          <pre className="text-xs bg-[#131E32] p-3 rounded border border-amber-500 whitespace-pre-wrap">{this.state.error}</pre>
          <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 bg-emerald-600 text-white rounded text-sm font-bold">Reload App</button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
