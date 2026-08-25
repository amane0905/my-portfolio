// This is a JavaScript file
"use strict";
// ===== 公開プロフィール（Firestore） =====
//
// 他のユーザーに見せてよい情報だけを users/{uid} ドキュメントに保存する。
// ⚠️ 本名やメールアドレス、パスワードは絶対にここへ書き込まないこと。
// （ここで書き込むのは name＝ニックネーム、avatarColor、avatarUrl、verified＝学生認証済みか のみ）

async function savePublicProfile(userId, { name, avatarColor, avatarUrl, verified } = {}) {
  const data = {};
  if (name !== undefined)        data.name        = name;
  if (avatarColor !== undefined) data.avatarColor = avatarColor;
  if (avatarUrl !== undefined)   data.avatarUrl   = avatarUrl;
  if (verified !== undefined)    data.verified    = verified;
  await fireDb.collection("users").doc(userId).set(data, { merge: true });
}

async function fetchPublicProfile(userId) {
  const snap = await fireDb.collection("users").doc(userId).get();
  return snap.exists ? snap.data() : null;
}

// 退会時：公開プロフィール・ブロックリストをFirestoreから削除する
async function deletePublicProfile(userId) {
  await Promise.all([
    fireDb.collection("users").doc(userId).delete(),
    fireDb.collection("blocks").doc(userId).delete().catch(() => {}), // 無ければ何もしない
  ]);
}

// ファイルをBase64のデータURLに変換する（Storageを使わない簡易アップロード方式）
function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// プロフィール写真をBase64のデータURLに変換して返す
// （Storageは使わず、Firestoreのuserドキュメントに直接保存する前提。500KB程度までを想定）
async function uploadAvatarPhoto(userId, file) {
  if (typeof MAX_ATTACHMENT_SIZE === "number" && file.size > MAX_ATTACHMENT_SIZE) {
    throw new Error("画像サイズは500KB以下にしてください。");
  }
  return await readFileAsDataURL(file);
}

// ===== ブロックリスト（Firestore） =====
// 「誰が誰をブロックしたか」は他人には見せる必要が無い情報なので、
// 公開プロフィール(users)とは別のコレクション(blocks)に保存する。

// 自分のブロックリストをFirestoreから取得する
async function fetchBlockedUsers(userId) {
  const snap = await fireDb.collection("blocks").doc(userId).get();
  return snap.exists ? (snap.data().blockedUserIds || []) : [];
}

// ブロックリストに1人追加する（同時に複数端末から操作しても安全なarrayUnionを使用）
async function addBlockedUser(userId, blockedUserId) {
  return fireDb.collection("blocks").doc(userId).set(
    { blockedUserIds: firebase.firestore.FieldValue.arrayUnion(blockedUserId) },
    { merge: true }
  );
}
