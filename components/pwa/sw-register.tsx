"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      process.env.NODE_ENV === "production"
    ) {
      navigator.serviceWorker.register("/sw.js").then(
        (reg) => {
          // Check for updates periodically (every hour)
          setInterval(() => reg.update(), 60 * 60 * 1000);
        },
        (err) => console.error("SW registration failed:", err)
      );
    }
  }, []);

  return null;
}
