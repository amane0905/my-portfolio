// Firebaseの初期設定
const firebaseConfig = {
  apiKey: "AIzaSyANP7bJUrE4W9akQ1uCkmMS9JqUgZ3hSfU",
  authDomain: "my-career-log-33dc0.firebaseapp.com",
  projectId: "my-career-log-33dc0",
  storageBucket: "my-career-log-33dc0.firebasestorage.app",
  messagingSenderId: "243449033098",
  appId: "1:243449033098:web:51c6742a2bb5944a835873"
};

// Firebaseの初期化（起動）
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

window.fireDb = firebase.firestore();
window.fireAuth = firebase.auth();