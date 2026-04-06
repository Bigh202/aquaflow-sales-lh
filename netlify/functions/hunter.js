const https = require('https');

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { reject(new Error('Parse error: ' + e.message)); }
      });
    }).on('error', reject);
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
  ['engineer', 'property'],
  ['manager'],
];

function titleScore(title) {
  const t = (title || '').toLowerCase();
  for (let i = TITLE_PRIORITY.length - 1; i >= 0; i--) {
    if (TITLE_PRIORITY[i].some(kw => t.includes(kw))) return i + 1;
  }
  return 0;
}

function extractDomain(url) {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith('http') ? url : 'https://' + url);
    return u.hostname.replace(/^www\./, '');
  } catch (e) { return null; }
}

function guessDomain(biz) {
  return biz.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30) + '.com';
}

// Common role-based email prefixes to try when no person is found
const GUESS_PREFIXES = ['info', 'contact', 'admin', 'office', 'hello', 'manager', 'pro'];

exports.handler = async (event) => {
  console.log('[hunter] handler invoked — method:', event.httpMethod);
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const HUNTER_KEY = process.env.HUNTER_KEY;
  console.log('[hunter] HUNTER_KEY present:', !!HUNTER_KEY);
  if (!HUNTER_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: 'HUNTER_KEY not set' }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { mode = 'domain-search', biz, website, domain: domainParam } = body;
  const domain = domainParam || (website ? extractDomain(website) : null) || (biz ? guessDomain(biz) : null);

  if (!domain) return { statusCode: 200, headers, body: JSON.stringify({ found: false, reason: 'no_domain' }) };

  console.log('[hunter] mode:', mode, '| domain:', domain);

  try {
    if (mode === 'domain-search') {
      const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&limit=20&api_key=${HUNTER_KEY}`;
      const result = await httpsGet(url);
      console.log('[hunter] domain-search status:', result.status, '| emails:', result.data?.data?.emails?.length ?? 0);

      if (result.status !== 200 || !result.data?.data?.emails?.length) {
        return { statusCode: 200, headers, body: JSON.stringify({ found: false, reason: 'no_results' }) };
      }

      const emails = result.data.data.emails;

      // Pick best decision-maker by title score; fall back to highest-confidence result
      const scored = emails
        .map(e => ({ e, score: titleScore(e.position) }))
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score);

      const best = scored.length
        ? scored[0].e
        : emails.sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];

      const name = [best.first_name, best.last_name].filter(Boolean).join(' ');

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          found: true,
          source: 'hunter',
          name: name || '',
          title: best.position || '',
          email: best.value || '',
          linkedin: '',
        }),
      };
    }

    if (mode === 'email-guess') {
      // Try common role-based prefixes and verify each with Hunter's email verifier
      for (const prefix of GUESS_PREFIXES) {
        const email = `${prefix}@${domain}`;
        const url = `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}&api_key=${HUNTER_KEY}`;
        const result = await httpsGet(url);
        const verdict = result.data?.data?.result;
        console.log('[hunter] email-guess verify:', email, '→', verdict);

        if (result.status === 200 && verdict === 'deliverable') {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              found: true,
              source: 'hunter-guess',
              name: '',
              title: '',
              email,
              linkedin: '',
            }),
          };
        }
      }
      return { statusCode: 200, headers, body: JSON.stringify({ found: false, reason: 'no_verified_email' }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown mode: ' + mode }) };
  } catch (err) {
    console.error('[hunter] error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
