// Vercel Serverless Function: お知らせ投稿専用 LINE Webhook 受信
//
// 投稿専用チャンネル（既存の api/webhook.js とは別チャンネル）からの受信。
// - x-line-signature ヘッダーで HMAC-SHA256 署名検証
// - 画像とテキストを最大60秒の猶予でまとめて notices_ennoji に1件保存（順番はどちらでも可）:
//     * 画像メッセージ → Storageに保存。60秒以内の保留テキスト(pending_texts)があれば結合、
//                        無ければ pending_images に一時保存（expiresAt=60秒後）
//     * テキスト       → 60秒以内の保留画像(pending_images)があれば結合、
//                        無ければ pending_texts に一時保存（expiresAt=60秒後）
//     * 60秒以内に相手が来なかった保留分 → 画像のみ／テキストのみで保存
//       （サーバーレスにタイマーが無いため、後続のWebhook受信時に掃き出す）
// - 「削除」と送信      → 最新のお知らせを1件削除
//
// 必要な環境変数:
//   - LINE_CHANNEL_SECRET_NOTICE        （署名検証用・新規追加）
//   - LINE_CHANNEL_ACCESS_TOKEN_NOTICE  （画像コンテンツ取得用・新規追加）
//   - FIREBASE_* （lib/firebaseAdmin.js を参照）

const crypto = require('crypto');
const { admin, getDb, getBucket } = require('../lib/firebaseAdmin');

const COLLECTION = 'notices_ennoji';
const PENDING = 'pending_images';
const PENDING_TEXTS = 'pending_texts';
const DELETE_KEYWORD = '削除';
const PENDING_TTL_MS = 60 * 1000; // 画像とテキストをまとめる猶予（60秒）

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function isValidSignature(rawBody, signature, channelSecret) {
  const expected = crypto.createHmac('sha256', channelSecret).update(rawBody).digest('base64');
  const received = signature || '';
  const sigBuf = Buffer.from(received);
  const expBuf = Buffer.from(expected);
  const valid = sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
  if (!valid) {
    // 署名検証が失敗したときの調査用ログ（expected と received を出力）
    console.log('signature check:', expected, received);
  }
  return valid;
}

// LINEの画像コンテンツを取得し Storage に保存して公開URLを返す
async function saveImage(messageId, accessToken) {
  const resp = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    throw new Error(`画像コンテンツの取得に失敗しました: ${resp.status}`);
  }
  const contentType = resp.headers.get('content-type') || 'image/jpeg';
  const ext = contentType.includes('png') ? 'png' : 'jpg';
  const buffer = Buffer.from(await resp.arrayBuffer());

  const bucket = getBucket();
  const filePath = `notices/${Date.now()}_${messageId}.${ext}`;
  const file = bucket.file(filePath);
  await file.save(buffer, { metadata: { contentType }, resumable: false });
  await file.makePublic();
  return `https://storage.googleapis.com/${bucket.name}/${filePath}`;
}

async function deleteLatestNotice(db) {
  const snap = await db.collection(COLLECTION).orderBy('timestamp', 'desc').limit(1).get();
  if (!snap.empty) {
    await snap.docs[0].ref.delete();
  }
}

// notices_ennoji に1件保存
async function addNotice(db, { text, imageUrl }) {
  await db.collection(COLLECTION).add({
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    text: text || '',
    imageUrl: imageUrl || null,
  });
}

// 画像を pending_images に一時保存（expiresAt = 60秒後）
async function addPendingImage(db, imageUrl) {
  await db.collection(PENDING).add({
    imageUrl,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + PENDING_TTL_MS),
  });
}

// 60秒以内（未期限切れ）の保留画像を1件取り出す。あればそのdocを削除してURLを返す。
async function claimRecentPendingImage(db) {
  const now = admin.firestore.Timestamp.now();
  const snap = await db
    .collection(PENDING)
    .where('expiresAt', '>', now)
    .orderBy('expiresAt', 'desc')
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  const imageUrl = doc.data().imageUrl || null;
  await doc.ref.delete();
  return imageUrl;
}

