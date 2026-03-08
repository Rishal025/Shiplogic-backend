
const Shipment = require('../models/shipment.model');
const Container = require('../models/container.model');
const Supplier = require('../models/supplier.model');
const Item = require('../models/item.model');
const logAudit = require('../models/auditLog.model');
const mongoose = require('mongoose');

exports.createShipment = async (req, res) => {
  try {

    const {
      orderDate,
      poNumber,
      year,
      supplierId,
      piNo,
      fpoNo,
      itemId,
      plannedQtyMT,
      estimatedContainerCount,
      estimatedContainerSize,
      plannedETD,
      plannedETA,
      fcPerUnit,
      totalFC,
      paymentTerms,
      advanceAmount,
      advanceAmountDate,
      incoterms,
      buyunit,
      totalSplitQtyMT
    } = req.body;

    // 1️⃣ Basic validation
    if (!poNumber || !orderDate || !supplierId || !itemId || !plannedQtyMT || !piNo || !incoterms || !buyunit || !paymentTerms || !totalSplitQtyMT) {
      return res.status(400).json({ message: "Required fields missing" });
    }

    // 2️⃣ Validate supplier
    const supplier = await Supplier.findById(supplierId);
    if (!supplier) {
      return res.status(400).json({ message: "Invalid supplier" });
    }

    // 3️⃣ Validate item
    const item = await Item.findById(itemId);
    if (!item) {
      return res.status(400).json({ message: "Invalid item" });
    }

    // 4️⃣ Auto shipment number generation
    const count = await Shipment.countDocuments({ poNumber, year });
    const packingMatch = item.description.match(/(\d+\s*Kg)/i);
    const packingInfo = packingMatch ? packingMatch[1] : "";

    // Auto generate shipment number
    const shipmentNo = `${poNumber}- ${packingInfo}-${count+1}(${plannedQtyMT}MT)`;

    let yearStr = new Date(orderDate).getFullYear();

    const qty = Number(plannedQtyMT) || 0;
    const rate = Number(fcPerUnit) || 0;

    const totalAmount = qty * rate;

    // 5️⃣ Create shipment
    const shipment = await Shipment.create({
      poNumber,
      year:yearStr,
      orderDate,
      supplierId,
      itemId,
      shipmentNo,
      plannedQtyMT:qty,
      estimatedContainerCount,
      estimatedContainerSize,
      plannedETD,
      plannedETA,
      piNo,
      fpoNo,
      fcPerUnit:rate,
      totalFC,
      paymentTerms,
      advanceAmount,
      advanceAmountDate,
      payment: {
            totalAmount,   // from req.body
            paidAmount: 0,                   // initially 0
            balanceAmount: totalAmount, // initially same as total
            paymentStatus: "Pending"         // default
        },
    incoterms,
    buyunit,
    totalSplitQtyMT,
    containersize:estimatedContainerSize
    });

    // 6️⃣ Audit log
    await logAudit({
      userId: req.user._id,
      module: "Purchase",
      entity: "Shipment",
      entityId: shipment._id,
      action: "Create",
      before: null,
      after: shipment.toObject(),
      remarks: "Shipment entry created"
    });

    return res.status(201).json({
      message: "Shipment created successfully",
      data: shipment
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Server error",
      error: error.message
    });
  }
};


