const twilio = require('twilio');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const TWILIO_ACCOUNT_SID   = process.env.TWILIO_ACCOUNT_SID;
  const TWILIO_API_KEY       = process.env.TWILIO_API_KEY;
  const TWILIO_API_SECRET    = process.env.TWILIO_API_SECRET;
  const TWILIO_TWIML_APP_SID = process.env.TWILIO_TWIML_APP_SID;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_API_KEY || !TWILIO_API_SECRET || !TWILIO_TWIML_APP_SID) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing Twilio env vars' }) };
  }

  try {
    const AccessToken = twilio.jwt.AccessToken;
    const VoiceGrant  = AccessToken.VoiceGrant;

    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: TWILIO_TWIML_APP_SID,
      incomingAllow: true,
    });

    const token = new AccessToken(TWILIO_ACCOUNT_SID, TWILIO_API_KEY, TWILIO_API_SECRET, {
      identity: 'aquaflow-sales',
      ttl: 3600,
    });
    token.addGrant(voiceGrant);

    return { statusCode: 200, headers, body: JSON.stringify({ token: token.toJwt() }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
