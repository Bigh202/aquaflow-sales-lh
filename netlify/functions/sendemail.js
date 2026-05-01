const https = require('https');

function gmailPost(token, bodyObj) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(bodyObj);
    const req = https.request({
      hostname: 'gmail.googleapis.com',
      path: '/gmail/v1/users/me/messages/send',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch (e) { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function encodeB64Url(s) {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function buildRfc2822(to, subject, textBody, htmlBody) {
  const boundary = 'boundary_' + Date.now();
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    textBody,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    htmlBody,
    '',
    `--${boundary}--`,
  ];
  return lines.join('\r\n');
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Connect Gmail first in the Email tab' }) };
  }

  try {
    const { to, subject, body, leadId, leadBiz } = JSON.parse(event.body);

    if (!to || !subject || !body) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields: to, subject, body' }) };
    }

    const trackingId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const trackingPixel = `<img src="https://aquaflowsales.com/.netlify/functions/email-track?id=${trackingId}" width="1" height="1" style="display:none" alt="">`;
    const htmlBody = body.split('\n').map(line => line ? `<p style="margin:0 0 12px;font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#333">${line}</p>` : '<br>').join('') + trackingPixel;

    const raw = encodeB64Url(buildRfc2822(to, subject, body, htmlBody));
    const result = await gmailPost(token, { raw });

    if (result.status === 200 || result.status === 202) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, id: result.body.id, leadId, leadBiz, trackingId }) };
    } else {
      return { statusCode: result.status, headers, body: JSON.stringify({ error: result.body.error?.message || 'Send failed', details: result.body }) };
    }
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
