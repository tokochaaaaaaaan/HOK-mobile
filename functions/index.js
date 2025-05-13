const functions = require("firebase-functions");
const admin     = require("firebase-admin");
admin.initializeApp();

exports.logAction = functions.database
  .ref("/actions/{pushId}")
  .onCreate((snapshot) => {
    const action = snapshot.val();
    return admin
      .database()
      .ref("/logs")
      .push({ action, timestamp: Date.now() });
  });
