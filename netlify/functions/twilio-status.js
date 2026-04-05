exports.handler = async (event) => {
  // Parse form-encoded status callback from Twilio
  const params = {};
  if (event.body) {
    new URLSearchParams(event.body).forEach((v, k) => { params[k] = v; });
  }

  console.log(JSON.stringify({
    event: 'twilio.status',
    callSid: params.CallSid,
    status: params.CallStatus,
    duration: params.CallDuration,
    recordingUrl: params.RecordingUrl,
    to: params.To,
    from: params.From,
    direction: params.Direction,
    timestamp: new Date().toISOString(),
  }));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/xml' },
    body: '<Response/>',
  };
};
