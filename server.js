require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const https = require('https');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- MongoDB (optional — falls back to users.json if unavailable) ---
let mongoReady = false;
if (process.env.MONGODB_URI) {
  mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
    .then(() => { mongoReady = true; console.log('MongoDB connected'); })
    .catch(err => console.error('MongoDB connection error (falling back to users.json):', err.message));
} else {
  console.warn('MONGODB_URI not set — using users.json for auth');
}

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  role:     { type: String, enum: ['admin', 'user'], default: 'user' },
  status:   { type: String, enum: ['pending', 'approved'], default: 'pending' }
}, { timestamps: true });
const User = mongoose.model('User', userSchema);

const activityDriverSchema = new mongoose.Schema({
  workCenter:     { type: String, required: true, trim: true },
  activityDriver: { type: String, required: true, trim: true },
  qualifier:      { type: String, trim: true },
  quantity:       { type: Number, required: true }
}, { timestamps: true });
const ActivityDriver = mongoose.model('ActivityDriver', activityDriverSchema);

const workCenterSchema = new mongoose.Schema({
  code:  { type: String, required: true, unique: true, trim: true, match: /^\d{3}$/ },
  title: { type: String, required: true, trim: true }
}, { timestamps: true });
const WorkCenter = mongoose.model('WorkCenter', workCenterSchema);

const productTypeSchema = new mongoose.Schema({
  code:        { type: String, required: true, unique: true, trim: true, match: /^\d{2}$/ },
  description: { type: String, required: true, trim: true }
}, { timestamps: true });
const ProductType = mongoose.model('ProductType', productTypeSchema);

const catalogueSchema = new mongoose.Schema({
  configuration: { type: String, required: true, trim: true },
  description:   { type: String, trim: true },
  productLine:   { type: String, trim: true },
  type:          { type: String, trim: true },
  width:         { type: Number, default: null },
  height:        { type: Number, default: null },
  depth:         { type: Number, default: null },
  doorQty:       { type: Number, default: 0 },
  drawerQty:     { type: Number, default: 0 },
  finInt:        { type: Boolean, default: false }
}, { timestamps: true });
const Catalogue = mongoose.model('Catalogue', catalogueSchema);

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

function requireAdmin(req, res, next) {
  if (req.session.user?.role === 'admin') return next();
  if (req.accepts('html')) return res.redirect('/');
  res.status(403).json({ error: 'Admin access required.' });
}

// Public signup — creates a pending account
app.post('/auth/signup', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (!mongoReady) return res.status(503).json({ error: 'Service unavailable. Try again later.' });
  try {
    const exists = await User.findOne({ username: username.toLowerCase().trim() });
    if (exists) return res.status(409).json({ error: 'That username is already taken.' });
    const hash = bcrypt.hashSync(password, 10);
    await User.create({ username: username.toLowerCase().trim(), password: hash, role: 'user', status: 'pending' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// Login route — uses MongoDB when connected, falls back to users.json
app.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    let user;
    if (mongoReady) {
      user = await User.findOne({ username: username.toLowerCase().trim() });
      if (!user || !bcrypt.compareSync(password, user.password)) {
        return res.status(401).json({ error: 'Invalid username or password.' });
      }
      if (user.status !== 'approved') {
        return res.status(403).json({ error: 'Your account is pending admin approval.' });
      }
      req.session.user = { username: user.username, role: user.role };
    } else {
      // Fallback to users.json — treat all as approved admins
      try {
        const users = JSON.parse(fs.readFileSync(path.join(__dirname, 'users.json'), 'utf8'));
        user = users.find(u => u.username === username.toLowerCase().trim());
      } catch { user = null; }
      if (!user || !bcrypt.compareSync(password, user.password)) {
        return res.status(401).json({ error: 'Invalid username or password.' });
      }
      req.session.user = { username: user.username, role: 'admin' };
    }
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

// Catalogue page
app.get('/catalogue', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'catalogue.html'));
});

// Settings page
app.get('/settings', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'settings.html'));
});

// Product Types page
app.get('/product-types', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'product-types.html'));
});

