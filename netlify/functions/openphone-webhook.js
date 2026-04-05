exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '' };

  let payload;
  try { payload = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { type, data } = payload;

  // Log all events — visible in Netlify Functions log dashboard
  console.log(JSON.stringify({ event: type, data, timestamp: new Date().toISOString() }));

  if (type === 'call.completed' && data) {
    const { id: callId, to, from, status, duration, recordingUrl, direction } = data;
    console.log(JSON.stringify({
      event: 'call.completed',
      callId,
      to,
      from,
      status,
      direction,
      duration,
      recordingUrl,
      timestamp: new Date().toISOString(),
    }));
  }

  return { statusCode: 200, headers, body: JSON.stringify({ received: true }) };
};
