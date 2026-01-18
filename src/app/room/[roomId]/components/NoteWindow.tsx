"use client";

import React, { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import { useUser } from "@/context/UserContext";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "../../../../../lib/firebase";
import styles from "./NoteWindow.module.css";

type NoteMode = "solo" | "multi";

interface NoteWindowProps {
  currentPage: "play" | "play2" | "waiting" | "play3" | "result" | "discussion";
}

interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
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
  const [windowState, setWindowState] = useState<WindowState>({
    x: 100,
    y: 100,
    width: 500,
    height: 400,
  });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [editingUsers, setEditingUsers] = useState<string[]>([]);
  const dragLongPressTimerRef = useRef<number | null>(null);
  const isHeaderMouseDownRef = useRef(false);
  const dragMoveHandlerRef = useRef<((e: MouseEvent) => void) | null>(null);
  const dragUpHandlerRef = useRef<((e: MouseEvent) => void) | null>(null);
  const resizeMoveHandlerRef = useRef<((e: MouseEvent) => void) | null>(null);
  const resizeUpHandlerRef = useRef<((e: MouseEvent) => void) | null>(null);
  const prevBodyCursorRef = useRef<string>("");
  const prevMultiModeEnabledRef = useRef(false);
  const isLocalDirtyRef = useRef(false);
  const remotePendingHtmlRef = useRef<string | null>(null);
  const lastWriteAtRef = useRef(0);
  const pendingWriteTimerRef = useRef<number | null>(null);
  const presenceHeartbeatRef = useRef<number | null>(null);
  const multiHtmlRef = useRef("");
  const editorRef = useRef<HTMLDivElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  
  // HTMLが実質的に空かどうか判定
  const isHtmlEmpty = (html: string) => {
    const tmp = document.createElement("div");
    tmp.innerHTML = html || "";
    const text = (tmp.textContent || "").trim();
    return text.length === 0;
  };

  // play3フェーズかどうかを判定（multiモードの有効性）
  const isPlay3 = currentPage === "play3";
  const isDiscussion = currentPage === "discussion";
  // 仕様変更：discussionに入った時点で全体用は最初から使用可能
  const canUseMulti = isPlay3 || isDiscussion;

  // localStorage からウィンドウ状態を読み込み
  useEffect(() => {
    const saved = localStorage.getItem("noteWindowState");
    if (saved) {
      try {
        setWindowState(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load window state:", e);
      }
    }
  }, []);

  // ウィンドウ状態が変わったら localStorage に保存
  useEffect(() => {
    localStorage.setItem("noteWindowState", JSON.stringify(windowState));
  }, [windowState]);

  // 仕様：メモ表示中でも、ウィンドウ外は通常通り操作可能にする（スクロールもブロックしない）

  const clearDragLongPressTimer = () => {
    if (dragLongPressTimerRef.current !== null) {
      window.clearTimeout(dragLongPressTimerRef.current);
      dragLongPressTimerRef.current = null;
    }
  };

  const stopDrag = () => {
    clearDragLongPressTimer();
    isHeaderMouseDownRef.current = false;
    if (dragMoveHandlerRef.current) {
      window.removeEventListener("mousemove", dragMoveHandlerRef.current);
      dragMoveHandlerRef.current = null;
    }
    if (dragUpHandlerRef.current) {
      window.removeEventListener("mouseup", dragUpHandlerRef.current);
      dragUpHandlerRef.current = null;
    }
    document.body.style.cursor = prevBodyCursorRef.current || "";
    setIsDragging(false);
  };

  const stopResize = () => {
    if (resizeMoveHandlerRef.current) {
      window.removeEventListener("mousemove", resizeMoveHandlerRef.current);
      resizeMoveHandlerRef.current = null;
    }
    if (resizeUpHandlerRef.current) {
      window.removeEventListener("mouseup", resizeUpHandlerRef.current);
      resizeUpHandlerRef.current = null;
    }
    document.body.style.cursor = prevBodyCursorRef.current || "";
    setIsResizing(false);
  };

  // 閉じた/アンマウント時に、ドラッグ/リサイズを確実に解除
  useEffect(() => {
    if (!isOpen) {
      stopDrag();
      stopResize();

      stopPresenceHeartbeat();
      if (mode === "multi" && canUseMulti) {
        setPresence(false).catch((e) => console.error("Presence update error:", e));
      }
    }
    return () => {
      stopDrag();
      stopResize();

      stopPresenceHeartbeat();
      if (mode === "multi" && canUseMulti) {
        setPresence(false).catch((e) => console.error("Presence update error:", e));
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

        // Multiノート読み込み（play3またはdiscussion）
        if (canUseMulti) {
          const multiRef = doc(db, "multi_log", roomId, "notes", "shared");
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
  }, [roomId, userName, canUseMulti]);

  // discussionはメモを開いたら最初からmulti
  useEffect(() => {
    if (isOpen && isDiscussion) {
      setMode("multi");
    }
  }, [isOpen, isDiscussion]);

  // エディタの初期化（モード切り替え時）
  useEffect(() => {
    if (editorRef.current && isOpen) {
      // 編集中（フォーカス中）は上書きしない
      if (document.activeElement === editorRef.current) return;
      const html = mode === "solo" ? soloHtml : multiHtml;
      if (editorRef.current.innerHTML !== html) {
        editorRef.current.innerHTML = html;
      }
    }
  }, [mode, isOpen, soloHtml, multiHtml]);

  useEffect(() => {
    multiHtmlRef.current = multiHtml;
  }, [multiHtml]);

  const clearPendingWriteTimer = () => {
    if (pendingWriteTimerRef.current !== null) {
      window.clearTimeout(pendingWriteTimerRef.current);
      pendingWriteTimerRef.current = null;
    }
  };

  const scheduleMultiWrite = (nextHtml: string) => {
    if (!roomId || !userName) return;

    clearPendingWriteTimer();
    pendingWriteTimerRef.current = window.setTimeout(async () => {
      const now = Date.now();
      const minIntervalMs = 2000; // 課金を抑えるため最小間隔を長めに
      const elapsed = now - lastWriteAtRef.current;
      if (elapsed < minIntervalMs) {
        scheduleMultiWrite(nextHtml);
        return;
      }

      try {
        const multiRef = doc(db, "multi_log", roomId, "notes", "shared");
        lastWriteAtRef.current = Date.now();
        await setDoc(
          multiRef,
          {
            content: nextHtml,
            updatedAt: serverTimestamp(),
            lastUpdatedBy: userName,
          },
          { merge: true }
        );
        isLocalDirtyRef.current = false;
      } catch (error) {
        console.error("Multi note realtime save error:", error);
      }
    }, 1200);
  };

  // 全体用のリアルタイム同期（メモが開いていてmultiモードの時だけ）
  useEffect(() => {
    if (!roomId || !userName) return;
    if (!isOpen) return;
    if (mode !== "multi") return;
    if (!canUseMulti) return;

    const multiRef = doc(db, "multi_log", roomId, "notes", "shared");
    const unsubscribe = onSnapshot(
      multiRef,
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data() as any;
        const next = String(data?.content || "");
        const updatedBy = String(data?.lastUpdatedBy || "");

        // 自分の更新 or 同じ内容は無視
        if (next === multiHtmlRef.current) return;

        const isFocused = document.activeElement === editorRef.current;
        if (isFocused && isLocalDirtyRef.current && updatedBy && updatedBy !== userName) {
          // 同時編集っぽい時は上書きせず、保留にする
          remotePendingHtmlRef.current = next;
          return;
        }

        remotePendingHtmlRef.current = null;
        setMultiHtml(next);
      },
      (error) => {
        console.error("Multi note realtime listen error:", error);
      }
    );

    return () => {
      unsubscribe();
    };
    // multiHtmlは依存に入れるとスナップショットごとに再購読になるのでref/比較で対処
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, userName, isOpen, mode, canUseMulti]);

  const stopPresenceHeartbeat = () => {
    if (presenceHeartbeatRef.current !== null) {
      window.clearInterval(presenceHeartbeatRef.current);
      presenceHeartbeatRef.current = null;
    }
  };

  const setPresence = async (isEditing: boolean) => {
    if (!roomId || !userName) return;
    const safeId = encodeURIComponent(userName);
    const ref = doc(db, "multi_log", roomId, "notes", "shared", "presence", safeId);
    await setDoc(
      ref,
      {
        name: userName,
        isEditing,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  };

  // 編集中ユーザー表示（multiを開いている時だけ購読）
  useEffect(() => {
    if (!roomId) return;
    if (!isOpen) return;
    if (mode !== "multi") return;
    if (!canUseMulti) return;

    const presenceCol = collection(db, "multi_log", roomId, "notes", "shared", "presence");
    const unsubscribe = onSnapshot(
      presenceCol,
      (snap) => {
        const now = Date.now();
        const active: string[] = [];
        snap.forEach((d) => {
          const data: any = d.data();
          if (!data?.isEditing) return;
          const ts = data?.updatedAt;
          const ms = typeof ts?.toMillis === "function" ? ts.toMillis() : 0;
          if (ms && now - ms <= 30_000) {
            active.push(String(data?.name || ""));
          }
        });
        setEditingUsers(active.filter(Boolean));
      },
      (error) => {
        console.error("Presence listen error:", error);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [roomId, isOpen, mode, canUseMulti]);

  // ドラッグ開始（0.1秒の長押し中のみ移動）
  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    if (!windowRef.current) return;
    if (e.button !== 0) return;

    // 既存のドラッグ状態を確実に解除
    stopDrag();

    isHeaderMouseDownRef.current = true;
    const rect = windowRef.current.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;

    clearDragLongPressTimer();
    dragLongPressTimerRef.current = window.setTimeout(() => {
      // 押し続けていないなら開始しない
      if (!isHeaderMouseDownRef.current) return;

      prevBodyCursorRef.current = document.body.style.cursor;
      document.body.style.cursor = "move";
      setIsDragging(true);

      dragMoveHandlerRef.current = (moveEvent: MouseEvent) => {
        // mouseup取り逃し対策：ボタンが押されていないなら即終了
        if (moveEvent.buttons === 0) {
          stopDrag();
          return;
        }
        setWindowState((prev) => ({
          ...prev,
          x: moveEvent.clientX - offsetX,
          y: moveEvent.clientY - offsetY,
        }));
      };

      dragUpHandlerRef.current = () => {
        stopDrag();
      };

      window.addEventListener("mousemove", dragMoveHandlerRef.current);
      window.addEventListener("mouseup", dragUpHandlerRef.current);
    }, 100);
  };

  const handleHeaderMouseUp = () => {
    isHeaderMouseDownRef.current = false;
    stopDrag();
  };

  const handleHeaderMouseLeave = () => {
    isHeaderMouseDownRef.current = false;
    stopDrag();
  };

  // リサイズ開始（コーナー検出）
  const handleResizeMouseDown = (
    e: React.MouseEvent,
    position:
      | "corner-se"
      | "corner-sw"
      | "corner-ne"
      | "corner-nw"
      | "edge-e"
      | "edge-w"
      | "edge-n"
      | "edge-s"
  ) => {
    e.preventDefault();
    if (!windowRef.current) return;

    // 競合防止
    stopDrag();
    stopResize();
    
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = windowState.width;
    const startHeight = windowState.height;
    const startWindowX = windowState.x;
    const startWindowY = windowState.y;
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      // mouseup取り逃し対策：ボタンが押されていないなら即終了
      if (moveEvent.buttons === 0) {
        stopResize();
        return;
      }
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      
      setWindowState((prev) => {
        let newState = { ...prev };
        
        if (position === "corner-se") {
          // 右下
          newState.width = Math.max(300, startWidth + deltaX);
          newState.height = Math.max(200, startHeight + deltaY);
        } else if (position === "corner-sw") {
          // 左下
          newState.x = startWindowX + deltaX;
          newState.width = Math.max(300, startWidth - deltaX);
          newState.height = Math.max(200, startHeight + deltaY);
        } else if (position === "corner-ne") {
          // 右上
          newState.y = startWindowY + deltaY;
          newState.width = Math.max(300, startWidth + deltaX);
          newState.height = Math.max(200, startHeight - deltaY);
        } else if (position === "corner-nw") {
          // 左上
          newState.x = startWindowX + deltaX;
          newState.y = startWindowY + deltaY;
          newState.width = Math.max(300, startWidth - deltaX);
          newState.height = Math.max(200, startHeight - deltaY);
        } else if (position === "edge-e") {
          // 右
          newState.width = Math.max(300, startWidth + deltaX);
        } else if (position === "edge-w") {
          // 左
          newState.x = startWindowX + deltaX;
          newState.width = Math.max(300, startWidth - deltaX);
        } else if (position === "edge-s") {
          // 下
          newState.height = Math.max(200, startHeight + deltaY);
        } else if (position === "edge-n") {
          // 上
          newState.y = startWindowY + deltaY;
          newState.height = Math.max(200, startHeight - deltaY);
        }
        
        return newState;
      });
    };
    
    const handleMouseUp = () => {
      stopResize();
    };

    const handleWindowBlur = () => {
      stopResize();
      window.removeEventListener("blur", handleWindowBlur);
    };

    prevBodyCursorRef.current = document.body.style.cursor;
    if (position === "corner-se" || position === "corner-nw") {
      document.body.style.cursor = "nwse-resize";
    } else if (position === "corner-sw" || position === "corner-ne") {
      document.body.style.cursor = "nesw-resize";
    } else if (position === "edge-e" || position === "edge-w") {
      document.body.style.cursor = "ew-resize";
    } else {
      document.body.style.cursor = "ns-resize";
    }

    setIsResizing(true);
    resizeMoveHandlerRef.current = handleMouseMove;
    resizeUpHandlerRef.current = handleMouseUp;
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("blur", handleWindowBlur);
  };

  // ウィンドウを閉じるときにセーブ
  const handleClose = async () => {
    setIsSaving(true);

    if (mode === "multi" && canUseMulti) {
      stopPresenceHeartbeat();
      setPresence(false).catch((e) => console.error("Presence update error:", e));
    }

    try {
      // Soloノートをセーブ（内容が空の場合は保存しない）
      if (roomId && userName && !isHtmlEmpty(soloHtml)) {
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

      // Multiノートをセーブ（play3またはdiscussion。内容が空の場合は保存しない）
      if (canUseMulti && roomId && !isHtmlEmpty(multiHtml)) {
        const multiRef = doc(db, "multi_log", roomId, "notes", "shared");
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

    // 全体用（multi）では Ctrl/Cmd+Z（Undo）と Shift+Ctrl/Cmd+Z（Redo）を無効化
    if (mode === "multi") {
      const isUndo = (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z";
      const isRedo = (e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "z";
      if (isUndo || isRedo) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
  };

  return (
    <>
      {/* ノートアイコン（マップボタンと同じスタイル） */}
      <button
        onClick={() => {
          setIsOpen(true);
          if (isDiscussion) setMode("multi");
        }}
        className={styles.noteIcon}
        aria-label="ノートを表示"
      >
        <span className={styles.iconEmoji}>📝</span>
        <span className={styles.iconText}>メモ</span>
      </button>

      {/* ノートウィンドウ */}
      {isOpen && (
        <div className={styles.noteOverlay}>
          <div
            ref={windowRef}
            className={styles.noteWindow}
            style={{
              position: "fixed",
              left: `${windowState.x}px`,
              top: `${windowState.y}px`,
              width: `${windowState.width}px`,
              height: `${windowState.height}px`,
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
          >
            {/* ヘッダー */}
            <div 
              className={`${styles.noteHeader} ${isDragging ? styles.noteHeaderDragging : ""}`}
              onMouseDown={handleHeaderMouseDown}
              onMouseUp={handleHeaderMouseUp}
              onMouseLeave={handleHeaderMouseLeave}
            >
              <div className={styles.noteTitleBlock}>
                <h2 className={styles.noteTitle}>📝 メモ</h2>
                {mode === "multi" && editingUsers.length > 0 && (
                  <div className={styles.editingInfo}>編集中: {editingUsers.join(" / ")}</div>
                )}
              </div>
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
                title={!canUseMulti ? "play3 / discussionでのみ使用可能" : ""}
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
              onFocus={() => {
                if (mode === "multi" && canUseMulti) {
                  setPresence(true).catch((e) => console.error("Presence update error:", e));
                  stopPresenceHeartbeat();
                  presenceHeartbeatRef.current = window.setInterval(() => {
                    setPresence(true).catch((e) => console.error("Presence update error:", e));
                  }, 15000);
                }
              }}
              onBlur={() => {
                if (mode === "multi" && canUseMulti) {
                  stopPresenceHeartbeat();
                  setPresence(false).catch((e) => console.error("Presence update error:", e));

                  // リモート変更が保留されていたら、編集終了時に反映
                  if (remotePendingHtmlRef.current !== null && !isLocalDirtyRef.current) {
                    setMultiHtml(remotePendingHtmlRef.current);
                    remotePendingHtmlRef.current = null;
                  }
                }
              }}
              onInput={() => {
                if (editorRef.current) {
                  if (mode === "solo") {
                    setSoloHtml(editorRef.current.innerHTML);
                  } else {
                    const next = editorRef.current.innerHTML;
                    setMultiHtml(next);
                    multiHtmlRef.current = next;
                    isLocalDirtyRef.current = true;

                    if (canUseMulti && presenceHeartbeatRef.current === null) {
                      setPresence(true).catch((e) => console.error("Presence update error:", e));
                      presenceHeartbeatRef.current = window.setInterval(() => {
                        setPresence(true).catch((e) => console.error("Presence update error:", e));
                      }, 15000);
                    }

                    scheduleMultiWrite(next);
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
                  : `全体用（${isDiscussion ? "discussionの相談フェーズ" : "play3"}で使用可能）`}
              </span>
              <button
                onClick={handleClose}
                className={styles.saveBtn}
                disabled={isSaving}
              >
                {isSaving ? "保存中..." : "閉じる"}
              </button>
            </div>

            {/* リサイズハンドル（4隅） */}
            <div
              className={styles.resizeHandle}
              style={{ cursor: "nwse-resize" }}
              onMouseDown={(e) => handleResizeMouseDown(e, "corner-se")}
            />
            <div
              className={styles.resizeHandleSW}
              style={{ cursor: "nesw-resize" }}
              onMouseDown={(e) => handleResizeMouseDown(e, "corner-sw")}
            />
            <div
              className={styles.resizeHandleNE}
              style={{ cursor: "nesw-resize" }}
              onMouseDown={(e) => handleResizeMouseDown(e, "corner-ne")}
            />
            <div
              className={styles.resizeHandleNW}
              style={{ cursor: "nwse-resize" }}
              onMouseDown={(e) => handleResizeMouseDown(e, "corner-nw")}
            />

            {/* リサイズハンドル（辺） */}
            <div
              className={styles.resizeHandleE}
              style={{ cursor: "ew-resize" }}
              onMouseDown={(e) => handleResizeMouseDown(e, "edge-e")}
            />
            <div
              className={styles.resizeHandleW}
              style={{ cursor: "ew-resize" }}
              onMouseDown={(e) => handleResizeMouseDown(e, "edge-w")}
            />
            <div
              className={styles.resizeHandleS}
              style={{ cursor: "ns-resize" }}
              onMouseDown={(e) => handleResizeMouseDown(e, "edge-s")}
            />
            <div
              className={styles.resizeHandleN}
              style={{ cursor: "ns-resize" }}
              onMouseDown={(e) => handleResizeMouseDown(e, "edge-n")}
            />
          </div>
        </div>
      )}
    </>
  );
}