// Product Types API
app.get('/api/product-types', async (req, res) => {
  try {
    const records = await ProductType.find().sort({ code: 1 });
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/product-types', async (req, res) => {
  const { code, description } = req.body;
  if (!code || !description) return res.status(400).json({ error: 'Code and description are required.' });
  if (!/^\d{2}$/.test(code)) return res.status(400).json({ error: 'Code must be exactly 2 digits.' });
  try {
    const exists = await ProductType.findOne({ code });
    if (exists) return res.status(409).json({ error: `Product type code "${code}" already exists.` });
    const record = await ProductType.create({ code, description });
    res.status(201).json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/product-types/:id', async (req, res) => {
  try {
    await ProductType.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Work Centers page
app.get('/work-centers', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'work-centers.html'));
});

// Work Centers API
app.get('/api/work-centers', async (req, res) => {
  try {
    const records = await WorkCenter.find().sort({ code: 1 });
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/work-centers', async (req, res) => {
  const { code, title } = req.body;
  if (!code || !title) return res.status(400).json({ error: 'Code and title are required.' });
  if (!/^\d{3}$/.test(code)) return res.status(400).json({ error: 'Code must be exactly 3 digits.' });
  try {
    const exists = await WorkCenter.findOne({ code });
    if (exists) return res.status(409).json({ error: `Work center code "${code}" already exists.` });
    const record = await WorkCenter.create({ code, title });
    res.status(201).json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/work-centers/:id', async (req, res) => {
  try {
    await WorkCenter.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Register / user management page (admin only)
app.get('/register', requireAuth, requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// User management API (admin only)
app.get('/api/users', requireAdmin, async (req, res) => {
  try {
    const users = await User.find({}, 'username role status createdAt _id').sort({ status: 1, username: 1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', requireAdmin, async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  try {
    const exists = await User.findOne({ username: username.toLowerCase().trim() });
    if (exists) return res.status(409).json({ error: `Username "${username}" is already taken.` });
    const hash = bcrypt.hashSync(password, 10);
    const user = await User.create({
      username: username.toLowerCase().trim(),
      password: hash,
      role: role === 'admin' ? 'admin' : 'user',
      status: 'approved'
    });
    res.status(201).json({ _id: user._id, username: user.username, role: user.role, status: user.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users/:id/approve', requireAdmin, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, { status: 'approved' }, { new: true });
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ ok: true, username: user.username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users/:id/reject', requireAdmin, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:id', requireAdmin, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Catalogue API
app.get('/api/catalogue', async (req, res) => {
  try {
    const records = await Catalogue.find().sort({ configuration: 1 });
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/catalogue', async (req, res) => {
  const { configuration, description, productLine, type, width, height, depth, doorQty, drawerQty, finInt } = req.body;
  if (!configuration) {
    return res.status(400).json({ error: 'configuration is required.' });
  }
  try {
    const record = await Catalogue.create({
      configuration,
      description,
      productLine,
      type,
      width:     width  !== '' && width  != null ? Number(width)  : null,
      height:    height !== '' && height != null ? Number(height) : null,
      depth:     depth  !== '' && depth  != null ? Number(depth)  : null,
      doorQty:   Number(doorQty   ?? 0),
      drawerQty: Number(drawerQty ?? 0),
      finInt:    Boolean(finInt)
    });
    res.status(201).json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/catalogue/:id', async (req, res) => {
  try {
    await Catalogue.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
  const { workCenter, activityDriver, qualifier, quantity } = req.body;
  if (!workCenter || !activityDriver || quantity === undefined) {
    return res.status(400).json({ error: 'workCenter, activityDriver, and quantity are required.' });
  }
  try {
    const record = await ActivityDriver.create({ workCenter, activityDriver, qualifier, quantity: Number(quantity) });
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

app.get('/api/shipmentitems/:projectId/:workOrderId', async (req, res) => {
  const { projectId, workOrderId } = req.params;
  const base = `https://app.innergy.com/api/v2-unstable/project-management/shipments/items`;

  try {
    const allRecords = [];
    let skip = 0;
    const take = 500;

    while (true) {
      const url = `${base}?projectId=${encodeURIComponent(projectId)}&workOrderId=${encodeURIComponent(workOrderId)}&take=${take}&skip=${skip}`;
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
      Name:              r.ShipmentItemName || r.Name || r.ItemName || r.name,
      Quantity:          Math.round((r.Quantity ?? r.Qty ?? r.quantity ?? r.qty ?? 0) * 1000) / 1000,
      Description:       r.Description || r.description,
      QuantityCompleted: Math.round((r.QuantityCompleted ?? 0) * 1000) / 1000,
      Width:             r.Width  ?? r.width  ?? null,
      Height:            r.Height ?? r.height ?? null,
      Depth:             r.Depth  ?? r.depth  ?? null
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
