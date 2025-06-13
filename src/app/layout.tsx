// src/app/layout.tsx
import "./globals.css";
import { ReactNode } from "react";
import { UserProvider } from "@/context/UserContext";
import styles from "./layout.module.css";  // 追加

export const metadata = {
  title: "Hang Out King",
  description: "グループ旅行計画サポート",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="ja">
      <body className={styles.body}>
        <UserProvider>
          <div className={styles.container}>
            {children}
          </div>
        </UserProvider>
      </body>
    </html>
  );
}
