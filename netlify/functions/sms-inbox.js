const https = require('https');

function twilioGet(sid, auth, path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.twilio.com',
      path,
      method: 'GET',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${sid}:${auth}`).toString('base64'),
        'Accept': 'application/json',
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { reject(new Error('Parse error: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const SID   = process.env.TWILIO_ACCOUNT_SID;
  const AUTH  = process.env.TWILIO_AUTH_TOKEN;
  const FROM  = process.env.TWILIO_CALLER_ID;

  if (!SID || !AUTH || !FROM) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing Twilio env vars' }) };
  }

  const base     = `/2010-04-01/Accounts/${SID}/Messages.json`;
  const encFrom  = encodeURIComponent(FROM);

  try {
    // Fetch inbound (To our number) and outbound (From our number) in parallel
    const [inbound, outbound] = await Promise.all([
      twilioGet(SID, AUTH, `${base}?To=${encFrom}&PageSize=50`),
      twilioGet(SID, AUTH, `${base}?From=${encFrom}&PageSize=50`),
    ]);

    const normalize = (msg) => ({
      sid:       msg.sid,
      from:      msg.from,
      to:        msg.to,
      body:      msg.body,
      dateSent:  msg.date_sent,
      direction: msg.direction,
      status:    msg.status,
    });

    const all = [
      ...(inbound.data.messages  || []).map(normalize),
      ...(outbound.data.messages || []).map(normalize),
    ];

    // Deduplicate by sid, sort newest first
    const seen   = new Set();
    const unique = all.filter(m => { if (seen.has(m.sid)) return false; seen.add(m.sid); return true; });
    unique.sort((a, b) => new Date(b.dateSent) - new Date(a.dateSent));

    return { statusCode: 200, headers, body: JSON.stringify({ messages: unique.slice(0, 50) }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
