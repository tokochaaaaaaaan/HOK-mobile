// src/app/room/[roomId]/page.tsx
"use client";

import React, { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useUser } from "@/context/UserContext";
import { usePreventBack } from "@/hooks/usePreventBack";
import { doc, getDoc, updateDoc, onSnapshot, runTransaction } from "firebase/firestore";
import { db } from "../../../../lib/firebase";
import { addAuthKey } from "../../../../lib/firebase-auth";

export default function RoomPage() {
  const { roomId } = useParams();
  const router = useRouter();
  const { userName } = useUser();

  const DEFAULT_MIN_STOPS = 6;

  // ブラウザの戻るボタンを無効化
  usePreventBack();

  const [roomData, setRoomData] = useState<any>(null);
  const [startPhase] = useState<"mobile">("mobile");
  const hasNavigatedRef = useRef(false);

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
    });
    return () => unsub();
  }, [roomId, router]);

  // gameStarted を検知したら（ホスト/ゲスト問わず）secondに遷移
  useEffect(() => {
    if (!roomId || typeof roomId !== "string") return;
    if (!roomData?.gameStarted) return;
    if (hasNavigatedRef.current) return;

    hasNavigatedRef.current = true;
    router.push(`/room/${roomId}/second`);
  }, [roomData, roomId, router]);

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
    if (cnt < 1) return;
    // Firestore にフラグを書き込む
    if (!roomId || typeof roomId !== 'string') return;
    const roomRef = doc(db, "rooms", roomId);
    await updateDoc(roomRef, addAuthKey({
      minStops: roomData?.minStops ?? DEFAULT_MIN_STOPS,
      startPhase,
      gameStarted: true,
    }));
    // ホスト自身も常にsecondに遷移
    router.push(`/room/${roomId}/second`);
  };

  if (!roomData) return null;

  const participantCount = Object.keys(roomData.participants || {}).length;

  return (
    <div
      style={{
        minHeight: "100dvh",
        width: "100%",
        backgroundColor: "#fff",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 72px)",
        paddingLeft: "16px",
        paddingRight: "16px",
        paddingBottom: "24px",
        boxSizing: "border-box",
      }}
    >
      {/* 全画面左上の戻るボタン */}
      <button
        onClick={() => router.push('/')}
        style={{
          position: "fixed",
          top: "calc(env(safe-area-inset-top, 0px) + 12px)",
          left: "calc(env(safe-area-inset-left, 0px) + 12px)",
          padding: "10px 14px",
          minHeight: "44px",
          backgroundColor: "#6c757d",
          color: "#fff",
          border: "none",
          borderRadius: "10px",
          cursor: "pointer",
          fontSize: "0.95rem",
          zIndex: 1000,
          boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
        }}
      >
        ← トップへ戻る
      </button>

      <div
        style={{
          backgroundColor: "#fff",
          padding: "24px",
          borderRadius: "12px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
          width: "100%",
          maxWidth: "420px",
          textAlign: "center",
          fontFamily: "Arial, sans-serif",
          boxSizing: "border-box",
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
          color: "#0f172a",
          fontSize: "1rem",
          lineHeight: 1.5,
          fontWeight: 700,
        }}>
          📍 ホストがゲームを開始するのを待っています
          <div style={{ marginTop: "8px", fontSize: "0.9rem", color: "#0f172a", fontWeight: 700 }}>
            しばらくお待ちください...
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
