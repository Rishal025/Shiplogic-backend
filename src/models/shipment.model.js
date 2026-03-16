const mongoose = require('mongoose');
const { type } = require('os');

const shipmentSchema = new mongoose.Schema({

  poNumber: { type: String, required: true },
  year: { type: Number, required: true },
  supplierId: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true },
  itemId: { type: mongoose.Schema.Types.ObjectId, ref: "Item" },

  shipmentNo: { type: String, unique: true },
  plannedQtyMT: { type: Number, required: true },
  piNo:{type:String},
  fpoNo:{type:String},
  // 🔹 Assumed / Planned split
  assumedContainerCount: { type: Number },
  assumedQtyPerContainer: { type: Number },

  // 🔹 Actual split tracking
  totalSplitQtyMT: { type: Number, default: 0 },
  actualContainerCount: { type: Number, default: 0 },
  isFullySplit: { type: Boolean, default: false },
  orderDate:Date,
  plannedETD: Date,
  plannedETA: Date,
  actualArrivalDate: Date,

  fcPerUnit: { type: Number }, 
  totalFC: { type: Number},        
  amountAED: { type: Number },      
  paymentTerms: { type: String},   
  advanceAmount: { type: Number, default: 0 }, 
  incoterms:{type:String},
  buyunit:{type:String},
  containersize:{type:Number, default: 0 },
  payment: {
  totalAmount: { type: Number, default: 0 },
  paidAmount: { type: Number, default: 0 },
  balanceAmount: { type: Number, default: 0 },
  paymentStatus: {
    type: String,
    enum: ["Pending", "Partially Paid", "Paid"],
    default: "Pending"
  },
  
},
      
  advanceAmountDate: { type: Date },   

  noOfShipments: { type: Number, default: null },
  currentStage: {
    type: String,
    enum: [
      "Shipment Entry",
      "Planned Split",
      "Shipment Split",
      "Payment Completed",
      "Arrived",
      "Documentation Completed",
      "Under Clearance",
      "Cleared",
      "Released",
      "GRN Completed"
    ],
    default: "Shipment Entry"
  }

}, { timestamps: true });

module.exports = mongoose.model("Shipment", shipmentSchema);

