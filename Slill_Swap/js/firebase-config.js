// Firebaseの初期設定
const firebaseConfig = {
  apiKey: "AIzaSyCtUvFS3964WgNm1cMmEpJtz1ermaPO-Ms",
  authDomain: "skill-swap-app-18bda.firebaseapp.com",
  projectId: "skill-swap-app-18bda",
  storageBucket: "skill-swap-app-18bda.firebasestorage.app",
  messagingSenderId: "120953794068",
  appId: "1:120953794068:web:b689010aae826ff7a60101",
  measurementId: "G-G6VD29CXS2"
};

// Firebaseの初期化（起動）

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

// どこからでもデータベース（Firestore）を使えるように準備
window.fireDb = firebase.firestore();
// メール確認（学生認証）専用にFirebase Authenticationを準備
window.fireAuth = firebase.auth();