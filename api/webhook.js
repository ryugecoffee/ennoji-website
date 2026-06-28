// Vercel Serverless Function: LINE Webhook 受信
//
// - x-line-signature ヘッダーで HMAC-SHA256 署名検証
// - テキストメッセージ → Firestore notices_ennoji に保存
// - 画像メッセージ    → Storageに保存し画像URLも保存
// - 「削除」と送信     → 最新のお知らせを1件削除
//
// 必要な環境変数:
//   - LINE_CHANNEL_SECRET        （署名検証用・新規追加）
//   - LINE_CHANNEL_ACCESS_TOKEN  （画像コンテンツ取得用・設定済み）
//   - FIREBASE_* （lib/firebaseAdmin.js を参照）

const crypto = require('crypto');
const { admin, getDb, getBucket } = require('../lib/firebaseAdmin');

const COLLECTION = 'notices_ennoji';
const DELETE_KEYWORD = '削除';

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function isValidSignature(rawBody, signature, channelSecret) {
  if (!signature) return false;
  const expected = crypto.createHmac('sha256', channelSecret).update(rawBody).digest('base64');
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!channelSecret || !accessToken) {
    console.error('LINE_CHANNEL_SECRET または LINE_CHANNEL_ACCESS_TOKEN が未設定です');
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
    for (const event of events) {
      if (event.type !== 'message' || !event.message) continue;
      const msg = event.message;

      if (msg.type === 'text') {
        const text = (msg.text || '').trim();
        if (text === DELETE_KEYWORD) {
          await deleteLatestNotice(db);
        } else {
          await db.collection(COLLECTION).add({
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            text: msg.text || '',
            imageUrl: null,
          });
        }
      } else if (msg.type === 'image') {
        const imageUrl = await saveImage(msg.id, accessToken);
        await db.collection(COLLECTION).add({
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          text: '',
          imageUrl,
        });
      }
    }
  } catch (err) {
    console.error('webhook handler error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }

  // LINEには常に200を返す
  return res.status(200).json({ ok: true });
};

// 署名検証のため生のリクエストボディが必要（bodyParserを無効化）
// ※ module.exports を再代入した後に設定すること
module.exports.config = { api: { bodyParser: false } };
