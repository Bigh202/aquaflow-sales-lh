const { getStore } = (() => {
  try { return require('@netlify/blobs'); } catch (e) { return { getStore: null }; }
})();

// 1x1 transparent GIF
const PIXEL_B64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

exports.handler = async (event) => {
  const pixelHeaders = {
    'Content-Type': 'image/gif',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Access-Control-Allow-Origin': '*',
  };

  const qs = event.queryStringParameters || {};
  const trackingId = qs.id || '';

  if (trackingId && getStore) {
    try {
      const store = getStore('email-opens');
      const existing = await store.get(trackingId, { type: 'json' }).catch(() => null);
      const count = (existing && existing.count) || 0;
      await store.setJSON(trackingId, {
        openedAt: existing && existing.openedAt ? existing.openedAt : new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
        count: count + 1,
        userAgent: event.headers['user-agent'] || '',
        ip: event.headers['x-forwarded-for'] || event.headers['client-ip'] || '',
      });
    } catch (e) {
      // Blobs unavailable — degrade gracefully, still return pixel
    }
  }

  return {
    statusCode: 200,
    headers: pixelHeaders,
    body: PIXEL_B64,
    isBase64Encoded: true,
  };
};
