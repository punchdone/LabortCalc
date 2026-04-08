require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const https = require('https');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, 'public', 'uploads'),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    cb(null, /^image\/(jpeg|png|gif|webp)$/.test(file.mimetype));
  }
});

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
  code:  { type: String, required: true, unique: true, trim: true, match: /^[a-zA-Z0-9]{3}$/ },
  title: { type: String, required: true, trim: true },
  order: { type: Number, default: 0 }
}, { timestamps: true });
const WorkCenter = mongoose.model('WorkCenter', workCenterSchema);

const productTypeSchema = new mongoose.Schema({
  code:        { type: String, required: true, unique: true, trim: true, match: /^[a-zA-Z0-9]{2}$/ },
  description: { type: String, required: true, trim: true },
  order:       { type: Number, default: 0 }
}, { timestamps: true });
const ProductType = mongoose.model('ProductType', productTypeSchema);

const productLineSchema = new mongoose.Schema({
  code:        { type: String, required: true, unique: true, trim: true, match: /^[a-zA-Z0-9]{2}$/ },
  description: { type: String, required: true, trim: true }
}, { timestamps: true });
const ProductLine = mongoose.model('ProductLine', productLineSchema);

const materialSchema = new mongoose.Schema({
  code:        { type: String, required: true, unique: true, trim: true, match: /^[a-zA-Z0-9]{2}$/ },
  description: { type: String, required: true, trim: true }
}, { timestamps: true });
const Material = mongoose.model('Material', materialSchema);

const finishTypeSchema = new mongoose.Schema({
  code:        { type: String, required: true, unique: true, trim: true, match: /^[a-zA-Z0-9]{2}$/ },
  description: { type: String, required: true, trim: true }
}, { timestamps: true });
const FinishType = mongoose.model('FinishType', finishTypeSchema);

const groupSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true }
}, { timestamps: true });
const Group = mongoose.model('Group', groupSchema);

const catalogueSchema = new mongoose.Schema({
  configuration: { type: String, required: true, trim: true },
  configCode:    { type: String, trim: true, match: /^[a-zA-Z0-9]{0,5}$/ },
  group:         { type: String, trim: true },
  description:   { type: String, trim: true },
  productLine:   { type: String, trim: true },
  type:          { type: String, trim: true },
  widthMin:  { type: Number, default: null },
  widthMax:  { type: Number, default: null },
  widthStd:  { type: Number, default: null },
  heightMin: { type: Number, default: null },
  heightMax: { type: Number, default: null },
  heightStd: { type: Number, default: null },
  depthMin:  { type: Number, default: null },
  depthMax:  { type: Number, default: null },
  depthStd:  { type: Number, default: null },
  doorQty:         { type: Number, default: 0 },
  topDrawerQty:    { type: Number, default: 0 },
  lowerDrawerQty:  { type: Number, default: 0 },
  shelfQty:        { type: Number, default: 0 },
  partitionQty:    { type: Number, default: 0 },
  buyOut:        { type: Boolean, default: false },
  supplierName:  { type: String, trim: true },
  supplierPartNo:{ type: String, trim: true },
  supplierPrice: { type: Number, default: null },
  finInt:        { type: Boolean, default: false },
  faceFrame:     { type: Boolean, default: false },
  multiFace:     { type: Boolean, default: false },
  angled:        { type: Boolean, default: false },
  price:         { type: Number, default: null },
  priceLevel1:   { type: Number, default: null },
  priceLevel2:   { type: Number, default: null },
  priceLevel3:   { type: Number, default: null },
  priceLevel4:   { type: Number, default: null },
  priceLevel5:   { type: Number, default: null },
  priceLevel6:   { type: Number, default: null },
  priceLevel7:   { type: Number, default: null },
  notes:         { type: String, trim: true },
  image:         { type: String, trim: true }
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
    const records = await ProductType.find().sort({ order: 1, code: 1 });
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/product-types', async (req, res) => {
  const { code, description } = req.body;
  if (!code || !description) return res.status(400).json({ error: 'Code and description are required.' });
  if (!/^[a-zA-Z0-9]{2}$/.test(code)) return res.status(400).json({ error: 'Code must be exactly 2 alphanumeric characters.' });
  try {
    const exists = await ProductType.findOne({ code });
    if (exists) return res.status(409).json({ error: `Product type code "${code}" already exists.` });
    const record = await ProductType.create({ code, description });
    res.status(201).json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/product-types/reorder', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array is required.' });
  try {
    await Promise.all(ids.map((id, i) => ProductType.findByIdAndUpdate(id, { order: i })));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/product-types/:id', async (req, res) => {
  const { code, description } = req.body;
  if (code && !/^[a-zA-Z0-9]{2}$/.test(code))
    return res.status(400).json({ error: 'Code must be exactly 2 alphanumeric characters.' });
  try {
    const update = {};
    if (code        !== undefined) update.code        = code;
    if (description !== undefined) update.description = description;
    const record = await ProductType.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!record) return res.status(404).json({ error: 'Not found.' });
    res.json(record);
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

// Product Lines page
app.get('/product-lines', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'product-lines.html'));
});

