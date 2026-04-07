const https = require('https');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const SID  = process.env.TWILIO_ACCOUNT_SID;
  const AUTH = process.env.TWILIO_AUTH_TOKEN;
  const FROM = process.env.TWILIO_CALLER_ID;

  if (!SID || !AUTH || !FROM) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing Twilio env vars' }) };
  }

  let to, message;
  try { ({ to, message } = JSON.parse(event.body)); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }

  if (!to || !message) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'to and message required' }) };
  }

  return new Promise((resolve) => {
    const body = new URLSearchParams({ To: to, From: FROM, Body: message }).toString();
    const req = https.request({
      hostname: 'api.twilio.com',
      path: `/2010-04-01/Accounts/${SID}/Messages.json`,
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${SID}:${AUTH}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const d = JSON.parse(data);
          if (res.statusCode === 201) {
            resolve({ statusCode: 200, headers, body: JSON.stringify({ success: true, messageSid: d.sid }) });
          } else {
            resolve({ statusCode: 200, headers, body: JSON.stringify({ success: false, error: d.message || 'Send failed' }) });
          }
        } catch (e) {
          resolve({ statusCode: 200, headers, body: JSON.stringify({ success: false, error: 'Parse error' }) });
        }
      });
    });
    req.on('error', e => resolve({ statusCode: 500, headers, body: JSON.stringify({ error: e.message }) }));
    req.write(body);
    req.end();
  });
};
