exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'text/xml',
  };

  // Allow custom voicemail URL to be passed as a query param
  const qs = event.queryStringParameters || {};
  const customUrl = qs.url || '';

  let twiml;
  if (customUrl) {
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${customUrl}</Play>
  <Hangup/>
</Response>`;
  } else {
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Hi, this is Lauren from AquaFlow. I'm reaching out because we help businesses like yours cut water and sewer bills by up to 30 percent with no disruption and a lifetime warranty. I'd love to show you how much you could save. Please give me a call back or visit aquaflowsales dot com. Have a great day.</Say>
  <Hangup/>
</Response>`;
  }

  return { statusCode: 200, headers, body: twiml };
};
