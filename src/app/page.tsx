"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/context/UserContext";
import CreateRoomButton from "./components/CreateRoomButton";
import styles from "./page.module.css";

export default function HomePage() {
  const router = useRouter();
  const { userName, setUserName } = useUser();
  const [roomIdInput, setRoomIdInput] = useState("");

  const handleJoinRoom = () => {
    if (!userName.trim()) {
      alert("名前を入力してください");
      return;
    }
    if (!roomIdInput.trim()) {
      alert("部屋IDを入力してください");
      return;
    }
    router.push(`/room/${roomIdInput.trim()}`);
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.card}>
        <h1 className={styles.title}>Hang Out King</h1>

        {/* 名前入力（共通） */}
        <div className={styles.row}>
          <label className={styles.label}>名前：</label>
          <input
            className={styles.input}
            type="text"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            placeholder="名前を入力"
          />
        </div>

        {/* ホストセクション：CreateRoomButtonを使う */}
        <div className={styles.section}>
          <div className={styles.sectionLabel}>ホスト</div>
          <CreateRoomButton />
        </div>

        {/* ゲストセクション */}
        <div className={styles.section} style={{ marginTop: "1.5rem" }}>
          <div className={styles.sectionLabel}>ゲスト参加</div>
          <div className={styles.row}>
            <label className={styles.label}>部屋ID：</label>
            <input
              className={styles.input}
              type="text"
              value={roomIdInput}
              onChange={(e) => setRoomIdInput(e.target.value)}
              placeholder="例：ABCD2345"
            />
          </div>
          <button className={styles.joinBtn} onClick={handleJoinRoom}>
            参加する
          </button>
        </div>
      </div>
    </div>
  );
}
