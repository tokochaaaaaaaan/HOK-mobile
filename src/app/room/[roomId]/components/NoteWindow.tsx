"use client";

import React, { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useUser } from "@/context/UserContext";
import { doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../../../../../lib/firebase";
import styles from "./NoteWindow.module.css";

type NoteMode = "solo" | "multi";

interface NoteWindowProps {
  currentPage: "play" | "play2" | "waiting" | "play3" | "result";
}

export default function NoteWindow({ currentPage }: NoteWindowProps) {
  const params = useParams();
  const roomId = Array.isArray(params?.roomId)
    ? params.roomId[0]
    : (params?.roomId as string);
  const { userName } = useUser();

  // ノートウィンドウの状態
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<NoteMode>("solo");
  const [soloHtml, setSoloHtml] = useState("");
  const [multiHtml, setMultiHtml] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [overlayMouseDown, setOverlayMouseDown] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);

  // play3フェーズかどうかを判定（multiモードの有効性）
  const isPlay3 = currentPage === "play3";
  const canUseMulti = isPlay3;

  // ウィンドウが開いているときに背景のスクロールを防ぐ
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // ノート読み込み
  useEffect(() => {
    if (!roomId || !userName) return;

    const loadNotes = async () => {
      try {
        // Soloノート読み込み
        const soloRef = doc(db, "solo_log", roomId, userName, "note");
        const soloSnap = await getDoc(soloRef);
        if (soloSnap.exists()) {
          setSoloHtml(soloSnap.data().content || "");
        }

        // Multiノート読み込み（play3の場合のみ）
        if (isPlay3) {
          const multiRef = doc(db, "multi_log", roomId, "note");
          const multiSnap = await getDoc(multiRef);
          if (multiSnap.exists()) {
            setMultiHtml(multiSnap.data().content || "");
          }
        }
      } catch (error) {
        console.error("Note loading error:", error);
      }
    };

    loadNotes();
  }, [roomId, userName, isPlay3]);

  // エディタの初期化（モード切り替え時）
  useEffect(() => {
    if (editorRef.current && isOpen) {
      const html = mode === "solo" ? soloHtml : multiHtml;
      if (editorRef.current.innerHTML !== html) {
        editorRef.current.innerHTML = html;
      }
    }
  }, [mode, isOpen]);

  // ウィンドウを閉じるときにセーブ
  const handleClose = async () => {
    setIsSaving(true);

    try {
      // Soloノートをセーブ
      if (roomId && userName) {
        const soloRef = doc(db, "solo_log", roomId, userName, "note");
        await setDoc(
          soloRef,
          {
            content: soloHtml,
            updatedAt: serverTimestamp(),
            userName,
          },
          { merge: true }
        );
      }

      // Multiノートをセーブ（play3でのみ）
      if (isPlay3 && roomId) {
        const multiRef = doc(db, "multi_log", roomId, "note");
        await setDoc(
          multiRef,
          {
            content: multiHtml,
            updatedAt: serverTimestamp(),
            lastUpdatedBy: userName,
          },
          { merge: true }
        );
      }
    } catch (error) {
      console.error("Note saving error:", error);
    } finally {
      setIsSaving(false);
      setIsOpen(false);
    }
  };

  // ツールバー機能
  const applyFormat = (command: string, value?: string) => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
  };

  const insertBullet = (type: "ul" | "ol") => {
    if (type === "ul") {
      document.execCommand("insertUnorderedList", false);
    } else {
      document.execCommand("insertOrderedList", false);
    }
    editorRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Tabキー: インデント
    if (e.key === "Tab") {
      e.preventDefault();
      if (e.shiftKey) {
        document.execCommand("outdent", false);
      } else {
        document.execCommand("indent", false);
      }
      editorRef.current?.focus();
    }
  };

  return (
    <>
      {/* ノートアイコン（マップボタンと同じスタイル） */}
      <button
        onClick={() => setIsOpen(true)}
        className={styles.noteIcon}
        aria-label="ノートを表示"
      >
        <span className={styles.iconEmoji}>📝</span>
        <span className={styles.iconText}>メモ</span>
      </button>

      {/* ノートウィンドウ */}
      {isOpen && (
        <div 
          className={styles.noteOverlay} 
          onMouseDown={(e) => {
            // オーバーレイ上でマウスダウンしたかを記録
            if (e.target === e.currentTarget) {
              setOverlayMouseDown(true);
            }
          }}
          onMouseUp={(e) => {
            // オーバーレイでマウスダウンして、そこでマウスアップしたら閉じる
            if (e.target === e.currentTarget && overlayMouseDown) {
              handleClose();
            }
            setOverlayMouseDown(false);
          }}
        >
          <div
            className={styles.noteWindow}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
          >
            {/* ヘッダー */}
            <div className={styles.noteHeader}>
              <h2 className={styles.noteTitle}>📝 ノート</h2>
              <button
                onClick={handleClose}
                className={styles.closeBtn}
                disabled={isSaving}
              >
                ✕
              </button>
            </div>

            {/* モード切り替えタブ */}
            <div className={styles.tabContainer}>
              <button
                className={`${styles.tab} ${
                  mode === "solo" ? styles.tabActive : ""
                }`}
                onClick={() => setMode("solo")}
              >
                1人用
              </button>
              <button
                className={`${styles.tab} ${
                  mode === "multi" ? styles.tabActive : ""
                } ${!canUseMulti ? styles.tabDisabled : ""}`}
                onClick={() => canUseMulti && setMode("multi")}
                disabled={!canUseMulti}
                title={!canUseMulti ? "play3でのみ使用可能" : ""}
              >
                全体用
              </button>
            </div>

            {/* ツールバー */}
            <div className={styles.toolbar}>
              <button
                onClick={() => applyFormat("bold")}
                className={styles.toolBtn}
                title="太字 (Ctrl+B)"
              >
                <strong>B</strong>
              </button>
              <button
                onClick={() => applyFormat("italic")}
                className={styles.toolBtn}
                title="斜体 (Ctrl+I)"
              >
                <em>I</em>
              </button>
              <button
                onClick={() => applyFormat("underline")}
                className={styles.toolBtn}
                title="下線 (Ctrl+U)"
              >
                <u>U</u>
              </button>
              <div className={styles.divider}></div>
              <button
                onClick={() => insertBullet("ul")}
                className={styles.toolBtn}
                title="箇条書き"
              >
                ●
              </button>
              <button
                onClick={() => insertBullet("ol")}
                className={styles.toolBtn}
                title="番号付きリスト"
              >
                1.
              </button>
              <div className={styles.divider}></div>
              <button
                onClick={() => applyFormat("outdent")}
                className={styles.toolBtn}
                title="インデント解除 (Shift+Tab)"
              >
                ◁
              </button>
              <button
                onClick={() => applyFormat("indent")}
                className={styles.toolBtn}
                title="インデント (Tab)"
              >
                ▷
              </button>
            </div>

            {/* リッチテキストエディタ */}
            <div
              ref={editorRef}
              id={mode === "solo" ? "solo-editor" : "multi-editor"}
              className={styles.editor}
              contentEditable
              suppressContentEditableWarning
              onInput={() => {
                if (editorRef.current) {
                  if (mode === "solo") {
                    setSoloHtml(editorRef.current.innerHTML);
                  } else {
                    setMultiHtml(editorRef.current.innerHTML);
                  }
                }
              }}
              onKeyDown={handleKeyDown}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
            />

            {/* フッター */}
            <div className={styles.footer}>
              <span className={styles.modeInfo}>
                {mode === "solo"
                  ? "1人用（すべてのページで使用可能）"
                  : "全体用（play3のみ）"}
              </span>
              <button
                onClick={handleClose}
                className={styles.saveBtn}
                disabled={isSaving}
              >
                {isSaving ? "保存中..." : "閉じる"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
