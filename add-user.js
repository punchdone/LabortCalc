#!/usr/bin/env node
// Usage: node add-user.js <username> <password>
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const [,, username, password] = process.argv;
if (!username || !password) {
  console.error('Usage: node add-user.js <username> <password>');
  process.exit(1);
}

const User = mongoose.model('User', new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true }
}));

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const exists = await User.findOne({ username: username.toLowerCase() });
  if (exists) {
    console.error(`User "${username}" already exists.`);
    process.exit(1);
  }
  const hash = bcrypt.hashSync(password, 10);
  await User.create({ username: username.toLowerCase(), password: hash });
  console.log(`User "${username}" added.`);
  await mongoose.disconnect();
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
