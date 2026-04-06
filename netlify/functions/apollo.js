const https = require('https');

function httpsPost(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { reject(new Error('Parse error: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function formatPhone(raw) {
  if (!raw) return '';
  const d = raw.replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  return raw;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const APOLLO_KEY = process.env.APOLLO_KEY;
  if (!APOLLO_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'APOLLO_KEY not set' }) };
  }

  let bizName, city, type;
  try {
    ({ bizName, city, type } = JSON.parse(event.body));
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  if (!bizName) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'bizName required' }) };
  }

  try {
    const payload = JSON.stringify({
      api_key: APOLLO_KEY,
      q_organization_name: bizName,
      person_titles: [
        'Facilities Manager', 'Director of Facilities', 'Property Manager',
        'General Manager', 'VP Operations', 'Director of Operations',
        'Plant Manager', 'Chief Engineer', 'Owner', 'President',
      ],
      per_page: 1,
    });

    const options = {
      hostname: 'api.apollo.io',
      path: '/v1/mixed_people/search',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const result = await httpsPost(options, payload);

    if (result.status === 429) {
      return { statusCode: 200, headers, body: JSON.stringify({ found: false, reason: 'rate_limited' }) };
    }

    if (result.status !== 200 || !result.data.people || !result.data.people.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ found: false, reason: 'no_results' }) };
    }

    const p = result.data.people[0];
    const phone = formatPhone(p.phone_numbers?.[0]?.sanitized_number || '');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        found: true,
        name: [p.first_name, p.last_name].filter(Boolean).join(' ') || '',
        title: p.title || '',
        email: p.email || '',
        phone,
        source: 'Apollo',
      }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
