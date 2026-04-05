const https = require('https');

function httpsPost(path, body, apiKey) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.prospeo.io',
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-KEY': apiKey,
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

const TITLE_PRIORITY = [
  ['vp ', 'vice president', 'chief operating', ' coo'],
  ['director of facilities', 'facilities director'],
  ['director of engineering', 'chief engineer'],
  ['director of operations', 'vp operations', 'director'],
  ['general manager', ' gm,', ' gm '],
  ['facilities manager', 'plant manager', 'property manager'],
  ['operations manager', 'managing director'],
  ['owner', 'partner', 'president', 'ceo'],
  ['manager'],
];

function titleScore(title) {
  const t = (title || '').toLowerCase();
  for (let i = TITLE_PRIORITY.length - 1; i >= 0; i--) {
    if (TITLE_PRIORITY[i].some(kw => t.includes(kw))) return i + 1;
  }
  return 0;
}

function guessDomain(biz) {
  return biz.toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 30) + '.com';
}

function extractDomain(url) {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith('http') ? url : 'https://' + url);
    return u.hostname.replace(/^www\./, '');
  } catch (e) { return null; }
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const PROSPEO_KEY = process.env.PROSPEO_KEY;
  if (!PROSPEO_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: 'PROSPEO_KEY not set' }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { mode, biz, website, domain: domainParam, firstName, lastName } = body;

  try {
    // email-finder mode: find email for a specific known person
    if (mode === 'email-finder') {
      if (!firstName || !lastName || !(domainParam || website)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'firstName, lastName, and domain or website required' }) };
      }
      const domain = domainParam || extractDomain(website);
      if (!domain) return { statusCode: 200, headers, body: JSON.stringify({ found: false, reason: 'no_domain' }) };

      const result = await httpsPost('/email-finder', { first_name: firstName, last_name: lastName, domain }, PROSPEO_KEY);
      if (result.status !== 200 || result.data.error || !result.data.response?.email) {
        return { statusCode: 200, headers, body: JSON.stringify({ found: false }) };
      }
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ found: true, email: result.data.response.email }),
      };
    }

    // Default: domain-search mode — find decision makers at the company
    if (!biz) return { statusCode: 400, headers, body: JSON.stringify({ error: 'biz required' }) };

    const domain = domainParam || (website ? extractDomain(website) : null) || guessDomain(biz);

    const result = await httpsPost('/domain-search', { company: domain, limit: 20 }, PROSPEO_KEY);

    if (result.status !== 200 || result.data.error || !result.data.response?.email_list?.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ found: false, reason: 'no_results' }) };
    }

    const people = result.data.response.email_list;

    // Pick best decision-maker by title score; fall back to first result
    const scored = people
      .map(p => ({ p, score: titleScore(p.position) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score);

    const best = scored.length ? scored[0].p : people[0];
    const name = [best.first_name, best.last_name].filter(Boolean).join(' ');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        found: true,
        name: name || '',
        title: best.position || '',
        email: best.email || '',
        linkedin: best.linkedin || '',
      }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
