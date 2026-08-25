"use strict";

// ===== チャット添付ファイルの上限（Firestoreへ直接保存するため） =====
const MAX_ATTACHMENT_SIZE = 500 * 1024; // 500KB

// ===== 認証ユーザー情報（Firestore） =====
const AUTH_USER_COLLECTION = "authUsers";

function authUserRef(userId) {
  return fireDb.collection(AUTH_USER_COLLECTION).doc(userId);
}

// ユーザーをデータベースから削除する（退会処理用）
async function deleteDatabaseUser(userId) {
  await authUserRef(userId).delete();
  return { deletedUserId: userId };
}

//ユーザーをデータベースに入れる
async function insertDatabaseUser(user) {
  const normalizedEmail = (user.email || "").trim().toLowerCase();

  await authUserRef(user.id).set({
    id: user.id,
    email: user.email,
    emailLower: normalizedEmail,
    name: user.name,
    school: user.school,
    avatarColor: user.avatarColor,
    realName: user.realName || "",
    matches: Number(user.matches || 0),
    totalPoints: Number(user.totalPoints || 0),
    role: "user",
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  return { id: user.id };
}

//データベースからユーザーを探す
async function getDatabaseUser(userId) {
  let snap = await authUserRef(userId).get();
  let record = snap.exists ? snap.data() : null;

  if (!record) return null;

  return {
    id: record.id || userId,
    email: record.email,
    name: record.name,
    school: record.school,
    avatarColor: record.avatarColor,
    realName: record.realName || "",
    rating: 0,
    reviewCount: 0,
    matches: Number(record.matches || 0),
    totalPoints: Number(record.totalPoints || 0)
  };
}

// ===== 大学検索 =====
let schools = [];
let selectedSchool = null;

const schoolInput = document.getElementById("reg-school");
const schoolResults = document.getElementById("school-results");

//CSVドキュメントを読み込む
if (schoolInput){
fetch("data/schools.csv")
  .then(function (response) {
    return response.text();
  })
  .then(function (text) {
    schools = text
      .split(/\r?\n/)
      .map(function (school) {
        return school.trim();
      })
      .filter(function (school) {
        return school !== "";
      });
  });

//学校検索 
schoolInput.addEventListener("input", function () {
  const keyword = schoolInput.value.trim();

  selectedSchool = null;
  schoolResults.innerHTML = "";

  if (keyword === "") {
    return;
  }

  const matches = schools.filter(function (school) {
    return school.includes(keyword);
  });

//学校が見つからなかった場合 
  if (matches.length === 0) {
    const item = document.createElement("li");
    item.textContent = "学校が見つかりませんでした。";
    item.classList.add("no-result");
    schoolResults.appendChild(item);
    return;
  }

//検索結果を表示 
  matches.forEach(function (school) {
    const item = document.createElement("li");
    item.textContent = school;

    item.addEventListener("click", function () {
      schoolInput.value = school;
      selectedSchool = school;
      schoolResults.innerHTML = "";
    });

    schoolResults.appendChild(item);
  });
});
}

// ===== パスワード変更用関数 =====
async function updatePassword(user, newPassword) {
    const idx = APP.users.findIndex(u => u.id === user.id);

    if (idx === -1) {
        return false;
    }

    try {
      await updateCurrentUserPassword(newPassword);
      return true;
    } catch (error) {
      console.error("パスワード更新に失敗:", error);
      return false;
    }
}

// ===== ログインパスワード表示切替 =====
document.addEventListener("DOMContentLoaded", () => {

  const passwordInput =
    document.getElementById("login-password");

  const toggleBtn =
    document.getElementById("toggle-login-pass");

  if (!passwordInput || !toggleBtn) return;

  toggleBtn.addEventListener("click", () => {
    const isHidden =
      passwordInput.type === "password";

    passwordInput.type =
      isHidden ? "text" : "password";

    toggleBtn.textContent =
      isHidden ? "🙈" : "👀";
  });

  // 新規登録用
    const regPasswordInput = document.getElementById("reg-password");
    const toggleRegBtn = document.getElementById("toggle-reg-pass");

    if (regPasswordInput && toggleRegBtn) {
      toggleRegBtn.addEventListener("click", () => {
        const isHidden = regPasswordInput.type === "password";
        regPasswordInput.type = isHidden ? "text" : "password";
        toggleRegBtn.textContent = isHidden ? "🙈" : "👀";
      });
    }

});

// ===== 固定配置 =====
const level_coefficients = { "初級": 1.0, "中級": 1.5, "上級": 2.0, "専門家": 3.0 };//レベルに応じた係数
const avatar_colors = ["av-orange", "av-mint", "av-rose", "av-sky", "av-lime", "av-peach"];
const student_domains = ["ac.jp", ".edu", "ac.uk", "edu.au", ".u-", "stud.", "student."];
const cat_emoji = { "言語":"🗣", "プログラミング":"💻", "デザイン":"🎨", "音楽":"🎵", "数学・理系":"📐", "ビジネス":"💼", "その他":"🌟" };

// ===== アプリの実行状態 =====
let currentUser  = null;
let activeConvId = null;
let selectedStars = 0;
let currentModalSkillId = null;
let currentReportTarget = null; // { reportedUserId, skillId } — 通報モーダルの対象（投稿経由 or チャット経由）
let pendingVerifyCredentials = null; // { email, password } — メール確認待ちの間、再サインインに使う
let pendingVerifyUser = null;        // メール確認待ちの間のローカルユーザー情報（確認できたらこれでログインする）

function showVerifyScreen(email) {
  document.getElementById("auth-screen").classList.add("hidden");
  document.getElementById("app").classList.add("hidden");
  const verifyScreen = document.getElementById("verify-screen");
  if(verifyScreen) verifyScreen.classList.remove("hidden");
  const emailEl = document.getElementById("verify-target-email");
  if(emailEl) emailEl.textContent = `${email} 宛に確認メールを送信しました。`;
  const infoEl = document.getElementById("verify-info");
  if(infoEl) infoEl.textContent = "";
}
let editingSkillId = null;
let homeFilter = { tab: "seek", cat: ""};
let appListenersInitialized = false;   



// ===== お知らせの機能 =====
function getNotificationBody(n) {
  const name = getUserName(n.fromUserId);

  if (n.type === "match") {
    return `${name}さんとスキル交換が成立しました！DMでやり取りを始めましょう。`;
  }
  if (n.type === "review") {
    return `${name}さんがあなたのスキルに★${n.stars}のレビューを書きました。`;
  }
  if (n.type === "dm") {
    return `${name}さんからDMが届いています。`;
  }
  return "";
}//通知を受け取る

function renderNotifications() {
  const list  = document.getElementById("notif-list");
  const empty = document.getElementById("notif-empty");
  list.innerHTML = "";
  const myNotifications = APP.notifications.filter(n => n.userId === currentUser.id);

  if (!myNotifications.length) { 
    empty.classList.remove("hidden"); return; 
    }
  empty.classList.add("hidden");
  const iconMap = { match:"🎉", review:"⭐", dm:"💬", system:"📢" };
  myNotifications.forEach(n => {
    const item = document.createElement("article");
    item.className = `notif-item ${n.read?"read":"unread"}`;
    item.setAttribute("role","listitem");
    item.innerHTML = `
      <div class="notif-item__icon">${iconMap[n.type]||"📢"}</div>
      <div class="notif-item__body">
        <div class="notif-item__title">${n.title}</div>
        <p>${escapeHtml(getNotificationBody(n))}</p>
      </div>
      <span class="notif-item__time">${n.time}</span>
    `;
    item.addEventListener("click", () => { n.read=true; saveNotifs(APP.notifications); item.className="notif-item read"; refreshBadges(); });
    list.appendChild(item);
  });
}//通知を読む

// ===== ローカルストレージ =====
const DEFAULT_NOTIF_SETTINGS = { match:true, review:true, dm:true, system:true };

function loadNotifSettings() {
  try { return JSON.parse(localStorage.getItem("ss_notif_settings")) || { ...DEFAULT_NOTIF_SETTINGS }; }
  catch(e) { return { ...DEFAULT_NOTIF_SETTINGS }; }
}

function saveNotifSettings(s) { localStorage.setItem("ss_notif_settings", JSON.stringify(s)); }

function loadState() {
  try {
    return {
      users:JSON.parse(localStorage.getItem("ss_users")) || [],
      skills:JSON.parse(localStorage.getItem("ss_skills")) || [],
      notifications:JSON.parse(localStorage.getItem("ss_notifications")) || [],
      reports:JSON.parse(localStorage.getItem("ss_reports")) || [],currentUserId:localStorage.getItem("ss_current_user") || null
    };
  } 
    catch(e) {
        return {
            users: [],
            skills: [],
            notifications: [],
            reports: [],
            currentUserId: null
    };
  }
}
function saveUsers(u)  { localStorage.setItem("ss_users", JSON.stringify(u)); }
function saveSkills(s) { localStorage.setItem("ss_skills", JSON.stringify(s)); }
function saveNotifs(n) { localStorage.setItem("ss_notifications", JSON.stringify(n)); }
function saveReports(r) { localStorage.setItem("ss_reports", JSON.stringify(r));}
function saveCurrentUser(id) { id ? localStorage.setItem("ss_current_user",id) : localStorage.removeItem("ss_current_user"); }

let APP = loadState();

// ===== メインの処理の関数 =====
function getAvatarColor(userId) {
  const u = getPublicUserById(userId);
  return u.avatarColor || avatar_colors[0];
}
function getUserInitial(userId) {
  const u = getPublicUserById(userId);
  const name = u.name || "ユーザー";
  return name.charAt(0);
}
function getAvatarUrl(userId) {
  const u = getPublicUserById(userId);
  return u.avatarUrl || null;
}

function calcPoints(time, level) {
  const minutes = Number(time) || 0;
  const coeff =
    Number(level_coefficients[level]) || 1;
  return Math.round(minutes * coeff);
}

async function settleCallPoints(
  convId, actualSeconds
) {
  try {
    const result =
      await settleConversationPointsInFirestore(
        convId, actualSeconds
      );

    if (result.alreadySettled) {
      return;
    }
    if (result.difference > 0) {
      showBanner(
        `学習終了！実際は ${result.actualPoints} Timeでした。${result.difference} Timeを返却しました。`
      );
    }
    else if (result.difference < 0) {
      showBanner(
        `学習終了！実際は ${result.actualPoints} Timeでした。追加で ${Math.abs(result.difference)} Timeを精算しました。`
      );
    }
    else {
      showBanner(
        `学習終了！${result.actualPoints} Timeを精算しました。`
      );

    }

  } catch(error) {
    console.error( "Time精算エラー:", error);

    if (
      error.code === "MATCH_INFO_MISSING"
    ) {
      showBanner(
        "この通話にはマッチ情報がないため、Timeを精算できませんでした。");
    } else {

      showBanner("Timeの精算に失敗しました。");
    }
  }
}

// 既存のDOM要素にアバター（写真があれば写真、無ければ色付きイニシャル）を反映する
// baseClass: その要素が元々持つべき基本クラス名（例: "avatar", "profile-avatar", "call-avatar"）
function applyAvatar(el, userId, baseClass) {
  if(!el) return;
  const url = getAvatarUrl(userId);
  if(url) {
    el.className = `${baseClass} avatar--photo`;
    el.style.backgroundImage = `url("${url}")`;
    el.textContent = "";
  } else {
    el.className = `${baseClass} ${getAvatarColor(userId)}`;
    el.style.backgroundImage = "";
    el.textContent = getUserInitial(userId);
  }
}

// HTMLテンプレート文字列の中でアバターを組み立てるときに使う
// (class属性・style属性・中身のテキストをまとめて返す)
function avatarParts(userId, baseClass) {
  const url = getAvatarUrl(userId);
  if(url) {
    return { cls: `${baseClass} avatar--photo`, style: `background-image:url('${url}')`, inner: "" };
  }
  return { cls: `${baseClass} ${getAvatarColor(userId)}`, style: "", inner: getUserInitial(userId) };
}

// Firestoreから取得した相手の公開プロフィールを、ローカルのAPP.usersにも反映する
// （既存のgetUserById / getAvatarColor / getUserInitial がそのまま使えるようにするため）
function upsertLocalUserProfile(userId, profile) {
  if(!profile) return;
  const idx = APP.users.findIndex(u => u.id === userId);
  if(idx !== -1) {
    if(profile.name)        APP.users[idx].name        = profile.name;
    if(profile.avatarColor) APP.users[idx].avatarColor  = profile.avatarColor;
    APP.users[idx].avatarUrl = profile.avatarUrl || null;
  } else {
    APP.users.push({
      id: userId,
      name: profile.name || "ユーザー",
      school: "",
      avatarColor: profile.avatarColor || avatar_colors[0],
      avatarUrl: profile.avatarUrl || null,
      rating:0, reviewCount:0, matches:0, totalPoints:0,
    });
  }
}
function getUserById(id) { return APP.users.find(u => u.id === id); }
function renderStars(r) { return "★".repeat(Math.floor(r)) + "☆".repeat(5-Math.floor(r)); }
function isStudentEmail(e) { return student_domains.some(d => e.toLowerCase().includes(d)); }
function generateId(p) { return p + Date.now() + Math.random().toString(36).slice(2,6); }
function nowTime() { const d=new Date(); return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; }
function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ===== 一時通知バナー =====
function showBanner(msg) {
  const banner = document.getElementById("notification-banner");
  document.getElementById("notif-message").textContent = msg;
  banner.classList.remove("hidden");
  clearTimeout(window._bannerTimer);
  window._bannerTimer = setTimeout(() => banner.classList.add("hidden"), 5000);
}

// ===== BADGES =====
function refreshBadges() {
const unN = currentUser
  ? APP.notifications.filter(
      n =>
        n.userId === currentUser.id &&
        !n.read
    ).length
  : 0;
const unD = currentUser
  ? liveConversations.reduce(
      (sum, conv) =>
        sum + Number(conv.unreadCount || 0), 0
    )
  : 0;
  const nb = document.getElementById("notif-badge");
  const db = document.getElementById("dm-badge");
  if(unN > 0) { 
    nb.textContent = unN; 
    nb.classList.remove("hidden"); 
    } 
    else {
        nb.textContent = "";
        nb.classList.add("hidden");
        }
  if(unD > 0) { 
    db.textContent = unD; 
    db.classList.remove("hidden"); 
    } 
    else {
        db.textContent = "";
        db.classList.add("hidden");
        }
}

function updateHeaderPoints() {
  const el = document.getElementById("header-points");

  if(el && currentUser) {
    const u = getPublicUserById(currentUser.id);
    el.textContent = u ? (u.totalPoints || 0) : 0;
  }
}

// ===== AUTH =====
function initAuth() {
  document.querySelectorAll(".auth-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".auth-tab").forEach(t => { t.classList.remove("active"); t.setAttribute("aria-selected","false"); });
      tab.classList.add("active"); tab.setAttribute("aria-selected","true");
      document.getElementById("login-form").classList.toggle("hidden",    tab.dataset.tab !== "login");
      document.getElementById("register-form").classList.toggle("hidden", tab.dataset.tab !== "register");
    });
  });

