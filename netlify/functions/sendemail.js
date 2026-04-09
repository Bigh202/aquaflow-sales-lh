const https = require('https');

function httpsPost(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const RESEND_KEY = process.env.RESEND_API_KEY;
  const FROM_EMAIL = process.env.FROM_EMAIL || 'lauren@aquaflowsales.com';
  const FROM_NAME = process.env.FROM_NAME || 'Lauren Hatwan';

  if (!RESEND_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'RESEND_API_KEY not set in Netlify environment variables' }) };
  }

  try {
    const { to, subject, body, leadId, leadBiz } = JSON.parse(event.body);

    if (!to || !subject || !body) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields: to, subject, body' }) };
    }

    const trackingId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const trackingPixel = `<img src="https://aquaflowsales.com/.netlify/functions/email-track?id=${trackingId}" width="1" height="1" style="display:none" alt="">`;
    const htmlBody = body.split('\n').map(line => line ? `<p style="margin:0 0 12px;font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#333">${line}</p>` : '<br>').join('') + trackingPixel;

    const emailPayload = JSON.stringify({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: [to],
      subject: subject,
      text: body,
      html: htmlBody,
    });

    const options = {
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(emailPayload)
      }
    };

    const result = await httpsPost(options, emailPayload);

    if (result.status === 200 || result.status === 201) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, id: result.body.id, leadId, leadBiz, trackingId }) };
    } else {
      return { statusCode: result.status, headers, body: JSON.stringify({ error: result.body.message || 'Send failed', details: result.body }) };
    }
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};