// 期限切れ（60秒経過してもテキストが来なかった）保留画像を、画像のみのお知らせとして確定。
// サーバーレスにはタイマーが無いため、各Webhook受信のたびに掃き出す。
async function flushExpiredPendingImages(db) {
  const now = admin.firestore.Timestamp.now();
  const snap = await db.collection(PENDING).where('expiresAt', '<=', now).get();
  for (const doc of snap.docs) {
    await addNotice(db, { text: '', imageUrl: doc.data().imageUrl });
    await doc.ref.delete();
  }
}

// テキストを pending_texts に一時保存（expiresAt = 60秒後）
async function addPendingText(db, text) {
  await db.collection(PENDING_TEXTS).add({
    text,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + PENDING_TTL_MS),
  });
}

// 60秒以内（未期限切れ）の保留テキストを1件取り出す。あればそのdocを削除して本文を返す（無ければnull）。
async function claimRecentPendingText(db) {
  const now = admin.firestore.Timestamp.now();
  const snap = await db
    .collection(PENDING_TEXTS)
    .where('expiresAt', '>', now)
    .orderBy('expiresAt', 'desc')
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  const text = doc.data().text || '';
  await doc.ref.delete();
  return text;
}

// 期限切れ（60秒経過しても画像が来なかった）保留テキストを、テキストのみのお知らせとして確定。
async function flushExpiredPendingTexts(db) {
  const now = admin.firestore.Timestamp.now();
  const snap = await db.collection(PENDING_TEXTS).where('expiresAt', '<=', now).get();
  for (const doc of snap.docs) {
    await addNotice(db, { text: doc.data().text || '', imageUrl: null });
    await doc.ref.delete();
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const channelSecret = process.env.LINE_CHANNEL_SECRET_NOTICE;
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN_NOTICE;
  if (!channelSecret || !accessToken) {
    console.error('LINE_CHANNEL_SECRET_NOTICE または LINE_CHANNEL_ACCESS_TOKEN_NOTICE が未設定です');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const rawBody = await readRawBody(req);

  if (!isValidSignature(rawBody, req.headers['x-line-signature'], channelSecret)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let body;
  try {
    body = JSON.parse(rawBody.toString('utf8') || '{}');
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const events = Array.isArray(body.events) ? body.events : [];

  try {
    const db = getDb();

    // まず期限切れ（60秒以内に相手が来なかった）保留分を単独で確定
    // 画像のみ → 画像だけのお知らせ、テキストのみ → テキストだけのお知らせ
    await flushExpiredPendingImages(db);
    await flushExpiredPendingTexts(db);

    for (const event of events) {
      if (event.type !== 'message' || !event.message) continue;
      const msg = event.message;

      if (msg.type === 'text') {
        const text = (msg.text || '').trim();
        if (text === DELETE_KEYWORD) {
          await deleteLatestNotice(db);
        } else {
          // 60秒以内の保留画像があれば結合して1件保存（画像→テキストの順）
          const imageUrl = await claimRecentPendingImage(db);
          if (imageUrl !== null) {
            await addNotice(db, { text: msg.text || '', imageUrl });
          } else {
            // 無ければテキストを一時保存（後続画像とまとめるため。テキスト→画像の順に対応）
            await addPendingText(db, msg.text || '');
          }
        }
      } else if (msg.type === 'image') {
        const imageUrl = await saveImage(msg.id, accessToken);
        // 60秒以内の保留テキストがあれば結合して1件保存（テキスト→画像の順）
        const pendingText = await claimRecentPendingText(db);
        if (pendingText !== null) {
          await addNotice(db, { text: pendingText, imageUrl });
        } else {
          // 無ければ画像を一時保存（後続テキストとまとめるため）
          await addPendingImage(db, imageUrl);
        }
      }
    }
  } catch (err) {
    console.error('notice-webhook handler error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }

  // LINEには常に200を返す
  return res.status(200).json({ ok: true });
};

// 署名検証のため生のリクエストボディが必要（bodyParserを無効化）
// ※ module.exports を再代入した後に設定すること
module.exports.config = { api: { bodyParser: false } };
