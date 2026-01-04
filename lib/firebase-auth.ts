// Firebase 認証用ヘルパー - 環境変数の秘密鍵を使用

const SECRET_KEY = process.env.NEXT_PUBLIC_FIREBASE_SECRET_KEY;

if (!SECRET_KEY) {
  console.error("⚠️ NEXT_PUBLIC_FIREBASE_SECRET_KEY が設定されていません");
}

/**
 * データに秘密鍵を自動的に付与するヘルパー関数
 * Firestore への書き込み時に使用
 */
export const addAuthKey = <T extends Record<string, any>>(data: T): T & { _authKey: string | undefined } => {
  return {
    ...data,
    _authKey: SECRET_KEY,
  };
};

/**
 * 認証が有効かどうかを確認（開発時のデバッグ用）
 */
export const isAuthValid = (): boolean => {
  return !!SECRET_KEY && SECRET_KEY.length > 10;
};

/**
 * 秘密鍵を取得（直接使用する場合）
 */
export const getAuthKey = (): string | undefined => {
  return SECRET_KEY;
};
