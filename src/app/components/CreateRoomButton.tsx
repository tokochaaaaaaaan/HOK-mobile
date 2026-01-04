"use client";

import { useRouter } from "next/navigation";
import { customAlphabet } from "nanoid";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { addAuthKey } from "../../../lib/firebase-auth";
import { useUser } from "@/context/UserContext";

// 衝突しやすい文字を除いたセット
const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const generateId = customAlphabet(alphabet, 8);

export default function CreateRoomButton() {
  const router = useRouter();
  const { userName } = useUser();

  const handleCreateRoom = async () => {
    if (!userName.trim()) {
      alert("名前を入力してください");
      return;
    }
    const roomId = generateId();
    const roomRef = doc(db, "rooms", roomId);
    await setDoc(roomRef, addAuthKey({
      createdAt: serverTimestamp(),
      host: userName,
      gameStarted: false,
      participants: {},
    }));
    router.push(`/room/${roomId}`);
  };

  return (
    <button
      onClick={handleCreateRoom}
      style={{
        width: "100%",
        padding: "10px 0",
        background: "#28a745",
        color: "#fff",
        border: "none",
        borderRadius: "6px",
        fontSize: "1.1rem",
        cursor: "pointer",
        transition: "background 0.2s",
      }}
    >
      ルーム作成
    </button>
  );
}
