const https = require('https');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
  const AUTH_TOKEN  = process.env.TWILIO_AUTH_TOKEN;

  if (!ACCOUNT_SID || !AUTH_TOKEN) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Twilio credentials not set' }) };
  }

  let callSid;
  try { ({ callSid } = JSON.parse(event.body)); } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  if (!callSid) return { statusCode: 400, headers, body: JSON.stringify({ error: 'callSid required' }) };

  const twimlUrl = 'https://aquaflowsales.com/.netlify/functions/voicemail-twiml';
  const body = new URLSearchParams({ Url: twimlUrl, Method: 'POST' }).toString();
  const auth = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64');

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.twilio.com',
      path: `/2010-04-01/Accounts/${ACCOUNT_SID}/Calls/${callSid}.json`,
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 202) {
          resolve({ statusCode: 200, headers, body: JSON.stringify({ success: true }) });
        } else {
          try {
            const err = JSON.parse(data);
            resolve({ statusCode: 200, headers, body: JSON.stringify({ error: err.message || 'Twilio error' }) });
          } catch (e) {
            resolve({ statusCode: 200, headers, body: JSON.stringify({ error: 'Twilio error: ' + res.statusCode }) });
          }
        }
      });
    });
    req.on('error', (e) => resolve({ statusCode: 200, headers, body: JSON.stringify({ error: e.message }) }));
    req.write(body);
    req.end();
  });
};
