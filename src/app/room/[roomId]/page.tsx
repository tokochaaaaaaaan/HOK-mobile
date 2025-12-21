// src/app/room/[roomId]/page.tsx
"use client";

import React, { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useUser } from "@/context/UserContext";
import { usePreventBack } from "@/hooks/usePreventBack";
import { doc, getDoc, updateDoc, onSnapshot, runTransaction } from "firebase/firestore";
import { db } from "../../../../lib/firebase";

export default function RoomPage() {
  const { roomId } = useParams();
  const router = useRouter();
  const { userName } = useUser();

  // ブラウザの戻るボタンを無効化
  usePreventBack();

  const [roomData, setRoomData] = useState<any>(null);
  const [minStops, setMinStops] = useState<number>(3);
  const [startPhase, setStartPhase] = useState<"solo" | "discussion">("solo");

  // ルーム情報のリアルタイム購読（ここで gameStarted も監視します）
  useEffect(() => {
    if (!roomId || typeof roomId !== 'string') return;
    console.log('Setting up room subscription for roomId:', roomId);
    const roomRef = doc(db, "rooms", roomId);
    const unsub = onSnapshot(roomRef, (snap) => {
      console.log('Room snapshot received, exists:', snap.exists());
      if (!snap.exists()) {
        console.log('Room does not exist');
        return;
      }
      const data = snap.data();
      console.log('Room data:', data);
      setRoomData(data);
      // gameStarted フラグが立ったら second ページへ
      if (data.gameStarted) {
        router.push(`/room/${roomId}/second`);
      }
    });
    return () => unsub();
  }, [roomId, router]);

  // 初回ロード時に自動参加
  useEffect(() => {
    if (!roomId || !userName || typeof roomId !== 'string') return;
    console.log('Auto-joining room:', roomId, 'as user:', userName);
    (async () => {
      try {
        const ref = doc(db, "rooms", roomId);
        
        // トランザクションを使用して安全に参加者を追加
        await runTransaction(db, async (transaction) => {
          const snap = await transaction.get(ref);
          if (!snap.exists()) {
            console.log('Room does not exist');
            alert("部屋が存在しません");
            router.push("/");
            return;
          }
          
          const data = snap.data();
          const parts = data.participants || {};
          console.log('Current participants:', parts);
          
          if (!Object.values(parts).some((p: any) => {
            // participants が { id: "name" } 形式か { id: { name, joinedAt } } 形式か判定
            const val = typeof p === 'string' ? p : p?.name;
            return val === userName;
          })) {
            console.log('User not in room, adding:', userName);
            const userId = crypto.randomUUID();
            const newParticipants = {
              ...parts,
              [userId]: {
                name: userName,
                joinedAt: Date.now(),
              },
            };
            console.log('New participants:', newParticipants);
            transaction.update(ref, {
              participants: newParticipants,
            });
            console.log('Successfully added user to room via transaction');
          } else {
            console.log('User already in room');
          }
        });
      } catch (error) {
        console.error('Error joining room:', error);
        // エラーが発生した場合、少し待ってからリトライ
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      }
    })();
  }, [roomId, userName, router]);

  // 「ゲーム開始」クリック時
  const handleStartGame = async () => {
    const parts = roomData?.participants || {};
    const cnt = Object.keys(parts).length;
    if (cnt < 2) {
      alert("参加者がまだ揃っていません");
      return;
    }
    if (startPhase === "discussion") {
      alert("まだ選べません");
      return;
    }
    // Firestore にフラグを書き込む
    if (!roomId || typeof roomId !== 'string') return;
    const roomRef = doc(db, "rooms", roomId);
    await updateDoc(roomRef, {
      minStops,
      startPhase,
      gameStarted: true,
    });
    // ホスト自身は即座に second に飛ばす
    router.push(`/room/${roomId}/second`);
  };

  if (!roomData) return null;

  const participantCount = Object.keys(roomData.participants || {}).length;

  return (
    <>
      {/* 全画面左上の戻るボタン */}
      <button
        onClick={() => router.push('/')}
        style={{
          position: "fixed",
          top: "16px",
          left: "16px",
          padding: "8px 16px",
          backgroundColor: "#6c757d",
          color: "#fff",
          border: "none",
          borderRadius: "6px",
          cursor: "pointer",
          fontSize: "0.9rem",
          zIndex: 1000,
          boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
        }}
      >
        ← トップへ戻る
      </button>

      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          backgroundColor: "#fff",
          padding: "32px",
          borderRadius: "12px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
          width: "360px",
          textAlign: "center",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <h2 style={{ marginBottom: "8px" }}>ユーザ名: {userName}</h2>
      <h3 style={{ marginBottom: "16px", color: "#555" }}>ルームID: {roomId}</h3>

      <div style={{ textAlign: "left", marginBottom: "24px" }}>
        <strong>参加者（{participantCount}/4）</strong>
        <ul style={{ listStyle: "none", padding: 0, margin: "8px 0" }}>
          {Object.entries(roomData.participants || {})
            .map(([id, data]: [string, any]) => ({
              id,
              name: typeof data === 'string' ? data : data?.name || id,
              joinedAt: typeof data === 'string' ? 0 : (data?.joinedAt || 0),
            }))
            .sort((a, b) => a.joinedAt - b.joinedAt)
            .map(({ id, name }) => (
              <li key={id} style={{ margin: "4px 0" }}>• {name}</li>
            ))}
        </ul>
      </div>

      {roomData.host === userName ? (
        <>
          {/* 周遊数入力 */}
          <div style={{ textAlign: "left", marginBottom: "16px" }}>
            <label style={{ display: "block", marginBottom: "4px", fontWeight: "bold" }}>
              周遊数（最小訪問数）：
            </label>
            <input
              type="number"
              min={1}
              max={20}
              value={minStops}
              onChange={e => setMinStops(+e.target.value)}
              style={{
                width: "100%",
                padding: "8px",
                borderRadius: "4px",
                border: "1px solid #ccc",
                boxSizing: "border-box",
                fontSize: "0.9rem",
              }}
            />
          </div>

          {/* フェーズ選択 */}
          <div style={{ textAlign: "left", marginBottom: "24px" }}>
            <label style={{ display: "block", marginBottom: "4px", fontWeight: "bold" }}>
              どのフェーズから始めますか？
            </label>
            <select
              value={startPhase}
              onChange={e => setStartPhase(e.target.value as any)}
              style={{
                width: "100%",
                padding: "8px",
                fontSize: "0.9rem",
                lineHeight: 1.4,
                borderRadius: "4px",
                border: "1px solid #ccc",
                boxSizing: "border-box",
              }}
            >
              <option value="solo">1人フェーズ（考えを整理する）</option>
              <option value="discussion">話し合いフェーズ（議論から始める）</option>
            </select>
          </div>

          {/* ゲーム開始ボタン */}
          <button
            onClick={handleStartGame}
            style={{
              width: "100%",
              padding: "12px 0",
              backgroundColor: "#28a745",
              color: "#fff",
              fontSize: "1rem",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            ゲーム開始
          </button>
        </>
      ) : (
        /* ゲスト画面 */
        <div style={{
          textAlign: "center",
          padding: "24px",
          backgroundColor: "#f8f9fa",
          borderRadius: "8px",
          border: "1px solid #e9ecef",
          color: "#6c757d",
          fontSize: "1rem",
          lineHeight: 1.5,
        }}>
          📍 ホストが目的地の<br />最低周遊数を決めています
          <div style={{ marginTop: "8px", fontSize: "0.9rem" }}>
            しばらくお待ちください...
          </div>
        </div>
      )}
      </div>
    </>
  );
}