// ===== ログイン =====
  document.getElementById("login-form").addEventListener("submit", async e => {
    e.preventDefault();
    const email = document.getElementById("login-email").value.trim();
    const password  = document.getElementById("login-password").value;
    const err   = document.getElementById("login-error");
    if(!email || !password) { err.textContent = "メールアドレスとパスワードを入力してください。"; return; }

   let verified = false;
   let authUid = null;
   try {
     const authResult = await signInAndCheckEmailVerified(email, password);
     verified = authResult.verified;
     authUid = authResult.user.uid;
   } catch (verifyError) {
     console.error("ログインに失敗:", verifyError);
     err.textContent = "メールアドレスまたはパスワードが正しくありません。";
     return;
   }

   let user = APP.users.find(u => u.id === authUid);
   if (!user) {
     try {
       user = await getDatabaseUser(authUid);
     } catch (error) {
       console.error(error);
       err.textContent = "ユーザー情報の取得に失敗しました。";
       return;
     }
   }
   if (!user) {
     const localByEmail = APP.users.find(
       u => (u.email || "").toLowerCase() === email.toLowerCase()
     );
     user = {
       id: authUid,
       email,
       name: localByEmail?.name || email.split("@")[0],
       realName: localByEmail?.realName || "",
       school: localByEmail?.school || "",
       avatarColor: localByEmail?.avatarColor || "av-orange",
       rating: 0,
       reviewCount: 0,
       matches: Number(localByEmail?.matches || 0),
       totalPoints: Number(localByEmail?.totalPoints || 0)
     };

     try {
       await insertDatabaseUser(user);
     } catch (createProfileError) {
       console.error("認証ユーザー情報の初期化に失敗:", createProfileError);
       err.textContent = "ユーザー情報の初期化に失敗しました。もう一度お試しください。";
       return;
     }
   }

   if (!APP.users.some(u => u.id === user.id)) {
     APP.users.push(user);
     saveUsers(APP.users);
   }

   if (!verified) {
     pendingVerifyCredentials = { email, password };
     pendingVerifyUser = user;
     err.textContent = "";
     showVerifyScreen(email);
     return;
   }

   err.textContent = "";
   loginUser(user);

  });

//===== パスワード忘れたボタン押せる =====
const forgotPasswordLink =
  document.getElementById("forgot-password-link");

const forgotPasswordModal =
  document.getElementById("forgot-password-modal");

forgotPasswordLink?.addEventListener("click", () => {
  forgotPasswordModal?.classList.remove("hidden");
});

//===== パスワードを忘れて再設定 =====
const forgotPasswordClose =
  document.getElementById("forgot-password-close");

forgotPasswordClose?.addEventListener("click", () => {
  forgotPasswordModal?.classList.add("hidden");
});

const forgotPasswordForm =
  document.getElementById("forgot-password-form");

if (forgotPasswordForm) {
  forgotPasswordForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    console.log("パスワード再設定メール送信ボタンが押されました");
    const email = document.getElementById("forgot-email").value.trim();
    const err = document.getElementById("forgot-password-error");

    if (!email) {
      err.textContent = "メールアドレスを入力してください。";
      return;
    }

    try {
      await sendPasswordReset(email);
      err.textContent = "";
      closeModal("forgot-password-modal");
      alert("パスワード再設定メールを送信しました。メール内のリンクから再設定してください。");
    } catch (resetError) {
      console.error("パスワード再設定メールの送信に失敗:", resetError);
      err.textContent = "再設定メールの送信に失敗しました。メールアドレスを確認して再度お試しください。";
    }
  });
}

// ===== 登録（学校選択のコードなし） =====
  document.getElementById("register-form").addEventListener ("submit", async e => {
    e.preventDefault();
    const realName = document.getElementById("reg-realname").value.trim();
    const name   = document.getElementById("reg-name").value.trim();
    const email  = document.getElementById("reg-email").value.trim();
    const school = document.getElementById("reg-school").value.trim();
    const password   = document.getElementById("reg-password").value;
    const agreed = document.getElementById("reg-agree").checked;
    const err    = document.getElementById("register-error");
    if(!name||!email||!school||!password) { err.textContent = "すべての必須項目を入力してください。"; return; }
    if(!realName) { err.textContent = "本名（氏名）を入力してください。"; return; }

    if(!selectedSchool || selectedSchool !== school) {
      err.textContent = "候補リストから学校名を選択してください。";
      return;
    }

    if(password.length < 8) { err.textContent = "パスワードは8文字以上にしてください。"; return; }
    if(!isStudentEmail(email)) { err.textContent = "学校のメールアドレス（ac.jp / edu 等）を使用してください。"; return; }
    if(!agreed) { err.textContent = "個人情報の取り扱いに同意してください。"; return; }
    if(APP.users.find(u => u.email === email)) { err.textContent = "このメールアドレスはすでに登録されています。"; return; }

    try {
        await registerAndSendVerification(email, password);
        const authUid = fireAuth.currentUser && fireAuth.currentUser.uid;
        if (!authUid) {
          err.textContent = "アカウント初期化に失敗しました。もう一度お試しください。";
          return;
        }

        const newUser = {
          id: authUid, name, realName, email, school,
          avatarColor: avatar_colors[APP.users.length % avatar_colors.length],
          rating:0, reviewCount:0, matches:0, totalPoints:0,
        };

        await insertDatabaseUser(newUser);
        APP.users.push(newUser);
        saveUsers(APP.users);
        err.textContent = "";

        pendingVerifyCredentials = { email, password };
        pendingVerifyUser = newUser;
        showVerifyScreen(email);
        } 
        catch (error) {
            console.error(error);
            if (error && error.code === "auth/email-already-in-use") {
              err.textContent = "このメールアドレスはすでに登録されています。";
              return;
            }
            err.textContent =
            "登録に失敗しました。もう一度お試しください。";
        }
  });

  if(APP.currentUserId) {
    const u = getUserById(APP.currentUserId);
    if(u) loginUser(u);
  }

  // ── メール確認待ち画面のボタン ──
  const verifyCheckBtn = document.getElementById("verify-check-btn");
  if(verifyCheckBtn) verifyCheckBtn.addEventListener("click", async () => {
    const infoEl = document.getElementById("verify-info");
    if(infoEl) infoEl.textContent = "確認しています…";
    try {
      const verified = await refreshEmailVerified();
      if(verified) {
        const user = pendingVerifyUser;
        pendingVerifyCredentials = null;
        pendingVerifyUser = null;
        document.getElementById("verify-screen").classList.add("hidden");
        if(user) loginUser(user);
      } else {
        if(infoEl) infoEl.textContent = "まだ確認が完了していません。メール内のリンクを開いてから、もう一度お試しください。";
      }
    } catch(e) {
      console.error("確認状態のチェックに失敗:", e);
      if(infoEl) infoEl.textContent = "確認に失敗しました。通信環境をご確認のうえ、もう一度お試しください。";
    }
  });

  const verifyResendBtn = document.getElementById("verify-resend-btn");
  if(verifyResendBtn) verifyResendBtn.addEventListener("click", async () => {
    const infoEl = document.getElementById("verify-info");
    try {
      await resendVerificationEmail();
      if(infoEl) infoEl.textContent = "確認メールを再送信しました。";
    } catch(e) {
      console.error("確認メールの再送信に失敗:", e);
      if(infoEl) infoEl.textContent = "再送信に失敗しました。時間をおいて再度お試しください。";
    }
  });

  const verifyLogoutBtn = document.getElementById("verify-logout-btn");
  if(verifyLogoutBtn) verifyLogoutBtn.addEventListener("click", () => {
    pendingVerifyCredentials = null;
    pendingVerifyUser = null;
    if(fireAuth.currentUser) fireAuth.signOut().catch(() => {});
    document.getElementById("verify-screen").classList.add("hidden");
    document.getElementById("auth-screen").classList.remove("hidden");
  });
}

function loginUser(user) {
  currentUser = user;
  APP.currentUserId = user.id;
  saveCurrentUser(user.id);

  // ローカルの記録にも「メール確認済み」を反映（プロフィール画面のバッジ表示に使う）
  const localIdx = APP.users.findIndex(u => u.id === user.id);
  if(localIdx !== -1) {
    APP.users[localIdx].verified = true;
    currentUser = APP.users[localIdx];
    saveUsers(APP.users);
  }

if (typeof ensureUserCloudState === "function") {
  ensureUserCloudState(user)
    .catch(error => {
      console.error(
        "ユーザークラウド状態の初期化失敗:",
        error
      );
    });
}

  document.getElementById("auth-screen").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  initApp();
  startUsersListener();
  startConversationListListener();
  startIncomingCallListener();
  startSkillsListener();
  startStatsListener();

  // Firestoreに保存されているブロックリストを取得し、他の端末でブロックした分も反映する
  fetchBlockedUsers(user.id).then(blockedUserIds => {
    const idx = APP.users.findIndex(u => u.id === user.id);
    if(idx !== -1) {
      APP.users[idx].blockedUsers = blockedUserIds;
      if(currentUser && currentUser.id === user.id) currentUser = APP.users[idx];
      saveUsers(APP.users);
      renderSkillGrid();
    }
  }).catch(e => console.error("ブロックリストの取得に失敗:", e));
}

