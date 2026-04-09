const https = require('https');

function callClaude(apiKey, prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
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

  let lead;
  try { ({ lead } = JSON.parse(event.body || '{}')); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  if (!lead) return { statusCode: 400, headers, body: JSON.stringify({ error: 'lead object required' }) };

  const size = lead.size || 5000;
  const s10 = Math.round(size * 0.1);
  const s20 = Math.round(size * 0.2);
  const s30 = Math.round(size * 0.3);

  const prompt = `Generate a professional water savings proposal for:
Business: ${lead.biz || 'Your Business'}
Contact: ${lead.contact || 'Decision Maker'}, ${lead.title || 'Facilities Manager'}
Monthly water bill: $${size}/mo
Projected savings at 10%: $${s10}/mo ($${s10 * 12}/yr)
Projected savings at 20%: $${s20}/mo ($${s20 * 12}/yr)
Projected savings at 30%: $${s30}/mo ($${s30 * 12}/yr)
Business type: ${lead.type || 'Commercial'}
Location: ${lead.city || 'Southern California'}

Write professional proposal sections:
1. Executive Summary (2 paragraphs, specific to this business type)
2. Current Situation (1 paragraph about their water usage challenges)
3. Proposed Solution (AquaFlow valve description, installation process, warranty)
4. Financial Analysis (savings narrative, ROI, payback period estimate)
5. Why AquaFlow (3 bullet points: NSF certified, lifetime warranty, 6-month money back)
6. Next Steps (audit process, timeline, what to expect)

Return ONLY a JSON object (no markdown, no code blocks):
{"executiveSummary":"string","currentSituation":"string","proposedSolution":"string","financialAnalysis":"string","whyAquaFlow":"string","nextSteps":"string"}`;

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
