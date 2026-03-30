#!/usr/bin/env node
// Usage: node add-user.js <username> <password>
const fs = require('fs');
const bcrypt = require('bcryptjs');

const [,, username, password] = process.argv;
if (!username || !password) {
  console.error('Usage: node add-user.js <username> <password>');
  process.exit(1);
}

const users = JSON.parse(fs.readFileSync('./users.json', 'utf8'));
if (users.find(u => u.username === username)) {
  console.error(`User "${username}" already exists.`);
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);
users.push({ username, password: hash });
fs.writeFileSync('./users.json', JSON.stringify(users, null, 2));
console.log(`User "${username}" added.`);
