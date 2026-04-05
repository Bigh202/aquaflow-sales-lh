const https = require('https');

function httpsRequest(method, path, body, apiKey) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const options = {
      hostname: 'api.openphone.com',
      path,
      method,
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
      },
    };
    if (payload) options.headers['Content-Length'] = Buffer.byteLength(payload);

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed;
        try {
          parsed = data ? JSON.parse(data) : {};
        } catch (e) {
          // Non-JSON response — return raw text in error field
          resolve({ status: res.statusCode, data: { error: 'Non-JSON response', raw: data } });
          return;
        }
        resolve({ status: res.statusCode, data: parsed });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const OPENPHONE_API_KEY = process.env.OPENPHONE_API_KEY;
  if (!OPENPHONE_API_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: 'OPENPHONE_API_KEY not set' }) };

  if (event.httpMethod === 'GET') {
    const params = event.queryStringParameters || {};

    // Debug: fetch current user info
    if (params.action === 'me') {
      try {
        const result = await httpsRequest('GET', '/v1/users/me', null, OPENPHONE_API_KEY);
        return { statusCode: 200, headers, body: JSON.stringify({ httpStatus: result.status, response: result.data }) };
      } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
      }
    }

    // Debug: fetch available phone numbers
    if (params.action === 'phone-numbers') {
      try {
        const result = await httpsRequest('GET', '/v1/phone-numbers', null, OPENPHONE_API_KEY);
        return { statusCode: 200, headers, body: JSON.stringify({ httpStatus: result.status, response: result.data }) };
      } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
      }
    }

    // Poll call status
    const callId = params.callId;
    if (!callId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'callId or action required' }) };
    try {
      const result = await httpsRequest('GET', `/v1/calls/${callId}`, null, OPENPHONE_API_KEY);
      if (result.status !== 200) return { statusCode: 200, headers, body: JSON.stringify({ status: 'unknown' }) };
      const call = result.data.data || result.data;
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          status: call.status || 'unknown',
          duration: call.duration || 0,
          recordingUrl: call.recordingUrl || call.recording_url || '',
        }),
      };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  // POST: initiate a call
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { to, from: fromNumber } = body;
  if (!to || !fromNumber) return { statusCode: 400, headers, body: JSON.stringify({ error: 'to and from required' }) };

  try {
    const result = await httpsRequest('POST', '/v1/calls', { to, from: fromNumber }, OPENPHONE_API_KEY);
    if (result.status >= 400) {
      const msg = result.data.message || result.data.error || 'OpenPhone API error';
      return { statusCode: 200, headers, body: JSON.stringify({ success: false, error: msg }) };
    }
    const call = result.data.data || result.data;
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, callId: call.id }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
