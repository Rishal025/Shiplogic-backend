// src/app.js
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

const authRoutes = require('./routes/auth.route');
const supplierRoutes = require('./routes/supplier.route');
const itemRoutes = require('./routes/item.route');
const shipmentRoutes = require('./routes/shipment.route');
// const logisticsRoutes = require('./modules/logistics/logistics.routes');

const app = express();

app.use(cors());
app.use(bodyParser.json());

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/supplier', supplierRoutes);
app.use('/api/v1/item', itemRoutes);
app.use('/api/v1/shipment', shipmentRoutes);

app.get('/', (req, res) => res.send('Shipment Tracker Backend Running'));

module.exports = app;
