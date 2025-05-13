"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../../../../../lib/firebase";

type Result = {
  userName: string;
  positions: Record<string, string[]>;
};

// 全カード一覧（3枚運用なら３枚。40枚運用なら40枚）
const allCards = [
  "/pngs/USJ_1_surface-1.png",
  "/pngs/USJ_2_surface-1.png",
  "/pngs/USJ_3_surface-1.png",
  // 以降 4…40 まで
];

export default function ResultPage() {
  const { roomId } = useParams();
  const [results, setResults] = useState<Result[]>([]);

  // Firestore から全参加者の results をリアルタイム取得
  useEffect(() => {
    const col = collection(db, "rooms", roomId, "results");
    const unsub = onSnapshot(col, (snap) => {
      setResults(snap.docs.map(d => d.data() as Result));
    });
    return () => unsub();
  }, [roomId]);

  // カードごとの配分表を作る
  const distribution = React.useMemo(() => {
    // 初期化
    const dist: Record<string, { go: string[]; maybe: string[]; no: string[] }> = {};
    allCards.forEach((src) => {
      dist[src] = { go: [], maybe: [], no: [] };
    });
    // 結果を集計
    results.forEach(({ userName, positions }) => {
      Object.entries(positions).forEach(([cat, srcs]) => {
        srcs.forEach((src) => {
          if (!dist[src]) dist[src] = { go: [], maybe: [], no: [] };
          if (cat === "行きたい") dist[src].go.push(userName);
          if (cat === "どちらでもいい") dist[src].maybe.push(userName);
          if (cat === "行きたくない") dist[src].no.push(userName);
        });
      });
    });
    return dist;
  }, [results]);

  return (
    <div style={{ padding: 24, fontFamily: "sans-serif" }}>
      <h1>カード別 配分結果</h1>
      {allCards.map((src) => {
        const d = distribution[src];
        return (
          <div key={src} style={{ marginBottom: 32 }}>
            <img src={src} alt="" style={{ width: 100, display: "block", marginBottom: 8 }} />
            <div style={{ display: "flex", gap: 16 }}>
              <div>
                <strong>行きたい:</strong>
                <div>{d.go.length ? d.go.join(", ") : "－"}</div>
              </div>
              <div>
                <strong>どちらでもいい:</strong>
                <div>{d.maybe.length ? d.maybe.join(", ") : "－"}</div>
              </div>
              <div>
                <strong>行きたくない:</strong>
                <div>{d.no.length ? d.no.join(", ") : "－"}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
