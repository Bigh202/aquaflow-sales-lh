const https = require('https');

const DAILY_SEND_LIMIT = 50;
const SEND_DELAY_MS = 2000;

function httpsPost(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function generateEmail(anthropicKey, lead, repName, repPhone, repEmail) {
  const typeAngles = {
    'golf': 'Golf courses use 50M+ gallons/year on irrigation alone',
    'hotel': 'Hotels rank in the top 10 commercial water users in California',
    'restaurant': 'Commercial kitchens, dishwashers, and ice machines run all day',
    'hospital': 'Hospitals average 570 gallons per staffed bed per day',
    'manufacturing': 'Processing plants depend on consistent water pressure and volume',
    'commercial': 'Water costs directly impact NOI and operating expenses',
    'car wash': 'Car washes are among the highest per-location water users',
    'university': 'Campus facilities run 24/7 across multiple buildings',
    'apartment': 'Multi-unit properties pay water bills for every tenant',
    'grocery': 'Produce misting, refrigeration, and cleaning use water constantly'
  };

  const typeKey = Object.keys(typeAngles).find(k => lead.type.toLowerCase().includes(k)) || 'commercial';
  const angle = typeAngles[typeKey];
  const savings = Math.round(lead.size * 0.30);

  const prompt = `You are a B2B sales rep for AquaFlow (aquaflow.com) — a patented water-saving valve that saves businesses 10-30% on water and sewer bills. USA-made, NSF/ANSI certified, installs in under 1 hour, no disruption, no maintenance ever, lifetime warranty, 6-month money-back guarantee.

Write a short cold outreach email to the owner or facilities manager at ${lead.biz}, a ${lead.type} in ${lead.city}.

Key facts:
- Their estimated monthly water bill: $${lead.size.toLocaleString()}/mo
- Potential 30% savings: $${savings.toLocaleString()}/mo ($${Math.round(savings * 12).toLocaleString()}/yr)
- Industry angle: ${angle}

Rules:
- Under 150 words
- No hollow openers ("I hope this finds you well")
- Lead with a sharp industry-specific hook
- Mention the potential dollar savings
- CTA = free no-obligation water audit
- Sign off: ${repName} | AquaFlow — Long Beach/LA | ${repPhone} | ${repEmail}

Format exactly as:
Subject: [subject line]

[email body]`;

  const payload = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }]
  });

  const options = {
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  const result = await httpsPost(options, payload);
  const text = result.body.content.map(i => i.text || '').join('\n');
  const subjectMatch = text.match(/Subject:\s*(.+)/i);
  const body = text.replace(/Subject:\s*.+\n?/i, '').trim();
  return {
    subject: subjectMatch ? subjectMatch[1].trim() : `Cutting water costs at ${lead.biz}`,
    body
  };
}

function encodeB64Url(s) {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function buildRfc2822(to, subject, textBody, htmlBody) {
  const boundary = 'boundary_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    textBody,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    htmlBody,
    '',
    `--${boundary}--`,
  ];
  return lines.join('\r\n');
}

async function sendViaGmail(gmailToken, to, subject, body, trackingId) {
  const trackingPixel = trackingId
    ? `<img src="https://aquaflowsales.com/.netlify/functions/email-track?id=${trackingId}" width="1" height="1" style="display:none" alt="">`
    : '';
  const htmlBody = body.split('\n').map(l => l ? `<p style="margin:0 0 12px;font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#333">${l}</p>` : '<br>').join('') + trackingPixel;
  const raw = encodeB64Url(buildRfc2822(to, subject, body, htmlBody));

  const bodyStr = JSON.stringify({ raw });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'gmail.googleapis.com',
      path: '/gmail/v1/users/me/messages/send',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${gmailToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch (e) { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
  const gmailToken = authHeader.replace(/^Bearer\s+/i, '');
  if (!gmailToken) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Connect Gmail first in the Email tab' }) };
  }

  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
  if (!ANTHROPIC_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: 'ANTHROPIC_KEY not set' }) };

  let leads, repName, repPhone, repEmail;
  try {
    ({ leads, repName, repPhone, repEmail } = JSON.parse(event.body));
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  if (!leads || !leads.length) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'leads array required' }) };
  }

  // Enforce daily Gmail send limit
  const capped = leads.slice(0, DAILY_SEND_LIMIT);
  const skipped = leads.length - capped.length;

  const results = [];

  for (const lead of capped) {
    try {
      const { subject, body } = await generateEmail(ANTHROPIC_KEY, lead, repName || 'Lauren Hatwan', repPhone || '', repEmail || '');
      const trackingId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      const sendResult = await sendViaGmail(gmailToken, lead.email, subject, body, trackingId);
      if (sendResult.status === 200 || sendResult.status === 202) {
        results.push({ leadId: lead.id, success: true, subject, trackingId });
      } else {
        const errMsg = sendResult.body?.error?.message || 'Send failed';
        results.push({ leadId: lead.id, success: false, error: errMsg });
      }
    } catch (e) {
      results.push({ leadId: lead.id, success: false, error: e.message });
    }

    // Rate limit: 1 email per 2 seconds to avoid Gmail throttling
    if (capped.indexOf(lead) < capped.length - 1) {
      await sleep(SEND_DELAY_MS);
    }
  }

  const sent   = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ sent, failed, skipped, results }),
  };
};
