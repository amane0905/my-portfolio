"use strict";
// ===== チャット送受信（Firestore） =====
//
// 会話ID（convId）は「2人のユーザーIDをアルファベット順に並べて連結したもの」で作ります。
// こうすることで、AさんがBさんに送っても、BさんがAさんに送っても、
// 必ず同じ Firestore ドキュメント（同じ会話）を指すようになり、
// お互いが同じメッセージ履歴を読み書きできます。
//
// Firestore の構造:
//   conversations/{convId}                … 会話メタ情報 { participants: [uidA, uidB], updatedAt }
//   conversations/{convId}/messages/{msgId} … 個々のメッセージ

function getConvId(userIdA, userIdB) {
  return [userIdA, userIdB].sort().join("_");
}

// 会話ドキュメントが無ければ作る（あれば何もしない）
async function ensureConversationDoc(convId, userIdA, userIdB) {
  const ref = fireDb.collection("conversations").doc(convId);
  await ref.set(
    {
      participants: [userIdA, userIdB].sort(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return ref;
}

// メッセージ送信。file が渡された場合は Firebase Storage にアップロードしてからURLを保存する
function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);

    reader.readAsDataURL(file);
  });
}

async function sendChatMessage(convId, senderId, { text = "", file = null } = {}) {
  let imgUrl = null;
  let fileUrl = null;
  let fileName = null;
  let isImage = false;
  
  if (file) {
      if (
          typeof MAX_ATTACHMENT_SIZE === "number" &&file.size > MAX_ATTACHMENT_SIZE) {
              throw new Error("ファイルサイズは500KB以下にしてください。");
        }
   
   isImage = file.type.startsWith("image/");
   fileName = file.name;

   const dataUrl = await readFileAsDataURL(file);

   if (isImage) {
    imgUrl = dataUrl;
    } 
    else {
    fileUrl = dataUrl;
    }
}

  const convRef =
  fireDb
    .collection("conversations")
    .doc(convId);


// 会話情報から相手を取得
const convSnap =
  await convRef.get();

const convData =
  convSnap.exists
    ? convSnap.data()
    : {};

const receiverId =
  (convData.participants || [])
    .find(id => id !== senderId);


// 現在の未読数をコピー
const unreadBy = {
  ...(convData.unreadBy || {})
};


// 相手の未読を +1
if (receiverId) {

  unreadBy[receiverId] =
    Number(
      unreadBy[receiverId] || 0
    ) + 1;

}


// 自分が送ったメッセージなので
// 自分の未読は0
unreadBy[senderId] = 0;


// メッセージ保存
await convRef
  .collection("messages")
  .add({
    sender: senderId,
    text,
    imgUrl,
    fileUrl,
    fileName,

    createdAt:
      firebase.firestore
        .FieldValue
        .serverTimestamp()
  });


// 会話一覧も更新
await convRef.set(
  {
    lastMessage:
      text ||
      (
        isImage
          ? "📷 画像"
          : fileName
            ? "📄 " + fileName
            : ""
      ),

    unreadBy,

    updatedAt:
      firebase.firestore
        .FieldValue
        .serverTimestamp()
  },
  {
    merge: true
  }
);
}

// 会話のメッセージをリアルタイム購読する。
// callback には常に「その時点までの全メッセージ配列（時系列順）」が渡される。
// 戻り値は購読解除用の関数（画面を離れるときに呼ぶ）。
function listenToMessages(convId, callback) {
  const ref = fireDb
    .collection("conversations")
    .doc(convId)
    .collection("messages")
    .orderBy("createdAt", "asc");

  return ref.onSnapshot(
    (snapshot) => {
      const messages = snapshot.docs.map((doc) => {
        const d = doc.data();
        return {
          id: doc.id,
          sender: d.sender,
          text: d.text || "",
          imgSrc: d.imgUrl || null,
          fileUrl: d.fileUrl || null,
          fileName: d.fileName || null,
          time: d.createdAt
            ? d.createdAt.toDate().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
            : nowTime(),
        };
      });
      callback(messages);
    },
    (err) => {
      console.error("チャット購読エラー:", err);
    }
  );
}