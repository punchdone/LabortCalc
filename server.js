require('dotenv').config();
const express = require('express');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

function httpsGet(url, headers, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, statusText: res.statusMessage, text: body }));
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
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

    const records = Array.isArray(data) ? data : Array.isArray(data?.Items) ? data.Items : null;
    if (!records) {
      return res.status(500).json({ error: 'Unexpected API response shape', keys: Object.keys(data) });
    }

    const cutoff = new Date('2026-03-01');
    const filtered = records.filter(p => p.CreatedOn && new Date(p.CreatedOn) > cutoff);

    console.log(`Innergy projects fetched successfully: ${Array.isArray(filtered) ? filtered.length : 'N/A'} project(s)`);
    res.json(filtered);
  } catch (err) {
    console.error('Request error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/workorders/:projectId', async (req, res) => {
  const { projectId } = req.params;
  const url = `https://app.innergy.com/api/projects/${encodeURIComponent(projectId)}/workOrders`;
  console.log('Fetching:', url);

  try {
    const response = await httpsGet(url, {
      'API-Key': process.env.INNERGY_API_KEY,
      'Accept': 'application/json'
    });

    console.log('Work orders status:', response.status, response.statusText);

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

    const records = Array.isArray(data) ? data : Array.isArray(data?.Items) ? data.Items : [];
    console.log(`Work orders for project ${projectId}: ${records.length}`);
    res.json(records);
  } catch (err) {
    console.error('Work orders request error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`LabortCalc running at http://localhost:${PORT}`);
});
