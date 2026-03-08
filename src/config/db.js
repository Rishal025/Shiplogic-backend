/* eslint-disable no-console */
const mongoose = require('mongoose');


async function databaseConnect(url) {
  try {
    await mongoose.connect(url); // no extra options needed in Mongoose v6+
    console.log('✅ Database connected');
  } catch (err) {
    console.error('❌ Database connection error:', err);
    process.exit(1); // exit process if DB connection fails
  }
}

mongoose.connection.on('error', (err) => {
  console.error('Database error occurred:', err);
});

module.exports = {
  databaseConnect,
};
