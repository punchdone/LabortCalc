require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

app.get('/api/projects', async (req, res) => {
  const url = `${process.env.INNERGY_BASE_URL}/projects`;
  console.log('Fetching:', url);

  try {
    const response = await fetch(url, {
      headers: {
        'API-Key': process.env.INNERGY_API_KEY,
        'Accept': 'application/json'
      }
    });

    console.log('Status:', response.status, response.statusText);
    const text = await response.text();
    console.log('Raw response:', text.slice(0, 500));

    if (!response.ok) {
      return res.status(response.status).json({
        error: `Innergy API error: ${response.status} ${response.statusText}`,
        body: text
      });
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(500).json({ error: 'Response is not JSON', body: text });
    }

    res.json(data);
  } catch (err) {
    console.error('Fetch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`LabortCalc running at http://localhost:${PORT}`);
});
