/**
 * One-time migration: copies users.json accounts into MongoDB.
 * Run once: node migrate-users.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true }
});
const User = mongoose.model('User', userSchema);

async function migrate() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const usersFile = path.join(__dirname, 'users.json');
  if (!fs.existsSync(usersFile)) {
    console.log('No users.json found — nothing to migrate.');
    process.exit(0);
  }

  const users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
  let created = 0, skipped = 0;

  for (const u of users) {
    const exists = await User.findOne({ username: u.username.toLowerCase() });
    if (exists) {
      console.log(`  Skipped (already exists): ${u.username}`);
      skipped++;
    } else {
      await User.create({ username: u.username.toLowerCase(), password: u.password, role: 'admin', status: 'approved' });
      console.log(`  Migrated: ${u.username}`);
      created++;
    }
  }

  console.log(`Done. ${created} created, ${skipped} skipped.`);
  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