document.getElementById("logout-btn").addEventListener(
    "click", () => {
  if(convListUnsub) { 
      convListUnsub(); 
      convListUnsub = null; 
      }
  if(convMsgUnsub) { 
      convMsgUnsub();  
      convMsgUnsub  = null; 
      }
  if(incomingCallUnsub) { 
      incomingCallUnsub(); 
      incomingCallUnsub = null; 
      }
  if(skillsUnsub) { 
      skillsUnsub(); 
      skillsUnsub = null; 
      }

  activeConvId = null;
  liveConversations = [];

  if(usersUnsub) {
      usersUnsub();
      usersUnsub = null;
      }
  if(statsMatchesUnsub) {
      statsMatchesUnsub();
      statsMatchesUnsub = null;
      }
  currentUser = null; APP.currentUserId = null; saveCurrentUser(null);
  document.getElementById("app").classList.add("hidden");
  document.getElementById("auth-screen").classList.remove("hidden");
  document.getElementById("login-email").value = "";
  document.getElementById("login-password").value = "";
  document.getElementById("login-error").textContent = "";
});

// ===== NAVIGATION =====
function initNav() {
  document.querySelectorAll(".nav-btn[data-view]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      showView(btn.dataset.view);
    });
  });

  // FAB → post
  document.getElementById("nav-post-btn").addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    showView("post");
  });
}

function showView(name) {
  if (name !== "messages" && activeConvId) {
      if (convMsgUnsub) {
          convMsgUnsub();
          convMsgUnsub = null;
          }
  activeConvId = null;
  showMsgPage("list");
}
  document.querySelectorAll(".view").forEach(v => {
    v.classList.remove("active", "hidden");
  });
  const t = document.getElementById(`view-${name}`);
  if(t) t.classList.add("active");
  if(name === "home")          renderSkillGrid();
  if(name === "messages")      renderMessages();
  if(name === "notifications") renderNotifications();
  if(name === "profile")       renderProfile();
}

// ===== HOME FILTER TABS =====
function initFilterTabs() {
  const seekBtn = document.getElementById("tab-seek");
  const giveBtn = document.getElementById("tab-give");

  seekBtn.addEventListener("click", () => {
    homeFilter.tab = "seek";
    seekBtn.classList.add("active-seek");
    giveBtn.classList.remove("active-seek"); giveBtn.classList.remove("active-give");
    renderSkillGrid();
  });
  giveBtn.addEventListener("click", () => {
    homeFilter.tab = "give";
    giveBtn.classList.add("active-give");
    seekBtn.classList.remove("active-seek"); seekBtn.classList.remove("active-give");
    renderSkillGrid();
  });
}

// ===== CATEGORY CHIPS =====
function initCategoryChips() {
  document.querySelectorAll(".cat-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".cat-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      homeFilter.cat = chip.dataset.cat;
      renderSkillGrid();
    });
  });
}

// ===== SKILL GRID =====
function renderSkillGrid() {
  const grid  = document.getElementById("skill-grid");
  const empty = document.getElementById("empty-state");
  const query = (document.getElementById("search-input").value || "").toLowerCase();

  let filtered = APP.skills.filter(s => {
    if((currentUser.blockedUsers || []).includes(s.userId)) return false;
    if (s.status !== "open") return false;
    if(s.type !== homeFilter.tab) return false;
    if(homeFilter.cat && s.category !== homeFilter.cat) return false;
    if(query && !s.skill.toLowerCase().includes(query) && !s.desc.toLowerCase().includes(query)) return false;
    return true;
  });

  grid.innerHTML = "";
  if(!filtered.length) { empty.classList.remove("hidden"); return; }
  empty.classList.add("hidden");

  filtered.forEach(skill => {
    const user = getPublicUserById(skill.userId);
    const av = avatarParts(user.id, "avatar");
    const points = calcPoints(skill.time, skill.level);
    const coeff  = level_coefficients[skill.level];
    const avg    = skill.reviews.length
      ? (skill.reviews.reduce((s,r) => s+r.stars,0)/skill.reviews.length).toFixed(1)
      : null;
    const emoji  = cat_emoji[skill.category] || "🌟";
    const isSeek = skill.type === "seek";
    const isMine = skill.userId === currentUser.id;

    const card = document.createElement("article");
    card.className = "skill-card";
    card.setAttribute("role","listitem");
    card.setAttribute("tabindex","0");
    card.setAttribute("aria-label", `${skill.skill} — ${user.name}`);
    card.innerHTML = `
      <div class="card-top-row">
        <span class="card-category-tag">${emoji} ${skill.category}</span>
        <span class="card-time-tag">
          <span class="coin-mini">☀</span>${points} Time
        </span>
      </div>
      <h2 class="card-title">
        ${isSeek ? "🆘" : "✨"} ${escapeHtml(skill.skill)}
      </h2>
      <div class="card-bottom-row">
      <div class="${av.cls}" style="${av.style}">
      ${av.inner}</div>
        <div class="card-user-info">
          <div class="card-user-name">
            ${escapeHtml(user.name)}
            ${isMine ? '<span class="card-user-tag">あなたの投稿</span>' : (isSeek ? '' : '<span class="card-user-tag">新着</span>')}
          </div>
          <div class="card-user-school">${escapeHtml(user.school)}</div>
          ${avg ? `<div class="card-stars">★ ${avg}</div>` : ""}
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
          <span class="card-level level--${skill.level}">${skill.level} ×${coeff}</span>
          <span style="font-size:.74rem;color:var(--text-soft)">⏱ ${skill.time}分</span>
        </div>
        ${isMine
          ? `<button class="btn--help" disabled aria-label="自分の投稿には申し込めません">投稿中</button>`
          : `<button class="btn--help" data-id="${skill.id}" aria-label="${isSeek?"助ける":"交換"}">${isSeek ? "助ける！" : "交換！"}</button>`
        }
      </div>
    `;

    card.addEventListener("click", e => {
      if(e.target.closest(".btn--help")) return;
      openSkillModal(skill.id);
    });
    const helpBtn = card.querySelector(".btn--help");
    if(!isMine && helpBtn) {
      helpBtn.addEventListener("click", e => {
        e.stopPropagation();
        
        const s = APP.skills.find(x => x.id === skill.id);

        if(!s) return;
        const u2 = getPublicUserById(s.userId);triggerMatch(s, u2);
      });
    }
    card.addEventListener("keydown", e => { if(e.key==="Enter"||e.key===" ") openSkillModal(skill.id); });
    grid.appendChild(card);
  });
}

// search-input listener bound in initListeners()

// ===== SKILL MODAL =====
function openSkillModal(skillId, reviewMode = false) {
  currentModalSkillId = skillId;
  selectedStars = 0;

  const skill = APP.skills.find(s => s.id === skillId);
  if(!skill) return;
  let displayUserId = skill.userId;
// 評価画面から開いた場合は相手を表示
if (reviewMode) {
  if (skill.teacherId === currentUser.id) {
    displayUserId = skill.learnerId;
  }
  else if (skill.learnerId === currentUser.id) {
    displayUserId = skill.teacherId;
  }
}
  const user = getPublicUserById(displayUserId);
  const points = calcPoints(skill.time, skill.level);
  const coeff  = level_coefficients[skill.level];
  const avg    = skill.reviews.length
    ? (skill.reviews.reduce((s,r) => s+r.stars,0)/skill.reviews.length).toFixed(1)
    : null;

  document.getElementById("modal-category").textContent       = `${cat_emoji[skill.category]||"🌟"} ${skill.category}`;
  document.getElementById("modal-title").textContent          = skill.skill;
  document.getElementById("modal-level").textContent          = skill.level;
  document.getElementById("modal-level").className            = `level-badge level--${skill.level}`;
  document.getElementById("modal-coeff").textContent          = `係数 ×${coeff}`;
  document.getElementById("modal-points").textContent         = `☀ ${points} Time`;
  applyAvatar(
  document.getElementById("modal-avatar"),
  user.id, "avatar");
  document.getElementById("modal-poster-name").textContent    = user.name;
  document.getElementById("modal-poster-school").textContent  = user.school;
  document.getElementById("modal-poster-rating").innerHTML    = avg
    ? `<span class="card-stars">★ ${avg}</span> <span style="font-size:.76rem;color:var(--text-soft)">(${skill.reviews.length}件)</span>`
    : `<span style="font-size:.76rem;color:var(--text-soft)">まだレビューなし</span>`;
  document.getElementById("modal-desc").textContent  = skill.desc;
  document.getElementById("modal-time").textContent  = `${skill.time}分`;

  const exWrap = document.getElementById("modal-exchange-wrap");
  if(skill.want) { exWrap.classList.remove("hidden"); document.getElementById("modal-exchange").textContent = skill.want; }
  else exWrap.classList.add("hidden");

  renderModalReviews(skill);
  document.querySelectorAll(".star-btn").forEach(b => b.classList.remove("active"));
  document.getElementById("review-text").value  = "";
  document.getElementById("review-error").textContent = "";

  const reviewForm =document.getElementById("review-form");
  const isParticipant =
  skill.teacherId === currentUser.id ||
  skill.learnerId === currentUser.id;
  const alreadyReviewed =
  (skill.reviews || []).some(
    r => r.userId === currentUser.id
  );
  const canReview =
  skill.status === "done" && isParticipant;
  
  if (reviewForm) {
  reviewForm.classList.toggle(
    "hidden",
    !canReview
  );
}

// Match button
const matchBtn =
  document.getElementById("modal-match-btn");

if (matchBtn) {
  if (
    skill.status === "matched" ||
    skill.status === "done"
  ) {
    matchBtn.classList.add("hidden");
  } else {
    matchBtn.classList.remove("hidden");

    matchBtn.textContent =
      skill.type === "seek"
        ? "助ける！🤝"
        : "交換を申し込む 🤝";
  }
}

document
  .getElementById("skill-modal")
  .classList.remove("hidden");
}

function getUserName(userId) {
  const user = getPublicUserById(userId);
  return user.name || "退会ユーザー";
}

function renderModalReviews(skill) {
  const list = document.getElementById("modal-review-list");
  list.innerHTML = "";
  if(!skill.reviews || !skill.reviews.length) {
    list.innerHTML = `<p style="font-size:.82rem;color:var(--text-soft)">まだレビューがありません</p>`;
    return;
  }
  skill.reviews.forEach(r => {
    const el = document.createElement("div");
    el.className = "review-item";
    el.innerHTML = `
      <div class="review-item__header">
        <span class="review-item__name">${escapeHtml(getUserName(r.userId))}</span>
        <span class="review-item__stars">${renderStars(r.stars)} ${r.stars}</span>
      </div>
      <p class="review-item__text">${escapeHtml(r.text)}</p>
    `;
    list.appendChild(el);
  });
}

async function triggerMatch(
  skill, matchedUser
) {
  // 自分の投稿には申し込めない
  if (
    skill.userId === currentUser.id
  ) {
    showBanner(
      "自分の投稿には申し込めません。"
    );
    return;
  }

  const mySkills = APP.skills.filter(
      s => s.userId === currentUser.id
    );
  const activeSkills = APP.skills.filter(
    s => s.status === "matched" &&
      (
        s.teacherId === currentUser.id ||
        s.learnerId === currentUser.id
      )
  );
  const myName = mySkills.length
      ? mySkills[0].skill : "あなたのスキル";

  // 投稿に書かれている予定Time
  const estimatedPoints =
    calcPoints(
      skill.time, skill.level
    );
  // 誰が教える側・教わる側か
  const teacherId = 
    skill.type === "give"
      ? matchedUser.id : currentUser.id;
  const learnerId =
    skill.type === "give"
      ? currentUser.id : matchedUser.id;

  try {
    const result =
      await matchSkillWithReservationInFirestore(
        skill.id,
        currentUser.id,
        teacherId,
        learnerId,
        estimatedPoints
      );

    // ローカル側も表示用に更新
    skill.status = "matched";
    skill.matchedUserId = currentUser.id;
    skill.teacherId = teacherId;
    skill.learnerId = learnerId;
    skill.reservedPoints = result.reservedPoints;
    skill.reservedUserId = learnerId;
    skill.reservationStatus = "reserved";
    skill.pointsSettled = false;

    // 会話にも今回のマッチ情報を保存
    await openDMWithUser(
      matchedUser.id,
      skill.skill,
      {
        skillId: skill.id,
        skillLevel: skill.level,
        teacherId: teacherId,
        learnerId: learnerId
      }
    );
} catch(error) {
    console.error(
      "マッチ処理に失敗:", error
    );
    if (
      error.code === "POINT_LIMIT"
    ) {
      showBanner(
        "このマッチをすると前借り上限（-100 Time）を超えるため申し込めません。"
      );
    }
    else if (
      error.code === "ALREADY_MATCHED"
    ) {
      showBanner("この投稿はすでにマッチ済みです。");
    }
    else {
      showBanner("マッチ処理に失敗しました。"
      );
    }
    return;
  }

  // マッチ成功通知
  APP.notifications.unshift({
    id: generateId("n"),
    userId: currentUser.id,
    fromUserId: matchedUser.id,
    type: "match",
    title: "マッチ成立！🎉",
    time: "たった今",
    read: false
  });

  saveNotifs(
    APP.notifications
  );
  refreshBadges();
  updateHeaderPoints();

  document
    .getElementById("match-modal-body")
    .textContent =
      `${matchedUser.name}さんとスキル交換が成立しました！`;
  document
    .getElementById("match-exchange-display")
    .innerHTML = `
      <span>${escapeHtml(myName)}</span>
      <span class="match-arrow">⇄</span>
      <span>${escapeHtml(skill.skill)}</span>
    `;
  document
    .getElementById("match-modal")
    .classList
    .remove("hidden");

  showBanner(
    `${matchedUser.name}さんとマッチ成立！🎉`
  );
}

