const https = require('https');

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const API_KEY = process.env.GOOGLE_MAPS_KEY;
  if (!API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'GOOGLE_MAPS_KEY not set' }) };
  }

  const { action, query, placeid, lat, lng, radius, type } = event.queryStringParameters || {};

  try {
    let url;
    if (action === 'geocode') {
      if (placeid) {
        url = `https://maps.googleapis.com/maps/api/geocode/json?place_id=${encodeURIComponent(placeid)}&key=${API_KEY}`;
      } else {
        url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${API_KEY}`;
      }
    } else if (action === 'autocomplete') {
      url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&types=(cities)&key=${API_KEY}`;
    } else if (action === 'nearby') {
      url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&keyword=${encodeURIComponent(type)}&key=${API_KEY}`;
    } else if (action === 'details') {
      url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${query}&fields=name,formatted_phone_number,formatted_address,website,rating&key=${API_KEY}`;
    } else {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };
    }

    const data = await httpsGet(url);
    return { statusCode: 200, headers, body: JSON.stringify(data) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
