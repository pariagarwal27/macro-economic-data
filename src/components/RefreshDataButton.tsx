"use client";

import { useState } from "react";

type RefreshDataButtonProps = {
  onComplete?: () => void;
};

export function RefreshDataButton({
  onComplete,
}: RefreshDataButtonProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");

  async function handleRefresh() {
    if (refreshing) return;

    setRefreshing(true);
    setMessage("");

    try {
      const response = await fetch("/api/refresh-data", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode: "refresh",
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
  const data = (await response.json()) as { error?: string };

  throw new Error(
    data.error || "Unable to refresh data."
  );
}

      setMessage("Data refreshed");
      onComplete?.();

      window.setTimeout(() => {
        setMessage("");
      }, 3000);
    } catch (error) {
      console.error("Refresh failed:", error);

      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to refresh data."
      );
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="refresh-data-control">
      <button
        type="button"
        className="refresh-data-button"
        onClick={handleRefresh}
        disabled={refreshing}
      >
        {refreshing ? "Refreshing…" : "Refresh Data"}
      </button>

      {message && (
        <span className="refresh-data-message">
          {message}
        </span>
      )}
    </div>
  );
}