// ===== DM（Firestoreでリアルタイム同期） =====
let skillsUnsub = null; // スキル投稿一覧の購読解除関数

// ログイン中ずっと、全スキル投稿をリアルタイム購読する。ログイン直後に1回呼べばOK。
function startSkillsListener() {
  if (skillsUnsub) { 
      skillsUnsub(); 
      skillsUnsub = null; 
      }

  skillsUnsub = listenToAllSkills(skills => {
    APP.skills = skills;
    saveSkills(APP.skills); // オフライン時などのローカルキャッシュとして保持
    // 今どの画面を見ているかに応じて再描画する
    const statSkills = document.getElementById("stat-skills");
    
    if (statSkills) {
        statSkills.textContent = skills.length;
        }

    const homeView = document.getElementById("view-home");
    const profileView = document.getElementById("view-profile");
    if(homeView && homeView.classList.contains("active")) renderSkillGrid();
    if(profileView && profileView.classList.contains("active")) renderProfile();
  });
}

let convListUnsub = null;    // 会話一覧の購読解除関数
let convMsgUnsub  = null;    // 開いている会話のメッセージ購読解除関数
let liveConversations = [];  // Firestoreから取得した会話一覧のキャッシュ（表示用）
let publicUsers = {};
let usersUnsub = null;
let statsMatchesUnsub = null;

function getPublicUserById(userId) {

  const firestoreUser = publicUsers[userId];
  const localUser = getUserById(userId);

  // Firestore にユーザー情報がある場合
  if (firestoreUser) {
    return {
      id: userId,
      name:
        firestoreUser.name ||
        firestoreUser.userName ||
        (localUser ? localUser.name : "") ||
        "ユーザー",
      school:
        firestoreUser.school ||
        (localUser ? localUser.school : "") ||
        "",
      avatarColor:
        firestoreUser.avatarColor ||
        (localUser ? localUser.avatarColor : "") ||
        "av-orange",
      avatarUrl:
        firestoreUser.avatarUrl ||
        (localUser ? localUser.avatarUrl : null) ||
        null,
      // ★ Firestore の本当のポイント
      totalPoints: Number(
        firestoreUser.totalPoints !== undefined
          ? firestoreUser.totalPoints
          : (localUser ? localUser.totalPoints : 0)
      ),
      // ★ Firestore のマッチ数
      matches: Number(
        firestoreUser.matches !== undefined
          ? firestoreUser.matches
          : (localUser ? localUser.matches : 0)
      )
    };
  }

  // Firestore にまだ無ければローカル
  if (localUser) {
    return {
      id: userId,
      name: localUser.name || "ユーザー",
      school: localUser.school || "",
      avatarColor:
        localUser.avatarColor || "av-orange",
      avatarUrl:
        localUser.avatarUrl || null,
      totalPoints:
        Number(localUser.totalPoints || 0),
      matches:
        Number(localUser.matches || 0)
    };
  }

  // どちらにも存在しない場合
  return {
    id: userId,
    name: "ユーザー",
    school: "",
    avatarColor: "av-orange",
    avatarUrl: null,
    totalPoints: 0,
    matches: 0
  };
}

// ログイン中ユーザーが参加している会話を一覧購読する。ログイン直後に1回呼べばOK。
function startConversationListListener() {
  if (convListUnsub) {
    convListUnsub();
    convListUnsub = null;
  }
  if (!currentUser) return;
  convListUnsub = fireDb
    .collection("conversations")
    .where(
      "participants",
      "array-contains",
      currentUser.id
    )
    .onSnapshot(snap => {
      liveConversations =
        snap.docs.map(doc => {
          const d = doc.data();
          const peerId =
            (d.participants || [])
              .find(
                id => id !== currentUser.id
              );
          return {
            id: doc.id,
            peerId,
            peerSkill: d.skillLabel || "",
            lastMessage: d.lastMessage || "",

              //自分の未読数
            unreadCount:
              Number( d.unreadBy?.[currentUser.id] || 0)
          };
        });
      renderMessages();
      refreshBadges();
    }, 
    err => {
        console.error(
        "会話一覧の購読エラー:", err
      );
    });
}

// 登録学生・投稿数・マッチ成立
function startUsersListener() {
  if (usersUnsub) {
    usersUnsub();
    usersUnsub = null;
  }
  usersUnsub = fireDb
    .collection("users")
    .onSnapshot(snapshot => {
      publicUsers = {};
      snapshot.forEach(doc => {
        publicUsers[doc.id] = {
          id: doc.id,
          ...doc.data()
        };
      });

      // 登録学生数を更新
  const statUsers = document.getElementById("stat-users");

  if (statUsers) {
  statUsers.textContent = snapshot.size;
}

// ポイント・プロフィールを最新状態に更新
  if (currentUser) {
  updateHeaderPoints();
  const profileView =
    document.getElementById("view-profile");
  if (profileView && profileView.classList.contains("active")) {
    renderProfile();
  }
}

      // 名前が変わったら画面も自動更新
      if (typeof renderMessages === "function") {
        renderMessages();
      }
      if (typeof renderSkillGrid === "function") {
        renderSkillGrid();
      }
    }, error => {
      console.error(
        "ユーザー情報の同期エラー:",
        error
      );
    });
}
function startStatsListener(){
  // 重複監視を防止
  if (statsMatchesUnsub) {
    statsMatchesUnsub();
    statsMatchesUnsub = null;
  }
  // マッチ成立数
  statsMatchesUnsub = fireDb
    .collection("conversations")
    .onSnapshot(snapshot => {
      const el = document.getElementById("stat-matches");
      if (el) {
        el.textContent = snapshot.size;
      }
    });
}

async function openDMWithUser(userId, skillName, matchInfo = null) {
  const convId = getConvId(currentUser.id, userId);
  await ensureConversationDoc(convId, currentUser.id, userId);

  const data = {};

  if (skillName) {
    data.skillLabel = skillName;
  }
  if (matchInfo) {
    data.skillId = matchInfo.skillId;
    data.skillLevel = matchInfo.skillLevel;
    data.teacherId = matchInfo.teacherId;
    data.learnerId = matchInfo.learnerId;
    // 新しいマッチなので精算状態をリセット
    data.pointsSettled = false;
    data.actualPoints = null;
    data.actualSeconds = null;
    data.settledAt = null;
    // マッチ成立を相手側の未読として1件追加
    data.unreadBy = {
        [currentUser.id]: 0,
        [userId]: 1
        };
}
  await fireDb
    .collection("conversations")
    .doc(convId)
    .set(data, { merge: true });

  activeConvId = convId;
}

function showMsgPage(page) {
  const listPage = document.getElementById("msg-page-list");
  const chatPage = document.getElementById("msg-page-chat");
  if(!listPage || !chatPage) return;
  if(page === "chat") {
    listPage.classList.add("hidden");
    chatPage.classList.remove("hidden");
  } else {
    chatPage.classList.add("hidden");
    listPage.classList.remove("hidden");
  }
}

function renderMessages() {
  const listEl = document.getElementById("conv-list-inner");

  if(!listEl) return;
  listEl.innerHTML = "";

  const blocked = (currentUser && currentUser.blockedUsers) || [];
  const visibleConversations = liveConversations.filter(c => !blocked.includes(c.peerId));

  if(!visibleConversations.length)
    listEl.innerHTML = `<div class="conv-empty-hint">まだ会話がありません<br>スキルをマッチして話しかけてみよう！</div>`;

    visibleConversations.forEach(conv => {
    const peer = getPublicUserById(conv.peerId);
    const item = document.createElement("div");
    item.className = "conv-item";
    item.setAttribute("role","button"); item.setAttribute("tabindex","0");
    item.dataset.convId = conv.id;
    const av = avatarParts(peer.id, "avatar avatar--sm");
    item.innerHTML = `
      <div class="${av.cls}" style="${av.style}">${av.inner}</div>
      <div class="conv-info">
        <div class="conv-name">${escapeHtml(peer.name)}</div>
        <div class="conv-preview">${conv.lastMessage ? escapeHtml(conv.lastMessage) : escapeHtml(conv.peerSkill)}</div>
      </div>
      
      ${
          conv.unreadCount > 0
    ? `<span class="conv-unread">${conv.unreadCount}</span>`
    : ""
    }

      <span class="conv-arrow">›</span>
    `;
    item.addEventListener("click", () => openConversation(conv.id));
    item.addEventListener("keydown", e => { if(e.key==="Enter"||e.key===" ") openConversation(conv.id); });
    listEl.appendChild(item);
  });
  if (!activeConvId) {
  showMsgPage("list");
}
}

async function markConversationRead(convId) {

  if (!currentUser) return;

  try {

    await fireDb
      .collection("conversations")
      .doc(convId)
      .update(
        new firebase.firestore.FieldPath(
          "unreadBy",
          currentUser.id
        ),
        0
      );

  } catch(error) {

    console.error(
      "未読解除エラー:",
      error
    );
  }
}

async function openConversation(convId, scroll=true) {
  activeConvId = convId;
  const conv = liveConversations.find(c => c.id === convId);

  if(!conv) return;

await markConversationRead(convId);

const peer = getPublicUserById(conv.peerId);

peer.id = conv.peerId;

  const avatarEl = document.getElementById("chat-avatar");
  const nameEl = document.getElementById("chat-peer-name");
  const skillEl = document.getElementById("chat-peer-skill");

  applyAvatar(avatarEl, peer.id, "avatar");
  if(nameEl) {
    nameEl.textContent = peer.name;
    }
  if(skillEl) {
    skillEl.textContent = conv.peerSkill;
    }
  if(convMsgUnsub) { 
    convMsgUnsub(); convMsgUnsub = null;
    }
  if (conv.messages) {
    renderChatMessages(conv, scroll);
    } 
  else if ( typeof listenToMessages === "function" ) 
  {
    convMsgUnsub =listenToMessages(convId, messages => {
        renderChatMessages({ messages }, scroll );
    });
  }

  showMsgPage("chat");
}

function renderChatMessages(conv, scroll=true) {
  const el = document.getElementById("chat-messages");
  if(!el) return;
  el.innerHTML = "";
  conv.messages.forEach(msg => {
    const isMine = msg.sender===currentUser.id ||
    msg.sender === "me";;
    const bubble = document.createElement("div");
    bubble.className = `msg-bubble ${isMine?"msg-bubble--mine":"msg-bubble--theirs"}`;
    const av = !isMine ? avatarParts(msg.sender, "avatar avatar--sm") : null;
    bubble.innerHTML = `
      ${av ? `<div class="${av.cls}" style="${av.style}">${av.inner}</div>` : ""}
      <div>
        <div class="msg-text">${buildMsgContent(msg)}</div>
        <div class="msg-time">${msg.time}</div>
      </div>
    `;
    el.appendChild(bubble);
    if(msg.imgSrc) {
      bubble.querySelector(".msg-img").addEventListener("click", () => openLightbox(msg.imgSrc));
    }
  });
  if(scroll) el.scrollTop = el.scrollHeight;
}

