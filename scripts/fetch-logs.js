// Firebaseから特定ユーザーのログデータを取得するスクリプト
const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json'); // サービスアカウントキーが必要

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function fetchUserLogs(roomId, userName) {
  try {
    const logsRef = db.collection('rooms').doc(roomId).collection('logs');
    const snapshot = await logsRef.where('user', '==', userName).get();
    
    if (snapshot.empty) {
      console.log('データが見つかりませんでした');
      return;
    }
    
    console.log(`${userName}のログデータ (${snapshot.size}件):`);
    console.log('='.repeat(50));
    
    const logs = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      logs.push({
        id: doc.id,
        ...data,
        timestamp: data.timestamp?.toDate?.() || data.timestamp
      });
    });
    
    // タイムスタンプでソート
    logs.sort((a, b) => {
      const aTime = a.timestamp?.getTime?.() || 0;
      const bTime = b.timestamp?.getTime?.() || 0;
      return aTime - bTime;
    });
    
    logs.forEach((log, index) => {
      console.log(`\n[${index + 1}]`);
      console.log(`  カード: ${log.card}`);
      console.log(`  選択: ${log.polarity === 3 ? '行きたい' : log.polarity === 2 ? 'どちらでも' : '行きたくない'}`);
      console.log(`  カテゴリ: ${log.category}`);
      console.log(`  時刻: ${log.timestamp}`);
    });
    
    console.log('\n' + '='.repeat(50));
    console.log('JSON形式:');
    console.log(JSON.stringify(logs, null, 2));
    
  } catch (error) {
    console.error('エラー:', error);
  }
}

// 実行
const roomId = 'DXSAGJLU';
const userName = 'B';

fetchUserLogs(roomId, userName)
  .then(() => {
    console.log('\n完了');
    process.exit(0);
  })
  .catch(error => {
    console.error('実行エラー:', error);
    process.exit(1);
  });
