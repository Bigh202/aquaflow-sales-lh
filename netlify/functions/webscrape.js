const https = require('https');
const http = require('http');
const { URL } = require('url');

function fetchUrl(urlStr, timeoutMs = 10000, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('Too many redirects'));
    let parsed;
    try { parsed = new URL(urlStr); } catch (e) { return reject(new Error('Invalid URL')); }
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.get(urlStr, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        req.destroy();
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, urlStr).href;
        return fetchUrl(next, timeoutMs, depth + 1).then(resolve).catch(reject);
      }
      if (res.statusCode < 200 || res.statusCode >= 400) {
        req.destroy();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      let html = '';
      res.setEncoding('utf8');
      res.on('data', c => { html += c; if (html.length > 300000) req.destroy(); });
      res.on('end', () => resolve(html));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function isCloudflareEmail(s) {
  return s.includes('cdn-cgi') || s.includes('email-protection') || s.includes('cloudflare');
}

// Extract real emails directly from raw HTML before tag stripping
function extractEmailsFromHtml(html) {
  const emails = new Set();

  // mailto: links
  const mailtoRe = /mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi;
  let m;
  while ((m = mailtoRe.exec(html)) !== null) {
    if (!isCloudflareEmail(m[1])) emails.add(m[1].toLowerCase());
  }

  // JSON-LD structured data (business sites often embed real contact info here)
  const jsonLdRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  while ((m = jsonLdRe.exec(html)) !== null) {
    try {
      const text = JSON.stringify(JSON.parse(m[1]));
      const emailRe = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
      let em;
      while ((em = emailRe.exec(text)) !== null) {
        if (!isCloudflareEmail(em[0])) emails.add(em[0].toLowerCase());
      }
    } catch (e) { /* invalid JSON-LD */ }
  }

  return [...emails];
}

// Decode common email obfuscation patterns in plain text
function decodeObfuscation(text) {
  return text
    .replace(/\s*\[at\]\s*/gi, '@')
    .replace(/\s*\(at\)\s*/gi, '@')
    .replace(/(?<!\w)AT(?!\w)/g, '@')
    .replace(/\s*\[dot\]\s*/gi, '.')
    .replace(/\s*\(dot\)\s*/gi, '.')
    .replace(/(?<!\w)DOT(?!\w)/g, '.');
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function extractSubpageLinks(html, baseUrl) {
  const keywords = ['about', 'team', 'staff', 'contact', 'management', 'leadership', 'directory', 'people', 'our-team', 'meet-the-team', 'meet-us'];
  const links = [];
  const hrefRe = /href=["']([^"'#?][^"']*?)["']/gi;
  let match;
  while ((match = hrefRe.exec(html)) !== null) {
    const href = match[1];
    if (!keywords.some(k => href.toLowerCase().includes(k))) continue;
    try {
      const full = href.startsWith('http') ? href : new URL(href, baseUrl).href;
      const base = new URL(baseUrl);
      const candidate = new URL(full);
      if (candidate.hostname === base.hostname && !links.includes(full)) {
        links.push(full);
      }
    } catch (e) { /* skip malformed */ }
  }
  return links.slice(0, 3);
}

// Generate common email pattern guesses from a person's name and domain
function guessEmails(name, domain) {
  if (!name || !domain) return [];
  const parts = name.toLowerCase().replace(/[^a-z\s]/g, '').trim().split(/\s+/);
  if (parts.length === 0) return [];
  const first = parts[0];
  const last = parts.length > 1 ? parts[parts.length - 1] : '';
  if (!last) return [`${first}@${domain}`];
  return [
    `${first}@${domain}`,
    `${first}.${last}@${domain}`,
    `${first}${last}@${domain}`,
    `${first[0]}${last}@${domain}`,
  ];
}

function callClaude(apiKey, text, bizName, bizType, targetName, knownEmails) {
  return new Promise((resolve, reject) => {
    let content = `Extract the most relevant decision maker contact from this ${bizType} business website content. Search aggressively for names: check signature blocks, contact forms, about pages, team pages, "Contact [Name]" patterns, email signatures, staff directories, and anywhere a person is mentioned with a title. Look for these roles in priority order: General Manager, Facilities Manager, Director of Operations, Property Manager, Owner, President, Director of Engineering, VP Operations, Plant Manager, Operations Manager, Chief Engineer. Return ONLY a JSON object: {name, title, email, phone}. Rules: if a name is found anywhere on the page paired with a relevant title, use it. If no name is found but a relevant title exists, return that title as the name field (e.g. name: "General Manager"). Only return {found: false} if absolutely no relevant role or person is present. If a field value is unknown use null. IMPORTANT: If you see any email containing "cdn-cgi" or "email-protection", that is Cloudflare-protected and NOT a real email address — ignore it and return null for email.`;
    if (targetName) {
      content += ` The person we are looking for is "${targetName}". Focus specifically on finding their email address.`;
    }
    if (knownEmails && knownEmails.length > 0) {
      content += ` These real email addresses were extracted directly from the page HTML: ${knownEmails.join(', ')}. Prefer these over anything else if they belong to the decision maker.`;
    }
    content += ` Business: ${bizName}. Content: ${text}`;

    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{ role: 'user', content }],
    });
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { reject(new Error('Claude parse error: ' + e.message)); }
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

  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
  if (!ANTHROPIC_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: 'ANTHROPIC_KEY not set' }) };

  let website, bizName, bizType, targetName;
  try { ({ website, bizName, bizType, targetName } = JSON.parse(event.body)); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }

  if (!website) return { statusCode: 200, headers, body: JSON.stringify({ found: false, reason: 'No website URL provided' }) };

  let baseUrl = website.trim();
  if (!/^https?:\/\//i.test(baseUrl)) baseUrl = 'https://' + baseUrl;

  try {
    // Step 1: Fetch homepage
    let homepageHtml;
    try { homepageHtml = await fetchUrl(baseUrl); }
    catch (e) { return { statusCode: 200, headers, body: JSON.stringify({ found: false, reason: 'Could not fetch website: ' + e.message }) }; }

    // Extract real emails from raw HTML before stripping tags
    const knownEmails = extractEmailsFromHtml(homepageHtml);

    const homepageText = decodeObfuscation(stripHtml(homepageHtml)).slice(0, 5000);

    // Step 2: Find and fetch relevant subpages
    const subpageUrls = extractSubpageLinks(homepageHtml, baseUrl);
    const subpageTexts = [];
    for (const url of subpageUrls) {
      try {
        const html = await fetchUrl(url, 8000);
        knownEmails.push(...extractEmailsFromHtml(html).filter(e => !knownEmails.includes(e)));
        subpageTexts.push(decodeObfuscation(stripHtml(html)));
      } catch (e) { /* skip failed subpages */ }
    }

    // Combine all text, limit to 8000 chars total
    const combined = [homepageText, ...subpageTexts].join('\n\n').slice(0, 8000);

    // Step 3: Send to Claude for extraction
    const { status, data: claudeData } = await callClaude(ANTHROPIC_KEY, combined, bizName || '', bizType || '', targetName || null, knownEmails);
    if (status !== 200) {
      return { statusCode: 200, headers, body: JSON.stringify({ found: false, reason: 'Claude API error: HTTP ' + status }) };
    }

    const responseText = claudeData.content?.[0]?.text || '';
    let extracted;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      extracted = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(responseText);
    } catch (e) {
      return { statusCode: 200, headers, body: JSON.stringify({ found: false, reason: 'Could not parse Claude response' }) };
    }

    if (extracted.found === false) {
      return { statusCode: 200, headers, body: JSON.stringify({ found: false, reason: 'No decision maker found on website' }) };
    }

    // Sanitize email — reject Cloudflare-protected values
    let email = extracted.email || null;
    if (email && isCloudflareEmail(email)) email = null;

    // If Claude still found no email, try guessing from known domain + name
    if (!email && extracted.name) {
      try {
        const domain = new URL(baseUrl).hostname.replace(/^www\./, '');
        const guesses = guessEmails(extracted.name, domain);
        // Include guesses in notes so Lauren can verify — don't auto-assign
        if (guesses.length > 0) {
          extracted.emailGuesses = guesses;
        }
      } catch (e) { /* skip */ }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        found: true,
        name: extracted.name || null,
        title: extracted.title || null,
        email,
        phone: extracted.phone || null,
        emailGuesses: extracted.emailGuesses || null,
        source: 'Website',
      }),
    };
  } catch (e) {
    return { statusCode: 200, headers, body: JSON.stringify({ found: false, reason: e.message }) };
  }
};
