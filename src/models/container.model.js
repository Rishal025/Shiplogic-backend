const mongoose = require('mongoose');
const { type } = require('os');

const actualContainerSchema = new mongoose.Schema({
  size: { type: String },
  FCL: { type: Number },
  qtyMT: { type: Number, required: true },
  bags: { type: Number, default: 0 },
  weekWiseShipment: { type: String },
  buyingUnit: { type: String, default: "MT" },
  receivedOn: { type: Date, default: Date.now },
  updatedETD: { type: Date },
  updatedETA: { type: Date },
  CLNo: { type: String },
  // FAS fields
  DHL: { type: String },
  docArrivalNotes: { type: String },
  BLNo: { type: String },

  shipmentArrivedOn: { type: Date },
  clearExpectedOn: { type: Date },
  clearedOn: { type: Date },

  paid_amount :{ type: Number, default: 0 },
  paidOn: { type: Date },
  remarks:{type:String},

  clearance: {
    clearedOn: Date,       // when the container was cleared
    remarks: String,       // remarks from logistics
    warehouse: String      // warehouse where container is stored
  },

  grn: {
    grnNo: String,
    grnDate: Date,
    statusRemarks: String
  }

}, { timestamps: true });

const containerSchema = new mongoose.Schema({
  shipmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Shipment", required: true },

  // Planned container info
  planned: {
    size: { type: String },
    qtyMT: { type: Number, default: 0 },
    bags: { type: Number, default: 0 },
    FCL: { type: Number },
    weekWiseShipment: { type: String },
    buyingUnit: { type: String, default: "MT" }
  },

  // Multiple actual entries per planned container
  actual: actualContainerSchema,

  status: { type: String, enum: ["Planned", "Actual","Documented", "Arrived","Paid", "Cleared","GRN"], default: "Planned" }

}, { timestamps: true });

module.exports = mongoose.model("Container", containerSchema);

