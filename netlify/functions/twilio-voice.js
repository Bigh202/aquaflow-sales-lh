const twilio = require('twilio');
const VoiceResponse = twilio.twiml.VoiceResponse;

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'text/xml' };

  const TWILIO_CALLER_ID = process.env.TWILIO_CALLER_ID;
  if (!TWILIO_CALLER_ID) {
    const twiml = new VoiceResponse();
    twiml.say('Configuration error: caller ID not set.');
    return { statusCode: 200, headers, body: twiml.toString() };
  }

  // Parse form-encoded body from Twilio
  const params = {};
  if (event.body) {
    new URLSearchParams(event.body).forEach((v, k) => { params[k] = v; });
  }

  const to = params.To;
  if (!to) {
    const twiml = new VoiceResponse();
    twiml.say('No destination number provided.');
    return { statusCode: 200, headers, body: twiml.toString() };
  }

  const twiml = new VoiceResponse();
  const dial = twiml.dial({ callerId: TWILIO_CALLER_ID, record: 'record-from-answer-dual' });
  dial.number(to);

  console.log(JSON.stringify({ event: 'twilio.voice', to, from: TWILIO_CALLER_ID, timestamp: new Date().toISOString() }));

  return { statusCode: 200, headers, body: twiml.toString() };
};
