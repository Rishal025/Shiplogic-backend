// src/app.js
const express = require('express');
const bodyParser = require('body-parser');

const authRoutes = require('./routes/auth.route');
const supplierRoutes = require('./routes/supplier.route');
const itemRoutes = require('./routes/item.route');
const shipmentRoutes = require('./routes/shipment.route');
const notificationRoutes = require('./routes/notification.route');
// const logisticsRoutes = require('./modules/logistics/logistics.routes');

const app = express();

// ─── Manual CORS middleware ───────────────────────────────────────────────────
// Using raw headers instead of the cors package to guarantee compatibility
// with Express 5. This runs on EVERY request before any auth middleware.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Respond immediately to OPTIONS preflight — never let it reach auth middleware
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  next();
});
// ─────────────────────────────────────────────────────────────────────────────

app.use(bodyParser.json());

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/supplier', supplierRoutes);
app.use('/api/v1/item', itemRoutes);
app.use('/api/v1/shipment', shipmentRoutes);
app.use('/api/v1/notifications', notificationRoutes);

app.get('/', (req, res) => res.send('Shipment Tracker Backend Running'));

module.exports = app;
