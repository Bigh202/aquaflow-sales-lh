const https = require('https');

function postForm(hostname, path, params) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const req = https.request({
      hostname,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
        catch (e) { reject(new Error('Parse error')); }
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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
  const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const REDIRECT_URI  = process.env.GOOGLE_REDIRECT_URI;

  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing Google OAuth env vars' }) };
  }

  let code;
  try { ({ code } = JSON.parse(event.body)); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }

  if (!code) return { statusCode: 400, headers, body: JSON.stringify({ error: 'code required' }) };

  try {
    const { status, data } = await postForm('oauth2.googleapis.com', '/token', {
      code,
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri:  REDIRECT_URI,
      grant_type:    'authorization_code',
    });

    if (status !== 200 || data.error) {
      return { statusCode: 200, headers, body: JSON.stringify({ error: data.error_description || data.error || 'Token exchange failed' }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        access_token:  data.access_token,
        refresh_token: data.refresh_token,
        expiry:        Date.now() + (data.expires_in * 1000),
      }),
    };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
