const https = require('https');

function httpsPost(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.apollo.io',
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { reject(new Error('Parse error: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.write(payload);
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

// Strip addresses, suite numbers, special chars — keep only the business name words
function cleanBizName(name) {
  return name
    .replace(/\b\d+\s+[\w\s]+(st|ave|blvd|rd|dr|ln|way|ct|pl|suite|ste|#)\b.*/i, '')
    .replace(/[^a-zA-Z0-9\s&'-]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function personResult(p, strategy) {
  return {
    found: true,
    strategy,
    name: [p.first_name, p.last_name].filter(Boolean).join(' ') || '',
    title: p.title || '',
    email: p.email || '',
    phone: formatPhone(p.phone_numbers?.[0]?.sanitized_number || ''),
    source: 'Apollo',
  };
}

const DM_TITLES = [
  'Facilities Manager', 'Director of Facilities', 'Property Manager',
  'General Manager', 'VP Operations', 'Director of Operations',
  'Plant Manager', 'Chief Engineer', 'Owner', 'President',
];

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

  const cleanName = cleanBizName(bizName);

  try {
    // ── Strategy 1: org name + DM titles, per_page 1 ──────────────────────────
    let r = await httpsPost('/v1/mixed_people/search', {
      api_key: APOLLO_KEY,
      q_organization_name: cleanName,
      person_titles: DM_TITLES,
      per_page: 1,
    });
    if (r.status === 429) return { statusCode: 200, headers, body: JSON.stringify({ found: false, reason: 'rate_limited' }) };
    if (r.status === 200 && r.data.people?.length) {
      return { statusCode: 200, headers, body: JSON.stringify(personResult(r.data.people[0], 1)) };
    }

    // ── Strategy 2: org name only, broader search, per_page 5 ─────────────────
    r = await httpsPost('/v1/mixed_people/search', {
      api_key: APOLLO_KEY,
      q_organization_name: cleanName,
      per_page: 5,
    });
    if (r.status === 429) return { statusCode: 200, headers, body: JSON.stringify({ found: false, reason: 'rate_limited' }) };
    if (r.status === 200 && r.data.people?.length) {
      return { statusCode: 200, headers, body: JSON.stringify(personResult(r.data.people[0], 2)) };
    }

    // ── Strategy 3: org search → org_id → people at that company ──────────────
    r = await httpsPost('/v1/mixed_companies/search', {
      api_key: APOLLO_KEY,
      q_organization_name: cleanName,
      per_page: 1,
    });
    if (r.status === 429) return { statusCode: 200, headers, body: JSON.stringify({ found: false, reason: 'rate_limited' }) };
    if (r.status === 200 && r.data.organizations?.length) {
      const orgId = r.data.organizations[0].id;
      r = await httpsPost('/v1/mixed_people/search', {
        api_key: APOLLO_KEY,
        organization_ids: [orgId],
        per_page: 5,
      });
      if (r.status === 429) return { statusCode: 200, headers, body: JSON.stringify({ found: false, reason: 'rate_limited' }) };
      if (r.status === 200 && r.data.people?.length) {
        return { statusCode: 200, headers, body: JSON.stringify(personResult(r.data.people[0], 3)) };
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ found: false, reason: 'no_results' }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
