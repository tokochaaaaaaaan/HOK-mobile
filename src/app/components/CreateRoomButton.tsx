"use client";

import { useRouter } from "next/navigation";
import { customAlphabet } from "nanoid";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { addAuthKey } from "../../../lib/firebase-auth";
import { useUser } from "@/context/UserContext";
import { useState } from "react";
import { getFuriganaText } from "@/components/FuriganaText";

// 衝突しやすい文字を除いたセット
const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const generateId = customAlphabet(alphabet, 8);

export default function CreateRoomButton() {
  const router = useRouter();
  const { userName } = useUser();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreateRoom = async () => {
    setError(null);
    
    if (!userName.trim()) {
      setError("名前を入力してください");
      alert("名前を入力してください");
      return;
    }

    setIsLoading(true);
    try {
      const roomId = generateId();
      const roomRef = doc(db, "rooms", roomId);
      
      console.log('[CreateRoomButton] Creating room:', { roomId, host: userName });
      
      await setDoc(roomRef, addAuthKey({
        createdAt: serverTimestamp(),
        host: userName,
        gameStarted: false,
        participants: {},
      }));
      
      console.log('[CreateRoomButton] Room created successfully:', roomId);
      router.push(`/room/${roomId}`);
    } catch (err: any) {
      const errMsg = err?.message || String(err) || 'Unknown error';
      console.error('[CreateRoomButton] Room creation failed:', err);
      setError(`ルーム作成に失敗しました: ${errMsg}`);
      alert(`エラー: ${errMsg}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      {error && (
        <div style={{
          marginBottom: "12px",
          padding: "10px",
          background: "#f8d7da",
          color: "#721c24",
          border: "1px solid #f5c6cb",
          borderRadius: "4px",
          fontSize: "0.9rem"
        }}>
          ⚠️ {error}
        </div>
      )}
      <button
        onClick={handleCreateRoom}
        disabled={isLoading}
        style={{
          width: "100%",
          padding: "10px 0",
          background: isLoading ? "#ccc" : "#28a745",
          color: "#fff",
          border: "none",
          borderRadius: "6px",
          fontSize: "1.1rem",
          cursor: isLoading ? "not-allowed" : "pointer",
          transition: "background 0.2s",
          opacity: isLoading ? 0.6 : 1,
        }}
      >
        {isLoading ? getFuriganaText("作成中...") : getFuriganaText("ルーム作成")}
      </button>
    </>
  );
}
