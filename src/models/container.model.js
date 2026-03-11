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
  expectedDocDate: { type: Date },
  receiver: { type: String },
  bankAdvanceAmountDocumentUrl: { type: String },
  bankAdvanceApprovedDocumentUrl: { type: String },
  bankAdvanceSubmittedOn: { type: Date },
  docToBeReleasedOn: { type: Date },

  shipmentArrivedOn: { type: Date },
  clearExpectedOn: { type: Date },
  clearedOn: { type: Date },

  // Step 4 – Shipment Clearing Tracker (doc + date pairs; URLs for S3 later)
  deliveryOrderDocumentUrl: { type: String },
  deliveryOrderDate: { type: Date },
  tokenDocumentUrl: { type: String },
  tokenDate: { type: Date },
  transportArrangedDocumentUrl: { type: String },
  transportArrangedDate: { type: Date },
  customsClearanceDocumentUrl: { type: String },
  customsClearanceDate: { type: Date },
  municipalityClearanceDocumentUrl: { type: String },
  municipalityClearanceDate: { type: Date },

  deliverySchedules: [{
    deliveryDate: { type: Date },
    deliveryNo: { type: String },
    noOfFCL: { type: Number },
    time: { type: String },
    location: { type: String }
  }],
  warehouseSchedules: [{
    deliveryDate: { type: Date },
    deliveryNo: { type: String },
    noOfFCL: { type: Number },
    time: { type: String },
    location: { type: String },
    grn: { type: String }
  }],

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