// ===== POST FORM =====
function initPostForm() {
  const lvl  = document.getElementById("post-level");
  const time = document.getElementById("post-time");
  function updateCoeff() {
    const l = lvl.value.replace(/（.*）/,"").trim();
    const t = parseInt(time.value,10);
    document.getElementById("coeff-value").textContent =
      (level_coefficients[l] && t) ? `${calcPoints(t,l)} Time` : "— Time";
  }
  lvl.addEventListener("change",  updateCoeff);
  time.addEventListener("change", updateCoeff);

  document.getElementById("post-form").addEventListener("submit", async e => {
    e.preventDefault();
    const err  = document.getElementById("post-error");
    const type = document.getElementById("post-type").value;
    const skill= document.getElementById("post-skill").value.trim();
    const cat  = document.getElementById("post-category").value;
    const rawL = document.getElementById("post-level").value;
    const level= rawL.replace(/（.*）/,"").trim();
    const time2= document.getElementById("post-time").value;
    const desc = document.getElementById("post-desc").value.trim();
    const want = document.getElementById("post-want").value.trim();

    if(!skill||!cat||!level||!desc) { err.textContent = "必須項目をすべて入力してください。"; return; }

    const pts = calcPoints(time2, level);

    if(editingSkillId) {
      const idx = APP.skills.findIndex(s => s.id === editingSkillId);
      if(idx !== -1) {
        const updatedFields = {
          type, skill, category:cat, level, time:parseInt(time2,10), desc, want,
          edited:true
        };

        try {
            await updateSkillWithReservationInFirestore(
                editingSkillId,
                currentUser.id,
                updatedFields,
                pts);
            APP.skills[idx] = {
                ...APP.skills[idx],
                ...updatedFields,
                reservedPoints: type === "seek" ? pts:  0,
                reservedUserId: type === "seek" ? currentUser.id : null,
                reservationStatus: type === "seek" ? "reserved" : "none",
                
                pointsSettled: false
                };
            } catch(error) {
                console.error("投稿の更新に失敗:",error);
                if (error.code === "POINT_LIMIT") {
                    err.textContent ="この内容に変更すると前借り上限（-100 Time）を超えます。";
                     } 
                else if (error.code === "MATCHED_SKILL") {
                         err.textContent ="マッチ済みの投稿は変更できません。";
                    } 
                else {
                     err.textContent ="投稿の更新に失敗しました。";
                    }
            return;
            }

        showBanner("投稿を更新しました！✏️");
      }
      editingSkillId = null;
      document.querySelector('#post-form button[type="submit"]').textContent = "投稿する 🌻";
      err.textContent = "";
      document.getElementById("post-form").reset();
      document.getElementById("coeff-value").textContent = "— Time";
      updateHeaderPoints();
      document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
      document.querySelector(".nav-btn[data-view='profile']").classList.add("active");
      showView("profile");
      return;
    }

    const ns = { 
        id:generateId("s"), 
        userId:currentUser.id, 
        userName: currentUser.name,
        userSchool: currentUser.school,
        userAvatarColor: currentUser.avatarColor || "av-orange",
        type, 
        skill, 
        category:cat, level, 
        time:parseInt(time2,10), 
        desc, 
        want, 
        reviews:[], 
        status:"open", 
        edited:false,
        
        reservedPoints: type === "seek" ? pts: 0,
        reservedUserId: type === "seek" ? currentUser.id : null,
        reservationStatus: type === "seek" ? "reserved" : "none",
        
        pointsSettled:false
    };
    
    try {
        await createSkillWithReservationInFirestore(
            ns,  type === "seek" ? pts : 0);
        APP.skills.unshift(ns);
        } 
        catch(error) {
            console.error("スキル投稿の保存に失敗:", error);
            
        if (error.code === "POINT_LIMIT") {
            err.textContent = "この投稿をすると前借り上限（-100 Time）を超えるため投稿できません。";
        } 
        else {
            err.textContent = "投稿の保存に失敗しました。";
            }
            return;
            }

    err.textContent = "";
    document.getElementById("post-form").reset();
    document.getElementById("coeff-value").textContent = "— Time";
    showBanner("スキルを投稿しました！🌻");
    updateHeaderPoints();
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    document.querySelector(".nav-btn[data-view='home']").classList.add("active");
    showView("home");
  });
}

// ===== PROFILE =====
function renderProfile() {
  if(!currentUser) return;
  const user = getPublicUserById(currentUser.id) || currentUser;
  const mySkills = APP.skills.filter(s => s.userId === currentUser.id);
  const activeSkills =
  APP.skills.filter(s => {
    const isParticipant =
      s.teacherId === currentUser.id ||
      s.learnerId === currentUser.id;
    if (!isParticipant) return false;
    // マッチ中は双方に表示
    if (s.status === "matched") {
      return true;
    }
    // 完了後は、教わった側にレビューするまで表示
    if (
      s.status === "done" &&
      s.learnerId === currentUser.id
    ) {
      const alreadyReviewed =
        (s.reviews || []).some(
          r => r.userId === currentUser.id
        );

      return !alreadyReviewed;
    }
    return false;
  });

  const allRevs  = mySkills.flatMap(s => s.reviews);
  const setEl = (id, fn) => { const el = document.
  getElementById(id); if(el) fn(el); };
  
  setEl("profile-avatar", el => {
  applyAvatar(
    el, user.id, "profile-avatar"
  );
});
  setEl("profile-name",    el => el.textContent = user.name);
  setEl("profile-school",  el => el.textContent = user.school);
  setEl("profile-verified-badge", el => el.classList.toggle("hidden", !user.verified));
  setEl("profile-realname-row", el => el.classList.toggle("hidden", !user.realName));
  setEl("profile-realname", el => el.textContent = user.realName || "");
  setEl("pstat-skills",    el => el.textContent = mySkills.length);
  setEl("pstat-matches",   el => el.textContent = user.matches||0);
  setEl("pstat-points",    el => el.textContent = user.totalPoints||0);

  const avg = allRevs.length
    ? (allRevs.reduce((s,r)=>s+r.stars,0)/allRevs.length).toFixed(1) : null;
  setEl("profile-stars",      el => el.textContent = avg ? renderStars(parseFloat(avg)) : "☆☆☆☆☆");
  setEl("profile-rating-val", el => el.textContent = avg ? `${avg} (${allRevs.length}件)` : "まだレビューなし");

  setEl("my-skills-list", sl => {
    sl.innerHTML = "";
    if(!mySkills.length) {
      sl.innerHTML=`<p style="font-size:.82rem;color:var(--text-soft)">まだスキルを投稿していません</p>`;
    } else {
      mySkills.forEach(s => {
        const isDone = s.status === "done";
        const item = document.createElement("div"); item.className="my-skill-item";
        item.innerHTML=`
          <div>
            <div class="my-skill-name">
              ${escapeHtml(s.skill)}
              ${isDone ? '<span class="card-user-tag">完了</span>' : ''}
              ${s.edited ? '<span class="card-user-tag">編集済み</span>' : ''}
            </div>
            <div class="my-skill-meta">${s.category} / ${s.level} / ${s.time}分</div>
            <div style="margin-top:6px;display:flex;gap:6px">
              <button class="btn btn--outline btn--sm my-skill-edit" data-id="${s.id}">編集</button>
              <button class="btn btn--outline btn--sm my-skill-delete" data-id="${s.id}">削除</button>
            </div>
          </div>  

          <span style="font-size:.8rem;font-weight:700;color:var(--orange)">☀ ${calcPoints(s.time,s.level)} Time</span>
        `;
        sl.appendChild(item);
      });

      sl.querySelectorAll(".my-skill-edit").forEach(btn => {
        btn.addEventListener("click", () => startEditSkill(btn.dataset.id));
      });
      sl.querySelectorAll(".my-skill-delete").forEach(btn => {
        btn.addEventListener("click", () => deleteSkill(btn.dataset.id));
      });
    }
  }); 

  setEl("active-skills-list", list => {
  list.innerHTML = "";

  if (!activeSkills.length) {
    list.innerHTML = `
      <p style="font-size:.82rem;color:var(--text-soft)">
        現在進行中のスキル交換はありません
      </p>
    `;
    return;
  }

  activeSkills.forEach(s => {

    const isTeacher = s.teacherId === currentUser.id;
    const partnerId = isTeacher ? s.learnerId : s.teacherId;
    const isLearner = s.learnerId === currentUser.id;const isDone = s.status === "done";
    const partner = getPublicUserById(partnerId);
    const roleText = isTeacher ? "教える側" : "教わる側";
    const item = document.createElement("div");

    item.className = "my-skill-item";

    item.innerHTML = `
      <div>
        <div class="my-skill-name">
          ${escapeHtml(s.skill)}
          <span class="card-user-tag">
            ${roleText}
          </span>
        </div>

        <div class="my-skill-meta">
          相手：${escapeHtml(partner.name)}
        </div>

        <div class="my-skill-meta">
          ${escapeHtml(s.category)}
          /
          ${escapeHtml(s.level)}
          /
          ${s.time}分
        </div>
      </div>

      <span
        style="
          font-size:.8rem;
          font-weight:700;
          color:var(--orange)
        "
      >
        ☀ ${calcPoints(s.time, s.level)} Time
      </span>
      ${
          isLearner && !isDone
      ? `
      <button
        class="btn btn--outline btn--sm exchange-complete-btn"
        data-id="${s.id}"
      >
        完了
      </button>
    `
    : ""
}

${
  isLearner && isDone
    ? `
      <button
        class="btn btn--primary btn--sm exchange-review-btn"
        data-id="${s.id}"
      >
        ⭐ 評価する
      </button>
    `
    : ""
}
    `;

    list.appendChild(item);

    list.querySelectorAll(
  ".exchange-complete-btn"
).forEach(btn => {

  btn.addEventListener(
    "click",
    async () => {

      const skillId =
        btn.dataset.id;

      const skill =
        APP.skills.find(
          s => s.id === skillId
        );

      if (!skill) return;
      if (
        skill.learnerId !==
        currentUser.id
      ) {
        return;
      }

      try {

        await updateSkillInFirestore(
          skillId,
          {
            status: "done",
            completedAt:
              firebase.firestore
                .FieldValue
                .serverTimestamp()
          }
        );

        skill.status = "done";

        renderProfile();

        showBanner(
          "学習を完了しました！🌻"
        );

      } catch(error) {

        console.error(
          "完了処理エラー:",
          error
        );

        showBanner(
          "完了処理に失敗しました。"
        );
      }
    }
  );
});


list.querySelectorAll(
  ".exchange-review-btn"
).forEach(btn => {
  btn.addEventListener(
    "click",() => {
      openSkillModal(btn.dataset.id,
      true);
    }
  );
});
  });
});

  setEl("reviews-list", rl => {
    rl.innerHTML = "";
    if(!allRevs.length) {
      rl.innerHTML=`<p style="font-size:.82rem;color:var(--text-soft)">まだレビューがありません</p>`;
    } else {
      allRevs.forEach(r => {
        const item = document.createElement("div"); item.className="review-item";
        item.innerHTML=`
          <div class="review-item__header">
            <span class="review-item__name">${escapeHtml(r.name)}</span>
            <span class="review-item__stars">${renderStars(r.stars)} ${r.stars}</span>
          </div>
          <p class="review-item__text">${escapeHtml(r.text)}</p>
        `;
        rl.appendChild(item);
      });
    }
  });
}
function startEditSkill(skillId) {
  const skill = APP.skills.find(s => s.id === skillId);
  if(!skill) return;

  editingSkillId = skillId;

  document.getElementById("post-type").value  = skill.type;
  document.getElementById("post-skill").value = skill.skill;
  document.getElementById("post-category").value = skill.category;
  document.getElementById("post-level").value = skill.level + (
    { "初級":"（係数 ×1.0）","中級":"（係数 ×1.5）","上級":"（係数 ×2.0）","専門家":"（係数 ×3.0）" }[skill.level] || ""
  );
  document.getElementById("post-time").value  = String(skill.time);
  document.getElementById("post-desc").value  = skill.desc;
  document.getElementById("post-want").value  = skill.want || "";

document.querySelector('#post-form button[type="submit"]').textContent = "更新する ✏️";

  showView("post");
}

