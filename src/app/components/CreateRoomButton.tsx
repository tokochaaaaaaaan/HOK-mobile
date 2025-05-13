// src/app/components/CreateRoomButton.tsx
"use client";

import { useRouter } from "next/navigation";
import { customAlphabet } from "nanoid";

// 衝突しやすい文字を除いたアルファベット＋数字セット
const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
// 8文字のIDを生成する関数を作成
const generateId = customAlphabet(alphabet, 8);

export default function CreateRoomButton() {
  const router = useRouter();

  const handleCreateRoom = () => {
    // ここでルームIDを生成
    const roomId = generateId();   // 例: "G7K9P4ZQ"
    // 生成したIDで /room/[roomId] に遷移
    router.push(`/room/${roomId}`);
  };

  return (
    <button onClick={handleCreateRoom} style={{ padding: "8px 16px" }}>
      新しいルームを作成
    </button>
  );
}
