"use client";

import React from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  React.useEffect(() => {
    // ここでログ送信など
    console.error("Global error:", error);
  }, [error]);

  return (
    <html>
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial" }}>
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#fff" }}>
          <div style={{ maxWidth: 560, padding: 24, border: "1px solid #e5e7eb", borderRadius: 12 }}>
            <h2 style={{ marginTop: 0, marginBottom: 12 }}>エラーが発生しました</h2>
            <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", background: "#f9fafb", padding: 12, borderRadius: 8 }}>
              {error?.message || "Unknown error"}
            </pre>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <button onClick={() => reset()} style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: "#2563eb", color: "#fff", cursor: "pointer" }}>
                もう一度試す
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
