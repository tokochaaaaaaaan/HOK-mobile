// src/app/components/Card.tsx
"use client";

type CardProps = {
  title: string;
  imageUrl: string;
};

export default function Card({ title, imageUrl }: CardProps) {
  return (
    <div style={{ border: "1px solid #ccc", padding: "8px", borderRadius: "8px" }}>
      <img src={imageUrl} alt={title} style={{ width: "100%", height: "auto" }} />
      <h3 style={{ fontSize: "16px", marginTop: "8px" }}>{title}</h3>
    </div>
  );
}