async function deleteSkill(skillId) {
  if (
    !confirm(
      "この投稿を削除しますか？この操作は取り消せません。"
    )
  ) {
    return;
  }

  try {
    const result =
      await deleteSkillWithRefundInFirestore(
        skillId, currentUser.id
      );

    APP.skills =
      APP.skills.filter(s => s.id !== skillId);

    if (result.refundedPoints > 0) {
      showBanner(
        `投稿を削除しました。予約していた ${result.refundedPoints} Timeを返却しました。`
      );
    } else {
      showBanner("投稿を削除しました🗑️");
    }

    updateHeaderPoints();
    renderProfile();

  } catch(error) {
    console.error(
      "投稿削除エラー:",
      error
    );

    if (
      error.code === "MATCHED_DELETE"
    ) {
      showBanner("マッチ済みの投稿は削除できません。");
    }
    else if (
      error.code === "NO_PERMISSION"
    ) {
      showBanner("この投稿は削除できません。");
    }
    else {
      showBanner("投稿の削除に失敗しました。通信環境をご確認ください。");
    }
  }
}

function buildMsgContent(msg) {
  if(msg.imgSrc) {
    return `<img class="msg-img" src="${msg.imgSrc}" alt="${escapeHtml(msg.fileName || "画像")}" />`;
  }
  if(msg.fileUrl) {
    return `<a class="msg-file" href="${msg.fileUrl}" download="${escapeHtml(msg.fileName || "")}">
      <span class="msg-file__icon">📄</span>
      <span class="msg-file__name">${escapeHtml(msg.fileName || "ファイル")}</span>
    </a>`;
  }
  return `<div class="msg-text">${escapeHtml(msg.text)}</div>`;
}
function openLightbox(src) {
  const lb = document.createElement("div");
  lb.className = "lightbox";
  lb.innerHTML = `<img src="${src}" />`;
  lb.addEventListener("click", () => lb.remove());
  document.body.appendChild(lb);
}


// ===== ALL DOM EVENT LISTENERS — bound once DOM is confirmed ready =====
function initListeners() {
  // Notification close
  const notifClose = document.getElementById("notif-close-btn");
  if(notifClose) notifClose.addEventListener("click", () =>
    document.getElementById("notification-banner").classList.add("hidden"));

  // Search
  const searchInput = document.getElementById("search-input");
  if(searchInput) searchInput.addEventListener("input", renderSkillGrid);

  // Skill modal close
  const modalCloseBtn = document.getElementById("modal-close-btn");
  if(modalCloseBtn) modalCloseBtn.addEventListener("click", () => {
    document.getElementById("skill-modal").classList.add("hidden");
    currentModalSkillId = null;
  });
  const skillModal = document.getElementById("skill-modal");
  if(skillModal) skillModal.addEventListener("click", e => {
    if(e.target === skillModal) { skillModal.classList.add("hidden"); currentModalSkillId = null; }
  });

  const modalReportBtn = document.getElementById("modal-report-btn");
  if(modalReportBtn) modalReportBtn.addEventListener("click", () => {
    if(!currentModalSkillId) return;
    const skill = APP.skills.find(s => s.id === currentModalSkillId);
    if(!skill) return;
    currentReportTarget = { reportedUserId: skill.userId, skillId: skill.id };
    document.getElementById("report-error").textContent = "";
    document.getElementById("report-form").reset();
    document.getElementById("report-modal").classList.remove("hidden");
  });
  const reportModalClose = document.getElementById("report-modal-close");
  if(reportModalClose) reportModalClose.addEventListener("click", () =>
    document.getElementById("report-modal").classList.add("hidden"));

  const reportForm = document.getElementById("report-form");
  if(reportForm) reportForm.addEventListener("submit", e => {
    e.preventDefault();
    if(!currentReportTarget) return;

    const newReport = {
      id: generateId("r"),
      skillId: currentReportTarget.skillId || null,
      reportedUserId: currentReportTarget.reportedUserId,
      reporterId: currentUser.id,
      reason: document.getElementById("report-reason").value,
      detail: document.getElementById("report-detail").value.trim(),
      createdAt: Date.now(),
      status: "pending"
    };
    APP.reports.push(newReport);
    saveReports(APP.reports);
    submitReportToFirestore(newReport).catch(e => console.error("通報の保存に失敗:", e));

    document.getElementById("report-modal").classList.add("hidden");
    currentReportTarget = null;
    showBanner("通報を受け付けました。運営が確認します🙏");
  });

  const modalBlockBtn = document.getElementById("modal-block-btn");
  if(modalBlockBtn) modalBlockBtn.addEventListener("click", () => {
    if(!currentModalSkillId) return;
    const skill = APP.skills.find(s => s.id === currentModalSkillId);
    if(!skill || skill.userId === currentUser.id) return;

    const uIdx = APP.users.findIndex(u => u.id === currentUser.id);
    if(uIdx === -1) return;

    if(!APP.users[uIdx].blockedUsers) APP.users[uIdx].blockedUsers = [];
    if(!APP.users[uIdx].blockedUsers.includes(skill.userId)) {
      APP.users[uIdx].blockedUsers.push(skill.userId);
      saveUsers(APP.users);
      currentUser = APP.users[uIdx];
      addBlockedUser(currentUser.id, skill.userId).catch(e => console.error("ブロックの保存に失敗:", e));
    }

    document.getElementById("skill-modal").classList.add("hidden");
    currentModalSkillId = null;
    renderSkillGrid();
    showBanner("このユーザーをブロックしました🚫");
  });
  
  // Stars
  document.querySelectorAll(".star-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedStars = parseInt(btn.dataset.star,10);
      document.querySelectorAll(".star-btn").forEach(b =>
        b.classList.toggle("active", parseInt(b.dataset.star,10) <= selectedStars));
    });
  });

  // Review form
  const reviewForm = document.getElementById("review-form");
  if(reviewForm) reviewForm.addEventListener("submit", e => {
    e.preventDefault();
    const err  = document.getElementById("review-error");
    const text = document.getElementById("review-text").value.trim();

    if(!selectedStars) { err.textContent = "評価（星）を選択してください。"; return; }
    if(!text) { err.textContent = "レビュー本文を入力してください。"; return; }
    if(!currentModalSkillId) return;

    const idx = APP.skills.findIndex(s => s.id === currentModalSkillId);

    if(idx === -1) return;
    const reviewSkill = APP.skills[idx];
    const isParticipant =
    reviewSkill.teacherId === currentUser.id ||
    reviewSkill.learnerId === currentUser.id;
    
    if (
        reviewSkill.status !== "done" || !isParticipant
        ) {
            err.textContent =
            "学習が完了した相手にのみレビューできます。";
            return;
            }
    if(APP.skills[idx].reviews.some(r => r.userId === currentUser.id)) { 
        err.textContent = "すでにレビュー済みです。"; 
        return; 
        }
    const newReview = { userId:currentUser.id, name:currentUser.name, stars:selectedStars, text };
    APP.skills[idx].reviews.push(newReview);
    addSkillReviewInFirestore(currentModalSkillId, newReview).catch(e2 => {
      console.error("レビューの保存に失敗:", e2);
      showBanner("レビューの保存に失敗しました。通信環境をご確認ください。");
    });
    APP.notifications.unshift({
        id: generateId("n"),
        userId: APP.skills[idx].userId,
        fromUserId: currentUser.id,
        type: "review",
        stars: selectedStars,
        title: "新しいレビューが届きました ⭐",
        time: "たった今",
        read: false
        });
    saveNotifs(APP.notifications);
    err.textContent = "";
    document.getElementById("review-text").value = "";
    selectedStars = 0;
    document.querySelectorAll(".star-btn").forEach(b => b.classList.remove("active"));
    renderModalReviews(APP.skills[idx]);
    showBanner("レビューを投稿しました！⭐");
    refreshBadges();
  });

  // Modal match button
  const modalMatchBtn = document.getElementById("modal-match-btn");
  if(modalMatchBtn) modalMatchBtn.addEventListener("click", () => {
    if(!currentModalSkillId) return;
    const skill = APP.skills.find(s => s.id === currentModalSkillId);
    const user  = skill ? getPublicUserById(skill.userId) : null;
    if(!skill || !user) return;
    document.getElementById("skill-modal").classList.add("hidden");
    triggerMatch(skill, user);
  });

  // Modal DM button
  const modalDmBtn = document.getElementById("modal-dm-btn");
  if(modalDmBtn) modalDmBtn.addEventListener("click", async () => {
    if(!currentModalSkillId) return;
    const skill = APP.skills.find(s => s.id === currentModalSkillId);
    if(!skill) return;
    document.getElementById("skill-modal").classList.add("hidden");
    await openDMWithUser(skill.userId, skill.skill);
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    const msgBtn = document.querySelector(".nav-btn[data-view='messages']");
    if(msgBtn) msgBtn.classList.add("active");
    showView("messages");
  });

  // Match modal buttons
  const matchGoDm = document.getElementById("match-go-dm");
  if(matchGoDm) matchGoDm.addEventListener("click", () => {
    document.getElementById("match-modal").classList.add("hidden");
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    const msgBtn = document.querySelector(".nav-btn[data-view='messages']");
    if(msgBtn) msgBtn.classList.add("active");
    showView("messages");
  });
  const matchClose = document.getElementById("match-close");
  if(matchClose) matchClose.addEventListener("click", () =>
    document.getElementById("match-modal").classList.add("hidden"));
  const matchModal = document.getElementById("match-modal");
  if(matchModal) matchModal.addEventListener("click", e => {
    if(e.target === matchModal) matchModal.classList.add("hidden");
  });

  // Chat back button
  const chatBackBtn = document.getElementById("chat-back-btn");
  if(chatBackBtn) chatBackBtn.addEventListener("click", () => {
    if(convMsgUnsub) { convMsgUnsub(); convMsgUnsub = null; }
    activeConvId = null;
    showMsgPage("list");
  });

  // ── チャット相手への操作（ブロック・通報）メニュー ──
  const chatMenuBtn = document.getElementById("chat-menu-btn");
  const chatMenuDropdown = document.getElementById("chat-menu-dropdown");
  if(chatMenuBtn && chatMenuDropdown) {
    chatMenuBtn.addEventListener("click", e => {
      e.stopPropagation();
      chatMenuDropdown.classList.toggle("hidden");
    });
    document.addEventListener("click", () => chatMenuDropdown.classList.add("hidden"));
    chatMenuDropdown.addEventListener("click", e => e.stopPropagation());
  }

  const chatMenuReport = document.getElementById("chat-menu-report");
  if(chatMenuReport) chatMenuReport.addEventListener("click", () => {
    if(chatMenuDropdown) chatMenuDropdown.classList.add("hidden");
    const conv = liveConversations.find(c => c.id === activeConvId);
    if(!conv) return;
    currentReportTarget = { reportedUserId: conv.peerId, skillId: null };
    document.getElementById("report-error").textContent = "";
    document.getElementById("report-form").reset();
    document.getElementById("report-modal").classList.remove("hidden");
  });

  const chatMenuBlock = document.getElementById("chat-menu-block");
  if(chatMenuBlock) chatMenuBlock.addEventListener("click", () => {
    if(chatMenuDropdown) chatMenuDropdown.classList.add("hidden");
    const conv = liveConversations.find(c => c.id === activeConvId);
    if(!conv || !currentUser) return;
    if(!confirm("このユーザーをブロックしますか？ブロックすると、相手の投稿が表示されなくなり、この会話も一覧から見えなくなります。")) return;

    const uIdx = APP.users.findIndex(u => u.id === currentUser.id);
    if(uIdx === -1) return;
    if(!APP.users[uIdx].blockedUsers) APP.users[uIdx].blockedUsers = [];
    if(!APP.users[uIdx].blockedUsers.includes(conv.peerId)) {
      APP.users[uIdx].blockedUsers.push(conv.peerId);
      saveUsers(APP.users);
      currentUser = APP.users[uIdx];
      addBlockedUser(currentUser.id, conv.peerId).catch(e => console.error("ブロックの保存に失敗:", e));
    }

    if(convMsgUnsub) { convMsgUnsub(); convMsgUnsub = null; }
    activeConvId = null;
    showMsgPage("list");
    renderMessages();
    renderSkillGrid();
    showBanner("このユーザーをブロックしました🚫");
  });

  // ── File attachment state ──
  var pendingAttachment = null; // { imgSrc, fileUrl, fileName, isImage }

  function clearAttachment() {
    pendingAttachment = null;
    const wrap = document.getElementById("img-preview-wrap");
    const fileInput = document.getElementById("file-input");
    if(wrap) wrap.classList.add("hidden");
    if(fileInput) fileInput.value = "";
  }

  const attachBtn = document.getElementById("attach-btn");
  const fileInput = document.getElementById("file-input");
  if(attachBtn && fileInput) {
    attachBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const file = fileInput.files[0];
      if(!file) return;
      if(file.size > MAX_ATTACHMENT_SIZE) {
        showBanner("ファイルサイズは500KB以下にしてください。");
        fileInput.value = "";
        return;
      }
      const isImage = file.type.startsWith("image/");
      const url = URL.createObjectURL(file);
      if(isImage) {
        const wrap    = document.getElementById("img-preview-wrap");
        const preview = document.getElementById("img-preview");
        if(preview) preview.src = url;
        if(wrap) wrap.classList.remove("hidden");
      }
      pendingAttachment = { file, imgSrc: isImage ? url : null, fileUrl: isImage ? null : url, fileName: file.name, isImage };
    });
  }

  const imgCancelBtn = document.getElementById("img-preview-cancel");
  if(imgCancelBtn) imgCancelBtn.addEventListener("click", clearAttachment);


  // Chat input form — defined inline to avoid any hoisting dependency
  async function doSend() {
    const input = document.getElementById("chat-input");
    if(!input) return;
    const text = input.value.trim();
    if(!text && !pendingAttachment) return;
    if(!activeConvId) return;

    const file = pendingAttachment ? pendingAttachment.file : null;
    input.value = "";
    clearAttachment();
    input.focus();

    try {
      await sendChatMessage(activeConvId, currentUser.id, { text, file });
    } catch(e) {
      console.error("メッセージ送信エラー:", e);
      showBanner(e && e.message ? e.message : "送信に失敗しました。通信環境をご確認ください。");
    }
  }
  const chatForm = document.getElementById("chat-input-form");
  if(chatForm) chatForm.addEventListener("submit", e => { e.preventDefault(); doSend(); });

  const chatInput = document.getElementById("chat-input");if (chatInput) {
  chatInput.addEventListener("keydown", e => {
    if (e.isComposing || e.keyCode === 229) {
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  });
}

  // ── Call feature（WebRTC + Firestoreシグナリング） ──
  var callTimerInterval = null;
  var callSeconds = 0;
  var callEnding = false;

  function setCallOverlayForType(type) {
    const overlay = document.getElementById("call-overlay");
    const remoteVideo = document.getElementById("call-remote-video");
    const localVideo  = document.getElementById("call-local-video");
    if(!overlay) return;
    overlay.classList.toggle("call-overlay--video", type === "video");
    if(remoteVideo) remoteVideo.classList.toggle("hidden", type !== "video");
    if(localVideo)  localVideo.classList.toggle("hidden", type !== "video");
  }

  function attachLocalStream(stream, type) {
    const localVideo = document.getElementById("call-local-video");
    if(type === "video" && localVideo) localVideo.srcObject = stream;
  }

  function attachRemoteStream(stream, type) {
    const remoteVideo = document.getElementById("call-remote-video");
    const remoteAudio = document.getElementById("call-remote-audio");
    if(type === "video" && remoteVideo) remoteVideo.srcObject = stream;
    else if(remoteAudio) remoteAudio.srcObject = stream;
  }

  function startCallTimer() {
    if (callTimerInterval) return;
    callSeconds = 0;
    const timerEl = document.getElementById("call-timer");
    const statusEl = document.getElementById("call-status");
    if(statusEl) statusEl.textContent = "通話中";
    callTimerInterval = setInterval(() => {
      callSeconds++;
      const m = String(Math.floor(callSeconds/60)).padStart(2,"0");
      const s = String(callSeconds%60).padStart(2,"0");
      if(timerEl) timerEl.textContent = `${m}:${s}`;
    }, 1000);
  }

  // 発信する
  async function doStartCall(type) {
    if(!activeConvId) return;
    const conv = liveConversations.find(c => c.id === activeConvId);
    if(!conv) return;
    let peer = getUserById(conv.peerId);
    if(!peer) {
        peer = {
            id: conv.peerId,
            name: "ユーザー",
            school: "",
            avatarColor: "av-orange"
            };
}

    const overlay  = document.getElementById("call-overlay");
    const avatarEl = document.getElementById("call-avatar");
    const nameEl   = document.getElementById("call-name");
    const statusEl = document.getElementById("call-status");
    const timerEl  = document.getElementById("call-timer");
    applyAvatar(avatarEl, peer.id, "call-avatar");
    if(nameEl)   nameEl.textContent   = peer.name;
    if(statusEl) statusEl.textContent = "発信中…";
    if(timerEl)  timerEl.textContent  = "00:00";
    setCallOverlayForType(type);
    if(overlay)  overlay.classList.remove("hidden");

    try {
      const stream = await startOutgoingCall(activeConvId, currentUser.id, conv.peerId, type, (remoteStream) => {
        attachRemoteStream(remoteStream, type);
        startCallTimer();
      }, () => doEndCall());
      attachLocalStream(stream, type);
    } catch(e) {
      console.error("発信に失敗しました:", e);
      showBanner("マイク／カメラを使用できませんでした。権限をご確認ください。");
      doEndCall();
    }
  }

  // 着信に応答する
  async function doAcceptCall(convId, callerId, type) {
    closeModal("incoming-call-modal");
    let peer = getUserById(callerId);
    if(!peer) peer = { id: callerId, name: "ユーザー", school: "", avatarColor: "av-orange" };

    const overlay  = document.getElementById("call-overlay");
    const avatarEl = document.getElementById("call-avatar");
    const nameEl   = document.getElementById("call-name");
    const statusEl = document.getElementById("call-status");
    const timerEl  = document.getElementById("call-timer");
    applyAvatar(avatarEl, peer.id, "call-avatar");
    if(nameEl)   nameEl.textContent   = peer.name;
    if(statusEl) statusEl.textContent = "接続中…";
    if(timerEl)  timerEl.textContent  = "00:00";
    setCallOverlayForType(type);
    activeConvId = convId;
    if(overlay)  overlay.classList.remove("hidden");

    try {
      const stream = await acceptIncomingCall(convId, type, (remoteStream) => {
        attachRemoteStream(remoteStream, type);
        startCallTimer();
      }, () => doEndCall());
      attachLocalStream(stream, type);
    } catch(e) {
      console.error("応答に失敗しました:", e);
      showBanner("マイク／カメラを使用できませんでした。権限をご確認ください。");
      doEndCall();
    }
  }

  async function doEndCall() {
      if(callEnding) return;
      callEnding = true;
      const actualSeconds = callSeconds;
      const settlementConvId = activeConvId;

      clearInterval(callTimerInterval);
      callTimerInterval = null;
      callSeconds = 0;
      
      await endCall();

      // 実通話時間によるTime精算は、settleCallPoints実装後に自動実行する。
      // 未実装の状態でも通話終了処理が止まらないようにガードする。
      if (
          actualSeconds > 0 && settlementConvId &&
          typeof settleCallPoints === "function"
          ) {
        await settleCallPoints(
            settlementConvId,
            actualSeconds);
            }

    const overlay = document.getElementById("call-overlay");

    if(overlay) { overlay.classList.add("hidden"); overlay.classList.remove("call-overlay--video"); }

    const remoteVideo = document.getElementById("call-remote-video");
    const localVideo  = document.getElementById("call-local-video");

    if(remoteVideo) remoteVideo.srcObject = null;
    if(localVideo)  localVideo.srcObject  = null;

    const muteBtn = document.getElementById("btn-call-mute");
    
    if(muteBtn) { muteBtn.textContent = "🎤"; muteBtn.classList.remove("call-action-btn--muted"); }
    callEnding = false;
  }

  const btnVoiceCall2 = document.getElementById("btn-voice-call");
  if(btnVoiceCall2) btnVoiceCall2.addEventListener("click", () => doStartCall("audio"));
  const btnVideoCall2 = document.getElementById("btn-video-call");
  if(btnVideoCall2) btnVideoCall2.addEventListener("click", () => doStartCall("video"));
  const btnCallEnd2 = document.getElementById("btn-call-end");
  if(btnCallEnd2) btnCallEnd2.addEventListener("click", () => doEndCall());
  const btnCallMute2 = document.getElementById("btn-call-mute");
  if(btnCallMute2) btnCallMute2.addEventListener("click", () => {
    const muted = toggleMute();
    btnCallMute2.classList.toggle("call-action-btn--muted", muted);
    btnCallMute2.textContent = muted ? "🔇" : "🎤";
  });

  // ── 着信モーダルのボタン ──
  const incomingAcceptBtn  = document.getElementById("incoming-call-accept");
  const incomingDeclineBtn = document.getElementById("incoming-call-decline");
  if(incomingAcceptBtn) incomingAcceptBtn.addEventListener("click", () => {
    const pending = window._pendingIncomingCall;
    if(pending) doAcceptCall(pending.convId, pending.callerId, pending.type);
  });
  if(incomingDeclineBtn) incomingDeclineBtn.addEventListener("click", () => {
    const pending = window._pendingIncomingCall;
    if(pending) declineIncomingCall(pending.convId);
    closeModal("incoming-call-modal");
    window._pendingIncomingCall = null;
  });
}

