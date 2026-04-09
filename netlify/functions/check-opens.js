const { getStore } = (() => {
  try { return require('@netlify/blobs'); } catch (e) { return { getStore: null }; }
})();

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const qs = event.queryStringParameters || {};
  const ids = (qs.ids || '').split(',').map(s => s.trim()).filter(Boolean);

  if (!ids.length) return { statusCode: 200, headers, body: JSON.stringify({}) };

  if (!getStore) {
    // Blobs not available — return all as unopened
    const result = {};
    ids.forEach(id => { result[id] = { opened: false, openedAt: null, count: 0 }; });
    return { statusCode: 200, headers, body: JSON.stringify(result) };
  }

  const store = getStore('email-opens');
  const result = {};

  await Promise.all(ids.map(async (id) => {
    try {
      const data = await store.get(id, { type: 'json' }).catch(() => null);
      if (data && data.count > 0) {
        result[id] = { opened: true, openedAt: data.openedAt, lastOpenedAt: data.lastOpenedAt, count: data.count };
      } else {
        result[id] = { opened: false, openedAt: null, count: 0 };
      }
    } catch (e) {
      result[id] = { opened: false, openedAt: null, count: 0 };
    }
  }));

  return { statusCode: 200, headers, body: JSON.stringify(result) };
};
