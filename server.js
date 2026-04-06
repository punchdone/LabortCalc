require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const https = require('https');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- MongoDB ---
if (!process.env.MONGODB_URI) {
  console.error('ERROR: MONGODB_URI is not set. Check your .env file.');
  process.exit(1);
}
mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err.message));

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true }
});
const User = mongoose.model('User', userSchema);

const activityDriverSchema = new mongoose.Schema({
  workCenter:     { type: String, required: true, trim: true },
  activityDriver: { type: String, required: true, trim: true },
  quantity:       { type: Number, required: true }
}, { timestamps: true });
const ActivityDriver = mongoose.model('ActivityDriver', activityDriverSchema);

// --- Middleware ---
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-me-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 8 * 60 * 60 * 1000 } // 8 hours
}));

function requireAuth(req, res, next) {
  if (req.session.user) return next();
  if (req.accepts('html')) return res.redirect('/login.html');
  res.status(401).json({ error: 'Unauthorized' });
}

// Login route
app.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'Database unavailable. Check server logs.' });
    }
    const user = await User.findOne({ username: username.toLowerCase().trim() });
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    req.session.user = { username: user.username };
    res.json({ ok: true });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

// Logout
app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login.html'));
});

// Public files (login page, assets)
app.use(express.static('public', { index: false }));

// Landing page
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// LaborCalc app
app.get('/laborcalc', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Activity Drivers page
app.get('/activity-drivers', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'activity-drivers.html'));
});

// Activity Drivers API
app.get('/api/activity-drivers', async (req, res) => {
  try {
    const records = await ActivityDriver.find().sort({ workCenter: 1, activityDriver: 1 });
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/activity-drivers', async (req, res) => {
  const { workCenter, activityDriver, quantity } = req.body;
  if (!workCenter || !activityDriver || quantity === undefined) {
    return res.status(400).json({ error: 'workCenter, activityDriver, and quantity are required.' });
  }
  try {
    const record = await ActivityDriver.create({ workCenter, activityDriver, quantity: Number(quantity) });
    res.status(201).json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/activity-drivers/:id', async (req, res) => {
  try {
    await ActivityDriver.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Protect all API routes
app.use('/api', requireAuth);

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

    const cutoff = new Date('2025-01-01');
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

app.get('/api/shipmentitems/:workOrderId', async (req, res) => {
  const { workOrderId } = req.params;
  const base = `https://app.innergy.com/api/v2-unstable/project-management/work-orders/${encodeURIComponent(workOrderId)}/shipment-items`;

  try {
    const allRecords = [];
    let skip = 0;
    const take = 500;

    while (true) {
      const url = `${base}?take=${take}&skip=${skip}`;
      console.log('Fetching:', url);

      const response = await httpsGet(url, {
        'API-Key': process.env.INNERGY_API_KEY,
        'Accept': 'application/json'
      }, 30000);

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

      const pageRecords = Array.isArray(data) ? data
        : Array.isArray(data?.data) ? data.data
        : Array.isArray(data?.Items) ? data.Items : [];

      allRecords.push(...pageRecords);

      const totalCount = data?.totalCount ?? pageRecords.length;
      console.log(`Shipment items skip=${skip}: got ${pageRecords.length}, total ${totalCount}`);

      if (allRecords.length >= totalCount || pageRecords.length === 0) break;
      skip += take;
    }

    allRecords.sort((a, b) => parseInt(a.EngineeringId, 10) - parseInt(b.EngineeringId, 10));
    console.log(`Shipment items for work order ${workOrderId}: ${allRecords.length} total`);
    const slim = allRecords.map(r => ({
      Name: r.Name || r.ItemName || r.name,
      Quantity: Math.round((r.Quantity ?? r.Qty ?? r.quantity ?? r.qty) * 1000) / 1000,
      Description: r.Description || r.description,
      QuantityCompleted: Math.round((r.QuantityCompleted ?? 0) * 1000) / 1000
    }));
    res.json(slim);
  } catch (err) {
    console.error('Shipment items request error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`LabortCalc running at http://localhost:${PORT}`);
});
