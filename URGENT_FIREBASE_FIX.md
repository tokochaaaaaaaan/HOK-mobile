# 🚨 緊急：Firebase使用量削減のための即時対応

## 現状の深刻度
- **ルール評価数: 875万回** ← 異常に高い
- **原因**: 複数のonSnapshotリスナー + 頻繁な書き込み + 自動保存
- **リスク**: このままでは課金が発生する可能性が高い

---

## 🔴 即時実施すべき対応（優先度順）

### 1. play2の自動保存を完全に削除（最優先）

**現在のコード（削除対象）:**
```typescript
// ❌ この全体を削除
const [saveTimeout, setSaveTimeout] = useState<NodeJS.Timeout | null>(null);
const autoSave = useCallback(async () => { ... }, [...]);
const debouncedAutoSave = useCallback(() => { ... }, [autoSave]);

useEffect(() => {
  if (isInitialized) {
    debouncedAutoSave();
  }
}, [wantSelected, dontSelected, reasons, planName, isInitialized, debouncedAutoSave]);

useEffect(() => {
  return () => {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
  };
}, [saveTimeout]);
```

**理由**: これが最も頻繁に書き込みを発生させている

---

### 2. onSnapshotの使用を最小限に制限

#### 修正箇所1: play/page.tsx

**現在:**
```typescript
// ❌ 全ログを常時監視
const q = query(
  collection(db, "rooms", roomId, "logs"),
  orderBy("timestamp", "asc")
);
const unsub = onSnapshot(q, (snap) => { ... });
```

**修正後:**
```typescript
// ✅ 初回のみ取得、その後はローカル状態を使用
useEffect(() => {
  if (!roomId || !userName || isInitialized) return;
  
  const q = query(
    collection(db, "rooms", roomId, "logs"),
    where("user", "==", userName),
    orderBy("timestamp", "asc")
  );
  
  // onSnapshotの代わりにgetDocsを使用
  getDocs(q).then((snap) => {
    const myLogs = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as any) }))
      .filter((l) => l.user === userName);
    
    setLogs(myLogs);
    const usedCardTitles = new Set(myLogs.map(log => log.card));
    const remainingCards = initialCards.filter(card => !usedCardTitles.has(card.title));
    setCards(remainingCards);
    setIsInitialized(true);
  });
}, [roomId, userName]);
```

#### 修正箇所2: play2/page.tsx

**play2Selectionsの監視を削除:**
```typescript
// ❌ 削除: リロード対応のonSnapshot
// useEffect(() => {
//   if (!roomId || !userName || isInitialized) return;
//   const unsubscribe = onSnapshot(
//     doc(db, "rooms", roomId, "play2Selections", userName),
//     (docSnap) => { ... }
//   );
//   return () => unsubscribe();
// }, [roomId, userName, isInitialized]);

// ✅ 代わりに初回のみ取得
useEffect(() => {
  if (!roomId || !userName || isInitialized) return;
  
  getDoc(doc(db, "rooms", roomId, "finalSelections", userName))
    .then((docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        // veryWant/veryDontからwant/dontを復元
        if (data.categories?.veryWant) {
          setWantSelected(new Set(data.categories.veryWant.map((c: any) => c.id)));
        }
        if (data.categories?.veryDont) {
          setDontSelected(new Set(data.categories.veryDont.map((c: any) => c.id)));
        }
        if (data.reasons) {
          setReasons(data.reasons);
        }
      }
      setIsInitialized(true);
    });
}, [roomId, userName]);
```

---

### 3. waitingページの保存頻度を削減

**現在: カード移動ごとに保存**
```typescript
const attemptDropToCategory = (target: CategoryType) => {
  // ...移動処理...
  saveCategories(normalized); // ❌ 毎回保存
};
```

**修正後: デバウンス保存**
```typescript
// ページの最上部に追加
const [pendingSave, setPendingSave] = useState(false);
const [lastSaveTime, setLastSaveTime] = useState(Date.now());

// デバウンス保存用のuseEffect
useEffect(() => {
  if (!pendingSave) return;
  
  const timer = setTimeout(() => {
    saveCategories(categories);
    setPendingSave(false);
    setLastSaveTime(Date.now());
  }, 3000); // 3秒後に保存
  
  return () => clearTimeout(timer);
}, [pendingSave, categories]);

// attemptDropToCategoryを修正
const attemptDropToCategory = (target: CategoryType) => {
  // ...移動処理...
  const normalized = normalizeCategories(next);
  setCategories(normalized);
  
  // ❌ saveCategories(normalized); を削除
  // ✅ デバウンス保存をトリガー
  setPendingSave(true);
};
```

---

### 4. 移動履歴の保存を削除（オプション）

```typescript
// ❌ 移動ごとに保存している
saveMovementHistory(card.id, picked.from, target);

// ✅ 実験用データなら完全に削除を検討
// または最終確定時のみ保存
```

---

## 📊 修正後の期待効果

### ルール評価数の削減
- **現在**: 1セッションで数万〜数十万回
- **修正後**: 1セッションで数百回
- **削減率**: 95%以上

### 書き込み回数の削減
- **現在**: 1ユーザー120-230回
- **修正後**: 1ユーザー50-70回
- **削減率**: 60-70%

---

## ⚡ 実装の優先順位

### 今すぐ実施（30分以内）
1. ✅ play2の自動保存を削除
2. ✅ play2Selectionsのリロード対応を削除

### 今日中に実施
3. ✅ playページのonSnapshotをgetDocsに変更
4. ✅ waitingページのデバウンス保存

### 余裕があれば
5. ⭕ 移動履歴の削除または最適化

---

## 🔍 修正後の確認方法

1. Firebase Console → Firestore → 使用量タブ
2. 「ルールの評価」の数値を確認
3. テストプレイして、1セッションあたりの増加量を確認
4. 目標: 1セッション（4人） = 1,000回以内

---

## ⚠️ リロード対応について

自動保存を削除した場合のリロード対応：
- ✅ `finalSelections`から復元（最終保存データ）
- ✅ ページ間遷移時に保存することで、完全にデータを失うことはない
- ⚠️ ページ内での作業中データは保存されない
  - → 必要なら「保存」ボタンを追加
  - → または「変更があります」警告を表示

---

## 📝 修正実施のチェックリスト

- [ ] play2の自動保存機能を削除
- [ ] play2のonSnapshot (play2Selections) を削除
- [ ] playのonSnapshotをgetDocsに変更
- [ ] waitingのデバウンス保存を実装
- [ ] 移動履歴保存の削除または最適化
- [ ] テストプレイで動作確認
- [ ] Firebase Consoleで使用量確認
