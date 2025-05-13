// src/app/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "../context/UserContext";
import { customAlphabet } from "nanoid";
import { db } from "../../lib/firebase";  // ← src/app から見た相対パス
import { doc, setDoc, serverTimestamp } from "firebase/firestore";

// 0,O,1,I,l を除いた読みやすい文字セットから長さ8のIDを生成する関数
const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const generateId = customAlphabet(alphabet, 8);

export default function HomePage() {
  const router = useRouter();
  const { userName, setUserName } = useUser();

  const [roomIdInput, setRoomIdInput] = useState(""); // 🔸 入力された部屋ID
  const [loading, setLoading] = useState(false);

  const createRoom = async () => {
    if (!userName.trim()) {
      alert("名前を入力してください");
      return;
    }

    setLoading(true);
    const roomId = generateId();

    const roomRef = doc(db, "rooms", roomId);
    await setDoc(roomRef, {
      host: userName,
      participants: {},
      gameStarted: false,
      createdAt: serverTimestamp(),
    });

    router.push(`/room/${roomId}`);
  };

  const joinRoom = () => {
    if (!userName.trim() || !roomIdInput.trim()) {
      alert("名前と部屋IDを両方入力してください");
      return;
    }
    router.push(`/room/${roomIdInput}`);
  };

  return (
    <main style={{ padding: 20 }}>
      <h1>Hang Out King</h1>

      {/* 名前入力 */}
      <div style={{ marginBottom: 16 }}>
        <label>
          お名前：{" "}
          <input
            type="text"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            placeholder="名前を入力"
            style={{ padding: "4px 8px", fontSize: 16 }}
          />
        </label>
      </div>

      {/* 🔵 ルーム作成ボタン */}
      <button
        onClick={createRoom}
        disabled={loading}
        style={{ marginRight: 12, padding: "8px 16px", fontSize: 16 }}
      >
        {loading ? "作成中…" : "ルーム作成"}
      </button>

      {/* 🟢 ルーム参加フォーム */}
      <div style={{ marginTop: 24 }}>
        <label>
          部屋ID：{" "}
          <input
            type="text"
            value={roomIdInput}
            onChange={(e) => setRoomIdInput(e.target.value.toUpperCase())}
            placeholder="例：ABCD1234"
            style={{ padding: "4px 8px", fontSize: 16 }}
          />
        </label>
        <button
          onClick={joinRoom}
          style={{ marginLeft: 12, padding: "8px 16px", fontSize: 16 }}
        >
          参加する
        </button>
      </div>
    </main>
  );
}