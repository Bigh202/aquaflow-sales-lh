exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const CLIENT_ID    = process.env.GOOGLE_CLIENT_ID;
  const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

  if (!CLIENT_ID || !REDIRECT_URI) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing GOOGLE_CLIENT_ID or GOOGLE_REDIRECT_URI env vars' }) };
  }

  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    response_type: 'code',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/userinfo.email',
    ].join(' '),
    access_type: 'offline',
    prompt:      'consent',
    state:       'gmail',
  });

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` }),
  };
};
