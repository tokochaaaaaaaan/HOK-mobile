"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/context/UserContext";
import CreateRoomButton from "./components/CreateRoomButton";
import styles from "./page.module.css";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { getFuriganaText } from "@/components/FuriganaText";

export default function HomePage() {
  const router = useRouter();
  const { userName, setUserName } = useUser();
  const [recentRooms, setRecentRooms] = useState<
    Array<{ id: string; host?: string; createdAt?: Date }>
  >([]);
  const [selectedRoomId, setSelectedRoomId] = useState("");

  // 直近30分以内に作成された部屋だけを取得してプルダウンに表示
  useEffect(() => {
    const THIRTY_MIN = 30 * 60 * 1000;
    const threshold = new Date(Date.now() - THIRTY_MIN);
    const q = query(
      collection(db, "rooms"),
      where("createdAt", ">=", threshold),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(q, (snap) => {
      const rooms = snap.docs
        .map((d) => {
          const data: any = d.data();
          const created = data?.createdAt?.toDate?.() as Date | undefined;
          return {
            id: d.id,
            host: data?.host,
            createdAt: created,
          };
        })
        .filter((r) =>
          r.createdAt ? r.createdAt.getTime() >= Date.now() - THIRTY_MIN : false
        );

      setRecentRooms(rooms);
      // まだ選択されていない場合は最新の部屋をデフォルト選択
      setSelectedRoomId((prev) => prev || rooms[0]?.id || "");
    });

    return () => unsub();
  }, []);

  const handleJoinRoom = () => {
    if (!userName.trim()) {
      alert("名前を入力してください");
      return;
    }
    if (!selectedRoomId.trim()) {
      alert("入室可能な部屋がありません");
      return;
    }
    router.push(`/room/${selectedRoomId.trim()}`);
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.card}>
        <h1 className={styles.title}>Hang Out King</h1>

        {/* 名前入力（共通） */}
        <div className={styles.row}>
          <label className={styles.label}>{getFuriganaText("名前")}：</label>
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
          <div className={styles.sectionLabel}>{getFuriganaText("ゲスト参加")}</div>
          <div className={styles.row}>
            <label className={styles.label}>{getFuriganaText("部屋")}：</label>
            <select
              className={styles.input}
              value={selectedRoomId}
              onChange={(e) => setSelectedRoomId(e.target.value)}
            >
              {recentRooms.length === 0 ? (
                <option value="">ー</option>
              ) : (
                recentRooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.id}
                  </option>
                ))
              )}
            </select>
          </div>
          <button className={styles.joinBtn} onClick={handleJoinRoom}>
            {getFuriganaText("参加する")}
          </button>
        </div>
      </div>
    </div>
  );
}
