// Vercel Serverless Function: お知らせ取得（公開GET）
// notices_ennoji から最新5件を返す。index.html のお知らせセクションが読み込む。

const { getDb } = require('../lib/firebaseAdmin');

const COLLECTION = 'notices_ennoji';
const LIMIT = 5;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const db = getDb();
    const snap = await db
      .collection(COLLECTION)
      .orderBy('createdAt', 'desc')
      .limit(LIMIT)
      .get();

    const notices = snap.docs.map((doc) => {
      const data = doc.data();
      const ts = data.createdAt;
      return {
        id: doc.id,
        text: data.text || '',
        imageUrl: data.imageUrl || null,
        createdAt: ts && typeof ts.toMillis === 'function' ? ts.toMillis() : null,
      };
    });

    // CDNで短時間キャッシュ（更新は数分以内に反映）
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ notices });
  } catch (err) {
    console.error('notices handler error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
