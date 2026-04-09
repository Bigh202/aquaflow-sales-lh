const https = require('https');

function callClaude(apiKey, prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
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
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Parse error')); }
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

  let bizName, bizType, city;
  try { ({ bizName, bizType, city } = JSON.parse(event.body || '{}')); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const prompt = `You are a B2B sales researcher. For ${bizName} in ${city} which is a ${bizType}:

Generate 3 realistic and relevant recent business developments or industry trends that a sales rep could reference in outreach. These should be plausible for this type of business in this location in 2026.
Focus on: expansion plans, new management, sustainability initiatives, rate increases, regulatory changes, seasonal factors.

Return ONLY a JSON array of exactly 3 items (no markdown):
[{"headline":"string","relevance":"Expansion"|"Sustainability"|"Regulatory"|"Seasonal"|"Cost Pressure","talkingPoint":"string starting with I noticed that... or Given that..."}]`;

  try {
    const claudeData = await callClaude(ANTHROPIC_KEY, prompt);
    const text = claudeData.content?.[0]?.text || '';
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('No JSON array in response');
    const result = JSON.parse(match[0]);
    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