// Product Lines API
app.get('/api/product-lines', async (req, res) => {
  try {
    const records = await ProductLine.find().sort({ code: 1 });
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/product-lines', async (req, res) => {
  const { code, description } = req.body;
  if (!code || !description) return res.status(400).json({ error: 'Code and description are required.' });
  if (!/^[a-zA-Z0-9]{2}$/.test(code)) return res.status(400).json({ error: 'Code must be exactly 2 alphanumeric characters.' });
  try {
    const exists = await ProductLine.findOne({ code });
    if (exists) return res.status(409).json({ error: `Product line code "${code}" already exists.` });
    const record = await ProductLine.create({ code, description });
    res.status(201).json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/product-lines/:id', async (req, res) => {
  const { code, description } = req.body;
  if (code && !/^[a-zA-Z0-9]{2}$/.test(code))
    return res.status(400).json({ error: 'Code must be exactly 2 alphanumeric characters.' });
  try {
    const update = {};
    if (code        !== undefined) update.code        = code;
    if (description !== undefined) update.description = description;
    const record = await ProductLine.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!record) return res.status(404).json({ error: 'Not found.' });
    res.json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/product-lines/:id', async (req, res) => {
  try {
    await ProductLine.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Materials page
app.get('/materials', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'materials.html'));
});

// Materials API
app.get('/api/materials', async (req, res) => {
  try {
    const records = await Material.find().sort({ code: 1 });
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/materials', async (req, res) => {
  const { code, description } = req.body;
  if (!code || !description) return res.status(400).json({ error: 'Code and description are required.' });
  if (!/^[a-zA-Z0-9]{2}$/.test(code)) return res.status(400).json({ error: 'Code must be exactly 2 alphanumeric characters.' });
  try {
    const exists = await Material.findOne({ code });
    if (exists) return res.status(409).json({ error: `Material code "${code}" already exists.` });
    const record = await Material.create({ code, description });
    res.status(201).json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/materials/:id', async (req, res) => {
  const { code, description } = req.body;
  if (code && !/^[a-zA-Z0-9]{2}$/.test(code))
    return res.status(400).json({ error: 'Code must be exactly 2 alphanumeric characters.' });
  try {
    const update = {};
    if (code        !== undefined) update.code        = code;
    if (description !== undefined) update.description = description;
    const record = await Material.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!record) return res.status(404).json({ error: 'Not found.' });
    res.json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/materials/:id', async (req, res) => {
  try {
    await Material.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Finish Types page
app.get('/finish-types', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'finish-types.html'));
});

// Finish Types API
app.get('/api/finish-types', async (req, res) => {
  try {
    const records = await FinishType.find().sort({ code: 1 });
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/finish-types', async (req, res) => {
  const { code, description } = req.body;
  if (!code || !description) return res.status(400).json({ error: 'Code and description are required.' });
  if (!/^[a-zA-Z0-9]{2}$/.test(code)) return res.status(400).json({ error: 'Code must be exactly 2 alphanumeric characters.' });
  try {
    const exists = await FinishType.findOne({ code });
    if (exists) return res.status(409).json({ error: `Finish type code "${code}" already exists.` });
    const record = await FinishType.create({ code, description });
    res.status(201).json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/finish-types/:id', async (req, res) => {
  const { code, description } = req.body;
  if (code && !/^[a-zA-Z0-9]{2}$/.test(code))
    return res.status(400).json({ error: 'Code must be exactly 2 alphanumeric characters.' });
  try {
    const update = {};
    if (code        !== undefined) update.code        = code;
    if (description !== undefined) update.description = description;
    const record = await FinishType.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!record) return res.status(404).json({ error: 'Not found.' });
    res.json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/finish-types/:id', async (req, res) => {
  try {
    await FinishType.findByIdAndDelete(req.params.id);
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
    const records = await WorkCenter.find().sort({ order: 1, code: 1 });
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/work-centers', async (req, res) => {
  const { code, title, order } = req.body;
  if (!code || !title) return res.status(400).json({ error: 'Code and title are required.' });
  if (!/^[a-zA-Z0-9]{3}$/.test(code)) return res.status(400).json({ error: 'Code must be exactly 3 alphanumeric characters.' });
  try {
    const exists = await WorkCenter.findOne({ code });
    if (exists) return res.status(409).json({ error: `Work center code "${code}" already exists.` });
    const record = await WorkCenter.create({ code, title, order: Number(order ?? 0) });
    res.status(201).json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/work-centers/:id', async (req, res) => {
  const { code, title, order } = req.body;
  if (code && !/^[a-zA-Z0-9]{3}$/.test(code))
    return res.status(400).json({ error: 'Code must be exactly 3 alphanumeric characters.' });
  try {
    const update = {};
    if (code  !== undefined) update.code  = code;
    if (title !== undefined) update.title = title;
    if (order !== undefined) update.order = Number(order);
    const record = await WorkCenter.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!record) return res.status(404).json({ error: 'Not found.' });
    res.json(record);
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

// Groups API
app.get('/api/groups', async (req, res) => {
  try {
    const records = await Group.find().sort({ name: 1 });
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/groups', async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Group name is required.' });
  try {
    const exists = await Group.findOne({ name: name.trim() });
    if (exists) return res.status(409).json({ error: `Group "${name.trim()}" already exists.` });
    const record = await Group.create({ name: name.trim() });
    res.status(201).json(record);
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

// Image upload
app.post('/api/upload', requireAuth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No valid image file received.' });
  res.json({ path: `/uploads/${req.file.filename}` });
});

// Delete an uploaded image file
app.delete('/api/upload', requireAuth, (req, res) => {
  const { filePath } = req.body;
  if (!filePath || !filePath.startsWith('/uploads/')) return res.status(400).json({ error: 'Invalid path.' });
  const abs = path.join(__dirname, 'public', filePath);
  fs.unlink(abs, () => res.json({ ok: true }));
});

app.post('/api/catalogue', async (req, res) => {
  const { configuration, configCode, description, productLine, type, group,
          widthMin, widthMax, widthStd,
          heightMin, heightMax, heightStd,
          depthMin, depthMax, depthStd,
          doorQty, topDrawerQty, lowerDrawerQty, shelfQty, partitionQty,
          buyOut, supplierName, supplierPartNo, supplierPrice,
          finInt, faceFrame, multiFace, angled, price,
          priceLevel1, priceLevel2, priceLevel3, priceLevel4, priceLevel5, priceLevel6, priceLevel7,
          notes, image } = req.body;
  if (!configuration) {
    return res.status(400).json({ error: 'configuration is required.' });
  }
  if (configCode && !/^[a-zA-Z0-9]{1,5}$/.test(configCode)) {
    return res.status(400).json({ error: 'Configuration code must be up to 5 alphanumeric characters.' });
  }
  const toNum = v => (v !== '' && v != null) ? Number(v) : null;
  try {
    const record = await Catalogue.create({
      configuration,
      configCode: configCode || undefined,
      description,
      productLine,
      type,
      group: group || undefined,
      widthMin:  toNum(widthMin),  widthMax:  toNum(widthMax),  widthStd:  toNum(widthStd),
      heightMin: toNum(heightMin), heightMax: toNum(heightMax), heightStd: toNum(heightStd),
      depthMin:  toNum(depthMin),  depthMax:  toNum(depthMax),  depthStd:  toNum(depthStd),
      doorQty:        Number(doorQty        ?? 0),
      topDrawerQty:   Number(topDrawerQty   ?? 0),
      lowerDrawerQty: Number(lowerDrawerQty ?? 0),
      shelfQty:       Number(shelfQty       ?? 0),
      partitionQty:   Number(partitionQty   ?? 0),
      buyOut:         Boolean(buyOut),
      supplierName:   supplierName  || undefined,
      supplierPartNo: supplierPartNo || undefined,
      supplierPrice:  (supplierPrice !== '' && supplierPrice != null) ? Number(supplierPrice) : null,
      finInt:    Boolean(finInt),
      faceFrame: Boolean(faceFrame),
      multiFace: Boolean(multiFace),
      angled:    Boolean(angled),
      price:     (price !== '' && price != null) ? Number(price) : null,
      priceLevel1: toNum(priceLevel1),
      priceLevel2: toNum(priceLevel2),
      priceLevel3: toNum(priceLevel3),
      priceLevel4: toNum(priceLevel4),
      priceLevel5: toNum(priceLevel5),
      priceLevel6: toNum(priceLevel6),
      priceLevel7: toNum(priceLevel7),
      notes:     notes || undefined,
      image:     image || undefined
    });
    res.status(201).json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/catalogue/:id', async (req, res) => {
  const toNum = v => (v !== '' && v != null) ? Number(v) : null;
  const {
    configuration, configCode, productLine, type, group,
    widthMin, widthMax, widthStd, heightMin, heightMax, heightStd, depthMin, depthMax, depthStd,
    doorQty, topDrawerQty, lowerDrawerQty, shelfQty, partitionQty,
    buyOut, supplierName, supplierPartNo, supplierPrice,
    finInt, faceFrame, multiFace, angled, price,
    priceLevel1, priceLevel2, priceLevel3, priceLevel4, priceLevel5, priceLevel6, priceLevel7,
    notes, image
  } = req.body;
  try {
    const u = {};
    if (configuration  !== undefined) u.configuration  = configuration;
    if (configCode     !== undefined) u.configCode     = configCode;
    if (productLine    !== undefined) u.productLine    = productLine;
    if (type           !== undefined) u.type           = type;
    if (group          !== undefined) u.group          = group;
    if (widthMin       !== undefined) u.widthMin       = toNum(widthMin);
    if (widthMax       !== undefined) u.widthMax       = toNum(widthMax);
    if (widthStd       !== undefined) u.widthStd       = toNum(widthStd);
    if (heightMin      !== undefined) u.heightMin      = toNum(heightMin);
    if (heightMax      !== undefined) u.heightMax      = toNum(heightMax);
    if (heightStd      !== undefined) u.heightStd      = toNum(heightStd);
    if (depthMin       !== undefined) u.depthMin       = toNum(depthMin);
    if (depthMax       !== undefined) u.depthMax       = toNum(depthMax);
    if (depthStd       !== undefined) u.depthStd       = toNum(depthStd);
    if (doorQty        !== undefined) u.doorQty        = Number(doorQty ?? 0);
    if (topDrawerQty   !== undefined) u.topDrawerQty   = Number(topDrawerQty ?? 0);
    if (lowerDrawerQty !== undefined) u.lowerDrawerQty = Number(lowerDrawerQty ?? 0);
    if (shelfQty       !== undefined) u.shelfQty       = Number(shelfQty ?? 0);
    if (partitionQty   !== undefined) u.partitionQty   = Number(partitionQty ?? 0);
    if (buyOut         !== undefined) u.buyOut         = Boolean(buyOut);
    if (supplierName   !== undefined) u.supplierName   = supplierName;
    if (supplierPartNo !== undefined) u.supplierPartNo = supplierPartNo;
    if (supplierPrice  !== undefined) u.supplierPrice  = toNum(supplierPrice);
    if (finInt         !== undefined) u.finInt         = Boolean(finInt);
    if (faceFrame      !== undefined) u.faceFrame      = Boolean(faceFrame);
    if (multiFace      !== undefined) u.multiFace      = Boolean(multiFace);
    if (angled         !== undefined) u.angled         = Boolean(angled);
    if (price          !== undefined) u.price          = toNum(price);
    if (priceLevel1    !== undefined) u.priceLevel1    = toNum(priceLevel1);
    if (priceLevel2    !== undefined) u.priceLevel2    = toNum(priceLevel2);
    if (priceLevel3    !== undefined) u.priceLevel3    = toNum(priceLevel3);
    if (priceLevel4    !== undefined) u.priceLevel4    = toNum(priceLevel4);
    if (priceLevel5    !== undefined) u.priceLevel5    = toNum(priceLevel5);
    if (priceLevel6    !== undefined) u.priceLevel6    = toNum(priceLevel6);
    if (priceLevel7    !== undefined) u.priceLevel7    = toNum(priceLevel7);
    if (notes          !== undefined) u.notes          = notes;
    if (image          !== undefined) u.image          = image;
    const record = await Catalogue.findByIdAndUpdate(req.params.id, u, { new: true });
    if (!record) return res.status(404).json({ error: 'Not found.' });
    res.json(record);
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

app.patch('/api/activity-drivers/:id', async (req, res) => {
  const { workCenter, activityDriver, qualifier, quantity } = req.body;
  try {
    const update = {};
    if (workCenter     !== undefined) update.workCenter     = workCenter;
    if (activityDriver !== undefined) update.activityDriver = activityDriver;
    if (qualifier      !== undefined) update.qualifier      = qualifier;
    if (quantity       !== undefined) update.quantity       = Number(quantity);
    const record = await ActivityDriver.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!record) return res.status(404).json({ error: 'Not found.' });
    res.json(record);
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
