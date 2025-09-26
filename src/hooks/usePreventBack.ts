"use client";

import { useEffect } from 'react';

/**
 * ブラウザの戻るボタンを無効化するHook
 * アプリケーション内での一方向ナビゲーションを強制する
 */
export function usePreventBack() {
  useEffect(() => {
    // ページ読み込み時に履歴エントリを追加
    if (typeof window !== 'undefined') {
      // 現在のページを履歴に追加
      window.history.pushState(null, '', window.location.href);
      
      const preventBack = () => {
        // 戻るボタンを押された時に再度現在のページを履歴に追加
        window.history.pushState(null, '', window.location.href);
      };

      // popstateイベントリスナーを追加
      window.addEventListener('popstate', preventBack);

      // クリーンアップ
      return () => {
        window.removeEventListener('popstate', preventBack);
      };
    }
  }, []);
}
