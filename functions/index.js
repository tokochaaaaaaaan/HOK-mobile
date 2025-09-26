const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

const db = admin.firestore();
const rtdb = admin.database();

// ===========================================
// 1. 合致率計算 (重い処理をサーバーサイドで実行)
// ===========================================
exports.calculateMatchPercentage = functions.https.onCall(async (data, context) => {
  try {
    const { roomId } = data;
    
    // Firestoreから全ユーザーの選択データを取得
    const selectionsSnapshot = await db
      .collection("rooms")
      .doc(roomId)
      .collection("finalSelections")
      .get();
    
    const selections = selectionsSnapshot.docs.map(doc => doc.data());
    
    if (selections.length < 2) {
      return { error: "計算に必要な参加者が不足しています" };
    }
    
    const results = [];
    
    // 全ペアの合致率を計算
    for (let i = 0; i < selections.length; i++) {
      for (let j = i + 1; j < selections.length; j++) {
        const user1 = selections[i];
        const user2 = selections[j];
        
        const commonWant = user1.want.filter(card => user2.want.includes(card));
        const commonDont = user1.dont.filter(card => user2.dont.includes(card));
        const conflictCards = [
          ...user1.want.filter(card => user2.dont.includes(card)),
          ...user1.dont.filter(card => user2.want.includes(card)),
        ];
        
        const totalCards = 40;
        const commonCount = commonWant.length + commonDont.length;
        const conflictCount = conflictCards.length;
        
        // 改良版合致率計算（重み付けあり）
        const wantWeight = 2.0;  // 行きたいカードの重み
        const dontWeight = 1.0;  // 行きたくないカードの重み
        const conflictPenalty = 3.0; // 衝突ペナルティ
        
        const weightedScore = (commonWant.length * wantWeight + commonDont.length * dontWeight) 
                            - (conflictCards.length * conflictPenalty);
        
        const maxPossibleScore = totalCards * wantWeight;
        const matchPercentage = Math.max(0, Math.min(100, 
          Math.round((weightedScore / maxPossibleScore) * 100)
        ));
        
        results.push({
          user1: user1.user,
          user2: user2.user,
          commonWant,
          commonDont,
          conflictCards,
          matchPercentage,
          rawScore: weightedScore,
          calculatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    }
    
    // 結果をFirestoreにキャッシュ
    await db
      .collection("rooms")
      .doc(roomId)
      .collection("analytics")
      .doc("matchResults")
      .set({
        results: results.sort((a, b) => b.matchPercentage - a.matchPercentage),
        calculatedAt: admin.firestore.FieldValue.serverTimestamp(),
        participantCount: selections.length
      });
    
    return { success: true, results };
    
  } catch (error) {
    console.error("合致率計算エラー:", error);
    return { error: error.message };
  }
});

// ===========================================
// 2. ルーム分析レポート生成
// ===========================================
exports.generateRoomAnalytics = functions.https.onCall(async (data, context) => {
  try {
    const { roomId } = data;
    
    // 各種データを並行取得
    const [logsSnapshot, selectionsSnapshot, presenceData] = await Promise.all([
      db.collection("rooms").doc(roomId).collection("logs").get(),
      db.collection("rooms").doc(roomId).collection("finalSelections").get(),
      rtdb.ref(`presence/${roomId}`).once('value')
    ]);
    
    const logs = logsSnapshot.docs.map(doc => doc.data());
    const selections = selectionsSnapshot.docs.map(doc => doc.data());
    const presence = presenceData.val() || {};
    
    // 分析データ生成
    const analytics = {
      totalActions: logs.length,
      participantCount: selections.length,
      avgPlayTime: calculateAveragePlayTime(logs),
      cardPopularity: calculateCardPopularity(logs),
      categoryDistribution: calculateCategoryDistribution(selections),
      activeUsers: Object.keys(presence).length,
      generatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    // Firestoreに保存
    await db
      .collection("rooms")
      .doc(roomId)
      .collection("analytics")
      .doc("roomAnalytics")
      .set(analytics);
    
    return { success: true, analytics };
    
  } catch (error) {
    console.error("分析レポート生成エラー:", error);
    return { error: error.message };
  }
});

// ===========================================
// 3. 通知送信
// ===========================================
exports.sendNotification = functions.https.onCall(async (data, context) => {
  try {
    const { roomId, message, targetUsers } = data;
    
    // Realtime Databaseに通知を保存
    const notificationData = {
      message,
      timestamp: admin.database.ServerValue.TIMESTAMP,
      sender: context.auth ? context.auth.uid : "system"
    };
    
    if (targetUsers && Array.isArray(targetUsers)) {
      // 特定ユーザーへの通知
      const promises = targetUsers.map(userId => 
        rtdb.ref(`notifications/${roomId}/${userId}`).push(notificationData)
      );
      await Promise.all(promises);
    } else {
      // 全体通知
      await rtdb.ref(`notifications/${roomId}/all`).push(notificationData);
    }
    
    return { success: true };
    
  } catch (error) {
    console.error("通知送信エラー:", error);
    return { error: error.message };
  }
});

// ===========================================
// 4. データ集計・統計
// ===========================================
exports.aggregatePlayData = functions.https.onCall(async (data, context) => {
  try {
    const { roomId, timeframe = "daily" } = data;
    
    const now = new Date();
    const startTime = getTimeframeStart(now, timeframe);
    
    // ログデータを期間で絞り込んで取得
    const logsSnapshot = await db
      .collection("rooms")
      .doc(roomId)
      .collection("logs")
      .where("timestamp", ">=", startTime)
      .where("timestamp", "<=", now)
      .get();
    
    const logs = logsSnapshot.docs.map(doc => doc.data());
    
    const aggregatedData = {
      period: timeframe,
      startTime,
      endTime: now,
      totalActions: logs.length,
      actionsByUser: aggregateByUser(logs),
      actionsByCard: aggregateByCard(logs),
      actionsByType: aggregateByType(logs),
      timeDistribution: aggregateByTime(logs, timeframe)
    };
    
    // 集計結果をFirestoreに保存
    await db
      .collection("rooms")
      .doc(roomId)
      .collection("analytics")
      .doc(`aggregated_${timeframe}`)
      .set({
        ...aggregatedData,
        aggregatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    
    return { success: true, data: aggregatedData };
    
  } catch (error) {
    console.error("データ集計エラー:", error);
    return { error: error.message };
  }
});

// ===========================================
// 5. Realtime Database トリガー
// ===========================================

// ユーザーの接続状態変化を監視
exports.onUserPresenceChange = functions.database
  .ref("/presence/{roomId}/{userId}")
  .onWrite(async (change, context) => {
    const { roomId, userId } = context.params;
    const newData = change.after.val();
    
    if (!newData) return null; // データ削除時は何もしない
    
    // Firestoreのユーザー情報を更新
    await db
      .collection("rooms")
      .doc(roomId)
      .collection("participants")
      .doc(userId)
      .update({
        lastSeen: admin.firestore.FieldValue.serverTimestamp(),
        isOnline: newData.online || false
      });
    
    return null;
  });

// プレイ進捗の変化を監視
exports.onPlayProgressChange = functions.database
  .ref("/play_progress/{roomId}/{userId}")
  .onWrite(async (change, context) => {
    const { roomId, userId } = context.params;
    const newData = change.after.val();
    
    if (!newData) return null;
    
    // 進捗をFirestoreにもログ保存
    await db
      .collection("rooms")
      .doc(roomId)
      .collection("progress_logs")
      .add({
        user: userId,
        progress: newData,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
    
    return null;
  });

// ===========================================
// ヘルパー関数
// ===========================================

function calculateAveragePlayTime(logs) {
  const userSessions = {};
  
  logs.forEach(log => {
    if (!userSessions[log.user]) {
      userSessions[log.user] = { start: null, end: null };
    }
    
    const logTime = new Date(log.timestamp);
    if (!userSessions[log.user].start || logTime < userSessions[log.user].start) {
      userSessions[log.user].start = logTime;
    }
    if (!userSessions[log.user].end || logTime > userSessions[log.user].end) {
      userSessions[log.user].end = logTime;
    }
  });
  
  const playTimes = Object.values(userSessions)
    .filter(session => session.start && session.end)
    .map(session => session.end - session.start);
  
  return playTimes.length > 0 
    ? playTimes.reduce((sum, time) => sum + time, 0) / playTimes.length
    : 0;
}

function calculateCardPopularity(logs) {
  const cardCounts = {};
  
  logs.forEach(log => {
    if (log.card) {
      cardCounts[log.card] = (cardCounts[log.card] || 0) + 1;
    }
  });
  
  return Object.entries(cardCounts)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 10); // トップ10
}

function calculateCategoryDistribution(selections) {
  const distribution = {
    veryWant: 0,
    want: 0,
    neutral: 0,
    dont: 0,
    veryDont: 0
  };
  
  selections.forEach(selection => {
    distribution.veryWant += (selection.want || []).length;
    distribution.veryDont += (selection.dont || []).length;
    // 他のカテゴリは追加の実装が必要
  });
  
  return distribution;
}

function getTimeframeStart(now, timeframe) {
  const start = new Date(now);
  
  switch (timeframe) {
    case "hourly":
      start.setHours(start.getHours() - 1);
      break;
    case "daily":
      start.setDate(start.getDate() - 1);
      break;
    case "weekly":
      start.setDate(start.getDate() - 7);
      break;
    default:
      start.setDate(start.getDate() - 1);
  }
  
  return start;
}

function aggregateByUser(logs) {
  const userCounts = {};
  logs.forEach(log => {
    userCounts[log.user] = (userCounts[log.user] || 0) + 1;
  });
  return userCounts;
}

function aggregateByCard(logs) {
  const cardCounts = {};
  logs.forEach(log => {
    if (log.card) {
      cardCounts[log.card] = (cardCounts[log.card] || 0) + 1;
    }
  });
  return cardCounts;
}

function aggregateByType(logs) {
  const typeCounts = {};
  logs.forEach(log => {
    if (log.action) {
      typeCounts[log.action] = (typeCounts[log.action] || 0) + 1;
    }
  });
  return typeCounts;
}

function aggregateByTime(logs, timeframe) {
  const timeBuckets = {};
  
  logs.forEach(log => {
    const timestamp = new Date(log.timestamp);
    let bucket;
    
    switch (timeframe) {
      case "hourly":
        bucket = timestamp.getHours();
        break;
      case "daily":
        bucket = timestamp.getDate();
        break;
      case "weekly":
        bucket = timestamp.getDay();
        break;
      default:
        bucket = timestamp.getHours();
    }
    
    timeBuckets[bucket] = (timeBuckets[bucket] || 0) + 1;
  });
  
  return timeBuckets;
}
