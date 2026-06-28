// Vercel Serverless Function: お問い合わせ → LINE プッシュ通知
//
// 必要な環境変数（Vercel のプロジェクト設定で登録）:
//   - LINE_CHANNEL_ACCESS_TOKEN : LINE Messaging API のチャネルアクセストークン
//   - LINE_USER_ID              : 通知先のユーザーID（または グループ/ルームID）

const TYPE_LABELS = {
  cemetery: '墓地分譲について',
  funeral: '葬儀・法事について',
  touba: '塔婆供養について',
  other: 'その他',
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const userId = process.env.LINE_USER_ID;
  if (!token || !userId) {
    console.error('LINE_CHANNEL_ACCESS_TOKEN または LINE_USER_ID が未設定です');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // req.body は Vercel が自動でパースするが、文字列で来る場合に備える
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }
  }
  body = body || {};

  const name = (body.name || '').toString().trim();
  const email = (body.email || '').toString().trim();
  const tel = (body.tel || '').toString().trim();
  const type = (body.type || '').toString().trim();
  const message = (body.message || '').toString().trim();
  const kaimyo = (body.kaimyo || '').toString().trim();
  const seshu = (body.seshu || '').toString().trim();

  if (!name || !tel || !message) {
    return res.status(400).json({ error: 'お名前・電話・内容は必須です' });
  }

  const typeLabel = TYPE_LABELS[type] || type || '（未選択）';

  let text =
    '【円応寺 お問い合わせ】\n' +
    `お名前：${name}\n` +
    `電話：${tel}\n` +
    `メール：${email || '（未入力）'}\n` +
    `種別：${typeLabel}\n`;

  // 塔婆供養の場合は戒名・施主名を追記
  if (type === 'touba') {
    text +=
      `戒名：${kaimyo || '（未入力）'}\n` +
      `施主：${seshu || '（未入力）'}\n`;
  }

  text += `内容：${message}`;

  try {
    const lineRes = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        to: userId,
        messages: [{ type: 'text', text }],
      }),
    });

    if (!lineRes.ok) {
      const detail = await lineRes.text();
      console.error('LINE API error:', lineRes.status, detail);
      return res.status(502).json({ error: 'LINE通知の送信に失敗しました' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('contact handler error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
