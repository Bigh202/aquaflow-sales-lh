const https = require('https');

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

async function sendEmail(resendKey, fromEmail, fromName, to, subject, body) {
  const emailPayload = JSON.stringify({
    from: `${fromName} <${fromEmail}>`,
    to: [to],
    subject,
    text: body,
    html: body.split('\n').map(l => l ? `<p style="margin:0 0 12px;font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#333">${l}</p>` : '<br>').join('')
  });

  const options = {
    hostn