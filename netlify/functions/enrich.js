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

// Ordered by priority — higher index = lower priority fallback
const TITLE_PRIORITY = [
  ['vp ', 'vice president', 'chief operating', ' coo'],          // 6
  ['director of facilities', 'facilities director'],             // 5
  ['director of engineering', 'chief engineer', 'dir. of eng'],  // 5
  ['director of operations', 'vp operations', 'director'],       // 4
  ['general manager', ' gm,', ' gm '],                          // 4
  ['facilities manager', 'plant manager', 'property manager'],   // 3
  ['operations manager', 'managing director'],                   // 2
  ['owner', 'partner', 'president', 'ceo'],                      // 2
  ['manager'],                                                   // 1
];

function titleScore(title) {
  const t = (title || '').toLowerCase();
  for (let i = TITLE_PRIORITY.length - 1; i >= 0; i--) {
    if (TITLE_PRIORITY[i].some(kw => t.includes(kw))) return i + 1;
  }
  return 0;
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
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'APOLLO_KEY env var not set' }) };
  }

  let biz, city, type;
  try {
    ({ biz, city, type } = JSON.parse(event.body));
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  if (!biz) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'biz field required' }) };
  }

  try {
    const payload = JSON.stringify({
      api_key: APOLLO_KEY,
      q_organization_name: biz,
      person_titles: [
        'Facilities Manager', 'Director of Facilities', 'Facilities Director',
        'VP Operations', 'Vice President Operations', 'Director of Operations',
        'General Manager', 'Plant Manager', 'Property Manager',
        'Director of Engineering', 'Chief Engineer', 'Owner',
        'Managing Director', 'COO', 'Director', 'Operations Manager',
      ],
      page: 1,
      per_page: 15,
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

    // Score each person and pick the best match
    const scored = result.data.people
      .map(p => ({
        p,
        score: titleScore(p.title) * 10
          + (p.email ? 5 : 0)
          + (p.phone_numbers?.length ? 3 : 0)
          + (p.linkedin_url ? 1 : 0),
      }))
      .filter(x => x.score > 0) // must match at least one title keyword
      .sort((a, b) => b.score - a.score);

    if (!scored.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ found: false, reason: 'no_dm_found' }) };
    }

    const best = scored[0].p;
    const phone = best.phone_numbers?.length
      ? formatPhone(best.phone_numbers[0].sanitized_number || best.phone_numbers[0].raw_number)
      : '';

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        found: true,
        name: [best.first_name, best.last_name].filter(Boolean).join(' ') || '',
        title: best.title || '',
        email: best.email || '',
        phone,
        linkedin: best.linkedin_url || '',
      }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
