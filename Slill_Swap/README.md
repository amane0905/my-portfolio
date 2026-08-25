# Skill-Swap (Portfolio)

学生向けスキル交換アプリです。現在は `index.html + js/*.js` の構成で動作しています。

## 主な機能

- 学生メール認証 (Firebase Authentication)
- スキル投稿 / マッチング
- DM (Firestore)
- 音声・ビデオ通話 (WebRTC + Firestore signaling)
- ポイント予約・精算

## セットアップ

1. Firebase プロジェクトを作成
2. Authentication で「メール/パスワード」を有効化
3. Firestore Database を作成
4. `js/firebase-config.js` の Firebase 設定値を自分のプロジェクト値に差し替え
5. Firestore Rules に `js/firestore.rules.example.txt` を貼り付けて公開

## 開発起動

```bash
pnpm install
pnpm dev
```

`http://localhost:8443` を開くとアプリを確認できます。

## 新規登録テストで既存メールが邪魔なとき

1. Firebase Console > Authentication > Users で対象メールを削除
2. 必要に応じて Firestore の `authUsers/{uid}` と `users/{uid}` も削除
3. ブラウザを再読み込みして再登録

## 現在の注意点

- 旧Monaca由来の `components/` は削除済みです。
- 認証のパスワードは Firestore に保存していません。Firebase Authentication を正とします。
- Firestore ルールはクライアント実装との整合のため、`users` 更新を一部広めに許可しています。将来的には Cloud Functions への移行でさらに厳密化できます。
