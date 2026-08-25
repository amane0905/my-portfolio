"use strict";
// ===== メール確認による学生認証（Firebase Authentication） =====
//
// このアプリのログインは Firebase Authentication を正として扱い、
// Firestore側にはプロフィール系の情報のみ保存する。
// 流れ：
//   1. 新規登録時：Firebase Authアカウントを作り、確認メールを送信
//   2. ログイン時：Firebase Authでサインインし、emailVerifiedを確認
//   3. 確認が済んでいなければ、確認待ち画面を表示する

// 新規登録時：Firebase Authアカウントを作成し、確認メールを送信する
async function registerAndSendVerification(email, password) {
  const cred = await fireAuth.createUserWithEmailAndPassword(email, password);
  await cred.user.sendEmailVerification();
  return cred.user;
}

// ログイン時：Firebase Authにサインインし、確認済みかどうかを返す
async function signInAndCheckEmailVerified(email, password) {
  const cred = await fireAuth.signInWithEmailAndPassword(email, password);
  await cred.user.reload();
  return {
    user: cred.user,
    verified: !!cred.user.emailVerified
  };
}

// 確認メールを再送信する（サインイン済みである必要がある）
async function resendVerificationEmail() {
  if (!fireAuth.currentUser) throw new Error("再送信にはログインが必要です。");
  await fireAuth.currentUser.sendEmailVerification();
}

// 現在Firebase Authにサインイン中のユーザーの確認状態を再取得する
async function refreshEmailVerified() {
  if (!fireAuth.currentUser) return false;
  await fireAuth.currentUser.reload();
  return fireAuth.currentUser.emailVerified;
}

// パスワード再設定メールを送る
async function sendPasswordReset(email) {
  await fireAuth.sendPasswordResetEmail(email);
}

// ログイン中ユーザーのパスワードを更新する
async function updateCurrentUserPassword(newPassword) {
  if (!fireAuth.currentUser) {
    throw new Error("再ログイン後にもう一度お試しください。");
  }
  await fireAuth.currentUser.updatePassword(newPassword);
}

// 退会時：Firebase Authのアカウント自体を削除する
async function deleteFirebaseAuthAccount() {
  if (!fireAuth.currentUser) return; // サインインしていなければ何もしない
  await fireAuth.currentUser.delete();
}
