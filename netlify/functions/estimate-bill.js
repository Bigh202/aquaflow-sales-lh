const https = require('https');

function callClaude(apiKey, prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
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

// Fallback lookup table matching the existing estBill() function
function fallbackEstimate(bizType) {
  const m = {
    'golf': 5500, 'hotel': 10000, 'resort': 10000, 'restaurant': 4500,
    'commercial': 12000, 'car wash': 3500, 'laundromat': 2800,
    'manufacturing': 25000, 'plant': 25000, 'hospital': 18000,
    'university': 15000, 'stadium': 8000, 'grocery': 7000, 'apartment': 9000,
  };
  const t = (bizType || '').toLowerCase();
  for (const [k, v] of Object.entries(m)) {
    if (t.includes(k)) {
      const mid = Math.round(v * (0.85 + Math.random() * 0.3));
      return { estimatedMonthlyBill: mid, lowEstimate: Math.round(mid * 0.7), highEstimate: Math.round(mid * 1.4), reasoning: 'Estimated based on typical usage for this business type.', confidence: 'low' };
    }
  }
  const mid = Math.round(4000 * (0.85 + Math.random() * 0.3));
  return { estimatedMonthlyBill: mid, lowEstimate: Math.round(mid * 0.7), highEstimate: Math.round(mid * 1.4), reasoning: 'General commercial estimate.', confidence: 'low' };
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
  if (!ANTHROPIC_KEY) {
    // Fall back gracefully
    let parsed = {};
    try { parsed = JSON.parse(event.body || '{}'); } catch (e) {}
    return { statusCode: 200, headers, body: JSON.stringify(fallbackEstimate(parsed.bizType || '')) };
  }

  let bizName, bizType, city, employeeCount, squareFootage;
  try { ({ bizName, bizType, city, employeeCount, squareFootage } = JSON.parse(event.body || '{}')); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const prompt = `You are a water utility expert. Estimate the monthly water and sewer bill for this business:
Business: ${bizName || 'Unknown'}
Type: ${bizType || 'Commercial'}
Location: ${city || 'Southern California'}
Employees: ${employeeCount || 'unknown'}
Square footage: ${squareFootage || 'unknown'}

Consider: local water rates (CA average $0.008/gallon commercial), typical usage for this business type, size indicators from the business name, seasonal factors for Southern California.
Return ONLY a JSON object (no markdown, no explanation outside the JSON):
{"estimatedMonthlyBill":number,"lowEstimate":number,"highEstimate":number,"reasoning":"one sentence","confidence":"low"|"medium"|"high"}`;

  try {
    const claudeData = await callClaude(ANTHROPIC_KEY, prompt);
    const text = claudeData.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');
    const result = JSON.parse(match[0]);
    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (e) {
    return { statusCode: 200, headers, body: JSON.stringify(fallbackEstimate(bizType || '')) };
  }
};
