// src/app/Providers.tsx
"use client";
import { ReactNode } from "react";
import { UserProvider } from "../context/UserContext";

export default function Providers({ children }: { children: ReactNode }) {
  console.log("🌟 Providers rendered");
  return (
    <UserProvider>
      <h2 style={{ margin: 20, color: "blue" }}>✨ Providers is working!</h2>
      {children}
    </UserProvider>
  );
}
