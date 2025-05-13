// src/app/layout.tsx
import "./globals.css";
import { ReactNode } from "react";
import { UserProvider } from "@/context/UserContext";

export const metadata = {
  title: "Hang Out King",
  description: "グループ旅行計画サポート",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>
        {/* ← ここで UserProvider でアプリ全体を包む */}
        <UserProvider>
          {children}    {/* これが各ページ (HomePage, RoomPage, MyCardsPage など) */}
        </UserProvider>
      </body>
    </html>
  );
}
