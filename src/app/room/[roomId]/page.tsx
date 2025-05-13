"use client";

import React, { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useUser } from "@/context/UserContext";
import { doc, getDoc, updateDoc, onSnapshot } from "firebase/firestore";
import { db } from "../../../../lib/firebase";

export default function RoomPage() {
  const { roomId } = useParams();
  const router = useRouter();
  const { userName } = useUser();
  const [roomData, setRoomData] = useState<any>(null);

  useEffect(() => {
    if (!roomId) return;
    const roomRef = doc(db, "rooms", roomId);
    const unsub = onSnapshot(roomRef, (docSnap) => {
      const data = docSnap.data();
      if (data) setRoomData(data);
    });
    return () => unsub();
  }, [roomId]);

  useEffect(() => {
    if (roomData?.gameStarted) {
      router.push(`/room/${roomId}/play`);
    }
  }, [roomData, roomId]);


const handleStartGame = async () => {
  const roomRef = doc(db, "rooms", roomId);

  // 現在の参加者数を取得
  const participants = roomData?.participants || {};
  const count = Object.keys(participants).length;

  // gameStarted と expectedCount を同時に保存
  await updateDoc(roomRef, {
    gameStarted: true,
    expectedCount: count,
  });
};


  useEffect(() => {
    const joinRoom = async () => {
      if (!roomId || !userName) return;
      const roomRef = doc(db, "rooms", roomId);
      const roomSnap = await getDoc(roomRef);
      if (!roomSnap.exists()) {
        alert("部屋が存在しません！");
        return;
      }
      const room = roomSnap.data();
      const participants = room.participants || {};
      const alreadyJoined = Object.values(participants).includes(userName);
      if (!alreadyJoined) {
        const newId = crypto.randomUUID();
        await updateDoc(roomRef, {
          participants: {
            ...participants,
            [newId]: userName,
          },
        });
      }
    };
    joinRoom();
  }, [roomId, userName]);

  return (
    <div
      style={{
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        backgroundColor: "#fff",
        padding: "32px",
        border: "2px solid #ccc",
        borderRadius: "12px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
        textAlign: "center",
        fontSize: 24,
      }}
    >
      <div style={{ marginBottom: 24 }}>
        <strong>ユーザ名:</strong> {userName}<br />
        <strong>ルームID:</strong> {roomId}
      </div>

      {roomData && (
        <>
          <div style={{ marginBottom: 16 }}>
            <strong>参加者（{Object.keys(roomData.participants || {}).length}/4）</strong>
            <ul style={{ listStyle: "none", padding: 0 }}>
              {Object.values(roomData.participants || {}).map((name: string, i: number) => (
                <li key={i} style={{ fontSize: 22 }}>{name}</li>
              ))}
            </ul>
          </div>

          {roomData?.host === userName && (
            <button
              onClick={handleStartGame}
              style={{
                marginTop: 24,
                padding: "16px 32px",
                fontSize: 20,
                backgroundColor: "#28a745",
                color: "#fff",
                border: "none",
                borderRadius: 10,
                cursor: "pointer"
              }}
            >
              ゲーム開始！
            </button>
          )}
        </>
      )}
    </div>
  );
}
