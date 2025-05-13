"use client";

import React, { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { DndProvider, useDrag, useDrop } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { useUser } from "@/context/UserContext";

const dropAreaColors: Record<string, string> = {
  行きたい: "pink",
  "どちらでもいい": "lightgray",
  行きたくない: "lightblue",
};

const Card = ({ src }: { src: string }) => {
  const [{ isDragging }, drag] = useDrag(() => ({
    type: "CARD",
    item: { src },
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
  }));
  return (
    <img
      ref={drag}
      src={src}
      alt="card"
      style={{
        width: "80px",
        margin: "0 8px",
        cursor: "move",
        opacity: isDragging ? 0.5 : 1,
      }}
    />
  );
};

const DropArea = ({
  category,
  onDrop,
}: {
  category: string;
  onDrop: (src: string) => void;
}) => {
  const [, drop] = useDrop({
    accept: "CARD",
    drop: (item: { src: string }) => onDrop(item.src),
  });
  return (
    <div
      ref={drop}
      style={{
        width: "250px",
        height: "180px",
        margin: "10px",
        border: "2px dashed #ccc",
        borderRadius: "8px",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: dropAreaColors[category],
      }}
    >
      {category}
    </div>
  );
};

const categories = ["行きたい", "どちらでもいい", "行きたくない"];
const totalCards = 3;
const cards = Array.from(
  { length: totalCards },
  (_, i) => `/pngs/USJ_${i + 1}_surface-1.png`
);

export default function PlayPage() {
  const { roomId } = useParams();
  const router = useRouter();
  const { userName, cardPositions, setCardPositions } = useUser();

  const safeCardPositions: Record<string, string[]> = cardPositions ?? {
    行きたい: [],
    "どちらでもいい": [],
    行きたくない: [],
  };

  const handleDrop = (category: string, src: string) => {
    setCardPositions((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((key) => {
        next[key] = next[key].filter((s) => s !== src);
      });
      next[category].push(src);
      return next;
    });
  };

  const unallocatedCards = cards.filter(
    (src) => !Object.values(safeCardPositions).flat().includes(src)
  );

  useEffect(() => {
    if (unallocatedCards.length === 0) {
      router.push(`/room/${roomId}/mycards`);
    }
  }, [unallocatedCards, roomId, router]);

  return (
    <DndProvider backend={HTML5Backend}>
      <div
        style={{
          position: "fixed",
          top: 20,
          left: 20,
          backgroundColor: "#fff",
          padding: "8px 16px",
          borderRadius: 4,
        }}
      >
        ユーザ: <strong>{userName}</strong> | ルームID: <strong>{roomId}</strong>
      </div>

      <div style={{ display: "flex", justifyContent: "center", marginTop: 80 }}>
        {categories.map((cat) => (
          <DropArea key={cat} category={cat} onDrop={(src) => handleDrop(cat, src)} />
        ))}
      </div>

      <div
        style={{
          position: "fixed",
          bottom: 20,
          left: 0,
          width: "100%",
          display: "flex",
          justifyContent: "flex-start",
          overflowX: "auto",
          padding: 10,
          backgroundColor: "rgba(255,255,255,0.9)",
        }}
      >
        {unallocatedCards.map((src) => (
          <Card key={src} src={src} />
        ))}
      </div>
    </DndProvider>
  );
}
