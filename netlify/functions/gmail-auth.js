exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const CLIENT_ID    = process.env.GOOGLE_CLIENT_ID;
  const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'https://aquaflowsales.com/auth/google/callback';

  if (!CLIENT_ID) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing GOOGLE_CLIENT_ID env var' }) };
  }

  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    response_type: 'code',
    scope: [
      'https://mail.google.com/',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/calendar.events',
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
