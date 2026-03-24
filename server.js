require('dotenv').config();
const express = require('express');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, statusText: res.statusMessage, text: body }));
    });
    req.on('error', reject);
  });
}

app.get('/api/projects', async (req, res) => {
  const url = 'https://app.innergy.com/api/projects';
  console.log('Fetching:', url);

  try {
    const response = await httpsGet(url, {
      'API-Key': process.env.INNERGY_API_KEY,
      'Accept': 'application/json'
    });

    console.log('Status:', response.status, response.statusText);
    console.log('Raw response:', response.text.slice(0, 500));

    if (response.status < 200 || response.status >= 300) {
      return res.status(response.status).json({
        error: `Innergy API error: ${response.status} ${response.statusText}`,
        body: response.text
      });
    }

    let data;
    try {
      data = JSON.parse(response.text);
    } catch {
      return res.status(500).json({ error: 'Response is not JSON', body: response.text });
    }

    res.json(data);
  } catch (err) {
    console.error('Request error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`LabortCalc running at http://localhost:${PORT}`);
});
