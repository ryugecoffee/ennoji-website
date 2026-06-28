// Firebase Admin の初期化（RCCと同じFirestoreプロジェクトを共有）
//
// 必要な環境変数（Vercel のプロジェクト設定で登録）:
//   - FIREBASE_PROJECT_ID
//   - FIREBASE_CLIENT_EMAIL
//   - FIREBASE_PRIVATE_KEY        （改行は \n でエスケープされた形でOK）
//   - FIREBASE_STORAGE_BUCKET     （任意。未設定時は <PROJECT_ID>.appspot.com）

const admin = require('firebase-admin');

let initialized = false;

function ensureApp() {
  if (initialized || admin.apps.length) {
    initialized = true;
    return;
  }
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Firebase の環境変数（FIREBASE_PROJECT_ID / CLIENT_EMAIL / PRIVATE_KEY）が未設定です');
  }

  admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.appspot.com`,
  });
  initialized = true;
}

function getDb() {
  ensureApp();
  return admin.firestore();
}

function getBucket() {
  ensureApp();
  return admin.storage().bucket();
}

module.exports = { admin, getDb, getBucket };
