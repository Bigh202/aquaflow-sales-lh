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
        catch (e) { reject(new Error('Parse error: ' + d.substring(0, 200))); }
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
  const REDIRECT_URI  = process.env.GOOGLE_REDIRECT_URI || 'https://aquaflowsales.com/auth/google/callback';

  console.log('[gmail-callback] CLIENT_ID present:', !!CLIENT_ID, '| CLIENT_SECRET present:', !!CLIENT_SECRET, '| REDIRECT_URI:', REDIRECT_URI);

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET env vars' }) };
  }

  let code;
  try { ({ code } = JSON.parse(event.body)); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }

  if (!code) return { statusCode: 400, headers, body: JSON.stringify({ error: 'code required' }) };

  console.log('[gmail-callback] Exchanging code (first 20 chars):', code.substring(0, 20), '...');

  try {
    const { status, data } = await postForm('oauth2.googleapis.com', '/token', {
      code,
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri:  REDIRECT_URI,
      grant_type:    'authorization_code',
    });

    console.log('[gmail-callback] Google token endpoint status:', status, '| error:', data.error || 'none', '| access_token present:', !!data.access_token, '| refresh_token present:', !!data.refresh_token);

    if (status !== 200 || data.error) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          error: data.error_description || data.error || 'Token exchange failed',
          google_status: status,
          google_error: data.error,
        }),
      };
    }

    if (!data.access_token) {
      return { statusCode: 200, headers, body: JSON.stringify({ error: 'Google returned no access_token', google_response: data }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        access_token:  data.access_token,
        refresh_token: data.refresh_token || null,
        expiry:        Date.now() + ((data.expires_in || 3600) * 1000),
      }),
    };
  } catch (e) {
    console.error('[gmail-callback] Error:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
