"use strict";
// ===== スキル投稿（Firestore） =====
//
// 「求む／教えます」の投稿を、全ユーザーで共有するFirestoreコレクションに保存する。
// これにより、誰かが投稿すると他のユーザーの画面にもリアルタイムで反映される。

// 新規投稿を作成する
function createSkillInFirestore(skill) {
  const { id, ...data } = skill;
  return fireDb.collection("skills").doc(id).set({
    ...data,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
}

// 既存の投稿の一部フィールドだけ更新する（編集・ステータス切替など）
function updateSkillInFirestore(skillId, fields) {
  return fireDb.collection("skills").doc(skillId).update(fields);
}

// 退会時：そのユーザーの投稿を全件削除する
async function deleteAllSkillsByUser(userId) {
  const snap = await fireDb.collection("skills").where("userId", "==", userId).get();
  await Promise.all(snap.docs.map(doc => doc.ref.delete()));
}

// レビューを1件追加する（同時に複数人が投稿しても安全なarrayUnionを使用）
function addSkillReviewInFirestore(skillId, review) {
  return fireDb.collection("skills").doc(skillId).update({
    reviews: firebase.firestore.FieldValue.arrayUnion(review),
  });
}

// 全スキル投稿をリアルタイム購読する（新しい順）
function listenToAllSkills(callback) {
  return fireDb.collection("skills")
    .orderBy("createdAt", "desc")
    .onSnapshot(snap => {
      const skills = snap.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          // 💡 createdAtがnullの瞬間（投稿直後）でも安全に現在時刻を入れる処理を追加！
          createdAt: data.createdAt ? data.createdAt : { toDate: () => new Date() }
        };
      });
      callback(skills);
    }, err => console.error("スキル投稿の購読エラー:", err));
}