// アプリ起動中ずっと着信を監視する（どの画面にいても着信モーダルを出せるように）
let incomingCallUnsub = null;
function startIncomingCallListener() {
  if(incomingCallUnsub) { 
      incomingCallUnsub(); 
      incomingCallUnsub = null; 
      }
  if(!currentUser) return;

  incomingCallUnsub = listenForIncomingCalls(currentUser.id, async ({ convId, callerId, type }) => {
    if(!getUserById(callerId)) {
      try {
        const profile = await fetchPublicProfile(callerId);
        upsertLocalUserProfile(callerId, profile);
      } catch(e) { console.error("発信者情報の取得エラー:", e); }
    }
    let caller = getUserById(callerId);
    if(!caller) caller = { id: callerId, name: "ユーザー", school: "", avatarColor: "av-orange" };
    window._pendingIncomingCall = { convId, callerId, type };
    const avatarEl = document.getElementById("incoming-call-avatar");
    const nameEl   = document.getElementById("incoming-call-name");
    const typeEl   = document.getElementById("incoming-call-type");
    applyAvatar(avatarEl, caller.id, "call-avatar");
    if(nameEl) nameEl.textContent = caller.name;
    if(typeEl) typeEl.textContent = type === "video" ? "📹 ビデオ通話" : "📞 音声通話";
    openModal("incoming-call-modal");
  });
}

// ===== ユーザーのクラウド状態を初期化 =====
async function ensureUserCloudState(user) {

  const ref = fireDb.collection("users").doc(user.id);

  await fireDb.runTransaction(async transaction => {
    const snap = await transaction.get(ref);

    // 初回だけローカルのポイントを初期値として使う
    if (!snap.exists) {

      transaction.set(ref, {
        name: user.name || "ユーザー",
        avatarColor:
          user.avatarColor || "av-orange",
        avatarUrl:
          user.avatarUrl || null,

        totalPoints:
          Number(user.totalPoints || 0),

        matches:
          Number(user.matches || 0)
      });

      return;
    }

    const data = snap.data();
    const update = {
      name: user.name || "ユーザー",
      avatarColor:
        user.avatarColor || "av-orange",
      avatarUrl:
        user.avatarUrl || null
    };

    // 既存ユーザーにまだポイント字段が無い時だけ作る
    if (data.totalPoints === undefined) {
      update.totalPoints =
        Number(user.totalPoints || 0);
    }

    if (data.matches === undefined) {
      update.matches =
        Number(user.matches || 0);
    }

    transaction.set(
      ref,
      update,
      { merge: true }
    );

  });
}

// ===== SETTINGS HELPERS =====
function openModal(id)  { const m = document.getElementById(id); if(m) m.classList.remove("hidden"); }
function closeModal(id) { const m = document.getElementById(id); if(m) m.classList.add("hidden"); }

