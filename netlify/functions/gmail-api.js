const https = require('https');

function gmailReq(token, method, path, bodyObj) {
  return new Promise((resolve, reject) => {
    const reqHeaders = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    };
    let bodyStr = null;
    if (bodyObj) {
      bodyStr = JSON.stringify(bodyObj);
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr);
    }
    const req = https.request({ hostname: 'gmail.googleapis.com', path, method, headers: reqHeaders }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
        catch (e) { reject(new Error('Parse error')); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function googlePost(path, params) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(d) }); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function decodeB64Url(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}
function encodeB64Url(s) {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function getHeader(hdrs, name) {
  const h = (hdrs || []).find(h => h.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

function extractBody(payload) {
  if (!payload) return '';
  if (payload.body && payload.body.data) return decodeB64Url(payload.body.data);
  if (payload.parts) {
    const html = payload.parts.find(p => p.mimeType === 'text/html');
    if (html && html.body && html.body.data) return decodeB64Url(html.body.data);
    const txt = payload.parts.find(p => p.mimeType === 'text/plain');
    if (txt && txt.body && txt.body.data) return decodeB64Url(txt.body.data);
    for (const p of payload.parts) {
      const nested = extractBody(p);
      if (nested) return nested;
    }
  }
  return '';
}

function buildRfc2822(from, to, subject, body, inReplyTo, references) {
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
  ];
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);
  lines.push('', body);
  return lines.join('\r\n');
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'No token provided' }) };

  const qs = event.queryStringParameters || {};
  const action = qs.action || '';

  try {
    // REFRESH
    if (action === 'refresh') {
      const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
      const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
      let refreshToken;
      try { ({ refreshToken } = JSON.parse(event.body || '{}')); } catch (e) {}
      if (!refreshToken) return { statusCode: 400, headers, body: JSON.stringify({ error: 'refreshToken required' }) };
      const { status, data } = await googlePost('/token', {
        client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
        refresh_token: refreshToken, grant_type: 'refresh_token',
      });
      if (data.error) return { statusCode: 200, headers, body: JSON.stringify({ error: data.error_description || data.error }) };
      return { statusCode: 200, headers, body: JSON.stringify({ access_token: data.access_token, expiry: Date.now() + data.expires_in * 1000 }) };
    }

    // INBOX, SENT, STARRED, or DRAFTS list
    if (action === 'inbox' || action === 'sent' || action === 'starred' || action === 'drafts') {
      const labelMap = { inbox: 'INBOX', sent: 'SENT', starred: 'STARRED', drafts: 'DRAFT' };
      const label = labelMap[action];
      const listRes = await gmailReq(token, 'GET', `/gmail/v1/users/me/messages?labelIds=${label}&maxResults=20`);
      if (listRes.status !== 200) return { statusCode: 200, headers, body: JSON.stringify({ messages: [], error: 'Gmail API error' }) };
      const msgs = listRes.data.messages || [];
      const details = await Promise.all(msgs.slice(0, 20).map(async m => {
        try {
          const r = await gmailReq(token, 'GET',
            `/gmail/v1/users/me/messages/${m.id}?format=metadata` +
            `&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`);
          if (r.status !== 200) return null;
          const msg = r.data;
          const hdrs = msg.payload && msg.payload.headers || [];
          return {
            id: msg.id,
            threadId: msg.threadId,
            from: getHeader(hdrs, 'from'),
            to: getHeader(hdrs, 'to'),
            subject: getHeader(hdrs, 'subject') || '(no subject)',
            date: getHeader(hdrs, 'date'),
            snippet: msg.snippet || '',
            isRead: !(msg.labelIds && msg.labelIds.includes('UNREAD')),
          };
        } catch (e) { return null; }
      }));
      return { statusCode: 200, headers, body: JSON.stringify({ messages: details.filter(Boolean) }) };
    }

    // READ single message
    if (action === 'read') {
      const id = qs.id;
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id required' }) };
      const r = await gmailReq(token, 'GET', `/gmail/v1/users/me/messages/${id}?format=full`);
      if (r.status !== 200) return { statusCode: 200, headers, body: JSON.stringify({ error: 'Message not found' }) };
      const msg = r.data;
      const hdrs = msg.payload && msg.payload.headers || [];
      const body = extractBody(msg.payload);
      // Mark as read silently
      gmailReq(token, 'POST', `/gmail/v1/users/me/messages/${id}/modify`, { removeLabelIds: ['UNREAD'] }).catch(() => {});
      return {
        statusCode: 200, headers, body: JSON.stringify({
          id: msg.id,
          threadId: msg.threadId,
          from: getHeader(hdrs, 'from'),
          to: getHeader(hdrs, 'to'),
          subject: getHeader(hdrs, 'subject') || '(no subject)',
          date: getHeader(hdrs, 'date'),
          body,
          isHtml: body.includes('<') && body.includes('>'),
          messageId: getHeader(hdrs, 'message-id'),
          references: getHeader(hdrs, 'references'),
        }),
      };
    }

    // SEND or REPLY
    if (action === 'send' || action === 'reply') {
      let parsed = {};
      try { parsed = JSON.parse(event.body || '{}'); } catch (e) {}
      const { to, subject, body: msgBody, from, threadId, inReplyTo, references } = parsed;
      if (!to || !subject || !msgBody) return { statusCode: 400, headers, body: JSON.stringify({ error: 'to, subject, body required' }) };
      const raw = buildRfc2822(from || 'me', to, subject, msgBody, inReplyTo, references);
      const payload = { raw: encodeB64Url(raw) };
      if (threadId) payload.threadId = threadId;
      const r = await gmailReq(token, 'POST', '/gmail/v1/users/me/messages/send', payload);
      if (r.status !== 200 && r.status !== 202) return { statusCode: 200, headers, body: JSON.stringify({ error: 'Send failed', detail: r.data }) };
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, id: r.data.id }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown action: ${action}` }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
