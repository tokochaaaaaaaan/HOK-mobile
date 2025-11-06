"use client";

import React from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
	React.useEffect(() => {
		console.error("Waiting route error:", error);
	}, [error]);

	return (
		<div style={{ minHeight: "50vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
			<div style={{ maxWidth: 520, padding: 16, border: "1px solid #e5e7eb", borderRadius: 12 }}>
				<h3 style={{ marginTop: 0 }}>エラーが発生しました</h3>
				<pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", background: "#f9fafb", padding: 12, borderRadius: 8 }}>
					{error?.message || "Unknown error"}
				</pre>
				<div style={{ display: "flex", justifyContent: "flex-end" }}>
					<button onClick={() => reset()} style={{ padding: "8px 12px", borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff' }}>
						もう一度試す
					</button>
				</div>
			</div>
		</div>
	);
}