// ===== 通報（Firestore） =====
// 通報内容を全員で共有するコレクションに保存する。
// これで「通報した本人の端末にしか記録が残らない」状態を解消し、
// 運営側がどの端末からでも通報一覧を確認できるようにする。
function submitReportToFirestore(report) {
  return fireDb.collection("reports").add({
    ...report,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
}

// ===== 投稿時のTime予約 =====
async function createSkillWithReservationInFirestore(
  skill,
  estimatedPoints,
  minBalance = -100
) {

  const { id, ...data } = skill;
  const skillRef =
    fireDb.collection("skills").doc(id);

  // 「教える」投稿は予約不要
  if (skill.type !== "seek") {
    return skillRef.set({
      ...data,
      reservedPoints: 0,
      reservedUserId: null,
      reservationStatus: "none",
      pointsSettled: false,
      createdAt:
        firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  // 「教わる」投稿は投稿時に予約
  const userRef =
    fireDb.collection("users").doc(skill.userId);
  return fireDb.runTransaction(async tx => {
    const userSnap =
      await tx.get(userRef);
    const currentPoints =
      Number(
        userSnap.exists
          ? userSnap.data().totalPoints || 0
          : 0
      );
    const reservedPoints =
      Number(estimatedPoints || 0);
    const newBalance =
      currentPoints - reservedPoints;

    if (newBalance < minBalance) {
      const error =
        new Error("POINT_LIMIT");
      error.code = "POINT_LIMIT";
      throw error;
    }

    // 先にTimeを予約
    tx.set(
      userRef,
      {
        totalPoints: newBalance
      },
      { merge: true }
    );

    // 投稿にも予約情報を保存
    tx.set(
      skillRef,
      {
        ...data,
        reservedPoints,
        reservedUserId:
          skill.userId,
        reservationStatus:
          "reserved",
        pointsSettled:
          false,
        createdAt:
          firebase.firestore.FieldValue.serverTimestamp()
      }
    );

    return {
      newBalance,
      reservedPoints
    };
  });
}

// ===== 予約Timeを考慮して投稿を編集する =====
async function updateSkillWithReservationInFirestore(
  skillId,
  ownerId,
  updatedFields,
  estimatedPoints,
  minBalance = -100
) {
  const skillRef =
    fireDb.collection("skills").doc(skillId);
  const userRef =
    fireDb.collection("users").doc(ownerId);

  return fireDb.runTransaction(async tx => {

    // 現在の投稿を取得
    const skillSnap = await tx.get(skillRef);

    if (!skillSnap.exists) {
      throw new Error("投稿が見つかりません。");
    }

    const oldSkill = skillSnap.data();

    // 自分の投稿だけ編集可能
    if (oldSkill.userId !== ownerId) {
      throw new Error("この投稿は編集できません。");
    }
    // マッチ済みは変更不可
    if (oldSkill.status === "matched") {
      const error =
        new Error("MATCHED_SKILL");
      error.code =
        "MATCHED_SKILL";
      throw error;
    }

    // 現在のユーザーTimeを取得
    const userSnap =
      await tx.get(userRef);
    const currentPoints =
      Number(
        userSnap.exists
          ? userSnap.data().totalPoints || 0
          : 0
      );

    // 編集前に予約していたTime
    const oldReserved =
      oldSkill.reservationStatus === "reserved" &&
      !oldSkill.pointsSettled
        ? Number(oldSkill.reservedPoints || 0)
        : 0;

    // 編集後に必要な予約Time
    const newReserved =
      updatedFields.type === "seek"
        ? Number(estimatedPoints || 0)
        : 0;

    // 一度古い予約を返して、
    // 新しい予約分を引く
    const newBalance =
      currentPoints
      + oldReserved
      - newReserved;

    // -100 Timeを超えるなら編集不可
    if (newBalance < minBalance) {
      const error =
        new Error("POINT_LIMIT");
      error.code =
        "POINT_LIMIT";
      throw error;
    }

    // ユーザーのTimeを更新
    tx.set(
      userRef,
      {
        totalPoints: newBalance
      },
      {
        merge: true
      }
    );

    // 投稿を更新
    tx.update(
      skillRef,
      {
        ...updatedFields,
        reservedPoints: newReserved,
        reservedUserId: newReserved > 0 ? ownerId : null,
        reservationStatus: newReserved > 0 ? "reserved": "none",
        pointsSettled: false
      }
    );
    return {
      newBalance,
      reservedPoints:
        newReserved
    };
  });
}

// ===== マッチ時のTime予約 =====
async function matchSkillWithReservationInFirestore(
  skillId,
  matchedUserId,
  teacherId,
  learnerId,
  estimatedPoints,
  minBalance = -100
) {
  const skillRef = fireDb.collection("skills").doc(skillId);
  const learnerRef = fireDb.collection("users").doc(learnerId);
  const teacherRef = fireDb.collection("users").doc(teacherId);

  return fireDb.runTransaction(async tx => {

    // 先に全部読む
    const skillSnap = await tx.get(skillRef);
    const learnerSnap = await tx.get(learnerRef);
    const teacherSnap = await tx.get(teacherRef);

    if (!skillSnap.exists) {
      const error = new Error("SKILL_NOT_FOUND");
      error.code = "SKILL_NOT_FOUND";
      throw error;
    }

    const skill = skillSnap.data();

    // すでに他の人とマッチ済み
    if (skill.status !== "open") {
      const error = new Error("ALREADY_MATCHED");
      error.code = "ALREADY_MATCHED";
      throw error;
    }

    let learnerPoints =
      Number(
        learnerSnap.exists ? learnerSnap.data().totalPoints || 0 : 0
      );
    const learnerMatches =
      Number(
        learnerSnap.exists ? learnerSnap.data().matches || 0 : 0
      );
    const teacherMatches =
      Number(
        teacherSnap.exists
          ? teacherSnap.data().matches || 0 : 0
      );

    let reservedPoints = 0;

    // 「教わる」投稿の場合は 投稿した時点ですでに予約済み
    const alreadyReserved =
      skill.reservationStatus === "reserved" &&
      skill.reservedUserId === learnerId;

    if (alreadyReserved) {
      // 二重に引かない
      reservedPoints = Number( 
          skill.reservedPoints || 0 );
    } 
    else {
      // 「教える」投稿の場合
      // マッチした学習者からここで予約する
      reservedPoints = Number(
          estimatedPoints || 0
        );

      const newBalance = learnerPoints - reservedPoints;

      if (newBalance < minBalance) {
        const error = new Error("POINT_LIMIT");
        error.code = "POINT_LIMIT";
        throw error;
      }

      learnerPoints = newBalance;
    }

    // 学習者
    tx.set(
      learnerRef,
      {
        totalPoints: learnerPoints,
        matches: learnerMatches + 1
      },
      {
        merge: true
      }
    );

    // 教える側
    tx.set(
      teacherRef,
      {
        matches: teacherMatches + 1
      },
      {
        merge: true
      }
    );

    // 投稿をマッチ済みにする
    tx.update(
      skillRef,
      {
        status: "matched",
        matchedUserId: matchedUserId,
        teacherId: teacherId,
        learnerId: learnerId,
        reservedPoints: reservedPoints,
        reservedUserId: learnerId,
        reservationStatus: "reserved",
        pointsSettled: false
      }
    );

    return {
      reservedPoints,
      learnerPoints
    };
  });
}

// ===== 通話終了時：実際の通話時間でTimeを精算 =====
async function settleConversationPointsInFirestore(
  convId, actualSeconds
) {
  const convRef = fireDb
      .collection("conversations")
      .doc(convId);

  return fireDb.runTransaction(async tx => {
    // 会話情報を取得
    const convSnap = await tx.get(convRef);

    if (!convSnap.exists) {
      const error = new Error("CONVERSATION_NOT_FOUND");
      error.code = "CONVERSATION_NOT_FOUND";
      throw error;
    }

    const conv = convSnap.data();

    if (conv.pointsSettled === true) {
      return {
        alreadySettled: true
      };
    }
    if (
      !conv.skillId ||
      !conv.teacherId ||
      !conv.learnerId
    ) {
      const error = new Error("MATCH_INFO_MISSING");
      error.code = "MATCH_INFO_MISSING";
      throw error;
    }

    const skillRef = fireDb
        .collection("skills")
        .doc(conv.skillId);
    const teacherRef = fireDb
        .collection("users")
        .doc(conv.teacherId);
    const learnerRef = fireDb
        .collection("users")
        .doc(conv.learnerId);
    const skillSnap = await tx.get(skillRef);
    const teacherSnap = await tx.get(teacherRef);
    const learnerSnap = await tx.get(learnerRef);

    if (!skillSnap.exists) {
      const error = new Error("SKILL_NOT_FOUND");
      error.code = "SKILL_NOT_FOUND";
      throw error;
    }

    const skill = skillSnap.data();


    if (skill.pointsSettled === true) {
      return {
        alreadySettled: true
      };
    }

    const coefficients = {
      "初級": 1,
      "中級": 1.5,
      "上級": 2,
      "専門家": 3
    };

    const level = conv.skillLevel ||
      skill.level || "初級";
    const coeff = Number( coefficients[level] || 1 );
    const actualPoints =
      Math.max(
        1,
        Math.round(
          (
            Number(actualSeconds) / 60
          ) * coeff
        )
      );
    const reservedPoints =
      Number( skill.reservedPoints || 0 );
    const learnerCurrent =
      Number( learnerSnap.exists  ? learnerSnap.data().totalPoints || 0 : 0
      );
    const teacherCurrent =
      Number( teacherSnap.exists
          ? teacherSnap.data().totalPoints || 0: 0
      );
    const learnerNew =
      learnerCurrent + reservedPoints - actualPoints;
    const teacherNew =
      teacherCurrent + actualPoints;

    tx.set(
      learnerRef,
      {
        totalPoints:
          learnerNew
      },
      {
        merge: true
      }
    );

    tx.set(
      teacherRef,
      {
        totalPoints:
          teacherNew
      },
      {
        merge: true
      }
    );

    tx.update(
      skillRef,
      {
        pointsSettled: true,
        reservationStatus: "settled",
        actualPoints: actualPoints,
        actualSeconds: Number(actualSeconds),
        settledAt: firebase.firestore
            .FieldValue
            .serverTimestamp()
      }
    );

    tx.set(
      convRef,
      {
        pointsSettled: true,
        actualPoints: actualPoints,
        actualSeconds: Number(actualSeconds),
        settledAt: firebase.firestore
            .FieldValue
            .serverTimestamp()
      },
      {
        merge: true
      }
    );

    return {
      alreadySettled: false,
      actualPoints: actualPoints,
      reservedPoints: reservedPoints,
      difference: reservedPoints - actualPoints,
      learnerNew: learnerNew,
      teacherNew: teacherNew
    };
  });
}

// ===== 投稿削除時：予約中のTimeを返却してから削除 =====
async function deleteSkillWithRefundInFirestore(
  skillId, requesterId
) {
  const skillRef = fireDb.collection("skills").doc(skillId);

  return fireDb.runTransaction(async tx => {

    // まず投稿を取得
    const skillSnap = await tx.get(skillRef);

    if (!skillSnap.exists) {
      return {
        deleted: false,
        refundedPoints: 0
      };
    }

    const skill = skillSnap.data();

    // 自分の投稿だけ削除可能
    if (skill.userId !== requesterId) {
      const error = new Error("NO_PERMISSION");
      error.code = "NO_PERMISSION";
      throw error;
    }
    // マッチ済み投稿は削除させない
    if (skill.status === "matched") {
      const error = new Error("MATCHED_DELETE");
      error.code = "MATCHED_DELETE";
      throw error;
    }

    // 返却対象かどうか
    const shouldRefund =
      skill.reservationStatus === "reserved" &&
      skill.pointsSettled !== true &&
      skill.reservedUserId;

    let refundedPoints = 0;

    if (shouldRefund) {
      refundedPoints = Number(skill.reservedPoints || 0);
      if (refundedPoints > 0) {
        const userRef = fireDb
            .collection("users")
            .doc(skill.reservedUserId);

        // Transactionなので先に読む
        const userSnap = await tx.get(userRef);
        const currentPoints =
          Number(
            userSnap.exists
              ? userSnap.data().totalPoints || 0 : 0
          );

        // 予約していたTimeを返す
        tx.set(
          userRef,
          {
            totalPoints:
              currentPoints + refundedPoints
          },
          {
            merge: true
          }
        );
      }
    }

    // 最後に投稿を削除
    tx.delete(skillRef);

    return {
      deleted: true, refundedPoints
    };
  });
}