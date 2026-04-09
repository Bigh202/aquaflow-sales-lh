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

  let bizName, bizType, city, website;
  try { ({ bizName, bizType, city, website } = JSON.parse(event.body || '{}')); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const prompt = `You are a water efficiency sales intelligence expert. For this business:
${bizName} - ${bizType} in ${city}
Website: ${website || 'unknown'}

Based on your knowledge provide:
1. Are businesses of this type typically already using water efficiency solutions?
2. What water conservation challenges are specific to ${bizType}?
3. What objections might the facilities manager raise?
4. What is the strongest opening angle for selling water-saving valves to this type of business?
5. Any known water efficiency programs in ${city} they might already be enrolled in?

Return ONLY a JSON object (no markdown):
{"likelyHasCompetitor":boolean,"competitorNotes":"string","keyChallenge":"string","topObjection":"string","bestAngle":"string","localPrograms":"string"}`;

  try {
    const claudeData = await callClaude(ANTHROPIC_KEY, prompt);
    const text = claudeData.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');
    const result = JSON.parse(match[0]);
    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
