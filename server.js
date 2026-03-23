require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

app.get('/api/projects', async (req, res) => {
  try {
    const response = await fetch(`${process.env.INNERGY_BASE_URL}/projects`, {
      headers: {
        'API-Key': process.env.INNERGY_API_KEY,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Innergy API error: ${response.statusText}` });
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`LabortCalc running at http://localhost:${PORT}`);
});