function bindModalClose(modalId, closeBtnId) {
  const btn = document.getElementById(closeBtnId);
  const overlay = document.getElementById(modalId);
  if(btn)     btn.addEventListener("click", () => closeModal(modalId));
  if(overlay) overlay.addEventListener("click", e => { if(e.target === overlay) closeModal(modalId); });
}

function initSettingsListeners() {
// ── アイコン設定 ──
const avatarEditBtn = document.getElementById("avatar-edit-btn");
const avatarFileInput = document.getElementById("avatar-file-input");
if (avatarEditBtn && avatarFileInput) {
  avatarEditBtn.addEventListener("click", () => {
    avatarFileInput.click();
  });

  avatarFileInput.addEventListener(
    "change",
    async () => {
      const file = avatarFileInput.files?.[0];

      if (!file || !currentUser) return;
      if (!file.type.startsWith("image/")) {
        showBanner("画像ファイルを選択してください。");
        return;
      }

      try {
        const avatarUrl = await uploadAvatarPhoto(
            currentUser.id,
            file
          );


        const idx = APP.users.findIndex(
            u => u.id === currentUser.id
          );

        if (idx !== -1) {
          APP.users[idx].avatarUrl =
            avatarUrl;
          currentUser = APP.users[idx];
          saveUsers(APP.users);
        }

        await savePublicProfile(
          currentUser.id,
          {
            avatarUrl: avatarUrl
          }
        );
        publicUsers[currentUser.id] = {
            ...(publicUsers[currentUser.id] || {}),
            id: currentUser.id,
            name: currentUser.name,
            avatarColor:
            currentUser.avatarColor || "av-orange",
            avatarUrl: avatarUrl
            };
            
            renderProfile();
            renderSkillGrid();
            renderMessages();

        showBanner(
          "アイコンを変更しました！📷"
        );
      } catch(error) {
        console.error(
          "アイコン変更エラー:", error
        );
        showBanner(
          error.message ||" アイコンの変更に失敗しました。"
        );
      }
      avatarFileInput.value = "";
    }
  );
}

  const btnEditName = document.getElementById("btn-edit-name");
  if(btnEditName) btnEditName.addEventListener("click", () => {
    const input = document.getElementById("edit-name-input");
    if(input) input.value = currentUser ? currentUser.name : "";
    document.getElementById("edit-name-error").textContent = "";
    openModal("edit-name-modal");
    setTimeout(() => { if(input) input.focus(); }, 80);
  });
  bindModalClose("edit-name-modal", "edit-name-close");
  const editNameCancel = document.getElementById("edit-name-cancel");
  if(editNameCancel) editNameCancel.addEventListener("click", () => closeModal("edit-name-modal"));

  const editNameForm = document.getElementById("edit-name-form");
  if(editNameForm) editNameForm.addEventListener("submit", e => {
    e.preventDefault();
    const input = document.getElementById("edit-name-input");
    const err   = document.getElementById("edit-name-error");
    const newName = input.value.trim();
    if(!newName) { err.textContent = "ニックネームを入れてください。"; return; }
    if(newName.length > 20) { err.textContent = "20文字以内で入力してください。"; return; }

    const idx = APP.users.findIndex(u => u.id === currentUser.id);
    if(idx !== -1) {
      APP.users[idx].name = newName;
      currentUser = APP.users[idx];
      saveUsers(APP.users);
      savePublicProfile(currentUser.id, {
          name: newName
          }).catch(error => {
              console.error("表示名の同期に失敗:", error);
    });
    }
    closeModal("edit-name-modal");
    renderProfile();
    showBanner(`表示名を「${newName}」に変更しました！`);
  });

// ===== マイページでパスワード変更 =====
document.getElementById("change-password-btn")
  ?.addEventListener("click", () => {
    openModal("change-password-modal");
  });
document.getElementById("change-password-close")
  ?.addEventListener("click", () => {
    closeModal("change-password-modal");
  });
document.getElementById("change-password-cancel")
  ?.addEventListener("click", () => {
    closeModal("change-password-modal");
  });

const changePasswordForm =document.getElementById("change-password-form");

if (changePasswordForm) {
  changePasswordForm.addEventListener("submit", async e => {
    e.preventDefault();

    const input = document.getElementById("change-password-input");
    const err = document.getElementById("change-password-error");
    const confirmInput =document.getElementById("change-password-confirm");

    const newPassword = input.value;
    const confirmPassword = confirmInput.value;

    if (newPassword !== confirmPassword) {
      err.textContent = "パスワードが一致していません。";
      return;
      }

    if (newPassword.length < 8) {
      err.textContent = "パスワードは8文字以上にしてください。";
      return;
    }
      
    const success = await updatePassword(currentUser, newPassword);//パスワード関数を使った
    
    if (success) {
        err.textContent = "";
        alert("パスワードを変更しました！");
        closeModal("change-password-modal");
        }
    else {
        err.textContent = "パスワードの変更に失敗しました。再ログイン後にお試しください。";
        }
  });  
}

  // ── Notification settings ──
  const btnNotif = document.getElementById("btn-notif-settings");
  if(btnNotif) btnNotif.addEventListener("click", () => {
    const settings = loadNotifSettings();
    const ids = ["match","review","dm","system"];
    ids.forEach(k => {
      const el = document.getElementById(`notif-${k}`);
      if(el) el.checked = !!settings[k];
    });
    openModal("notif-settings-modal");
  });
  bindModalClose("notif-settings-modal", "notif-settings-close");

  const notifSaveBtn = document.getElementById("notif-settings-save");
  if(notifSaveBtn) notifSaveBtn.addEventListener("click", () => {
    const settings = { match:false, review:false, dm:false, system:false };
    Object.keys(settings).forEach(k => {
      const el = document.getElementById(`notif-${k}`);
      if(el) settings[k] = el.checked;
    });
    saveNotifSettings(settings);
    closeModal("notif-settings-modal");
    showBanner("通知設定を保存しました！🔔");
  });

  // ── Terms ──
  const btnTerms = document.getElementById("btn-terms");
  if(btnTerms) btnTerms.addEventListener("click", () => {
    // Reset to first tab
    document.querySelectorAll(".terms-tab").forEach(t => t.classList.remove("active"));
    const firstTab = document.querySelector(".terms-tab[data-terms='tos']");
    if(firstTab) firstTab.classList.add("active");
    document.getElementById("terms-tos").classList.remove("hidden");
    document.getElementById("terms-privacy").classList.add("hidden");
    openModal("terms-modal");
  });
  bindModalClose("terms-modal", "terms-close");
}

// ===== INIT =====
function initApp() {

  if (!appListenersInitialized) {
    initNav();
    initFilterTabs();
    initCategoryChips();
    initPostForm();
    initSettingsListeners();

    appListenersInitialized = true;
  }
  refreshBadges();
  updateHeaderPoints();
  showView("home");
}

// ===== BOOT =====
if(document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { initListeners(); initAuth(); });
} else {
  initListeners();
  initAuth();
}

//===== 「個人情報」を押すと内容が表示される ====
const openTerms = document.getElementById("open-terms");
const termsModal = document.getElementById("terms-modal");
const termsClose = document.getElementById("terms-close");

openTerms.addEventListener("click", function () {
  termsModal.classList.remove("hidden");
});
termsClose.addEventListener("click", function () {
  termsModal.classList.add("hidden");
});

//利用規約とプライバシーポリシーを切り換える
const termsTabs = document.querySelectorAll(".terms-tab");
const termsTos = document.getElementById("terms-tos");
const termsPrivacy = document.getElementById("terms-privacy");

termsTabs.forEach(function (tab) {
  tab.addEventListener("click", function () {
    termsTabs.forEach(function (button) {
      button.classList.remove("active");
    });

    tab.classList.add("active");

    //利用規約の所を押したら
    if (tab.dataset.terms === "tos") {
      termsTos.classList.remove("hidden");
      termsPrivacy.classList.add("hidden");
    }
    //プライバシーポリシーの所を押したら
    if (tab.dataset.terms === "privacy") {
      termsTos.classList.add("hidden");
      termsPrivacy.classList.remove("hidden");
    }
  });
});

const deleteAccountForm =
  document.getElementById("delete-account-form");

// ===== 退会（アカウント削除）の処理　=====
const openDeleteBtn = document.getElementById('open-delete-account-btn');
const deleteModal = document.getElementById('delete-account-modal');
const closeDeleteBtn = document.getElementById('delete-account-close');
const cancelDeleteBtn = document.getElementById('delete-account-cancel');
const deleteForm = document.getElementById('delete-account-form');
const deleteCheck = document.getElementById('delete-confirm-check');
const deleteSubmitBtn = document.getElementById('delete-account-submit');

// モーダルを開く
openDeleteBtn?.addEventListener('click', () => {
  deleteModal?.classList.remove('hidden');
});

// モーダルを閉じる関数
const closeDeleteModal = () => {
  deleteModal?.classList.add('hidden');
  if (deleteCheck) deleteCheck.checked = false;
  if (deleteSubmitBtn) {
    deleteSubmitBtn.disabled = true;
    deleteSubmitBtn.style.opacity = '0.5';
  }
};

closeDeleteBtn?.addEventListener('click', closeDeleteModal);
cancelDeleteBtn?.addEventListener('click', closeDeleteModal);

// 同意のチェックボックスを付けた時だけ「退会する」ボタンを押せるようにする
deleteCheck?.addEventListener('change', (e) => {
  if (e.target.checked) {
    deleteSubmitBtn.disabled = false;
    deleteSubmitBtn.style.opacity = '1';
  } else {
    deleteSubmitBtn.disabled = true;
    deleteSubmitBtn.style.opacity = '0.5';
  }
});

deleteForm?.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!deleteCheck?.checked) {
  return;
  }

  if (confirm('本当にアカウントを削除しますか？この操作は取り消せません。')) {
    const deletedUserId = currentUser.id;
    if(deleteSubmitBtn) { deleteSubmitBtn.disabled = true; deleteSubmitBtn.textContent = "削除中…"; }

    // 1つの処理が応答なしで固まっても全体が止まらないよう、8秒でタイムアウトさせる
    function withTimeout(promise, label, ms = 8000) {
      console.log(`[退会処理] ${label} 開始`);
      return Promise.race([
        promise.then(v => { console.log(`[退会処理] ${label} 完了`); return v; }),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}がタイムアウトしました（${ms}ms）`)), ms)),
      ]);
    }

    // それぞれ独立して実行し、1箇所が失敗・タイムアウトしても他の削除は続行する
    const results = await Promise.allSettled([
      withTimeout(deleteAllSkillsByUser(deletedUserId), "投稿の削除"),
      withTimeout(deletePublicProfile(deletedUserId), "公開プロフィールの削除"),
      withTimeout(deleteFirebaseAuthAccount(), "Firebase Authアカウントの削除"),
      withTimeout(deleteDatabaseUser(deletedUserId), "認証ユーザー情報の削除"),
    ]);
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        console.error(["投稿の削除", "公開プロフィールの削除", "Firebase Authアカウントの削除", "認証ユーザー情報の削除"][i] + "に失敗:", r.reason);
      }
    });

    // ローカルの記録を削除
    APP.users = APP.users.filter(u => u.id !== deletedUserId);
    APP.skills = APP.skills.filter(s => s.userId !== deletedUserId);
    saveSkills(APP.skills);
    saveUsers(APP.users);

    // 各種リアルタイム購読を停止
    if(convListUnsub) { convListUnsub(); convListUnsub = null; }
    if(convMsgUnsub)  { convMsgUnsub();  convMsgUnsub  = null; }
    if(incomingCallUnsub) { incomingCallUnsub(); incomingCallUnsub = null; }
    if(skillsUnsub) { skillsUnsub(); skillsUnsub = null; }
    if(usersUnsub)  { usersUnsub();  usersUnsub  = null; }

    // ログイン状態を削除
    saveCurrentUser(null);
    currentUser = null;

    deleteModal?.classList.add('hidden');
    document.getElementById("app").classList.add("hidden");
    document.getElementById("verify-screen").classList.add("hidden");
    document.getElementById("auth-screen").classList.remove("hidden");

    const failCount = results.filter(r => r.status === "rejected").length;
    if (failCount > 0) {
      alert('退会手続きは完了しましたが、一部データの削除に失敗した可能性があります（詳細はコンソールをご確認ください）。');
    } else {
      alert('退会手続きが完了しました。ご利用ありがとうございました。');
    }
  }
});