exports.createPlannedContainersBulk = async (req, res) => {
  try {
    const { shipmentId, plannedContainers } = req.body;

    if (!Array.isArray(plannedContainers)) {
      return res.status(400).json({ message: "plannedContainers must be an array" });
    }

    const shipment = await Shipment.findById(shipmentId);
    if (!shipment) return res.status(404).json({ message: "Shipment not found" });

    // 1️⃣ Delete all existing planned containers for this shipment
    await Container.deleteMany({ shipmentId, status: "Planned" });

    // 2️⃣ Insert all new planned containers
    let currentPlannedMT = 0;
    const processedContainers = [];

    for (let c of plannedContainers) {
      // Check if totalOrderedQtyMT exceeded
      if (currentPlannedMT + c.qtyMT > shipment.totalOrderedQtyMT) {
        return res.status(400).json({
          message: `Cannot add container of ${c.qtyMT} MT. Total would exceed ordered quantity (${shipment.totalOrderedQtyMT} MT)`
        });
      }

      const container = await Container.create({
        shipmentId,
        planned: {
          size: c.size,
          FCL: c.FCL,
          weekWiseShipment: c.weekWiseShipment,
          qtyMT: c.qtyMT,
          buyingUnit: c.buyingUnit || "MT"
        },
        status: "Planned"
      });

      currentPlannedMT += c.qtyMT;
      processedContainers.push(container);
    }

    // 3️⃣ Recalculate shipment totals
    shipment.plannedQtyMT = currentPlannedMT;
    shipment.assumedContainerCount = processedContainers.length;
    shipment.currentStage = "Planned Split";
    await shipment.save();

    res.status(200).json({
      message: "Planned containers replaced successfully",
      shipment: {
        plannedQtyMT: shipment.plannedQtyMT,
        assumedContainerCount: shipment.assumedContainerCount,
        currentStage: shipment.currentStage
      },
      containers: processedContainers
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};





exports.addActualContainer = async (req, res) => {
  try {

    const container = await Container.findById(req.params.id);


    const {
      qtyMT,
      bags,
      updatedETD,
      updatedETA,
      CLNo
    } = req.body;

    
    if (!container) {
      return res.status(404).json({ message: "Container not found" });
    }

    const shipment = await Shipment.findById(container.shipmentId);
    if (!shipment) {
      return res.status(404).json({ message: "Shipment not found" });
    }

    // 🔥 REPLACE ACTUAL (NOT ARRAY)
    container.actual = {
      qtyMT,
      bags,
      updatedETD,
      updatedETA,
      CLNo,
      receivedOn: new Date()
    };

    container.status = "Actual";
    await container.save();

    // 🔥 RECALCULATE SHIPMENT TOTALS
    const allContainers = await Container.find({ shipmentId: shipment._id });

    shipment.actualQtyMT = allContainers.reduce(
      (sum, c) => sum + (c.actual?.qtyMT || 0),
      0
    );

    shipment.actualBags = allContainers.reduce(
      (sum, c) => sum + (c.actual?.bags || 0),
      0
    );

    shipment.currentStage = "Shipment Split";

    if (CLNo) shipment.CLNo = CLNo;

    // 🔥 AUTO CLOSE LOGIC
    if (shipment.actualQtyMT >= shipment.totalOrderedQtyMT) {
      shipment.currentStage = "Shipment Split";
    }

    await shipment.save();

    res.status(200).json({
      message: "Actual container recorded successfully",
      container,
      shipment: {
        actualQtyMT: shipment.actualQtyMT,
        actualBags: shipment.actualBags,
        currentStage: shipment.currentStage
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Server error",
      error: err.message
    });
  }
};


exports.updateFASContainer = async (req, res) => {
  try {
   
    const { DHL, docArrivalNotes, BLNo } = req.body;

    const container = await Container.findById(req.params.id);
    if (!container) return res.status(404).json({ message: "Container not found" });

    if (!container.actual) return res.status(400).json({ message: "Container has no actual recorded yet" });

    const beforeUpdate = container.toObject();

    // Update FAS info
    if (DHL !== undefined) container.actual.DHL = DHL;
    if (docArrivalNotes !== undefined) container.actual.docArrivalNotes = docArrivalNotes;
    if (BLNo !== undefined) container.actual.BLNo = BLNo;
    container.status = "Documented";
    await container.save();

    // Optional: log audit
    await logAudit({
      userId: req.user._id,
      module: "FAS",
      entity: "Container",
      entityId: container._id,
      action: "UpdateFASDetails",
      before: beforeUpdate,
      after: container.toObject(),
      remarks: "FAS updated DHL/DocNotes/BLNo for container"
    });

    res.status(200).json({ message: "FAS details updated successfully", container });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

exports.updateLogisticsDetails = async (req, res) => {
  try {
    const container = await Container.findById(req.params.id);
    const {
      shipmentArrivedOn,
      clearExpectedOn
    } = req.body;

    if (!container)
      return res.status(404).json({ message: "Container not found" });

    if (!container.actual)
      return res.status(400).json({ message: "Actual not created yet" });

    // 🔹 Update fields
    if (shipmentArrivedOn !== undefined)
      container.actual.shipmentArrivedOn = shipmentArrivedOn;

    if (clearExpectedOn !== undefined)
      container.actual.clearExpectedOn = clearExpectedOn;
    container.status = "Arrived";

    await container.save();

    // // 🔥 Recalculate shipment totals
    const shipment = await Shipment.findById(container.shipmentId);
    const allContainers = await Container.find({ shipmentId: shipment._id });

    // shipment.actualQtyMT = allContainers.reduce(
    //   (sum, c) => sum + (c.actual?.qtyMT || 0),
    //   0
    // );

    // shipment.actualBags = allContainers.reduce(
    //   (sum, c) => sum + (c.actual?.bags || 0),
    //   0
    // );

    // // 🔥 Shipment stage control
    // const allCleared = allContainers.every(c => c.status === "Cleared");
    // const anyArrived = allContainers.some(c => c.status === "Arrived" || c.status === "Cleared");

    // if (allCleared && allContainers.length > 0) {
    //   shipment.currentStage = "Cleared";
    // } else if (anyArrived) {
    //   shipment.currentStage = "Arrived";
    // } else {
    //   shipment.currentStage = "In Transit";
    // }

    // await shipment.save();

    res.status(200).json({
      message: "Logistics details updated successfully",
      container,
      shipment: {
        actualQtyMT: shipment.actualQtyMT,
        actualBags: shipment.actualBags,
        currentStage: shipment.currentStage
      }
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.addContainerPayment = async (req, res) => {
  try {

    const container = await Container.findById(req.params.id);
    const { paid_amount, paidOn, remarks } = req.body;

    if (!paid_amount || paid_amount <= 0)
      return res.status(400).json({ message: "Valid amount required" });

    if (!container)
      return res.status(404).json({ message: "Container not found" });

    const shipment = await Shipment.findById(container.shipmentId);
    if (!shipment)
      return res.status(404).json({ message: "Shipment not found" });

    const allContainers = await Container.find({
      shipmentId: shipment._id
    });


    const shipmentTotalPaid = allContainers.reduce(
      (sum, c) => sum + (c.actual?.paid_amount || 0),
      0
    );

   
    if (shipmentTotalPaid + paid_amount > shipment.payment?.totalAmount) {
      return res.status(400).json({
        message: "Payment exceeds shipment invoice amount"
      });
    }

    container.actual.paid_amount = paid_amount;
    container.actual.paidOn = paidOn;
    container.actual.remarks = remarks;
    container.status = "Paid";
    await container.save();

    // 🔥 Add to existing paidAmount
    shipment.payment.paidAmount += paid_amount;

    // 🔥 Update balance
    shipment.payment.balanceAmount =
      shipment.payment.totalAmount - shipment.payment.paidAmount;

    // 🔥 Update status
    if (shipment.payment.paidAmount === 0) {
      shipment.payment.paymentStatus = "Pending";
    } else if (shipment.payment.balanceAmount === 0) {
      shipment.payment.paymentStatus = "Paid";
    } else {
      shipment.payment.paymentStatus = "Partially Paid";
    }

    await shipment.save();

    res.status(200).json({
      message: "Payment added successfully",
      payment: container.payment
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.clearContainer = async (req, res) => {
  try {
    const container = await Container.findById(req.params.id);
    const { clearedOn, remarks, warehouse } = req.body;

    if (!container) return res.status(404).json({ message: "Container not found" });

    // 🔥 Only allow clearance if actual exists
    if (!container.actual) {
      return res.status(400).json({ message: "Cannot clear: container has no actual record" });
    }


    container.actual.clearance = {
      clearedOn: clearedOn || new Date(),
      remarks: remarks || "",
      warehouse: warehouse || ""
    };

    container.status = "Cleared"; // optional overall status update

    await container.save();

    res.status(200).json({
      message: "Container cleared successfully",
      containerActual: container.actual
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

exports.addContainerGRN = async (req, res) => {
  try {
    const container = await Container.findById(req.params.id);
    const { grnNo, grnDate, statusRemarks } = req.body;

    if (!grnNo || !grnDate) return res.status(400).json({ message: "GRN No and GRN Date required" });

    
    if (!container) return res.status(404).json({ message: "Container not found" });

    // 🔥 Ensure container has actual and is cleared
    if (!container.actual) {
      return res.status(400).json({ message: "Cannot add GRN: container has no actual record" });
    }

    if (!container.actual.clearance || !container.actual.clearance.clearedOn) {
      return res.status(400).json({ message: "Cannot add GRN: container not cleared yet" });
    }

    container.actual.grn = {
      grnNo,
      grnDate: new Date(grnDate),
      statusRemarks: statusRemarks || ""
    };

    container.status = "GRN"; // optional overall status

    await container.save();

    res.status(200).json({
      message: "GRN added successfully",
      containerActual: container.actual
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};



exports.getAllShipments = async (req, res) => {
  try {
    let { page = 1, limit = 20, search = '', status = '' } = req.query;

    page = parseInt(page);
    limit = parseInt(limit);

    const query = {};

    // 🔍 Search filter
    if (search) {
      query.$or = [
        { shipmentNo: { $regex: search, $options: 'i' } },
        { orderNumber: { $regex: search, $options: 'i' } },
        { piNo: { $regex: search, $options: 'i' } }
      ];
    }

    // 🎯 Status filter (optional)
    if (status) {
      query.currentStage = status;
    }

    const total = await Shipment.countDocuments(query);

    const shipments = await Shipment.find(query)
      .populate("supplierId", "name")
      .populate("itemId", "description")
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ createdAt: -1 });

    const formatted = shipments.map(s => ({
      _id: s._id,
      year:s.year,
      shipmentNo: s.shipmentNo,
      orderNumber: s.orderNumber,
      orderDate: s.orderDate,
      supplier: s.supplierId?.name || null,
      item: s.itemId?.description || null,
      piNo: s.piNo,
      totalQty: s.totalOrderedQtyMT,
      split: s.totalSplitQtyMT || 0,
      status: s.currentStage,
      totalAmount: s.payment?.totalAmount || 0
    }));

    res.json({
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      totalRecords: total,
      shipments: formatted
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getShipmentSummary = async (req, res) => {
  try {

    const total = await Shipment.countDocuments();

    const completed = await Shipment.countDocuments({
      currentStage: "GRN Completed"
    });

    const inProgress = await Shipment.countDocuments({
      currentStage: { $ne: "GRN Completed" }
    });

    res.status(200).json({
      totalShipments: total,
      completedShipments: completed,
      inProgressShipments: inProgress
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};



exports.getShipmentById = async (req, res) => {
  try {
    
    // Fetch shipment info
    const shipment = await Shipment.findById(req.params.id)
      .populate("supplierId", "name")
      .populate("itemId", "description itemCode unit riceName packing");

    if (!shipment) {
      return res.status(404).json({ message: "Shipment not found" });
    }
    const shipmentId = shipment._id;
    // Fetch all containers for this shipment
    const containers = await Container.find({ shipmentId }).sort({ createdAt: 1 });

    // Planned array
    const planned = containers.map(c => ({
      containerId: c._id,
      size: c.planned?.size,
      FCL: c.planned?.FCL,
      qtyMT: c.planned?.qtyMT,
      bags: c.planned?.bags,
      weekWiseShipment: c.planned?.weekWiseShipment,
      buyingUnit: c.planned?.buyingUnit,
      status: c.status
    }));

    // Actual array
    const actual = [];
    containers.forEach(c => {
      if (c.actual) {
        // ensure actual is always an array
        const actualArr = Array.isArray(c.actual) ? c.actual : [c.actual];
        actualArr.forEach(a => {

        const actualData = {
          containerId: c._id,
          size: a.size,
          FCL: a.FCL,
          qtyMT: a.qtyMT,
          bags: a.bags,
          buyingUnit: a.buyingUnit,
          receivedOn: a.receivedOn,
          updatedETD: a.updatedETD,
          updatedETA: a.updatedETA,
          CLNo: a.CLNo,
          BLNo: a.BLNo,
          DHL: a.DHL,
          docArrivalNotes: a.docArrivalNotes,
          clearExpectedOn: a.clearExpectedOn,
          shipmentArrivedOn: a.shipmentArrivedOn,
          paid_amount: a.paid_amount,
          paidOn: a.paidOn,
          remarks: a.remarks
        };

        if (hasValues(a.clearance)) {
          actualData.clearance = a.clearance;
        }

        if (hasValues(a.grn)) {
          actualData.grn = a.grn;
        }

        actual.push(actualData);
      });
      }
    });

    res.status(200).json({
      shipment: {
        _id: shipment._id,
        shipmentNo: shipment.shipmentNo,
        orderNumber: shipment.orderNumber,
        orderDate: shipment.orderDate,
        supplier: shipment.supplierId?.name || null,
        item: shipment.itemId
          ? `${shipment.itemId.itemCode} - ${shipment.itemId.description}`
          : null,
        riceName:shipment.itemId.riceName,
        packing:shipment.itemId.packing,
        piNo: shipment.piNo,
        totalOrderedQtyMT: shipment.totalOrderedQtyMT,
        plannedQtyMT: shipment.plannedQtyMT,
        actualQtyMT: shipment.actualQtyMT,
        assumedContainerCount: shipment.totalSplitQtyMT,
        currentStage: shipment.currentStage,
        payment: shipment.payment.totalAmount,
        incoterms:shipment.incoterms,
        buyunit:shipment.buyunit,
        fcPerUnit:shipment.fcPerUnit,
        advanceAmount:shipment.advanceAmount,
        paymentTerms:shipment.paymentTerms,
        plannedETD:shipment.plannedETD,
        plannedETA:shipment.plannedETA,
        containerSize:shipment.containersize
      },
      planned,
      actual
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};


const hasValues = (obj) => {
  if (!obj) return false;
  return Object.values(obj).some(
    value => value !== null && value !== undefined && value !== ""
  );
};

// Mock extraction response — fallback when Python API is unavailable
function getMockExtractionResponse() {
  return {
    piNo: 'PI-2024-001',
    piDate: '2024-03-01',
    fpoNo: 'PO-2024-456',
    purchaseDate: '2024-03-05',
    incoTerms: 'CIF',
    portOfLoading: 'Karachi',
    portOfDischarge: 'Dubai',
    commodity: 'Rice',
    brandName: 'Royal Basmati',
    itemDescription: 'Basmati Rice 25kg bags',
    supplierCode: 'SUP-001',
    supplierName: 'Pakistan Rice Exporters',
    itemCode: 'RICE-25KG',
    countryOfOrigin: 'Pakistan',
    packagingType: '25 Kg Bags',
    containerSize: '40',
    plannedContainers: 500,
    fcl: 20,
    pallet: 100,
    bags: 20000,
    noOfShipments: 20,
    buyingUnit: 'MT',
    fcPerUnit: 450,
    totalUSD: 225000,
    totalAED: 825750,
    paymentTerms: '20% Advance and 80% CAD',
    advanceAmount: 45000,
    expectedETD: '2024-04-15',
    expectedETA: '2024-05-10'
  };
}

// Parse number from strings like "USD 985.00", "480.000 MT (+/- 5%)", "48,000.00"
function parseNum(s) {
  if (s == null) return undefined;
  if (typeof s === 'number' && !Number.isNaN(s)) return s;
  if (typeof s !== 'string') return undefined;
  const cleaned = s.replace(/,/g, '').replace(/[^\d.-]/g, ' ');
  const match = cleaned.match(/-?\d+\.?\d*/);
  return match ? parseFloat(match[0]) : undefined;
}

// Map Python extraction API response to frontend ExtractedShipmentData shape
function mapPythonResponseToExtraction(pythonRes) {
  const out = {};
  if (!pythonRes || typeof pythonRes !== 'object') return out;

  const lpo = pythonRes.lpo_invoice || {};
  const pi = pythonRes.performa_invoice || {};

  // Shipment info
  if (pi.pi_number != null && pi.pi_number !== '') out.piNo = String(pi.pi_number).trim();
  if (pi.pi_date != null && pi.pi_date !== '') out.piDate = String(pi.pi_date).trim();
  if (lpo.po_number != null && lpo.po_number !== '') out.fpoNo = String(lpo.po_number).trim();
  if (lpo.po_date != null && lpo.po_date !== '') out.purchaseDate = String(lpo.po_date).trim();
  if (pi.inco_terms != null && pi.inco_terms !== '') out.incoTerms = String(pi.inco_terms).trim();
  if (pi.port_of_loading != null && pi.port_of_loading !== '') out.portOfLoading = String(pi.port_of_loading).trim();
  if (pi.port_of_discharge != null && pi.port_of_discharge !== '') out.portOfDischarge = String(pi.port_of_discharge).trim();
  if (lpo.commodity != null && lpo.commodity !== '') out.commodity = String(lpo.commodity).trim();
  if (pi.brand != null && pi.brand !== '') out.brandName = String(pi.brand).trim();
  const itemDesc = lpo.item ?? pi.item ?? '';
  if (itemDesc !== '') out.itemDescription = String(itemDesc).trim();

  // Supplier (Python returns names only)
  const supplierName = pi.supplier_details ?? lpo.vendor ?? '';
  if (supplierName !== '') out.supplierName = String(supplierName).trim();

  // Item
  if (lpo.item_code != null && lpo.item_code !== '') out.itemCode = String(lpo.item_code).trim();

  // Packaging / quantity
  if (pi.packaging != null && pi.packaging !== '') out.packagingType = String(pi.packaging).trim();

  const qtyPi = pi.quantity;
  if (qtyPi != null && qtyPi !== '') {
    const parsed = parseNum(qtyPi);
    if (parsed != null) out.plannedContainers = parsed;
    if (/mt|mton|metric/i.test(String(qtyPi))) out.buyingUnit = 'MT';
  }
  const qtyLpo = lpo.quantity;
  if (qtyLpo != null && qtyLpo !== '' && out.plannedContainers == null) {
    const parsed = parseNum(qtyLpo);
    if (parsed != null) out.plannedContainers = parsed;
  }
  if (lpo.unit != null && lpo.unit !== '' && !out.buyingUnit) {
    const u = String(lpo.unit).toUpperCase();
    if (['MT', 'KG', 'BAG', 'PALLET'].includes(u)) out.buyingUnit = u === 'BAG' ? 'Bag' : u;
  }
  if (!out.buyingUnit) out.buyingUnit = 'MT';

  // Price
  const pricePerMton = pi.price_per_mton ?? pi.price_per_mt;
  if (pricePerMton != null && pricePerMton !== '') {
    const n = parseNum(pricePerMton);
    if (n != null) out.fcPerUnit = n;
  }
  const totalPrice = pi.total_price ?? lpo.price;
  if (totalPrice != null && totalPrice !== '') {
    const n = parseNum(totalPrice);
    if (n != null) out.totalUSD = n;
  }
  if (pi.payment_terms != null && pi.payment_terms !== '') out.paymentTerms = String(pi.payment_terms).trim();

  if (out.totalUSD != null && typeof out.totalUSD === 'number') {
    out.totalAED = Math.round(out.totalUSD * 3.67 * 100) / 100;
  }

  return out;
}

// =======================
// EXTRACT FROM DOCUMENTS — calls Python API, maps response to frontend shape
// Frontend sends: document1 = Purchase order (LPO), document2 = Performa Invoice (PI)
// Python API expects: lpo_invoice, performa_invoice (with optional inco_terms_list, suppliers)
// =======================
exports.extractFromDocuments = async (req, res) => {
  try {
    const files = req.files;
    // document1 = Purchase order → lpo_invoice, document2 = Performa Invoice → performa_invoice
    if (!files?.document1?.[0] || !files?.document2?.[0]) {
      return res.status(400).json({
        message: 'Both Purchase order (document1) and Performa Invoice (document2) are required'
      });
    }

    const pythonUrl = process.env.PYTHON_EXTRACTION_API_URL || 'http://localhost:8096';
    const endpoint = `${pythonUrl.replace(/\/$/, '')}/shipment-form`;
    const incoTermsList = process.env.PYTHON_INCO_TERMS_LIST || 'CIF,FOB,EXWORKS';
    const suppliersList = process.env.PYTHON_SUPPLIERS_LIST || '';

    const lpoFile = files.document1[0];
    const piFile = files.document2[0];

    const FormData = globalThis.FormData;
    const form = new FormData();
    const lpoBlob = new Blob([lpoFile.buffer], { type: lpoFile.mimetype || 'application/octet-stream' });
    const piBlob = new Blob([piFile.buffer], { type: piFile.mimetype || 'application/octet-stream' });
    form.append('lpo_invoice', lpoBlob, lpoFile.originalname || 'lpo.pdf');
    form.append('performa_invoice', piBlob, piFile.originalname || 'pi.pdf');
    form.append('inco_terms_list', incoTermsList);
    form.append('suppliers', suppliersList);

    const response = await fetch(endpoint, {
      method: 'POST',
      body: form
    });

    if (!response.ok) {
      const errText = await response.text();
      let errJson;
      try { errJson = JSON.parse(errText); } catch { errJson = { detail: errText }; }
      return res.status(response.status).json({
        message: errJson.detail || errJson.message || `Python extraction service returned ${response.status}`,
        error: errJson
      });
    }

    const pythonRes = await response.json();
    const data = mapPythonResponseToExtraction(pythonRes);

    return res.status(200).json({
      message: 'Data extracted successfully',
      data: data || {}
    });
  } catch (err) {
    console.error('Extract from documents error:', err);
    const isNetwork = err.cause?.code === 'ECONNREFUSED' || err.code === 'ECONNREFUSED';
    return res.status(500).json({
      message: isNetwork
        ? 'Extraction service unavailable. Check PYTHON_EXTRACTION_API_URL and that the Python service is running.'
        : (err.message || 'Server error'),
      error: err.message
    });
  }
};














