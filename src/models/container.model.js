const mongoose = require('mongoose');
const { type } = require('os');

const actualContainerSchema = new mongoose.Schema({
  actualSerialNo: { type: String },
  commercialInvoiceNo: { type: String },
  shipOnBoardDate: { type: Date },
  size: { type: String },
  FCL: { type: Number },
  qtyMT: { type: Number, required: true },
  bags: { type: Number, default: 0 },
  pallet: { type: Number, default: 0 },
  weekWiseShipment: { type: String },
  buyingUnit: { type: String, default: "MT" },
  receivedOn: { type: Date, default: Date.now },
  updatedETD: { type: Date },
  updatedETA: { type: Date },
  CLNo: { type: String },
  // FAS fields
  DHL: { type: String },
  courierTrackNo: { type: String },
  courierServiceProvider: { type: String },
  docArrivalNotes: { type: String },
  BLNo: { type: String },
  expectedDocDate: { type: Date },
  receiver: { type: String },
  bankName: { type: String },
  bankAdvanceAmountDocumentUrl: { type: String },
  bankAdvanceApprovedDocumentUrl: { type: String },
  bankAdvanceSubmittedOn: { type: Date },
  docToBeReleasedOn: { type: Date },
  inwardCollectionAdviceDate: { type: Date },
  inwardCollectionAdviceDocumentUrl: { type: String },
  inwardCollectionAdviceDocumentName: { type: String },
  murabahaContractReleasedDate: { type: Date },
  murabahaContractApprovedDate: { type: Date },
  murabahaContractSubmittedDate: { type: Date },
  murabahaContractSubmittedDocumentUrl: { type: String },
  murabahaContractSubmittedDocumentName: { type: String },
  documentsReleasedDate: { type: Date },
  documentsReleasedDocumentUrl: { type: String },
  documentsReleasedDocumentName: { type: String },

  shipmentArrivedOn: { type: Date },
  clearExpectedOn: { type: Date },
  clearedOn: { type: Date },

  arrivalOn: { type: Date },
  shipmentFreeRetentionDate: { type: Date },
  portRetentionWithPenaltyDate: { type: Date },
  maximumRetentionDate: { type: Date },
  arrivalNoticeDate: { type: Date },
  arrivalNoticeFreeRetentionDays: { type: Number, default: 0 },
  arrivalNoticeDocumentUrl: { type: String },
  arrivalNoticeDocumentName: { type: String },
  advanceRequestDate: { type: Date },
  advanceRequestDocumentUrl: { type: String },
  advanceRequestDocumentName: { type: String },
  doReleasedDate: { type: Date },
  doReleasedDocumentUrl: { type: String },
  doReleasedDocumentName: { type: String },
  doReleasedRemarks: { type: String },
  dpApprovalDate: { type: Date },
  dpApprovalDocumentUrl: { type: String },
  dpApprovalDocumentName: { type: String },
  dpApprovalRemarks: { type: String },
  customsClearanceRemarks: { type: String },
  tokenReceivedDate: { type: Date },
  municipalityDate: { type: Date },
  municipalityDocumentUrl: { type: String },
  municipalityDocumentName: { type: String },
  municipalityRemarks: { type: String },

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
  },

  noOfContainers: { type: Number },
  noOfBags: { type: Number },
  quantityByMt: { type: Number },
  portOfLoading: { type: String },
  portOfDischarge: { type: String },
  shippingLine: { type: String },
  freeDetentionDays: { type: Number },
  maximumDetentionDays: { type: Number },
  freightPrepared: { type: String, enum: ['Yes', 'No'] },
  billExtractionData: { type: mongoose.Schema.Types.Mixed },
  extractedContainers: [{
    containerNo: { type: String },
    pkgCt: { type: Number }
  }],
  costSheetBookingDocumentUrl: { type: String },
  costSheetBookingDocumentName: { type: String },
  costSheetBookings: [{
    sn: { type: Number },
    description: { type: String },
    requestAmount: { type: Number },
    paidAmount: { type: Number }
  }],
  storageAllocations: [{
    sn: { type: Number },
    containerSerialNo: { type: String },
    bags: { type: Number },
    warehouse: { type: String },
    storageAvailability: { type: Number }
  }],
  maximumRetentionDate: { type: Date },
  transportationBooked: [{
    sn: { type: Number },
    containerSerialNo: { type: String },
    transportCompanyName: { type: String },
    bookedDate: { type: Date },
    bookingTime: { type: String },
    transportDate: { type: Date },
    transportTime: { type: String },
    delayHours: { type: Number }
  }],
  storageSplits: [{
    containerSerialNo: { type: String },
    bags: { type: Number },
    warehouse: { type: String },
    storageAvailability: { type: Number },
    receivedOnDate: { type: Date },
    receivedOnTime: { type: String },
    customsInspection: { type: String },
    grn: { type: String },
    batch: { type: String },
    productionDate: { type: Date },
    expiryDate: { type: Date },
    remarks: { type: String },
    documentUrl: { type: String },
    documentName: { type: String }
  }],
  storageDocumentUrl: { type: String },
  storageDocumentName: { type: String },
  qualityRows: [{
    sn: { type: Number },
    sampleNo: { type: String },
    phase: { type: String },
    date: { type: Date },
    inhouseReportNo: { type: String },
    inhouseReportDate: { type: Date },
    inhouseReportDocumentUrl: { type: String },
    inhouseReportDocumentName: { type: String },
    strategicReportNo: { type: String },
    strategicReportDate: { type: Date },
    strategicReportDocumentUrl: { type: String },
    strategicReportDocumentName: { type: String },
    thirdPartyReportNo: { type: String },
    thirdPartyReportDate: { type: Date },
    thirdPartyReportDocumentUrl: { type: String },
    thirdPartyReportDocumentName: { type: String }
    ,
    remarks: { type: String },
    attachmentDocumentUrl: { type: String },
    attachmentDocumentName: { type: String }
  }],
  qualityReports: [{
    phase: { type: String },
    reportDate: { type: Date },
    remarks: { type: String },
    documentUrl: { type: String },
    documentName: { type: String }
  }],
  paymentAllocations: [{
    sn: { type: Number },
    description: { type: String },
    requestAmount: { type: Number },
    paidAmount: { type: Number }
  }],
  paymentCostings: [{
    sn: { type: Number },
    description: { type: String },
    requestAmount: { type: Number },
    paidAmount: { type: Number },
    actualPaid: { type: Number },
    refBillNo: { type: String },
    refBillDate: { type: Date },
    refBillVendor: { type: String },
    refBillDocumentUrl: { type: String },
    refBillDocumentName: { type: String }
  }],
  paymentCostingDocumentUrl: { type: String },
  paymentCostingDocumentName: { type: String }

}, { timestamps: true });

const containerSchema = new mongoose.Schema({
  shipmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Shipment", required: true },

  // Planned container info
  planned: {
    size: { type: String },
    qtyMT: { type: Number, default: 0 },
    bags: { type: Number, default: 0 },
    FCL: { type: Number },
    etd: { type: Date },
    eta: { type: Date },
    weekWiseShipment: { type: String },
    buyingUnit: { type: String, default: "MT" }
  },

  // Multiple actual entries per planned container
  actual: actualContainerSchema,

  status: { type: String, enum: ["Planned", "Actual","Documented", "Arrived","Paid", "Cleared","GRN"], default: "Planned" }

}, { timestamps: true });

module.exports = mongoose.model("Container", containerSchema);
