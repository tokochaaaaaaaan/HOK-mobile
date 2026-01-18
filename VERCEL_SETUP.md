# Vercel デプロイメント ガイド

このドキュメントでは、HOK3 をVercelにデプロイする際の設定と確認手順を説明します。

## 📋 前提条件

- GitHub上のリポジトリが最新状態であること
- Vercelプロジェクトが作成済みであること

## 🔐 環境変数設定 (Vercel Dashboardで必須)

Vercel Projectの **Settings → Environment Variables** で以下を設定してください:

### 1. Firebase認証キー
```
NEXT_PUBLIC_FIREBASE_SECRET_KEY = (FirebaseプロジェクトのSecret keyをここに入力)
```
**重要**: この値がないとルーム作成に失敗します。

### 2. ビルド環境指定（オプション）
```
NODE_ENV = production
```

## ✅ デプロイ前チェック

### ローカル環境での確認

```bash
# 1. 依存関係のインストール
npm install

# 2. ローカル開発サーバー起動
npm run dev

# 3. ブラウザで http://localhost:3000 にアクセス
# → 「ルーム作成」ボタンをクリックして名前を入力し、ルーム作成が成功することを確認
# → 失敗時はブラウザのDeveloper Console (F12)でエラーメッセージを確認
```

### よくあるエラー

| エラーメッセージ | 原因 | 対応 |
|---|---|---|
| `ルーム作成に失敗しました: Permission denied` | Firestore権限不足 | `firestore.rules` を確認（デフォルトは`allow read, write: if true`） |
| `ルーム作成に失敗しました: Firebase not initialized` | Firebase初期化失敗 | インターネット接続確認、Firebase configを確認 |
| `NEXT_PUBLIC_FIREBASE_SECRET_KEY が設定されていません` | SECRET_KEY未設定 | Vercelダッシュボードで上記の環境変数を設定 |

## 🚀 デプロイ手順

### Vercelへの自動デプロイ

```bash
# 1. ローカルで変更をコミット
git add -A
git commit -m "Your commit message"
git push origin main

# 2. Vercelダッシュボードで自動デプロイを待つ
# → または Vercel Projectの "Deployments" タブで手動トリガー
```

### Vercelデプロイ後の確認

1. Vercel Projectの **Deployments** タブで最新デプロイが `Ready` になったことを確認
2. デプロイURL（例: `https://hok-3-git-main-xxx.vercel.app`）にアクセス
3. 「ルーム作成」をテストして動作確認
4. 失敗時は以下を確認:
   - Vercel Settings → Environment Variables で `NEXT_PUBLIC_FIREBASE_SECRET_KEY` が設定済みか
   - ブラウザのDeveloper Console でエラーを確認
   - Vercel Deployments タブで Logs を確認

## 🔍 トラブルシューティング

### ルーム作成ボタンをクリックしても何も起きない

**確認項目:**
1. ブラウザの Developer Console (F12 → Console タブ) を開く
2. 以下のログが出ているか確認:
   - `[CreateRoomButton] Creating room:...` (成功時)
   - `[CreateRoomButton] Room creation failed:...` (失敗時)
3. エラーメッセージがあればそれをVercels Logs と照らし合わせる

### `NEXT_PUBLIC_FIREBASE_SECRET_KEY が設定されていません`

1. Vercel Projectの Settings に移動
2. Environment Variables セクションで `NEXT_PUBLIC_FIREBASE_SECRET_KEY` を追加
3. デプロイを再実行（Redeploy ボタン）

### Firestore Permission denied

`firestore.rules` を確認。開発環境では以下のルールで動作:
```
match /rooms/{roomId} {
  allow read, write: if true;
  match /{document=**} {
    allow read, write: if true;
  }
}
```

**プロダクション環境では適切な認証ルールを設定してください。**

## 📊 パフォーマンス & ログ

### Vercel Logs の確認方法

1. Vercel Projectの **Logs** タブ (または Deployments → 該当デプロイ → Logs)
2. Server-side と Client-side のログをフィルタリング
3. Firebase関連のログ (`[Firebase]`, `[CreateRoomButton]`など) を検索

## 🔄 本番環境への移行

1. **Firestore Rules** をプロダクション対応ルールに変更
2. **Firebase Secret Key** をプロダクション用に更新
3. **環境変数** のすべてを確認
4. 複数ユーザーでの動作テストを実施

---

**質問・問題がある場合**: Developer Console (F12) でエラーを確認し、そのメッセージをSlack等で共有してください。
