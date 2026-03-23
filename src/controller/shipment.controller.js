
const Shipment = require('../models/shipment.model');
const Container = require('../models/container.model');
const Supplier = require('../models/supplier.model');
const Item = require('../models/item.model');
const logAudit = require('../models/auditLog.model');
const { uploadBufferToS3, createSignedGetUrl } = require('../core/utils/s3Upload');
const mongoose = require('mongoose');

const parseJsonField = (value) => {
  if (value == null || value === '') return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const normalizeUploadedFiles = (files) => {
  if (!files) return {};
  if (!Array.isArray(files)) return files;

  return files.reduce((acc, file) => {
    if (!file?.fieldname) return acc;
    if (!acc[file.fieldname]) {
      acc[file.fieldname] = [];
    }
    acc[file.fieldname].push(file);
    return acc;
  }, {});
};

const toDateOrNull = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toSignedDocument = async (url, name, expiresIn = 900) => {
  if (!url) return { url: null, name: name || null };
  const signedUrl = await createSignedGetUrl(url, expiresIn).catch(() => url);
  return { url: signedUrl, name: name || null };
};

const toPlainObject = (value) => {
  if (value && typeof value.toObject === 'function') {
    return value.toObject();
  }
  return value;
};

exports.createShipment = async (req, res) => {
  try {
    const {
      orderDate,
      poNumber,
      year,
      supplierId,
      supplierName,
      piNo,
      fpoNo,
      itemId,
      itemCode,
      itemDescription,
      commodity,
      countryOfOrigin,
      brandName,
      barcode,
      variant,
      hsCode,
      packing,
      portOfLoading,
      portOfDischarge,
      plannedQtyMT,
      estimatedContainerCount,
      estimatedContainerSize,
      plannedETD,
      plannedETA,
      fcPerUnit,
      totalFC,
      paymentTerms,
      bankName,
      advanceAmount,
      advanceAmountDate,
      incoterms,
      buyunit,
      totalSplitQtyMT,
      q1Report
    } = req.body;

    const files = req.files || {};
    const lpoDocument = files?.lpoDocument?.[0];
    const proformaDocument = files?.proformaDocument?.[0];
    const s1QualityReport = files?.s1QualityReport?.[0];

    // 1️⃣ Basic validation (itemId now optional)
    const parsedQ1Report = parseJsonField(q1Report);

    if (!poNumber || !orderDate || !(supplierId || supplierName) || !plannedQtyMT || !piNo || !incoterms || !buyunit || !paymentTerms || !totalSplitQtyMT) {
      return res.status(400).json({ message: "Required fields missing" });
    }
    if (!lpoDocument || !proformaDocument || !s1QualityReport) {
      return res.status(400).json({
        message: 'All 3 documents are required: lpoDocument, proformaDocument, s1QualityReport'
      });
    }

    // 2️⃣ Validate supplier
    let supplier = null;
    if (supplierId) {
      supplier = await Supplier.findById(supplierId);
      if (!supplier) {
        return res.status(400).json({ message: "Invalid supplier" });
      }
    }

    // 3️⃣ Auto PO number generation: RHST + YY + MM + running 3-digit sequence (monthly)
    const orderDateObj = orderDate ? new Date(orderDate) : new Date();
    if (Number.isNaN(orderDateObj.getTime())) {
      return res.status(400).json({ message: 'Invalid orderDate' });
    }

    const yy = String(orderDateObj.getFullYear()).slice(-2);
    const mm = String(orderDateObj.getMonth() + 1).padStart(2, '0');
    const monthStart = new Date(orderDateObj.getFullYear(), orderDateObj.getMonth(), 1, 0, 0, 0, 0);
    const nextMonthStart = new Date(orderDateObj.getFullYear(), orderDateObj.getMonth() + 1, 1, 0, 0, 0, 0);

    const monthCount = await Shipment.countDocuments({
      orderDate: { $gte: monthStart, $lt: nextMonthStart }
    });

    let runningNo = monthCount + 1;
    let autoPoNumber = `RHST${yy}${mm}${String(runningNo).padStart(3, '0')}`;
    while (await Shipment.exists({ poNumber: autoPoNumber })) {
      runningNo += 1;
      autoPoNumber = `RHST${yy}${mm}${String(runningNo).padStart(3, '0')}`;
    }

    // Auto generate shipment number from generated PO number
    const shipmentNo = `${autoPoNumber}-${1}(${plannedQtyMT}MT)`;

    const yearStr = orderDateObj.getFullYear();

    const qty = Number(plannedQtyMT) || 0;
    const rate = Number(fcPerUnit) || 0;

    const totalAmount = qty * rate;

    // 4️⃣ Upload all mandatory documents to S3
    const [lpoUpload, proformaUpload, s1Upload] = await Promise.all([
      uploadBufferToS3(lpoDocument, 'shipments/lpo'),
      uploadBufferToS3(proformaDocument, 'shipments/proforma'),
      uploadBufferToS3(s1QualityReport, 'shipments/quality/s1')
    ]);

    // 5️⃣ Create shipment with persisted document URLs
    const shipment = await Shipment.create({
      poNumber: autoPoNumber,
      year: yearStr,
      orderDate,
      supplierId: supplier?._id,
      supplierName: supplierName || supplier?.name || '',
      itemId: itemId || undefined,
      itemCode: itemCode || '',
      itemDescription: itemDescription || '',
      commodity: commodity || '',
      countryOfOrigin: countryOfOrigin || '',
      brandName: brandName || '',
      barcode: barcode || '',
      variant: variant || '',
      hsCode: hsCode || '',
      packing: packing || '',
      portOfLoading: portOfLoading || '',
      portOfDischarge: portOfDischarge || '',
      shipmentNo,
      plannedQtyMT: qty,
      estimatedContainerCount,
      estimatedContainerSize,
      plannedETD,
      plannedETA,
      piNo,
      fpoNo,
      fcPerUnit: rate,
      totalFC,
      paymentTerms,
      bankName: bankName || '',
      advanceAmount,
      advanceAmountDate,
      q1Report: parsedQ1Report,
      lpoDocumentName: lpoUpload.fileName,
      lpoDocumentUrl: lpoUpload.url,
      proformaDocumentName: proformaUpload.fileName,
      proformaDocumentUrl: proformaUpload.url,
      s1QualityReportName: s1Upload.fileName,
      s1QualityReportUrl: s1Upload.url,
      payment: {
        totalAmount,   // from req.body
        paidAmount: 0,                   // initially 0
        balanceAmount: totalAmount, // initially same as total
        paymentStatus: "Pending"         // default
      },
      incoterms,
      buyunit,
      totalSplitQtyMT,
      containersize: estimatedContainerSize
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
      data: shipment,
      documents: {
        lpo: { name: lpoUpload.fileName, url: lpoUpload.url },
        proforma: { name: proformaUpload.fileName, url: proformaUpload.url },
        s1QualityReport: { name: s1Upload.fileName, url: s1Upload.url }
      }
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
    const { shipmentId, plannedContainers, noOfShipments } = req.body;

    if (!Array.isArray(plannedContainers)) {
      return res.status(400).json({ message: "plannedContainers must be an array" });
    }

    const shipment = await Shipment.findById(shipmentId);
    if (!shipment) return res.status(404).json({ message: "Shipment not found" });

    const totalQtyMT = shipment.plannedQtyMT ?? shipment.totalOrderedQtyMT ?? 0;

    // 1️⃣ Delete all existing planned containers for this shipment
    await Container.deleteMany({ shipmentId, status: "Planned" });

    // 2️⃣ Insert all new planned containers
    let currentPlannedMT = 0;
    const processedContainers = [];

    for (let c of plannedContainers) {
      const qty = Number(c.qtyMT) || 0;
      if (totalQtyMT > 0 && currentPlannedMT + qty > totalQtyMT) {
        return res.status(400).json({
          message: `Cannot add container of ${qty} MT. Total would exceed ordered quantity (${totalQtyMT} MT)`
        });
      }

      const container = await Container.create({
        shipmentId,
        planned: {
          size: c.size,
          FCL: c.FCL,
          weekWiseShipment: c.weekWiseShipment,
          qtyMT: qty,
          buyingUnit: c.buyingUnit || "MT"
        },
        status: "Planned"
      });

      currentPlannedMT += qty;
      processedContainers.push(container);
    }

    // 3️⃣ Recalculate shipment totals and save noOfShipments
    shipment.plannedQtyMT = currentPlannedMT;
    shipment.assumedContainerCount = processedContainers.length;
    if (noOfShipments != null && noOfShipments !== '') shipment.noOfShipments = Number(noOfShipments);
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
      actualSerialNo,
      commercialInvoiceNo,
      shipOnBoardDate,
      qtyMT,
      bags,
      pallet,
      updatedETD,
      updatedETA,
      CLNo,
      BLNo,
      portOfLoading,
      portOfDischarge,
      noOfContainers,
      noOfBags,
      quantityByMt,
      shippingLine,
      freeDetentionDays,
      maximumDetentionDays,
      freightPrepared,
      billExtractionData,
      extractedContainers
    } = req.body;


    if (!container) {
      return res.status(404).json({ message: "Container not found" });
    }

    const shipment = await Shipment.findById(container.shipmentId);
    if (!shipment) {
      return res.status(404).json({ message: "Shipment not found" });
    }

    // BLNo is sent by frontend; CLNo kept for backward compatibility
    const billOrLadingNo = BLNo ?? CLNo;

    // 🔥 REPLACE ACTUAL (NOT ARRAY)
    container.actual = {
      ...(container.actual?.toObject ? container.actual.toObject() : container.actual || {}),
      actualSerialNo,
      commercialInvoiceNo,
      shipOnBoardDate: shipOnBoardDate ? new Date(shipOnBoardDate) : null,
      size: container.planned?.size,
      FCL: container.planned?.FCL,
      qtyMT,
      bags,
      pallet,
      updatedETD,
      updatedETA,
      CLNo: billOrLadingNo,
      BLNo: billOrLadingNo,
      portOfLoading: portOfLoading || container.actual?.portOfLoading || '',
      portOfDischarge: portOfDischarge || container.actual?.portOfDischarge || '',
      noOfContainers: Number(noOfContainers) || container.actual?.noOfContainers || 0,
      noOfBags: Number(noOfBags) || Number(bags) || container.actual?.noOfBags || 0,
      quantityByMt: Number(quantityByMt) || Number(qtyMT) || container.actual?.quantityByMt || 0,
      shippingLine: shippingLine || container.actual?.shippingLine || '',
      freeDetentionDays: Number(freeDetentionDays) || container.actual?.freeDetentionDays || 0,
      maximumDetentionDays: Number(maximumDetentionDays) || container.actual?.maximumDetentionDays || 0,
      freightPrepared: freightPrepared || container.actual?.freightPrepared || 'No',
      billExtractionData: billExtractionData || container.actual?.billExtractionData || null,
      extractedContainers: Array.isArray(extractedContainers)
        ? extractedContainers.map((row) => ({
            containerNo: row.containerNo || row.container_no || '',
            pkgCt: Number(row.pkgCt ?? row.pkg_ct) || 0
          }))
        : container.actual?.extractedContainers || [],
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

    if (billOrLadingNo) shipment.CLNo = billOrLadingNo;

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

exports.updateBLDetails = async (req, res) => {
  try {
    const container = await Container.findById(req.params.id);
    if (!container) {
      return res.status(404).json({ message: 'Container not found' });
    }

    if (!container.actual) {
      container.actual = {
        size: container.planned?.size,
        FCL: container.planned?.FCL,
        qtyMT: container.planned?.qtyMT || 0,
        bags: container.planned?.bags || 0
      };
    }

    const files = req.files || {};
    const costSheetBookingDocument = files?.costSheetBookingDocument?.[0];

    const {
      blNo,
      shippedOnBoard,
      portOfLoading,
      portOfDischarge,
      noOfContainers,
      noOfBags,
      quantityByMt,
      shippingLine,
      freeDetentionDays,
      maximumDetentionDays,
      freightPrepared,
      costSheetBookings,
      storageAllocations
    } = req.body;

    const parsedCostSheetBookings = parseJsonField(costSheetBookings);
    const parsedStorageAllocations = parseJsonField(storageAllocations);

    if (blNo !== undefined) {
      container.actual.BLNo = blNo || '';
      container.actual.CLNo = blNo || '';
    }
    if (shippedOnBoard !== undefined) container.actual.shipOnBoardDate = toDateOrNull(shippedOnBoard);
    if (portOfLoading !== undefined) container.actual.portOfLoading = portOfLoading || '';
    if (portOfDischarge !== undefined) container.actual.portOfDischarge = portOfDischarge || '';
    if (noOfContainers !== undefined) container.actual.noOfContainers = Number(noOfContainers) || 0;
    if (noOfBags !== undefined) container.actual.noOfBags = Number(noOfBags) || 0;
    if (quantityByMt !== undefined) container.actual.quantityByMt = Number(quantityByMt) || 0;
    if (shippingLine !== undefined) container.actual.shippingLine = shippingLine || '';
    if (freeDetentionDays !== undefined) container.actual.freeDetentionDays = Number(freeDetentionDays) || 0;
    if (maximumDetentionDays !== undefined) container.actual.maximumDetentionDays = Number(maximumDetentionDays) || 0;
    if (freightPrepared !== undefined) container.actual.freightPrepared = freightPrepared || 'No';
    if (Array.isArray(parsedCostSheetBookings)) {
      container.actual.costSheetBookings = parsedCostSheetBookings.map((row) => ({
        sn: Number(row.sn) || 0,
        description: row.description || '',
        requestAmount: Number(row.requestAmount) || 0,
        paidAmount: Number(row.paidAmount) || 0
      }));
    }
    if (Array.isArray(parsedStorageAllocations)) {
      container.actual.storageAllocations = parsedStorageAllocations.map((row) => ({
        sn: Number(row.sn) || 0,
        containerSerialNo: row.containerSerialNo || '',
        warehouse: row.warehouse || '',
        storageAvailability: Number(row.storageAvailability) || 0
      }));
    }

    if (costSheetBookingDocument) {
      const uploaded = await uploadBufferToS3(costSheetBookingDocument, 'shipments/bl/cost-sheet');
      container.actual.costSheetBookingDocumentUrl = uploaded.url;
      container.actual.costSheetBookingDocumentName = uploaded.fileName;
    }

    await container.save();

    res.status(200).json({
      message: 'B/L details updated successfully',
      container
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};


exports.updateFASContainer = async (req, res) => {
  try {
    const files = req.files || {};
    const inwardCollectionAdviceDocument = files?.inwardCollectionAdviceDocument?.[0];
    const murabahaContractSubmittedDocument = files?.murabahaContractSubmittedDocument?.[0];
    const documentsReleasedDocument = files?.documentsReleasedDocument?.[0];

    const {
      BLNo,
      DHL,
      expectedDocDate,
      receiver,
      courierTrackNo,
      courierServiceProvider,
      bankName,
      inwardCollectionAdviceDate,
      murabahaContractReleasedDate,
      murabahaContractApprovedDate,
      murabahaContractSubmittedDate,
      documentsReleasedDate,
      bankAdvanceAmountDocumentUrl,
      bankAdvanceApprovedDocumentUrl,
      bankAdvanceSubmittedOn,
      docToBeReleasedOn
    } = req.body;

    const container = await Container.findById(req.params.id);
    if (!container) return res.status(404).json({ message: "Container not found" });

    if (!container.actual) return res.status(400).json({ message: "Container has no actual recorded yet" });

    const beforeUpdate = container.toObject();

    if (BLNo !== undefined) container.actual.BLNo = BLNo;
    if (DHL !== undefined) container.actual.DHL = DHL;
    if (courierTrackNo !== undefined) container.actual.courierTrackNo = courierTrackNo || '';
    if (courierServiceProvider !== undefined) container.actual.courierServiceProvider = courierServiceProvider || '';
    if (expectedDocDate !== undefined) container.actual.expectedDocDate = toDateOrNull(expectedDocDate);
    if (receiver !== undefined) container.actual.receiver = receiver;
    if (bankName !== undefined) container.actual.bankName = bankName || '';
    if (inwardCollectionAdviceDate !== undefined) container.actual.inwardCollectionAdviceDate = toDateOrNull(inwardCollectionAdviceDate);
    if (murabahaContractReleasedDate !== undefined) container.actual.murabahaContractReleasedDate = toDateOrNull(murabahaContractReleasedDate);
    if (murabahaContractApprovedDate !== undefined) container.actual.murabahaContractApprovedDate = toDateOrNull(murabahaContractApprovedDate);
    if (murabahaContractSubmittedDate !== undefined) container.actual.murabahaContractSubmittedDate = toDateOrNull(murabahaContractSubmittedDate);
    if (documentsReleasedDate !== undefined) container.actual.documentsReleasedDate = toDateOrNull(documentsReleasedDate);
    if (bankAdvanceAmountDocumentUrl !== undefined) container.actual.bankAdvanceAmountDocumentUrl = bankAdvanceAmountDocumentUrl || '';
    if (bankAdvanceApprovedDocumentUrl !== undefined) container.actual.bankAdvanceApprovedDocumentUrl = bankAdvanceApprovedDocumentUrl || '';
    if (bankAdvanceSubmittedOn !== undefined) container.actual.bankAdvanceSubmittedOn = toDateOrNull(bankAdvanceSubmittedOn);
    if (docToBeReleasedOn !== undefined) container.actual.docToBeReleasedOn = toDateOrNull(docToBeReleasedOn);

    if (inwardCollectionAdviceDocument) {
      const uploaded = await uploadBufferToS3(inwardCollectionAdviceDocument, 'shipments/document-tracker/inward-advice');
      container.actual.inwardCollectionAdviceDocumentUrl = uploaded.url;
      container.actual.inwardCollectionAdviceDocumentName = uploaded.fileName;
    }
    if (murabahaContractSubmittedDocument) {
      const uploaded = await uploadBufferToS3(murabahaContractSubmittedDocument, 'shipments/document-tracker/murabaha-submitted');
      container.actual.murabahaContractSubmittedDocumentUrl = uploaded.url;
      container.actual.murabahaContractSubmittedDocumentName = uploaded.fileName;
    }
    if (documentsReleasedDocument) {
      const uploaded = await uploadBufferToS3(documentsReleasedDocument, 'shipments/document-tracker/documents-released');
      container.actual.documentsReleasedDocumentUrl = uploaded.url;
      container.actual.documentsReleasedDocumentName = uploaded.fileName;
    }

    container.status = "Documented";
    await container.save();

    await logAudit({
      userId: req.user._id,
      module: "FAS",
      entity: "Container",
      entityId: container._id,
      action: "UpdateFASDetails",
      before: beforeUpdate,
      after: container.toObject(),
      remarks: "FAS updated documentation details for container"
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
    const files = req.files || {};
    const {
      arrivalOn,
      shipmentFreeRetentionDate,
      portRetentionWithPenaltyDate,
      arrivalNoticeDate,
      advanceRequestDate,
      doReleasedDate,
      doReleasedRemarks,
      dpApprovalDate,
      dpApprovalRemarks,
      customsClearanceDate,
      customsClearanceRemarks,
      tokenReceivedDate,
      municipalityDate,
      municipalityRemarks,
      transportationBooked,
      deliveryOrderDocumentUrl,
      deliveryOrderDate,
      tokenDocumentUrl,
      tokenDate,
      transportArrangedDocumentUrl,
      transportArrangedDate,
      customsClearanceDocumentUrl,
      municipalityClearanceDocumentUrl,
      municipalityClearanceDate,
      deliverySchedules,
      warehouseSchedules
    } = req.body;

    if (!container)
      return res.status(404).json({ message: "Container not found" });

    if (!container.actual)
      return res.status(400).json({ message: "Actual not created yet" });

    const parsedTransportationBooked = parseJsonField(transportationBooked);
    const parsedDeliverySchedules = parseJsonField(deliverySchedules);
    const parsedWarehouseSchedules = parseJsonField(warehouseSchedules);

    if (arrivalOn !== undefined) container.actual.arrivalOn = toDateOrNull(arrivalOn);
    if (shipmentFreeRetentionDate !== undefined) container.actual.shipmentFreeRetentionDate = toDateOrNull(shipmentFreeRetentionDate);
    if (portRetentionWithPenaltyDate !== undefined) container.actual.portRetentionWithPenaltyDate = toDateOrNull(portRetentionWithPenaltyDate);
    if (arrivalNoticeDate !== undefined) container.actual.arrivalNoticeDate = toDateOrNull(arrivalNoticeDate);
    if (advanceRequestDate !== undefined) container.actual.advanceRequestDate = toDateOrNull(advanceRequestDate);
    if (doReleasedDate !== undefined) container.actual.doReleasedDate = toDateOrNull(doReleasedDate);
    if (doReleasedRemarks !== undefined) container.actual.doReleasedRemarks = doReleasedRemarks || '';
    if (dpApprovalDate !== undefined) container.actual.dpApprovalDate = toDateOrNull(dpApprovalDate);
    if (dpApprovalRemarks !== undefined) container.actual.dpApprovalRemarks = dpApprovalRemarks || '';
    if (customsClearanceDate !== undefined) container.actual.customsClearanceDate = toDateOrNull(customsClearanceDate);
    if (customsClearanceRemarks !== undefined) container.actual.customsClearanceRemarks = customsClearanceRemarks || '';
    if (tokenReceivedDate !== undefined) container.actual.tokenReceivedDate = toDateOrNull(tokenReceivedDate);
    if (municipalityDate !== undefined) container.actual.municipalityDate = toDateOrNull(municipalityDate);
    if (municipalityRemarks !== undefined) container.actual.municipalityRemarks = municipalityRemarks || '';

    if (deliveryOrderDocumentUrl !== undefined) container.actual.deliveryOrderDocumentUrl = deliveryOrderDocumentUrl || '';
    if (deliveryOrderDate !== undefined) container.actual.deliveryOrderDate = toDateOrNull(deliveryOrderDate);
    if (tokenDocumentUrl !== undefined) container.actual.tokenDocumentUrl = tokenDocumentUrl || '';
    if (tokenDate !== undefined) container.actual.tokenDate = toDateOrNull(tokenDate);
    if (transportArrangedDocumentUrl !== undefined) container.actual.transportArrangedDocumentUrl = transportArrangedDocumentUrl || '';
    if (transportArrangedDate !== undefined) container.actual.transportArrangedDate = toDateOrNull(transportArrangedDate);
    if (customsClearanceDocumentUrl !== undefined) container.actual.customsClearanceDocumentUrl = customsClearanceDocumentUrl || '';
    if (customsClearanceDate !== undefined) container.actual.customsClearanceDate = toDateOrNull(customsClearanceDate);
    if (municipalityClearanceDocumentUrl !== undefined) container.actual.municipalityClearanceDocumentUrl = municipalityClearanceDocumentUrl || '';
    if (municipalityClearanceDate !== undefined) container.actual.municipalityClearanceDate = toDateOrNull(municipalityClearanceDate);

    const arrivalNoticeDocument = files?.arrivalNoticeDocument?.[0];
    const advanceRequestDocument = files?.advanceRequestDocument?.[0];
    const doReleasedDocument = files?.doReleasedDocument?.[0];
    const dpApprovalDocument = files?.dpApprovalDocument?.[0];
    const customsClearanceDocument = files?.customsClearanceDocument?.[0];
    const municipalityDocument = files?.municipalityDocument?.[0];

    if (arrivalNoticeDocument) {
      const uploaded = await uploadBufferToS3(arrivalNoticeDocument, 'shipments/logistics/arrival-notice');
      container.actual.arrivalNoticeDocumentUrl = uploaded.url;
      container.actual.arrivalNoticeDocumentName = uploaded.fileName;
    }
    if (advanceRequestDocument) {
      const uploaded = await uploadBufferToS3(advanceRequestDocument, 'shipments/logistics/advance-request');
      container.actual.advanceRequestDocumentUrl = uploaded.url;
      container.actual.advanceRequestDocumentName = uploaded.fileName;
    }
    if (doReleasedDocument) {
      const uploaded = await uploadBufferToS3(doReleasedDocument, 'shipments/logistics/do-released');
      container.actual.doReleasedDocumentUrl = uploaded.url;
      container.actual.doReleasedDocumentName = uploaded.fileName;
    }
    if (dpApprovalDocument) {
      const uploaded = await uploadBufferToS3(dpApprovalDocument, 'shipments/logistics/dp-approval');
      container.actual.dpApprovalDocumentUrl = uploaded.url;
      container.actual.dpApprovalDocumentName = uploaded.fileName;
    }
    if (customsClearanceDocument) {
      const uploaded = await uploadBufferToS3(customsClearanceDocument, 'shipments/logistics/customs-clearance');
      container.actual.customsClearanceDocumentUrl = uploaded.url;
      container.actual.customsClearanceDocumentName = uploaded.fileName;
    }
    if (municipalityDocument) {
      const uploaded = await uploadBufferToS3(municipalityDocument, 'shipments/logistics/municipality');
      container.actual.municipalityDocumentUrl = uploaded.url;
      container.actual.municipalityDocumentName = uploaded.fileName;
    }

    if (Array.isArray(parsedTransportationBooked)) {
      container.actual.transportationBooked = parsedTransportationBooked.map((row) => ({
        sn: Number(row.sn) || 0,
        containerSerialNo: row.containerSerialNo || '',
        transportCompanyName: row.transportCompanyName || '',
        bookedDate: toDateOrNull(row.bookedDate),
        bookingTime: row.bookingTime || '',
        transportDate: toDateOrNull(row.transportDate),
        transportTime: row.transportTime || '',
        delayHours: Number(row.delayHours) || 0
      }));
    }

    if (Array.isArray(parsedDeliverySchedules)) {
      container.actual.deliverySchedules = parsedDeliverySchedules.map((ds) => ({
        deliveryDate: toDateOrNull(ds.deliveryDate),
        deliveryNo: ds.deliveryNo || '',
        noOfFCL: ds.noOfFCL,
        time: ds.time || '',
        location: ds.location || ''
      }));
    }
    if (Array.isArray(parsedWarehouseSchedules)) {
      container.actual.warehouseSchedules = parsedWarehouseSchedules.map((ws) => ({
        deliveryDate: toDateOrNull(ws.deliveryDate),
        deliveryNo: ws.deliveryNo || '',
        noOfFCL: ws.noOfFCL,
        time: ws.time || '',
        location: ws.location || '',
        grn: ws.grn || ''
      }));
    }

    container.status = "Arrived";
    await container.save();

    const shipment = await Shipment.findById(container.shipmentId);
    if (!shipment) {
      return res.status(500).json({ message: "Shipment not found" });
    }

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

exports.updateStorageDetails = async (req, res) => {
  try {
    const container = await Container.findById(req.params.id);
    if (!container) return res.status(404).json({ message: 'Container not found' });
    if (!container.actual) return res.status(400).json({ message: 'Actual not created yet' });

    const { storageSplits } = req.body;
    const parsedStorageSplits = parseJsonField(storageSplits);
    if (!Array.isArray(parsedStorageSplits)) {
      return res.status(400).json({ message: 'storageSplits must be an array' });
    }

    container.actual.storageSplits = parsedStorageSplits.map((row) => ({
      containerSerialNo: row.containerSerialNo || '',
      warehouse: row.warehouse || '',
      storageAvailability: Number(row.storageAvailability) || 0,
      receivedOnDate: toDateOrNull(row.receivedOnDate),
      receivedOnTime: row.receivedOnTime || '',
      customsInspection: row.customsInspection || 'No',
      grn: row.grn || '',
      batch: row.batch || '',
      productionDate: toDateOrNull(row.productionDate),
      expiryDate: toDateOrNull(row.expiryDate),
      remarks: row.remarks || ''
    }));

    await container.save();
    res.status(200).json({ message: 'Storage details updated successfully', container });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

exports.updateQualityDetails = async (req, res) => {
  try {
    const container = await Container.findById(req.params.id);
    if (!container) return res.status(404).json({ message: 'Container not found' });
    if (!container.actual) return res.status(400).json({ message: 'Actual not created yet' });

    const files = normalizeUploadedFiles(req.files);
    const { qualityRows, qualityReports } = req.body;
    const parsedQualityRows = parseJsonField(qualityRows);
    const parsedQualityReports = parseJsonField(qualityReports);

    const uploadedByField = {};
    for (const [field, list] of Object.entries(files)) {
      const file = Array.isArray(list) ? list[0] : null;
      if (!file) continue;
      const uploaded = await uploadBufferToS3(file, `shipments/quality/${field}`);
      uploadedByField[field] = uploaded;
    }

    if (Array.isArray(parsedQualityRows)) {
      container.actual.qualityRows = parsedQualityRows.map((row, index) => {
        const inhouseUpload = uploadedByField[`qualityRows_${index}_inhouse`];
        const strategicUpload = uploadedByField[`qualityRows_${index}_strategic`];
        const thirdPartyUpload = uploadedByField[`qualityRows_${index}_thirdParty`];
        const existing = container.actual?.qualityRows?.[index] || {};
        return {
          sn: Number(row.sn) || index + 1,
          sampleNo: row.sampleNo || '',
          phase: row.phase || 'S1',
          date: toDateOrNull(row.date),
          inhouseReportNo: row.inhouseReportNo || '',
          inhouseReportDate: toDateOrNull(row.inhouseReportDate),
          inhouseReportDocumentUrl: inhouseUpload?.url || row.inhouseReportDocumentUrl || existing.inhouseReportDocumentUrl || '',
          inhouseReportDocumentName: inhouseUpload?.fileName || row.inhouseReportDocumentName || existing.inhouseReportDocumentName || '',
          strategicReportNo: row.strategicReportNo || '',
          strategicReportDate: toDateOrNull(row.strategicReportDate),
          strategicReportDocumentUrl: strategicUpload?.url || row.strategicReportDocumentUrl || existing.strategicReportDocumentUrl || '',
          strategicReportDocumentName: strategicUpload?.fileName || row.strategicReportDocumentName || existing.strategicReportDocumentName || '',
          thirdPartyReportNo: row.thirdPartyReportNo || '',
          thirdPartyReportDate: toDateOrNull(row.thirdPartyReportDate),
          thirdPartyReportDocumentUrl: thirdPartyUpload?.url || row.thirdPartyReportDocumentUrl || existing.thirdPartyReportDocumentUrl || '',
          thirdPartyReportDocumentName: thirdPartyUpload?.fileName || row.thirdPartyReportDocumentName || existing.thirdPartyReportDocumentName || ''
        };
      });
    }

    if (Array.isArray(parsedQualityReports)) {
      container.actual.qualityReports = parsedQualityReports.map((row, index) => {
        const reportUpload = uploadedByField[`qualityReports_${index}_report`];
        const existing = container.actual?.qualityReports?.[index] || {};
        return {
          phase: row.phase || 'S1',
          reportDate: toDateOrNull(row.reportDate),
          remarks: row.remarks || '',
          documentUrl: reportUpload?.url || row.documentUrl || existing.documentUrl || '',
          documentName: reportUpload?.fileName || row.documentName || existing.documentName || ''
        };
      });
    }

    container.status = 'GRN';
    await container.save();
    res.status(200).json({ message: 'Quality details updated successfully', container });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

exports.updatePaymentCostingDetails = async (req, res) => {
  try {
    const container = await Container.findById(req.params.id);
    if (!container) return res.status(404).json({ message: 'Container not found' });
    if (!container.actual) return res.status(400).json({ message: 'Actual not created yet' });

    const files = normalizeUploadedFiles(req.files);
    const { paymentAllocations, paymentCostings } = req.body;
    const parsedAllocations = parseJsonField(paymentAllocations);
    const parsedCostings = parseJsonField(paymentCostings);

    const uploadedByField = {};
    for (const [field, list] of Object.entries(files)) {
      const file = Array.isArray(list) ? list[0] : null;
      if (!file) continue;
      const uploaded = await uploadBufferToS3(file, `shipments/payment-costing/${field}`);
      uploadedByField[field] = uploaded;
    }

    if (Array.isArray(parsedAllocations)) {
      container.actual.paymentAllocations = parsedAllocations.map((row, index) => ({
        sn: Number(row.sn) || index + 1,
        description: row.description || '',
        requestAmount: Number(row.requestAmount) || 0,
        paidAmount: Number(row.paidAmount) || 0
      }));
    }

    if (Array.isArray(parsedCostings)) {
      container.actual.paymentCostings = parsedCostings.map((row, index) => {
        const refUpload = uploadedByField[`paymentCostings_${index}_refBill`];
        const existing = container.actual?.paymentCostings?.[index] || {};
        return {
          sn: Number(row.sn) || index + 1,
          description: row.description || '',
          requestAmount: Number(row.requestAmount) || 0,
          paidAmount: Number(row.paidAmount) || 0,
          actualPaid: Number(row.actualPaid) || 0,
          refBillNo: row.refBillNo || '',
          refBillDate: toDateOrNull(row.refBillDate),
          refBillVendor: row.refBillVendor || '',
          refBillDocumentUrl: refUpload?.url || row.refBillDocumentUrl || existing.refBillDocumentUrl || '',
          refBillDocumentName: refUpload?.fileName || row.refBillDocumentName || existing.refBillDocumentName || ''
        };
      });
    }

    const overallDoc = files?.paymentCostingDocument?.[0];
    if (overallDoc) {
      const uploaded = await uploadBufferToS3(overallDoc, 'shipments/payment-costing/overall');
      container.actual.paymentCostingDocumentUrl = uploaded.url;
      container.actual.paymentCostingDocumentName = uploaded.fileName;
    }

    await container.save();
    res.status(200).json({ message: 'Payment costing updated successfully', container });
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
      year: s.year,
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
    const shipments = await Shipment.find({})
      .populate('supplierId', 'name country')
      .populate('itemId', 'description itemCode')
      .sort({ orderDate: -1, createdAt: -1 })
      .lean();

    const total = shipments.length;
    const completed = shipments.filter((s) => s.currentStage === 'GRN Completed').length;
    const inProgress = Math.max(total - completed, 0);
    const underClearance = shipments.filter((s) =>
      ['Under Clearance', 'Cleared', 'Released'].includes(s.currentStage)
    ).length;

    const stageMap = new Map();
    shipments.forEach((s) => {
      const stage = s.currentStage || 'Shipment Entry';
      stageMap.set(stage, (stageMap.get(stage) || 0) + 1);
    });

    const stageBreakdown = Array.from(stageMap.entries()).map(([stage, count]) => ({ stage, count }));

    const monthMap = new Map();
    shipments.forEach((s) => {
      const date = s.orderDate ? new Date(s.orderDate) : new Date(s.createdAt);
      if (!date || Number.isNaN(date.getTime())) return;
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const key = `${year}-${month}`;
      monthMap.set(key, (monthMap.get(key) || 0) + 1);
    });

    const monthlyTrend = Array.from(monthMap.entries())
      .map(([key, count]) => {
        const [yearStr, monthStr] = key.split('-');
        const year = Number(yearStr);
        const month = Number(monthStr);
        const label = new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'short' });
        return { label, month, year, count };
      })
      .sort((a, b) => (a.year - b.year) || (a.month - b.month))
      .slice(-6);

    const paymentSummary = shipments.reduce((acc, s) => {
      const totalAmount = Number(s?.payment?.totalAmount || 0);
      const paidAmount = Number(s?.payment?.paidAmount || 0);
      const balanceAmount = Number(s?.payment?.balanceAmount || Math.max(totalAmount - paidAmount, 0));
      const status = String(s?.payment?.paymentStatus || '').toLowerCase();

      acc.totalAmount += totalAmount;
      acc.paidAmount += paidAmount;
      acc.balanceAmount += balanceAmount;

      if (status === 'paid') acc.paidShipments += 1;
      else if (status === 'partially paid') acc.partiallyPaidShipments += 1;
      else acc.pendingShipments += 1;
      return acc;
    }, {
      totalAmount: 0,
      paidAmount: 0,
      balanceAmount: 0,
      pendingShipments: 0,
      partiallyPaidShipments: 0,
      paidShipments: 0
    });

    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfWeek = new Date(startOfToday);
    endOfWeek.setDate(endOfWeek.getDate() + 7);

    const totalContainers = shipments.reduce((sum, s) =>
      sum + Number(s.noOfShipments || s.assumedContainerCount || 1), 0
    );

    const arrivedContainers = shipments
      .filter((s) => ['Arrived', 'Cleared', 'Released', 'GRN Completed'].includes(s.currentStage))
      .reduce((sum, s) => sum + Number(s.noOfShipments || s.assumedContainerCount || 1), 0);

    const clearedContainers = shipments
      .filter((s) => ['Cleared', 'Released', 'GRN Completed'].includes(s.currentStage))
      .reduce((sum, s) => sum + Number(s.noOfShipments || s.assumedContainerCount || 1), 0);

    const dueThisWeekShipments = shipments.filter((s) => {
      if (!s.plannedETA) return false;
      const eta = new Date(s.plannedETA);
      return eta >= startOfToday && eta <= endOfWeek;
    }).length;

    const overdueShipments = shipments.filter((s) => {
      if (!s.plannedETA) return false;
      const eta = new Date(s.plannedETA);
      return eta < startOfToday && !['Cleared', 'Released', 'GRN Completed'].includes(s.currentStage);
    }).length;

    const etaScheduledShipments = shipments.filter((s) => !!s.plannedETA).length;

    const recentShipments = shipments.slice(0, 8).map((s) => ({
      _id: s._id,
      shipmentNo: s.shipmentNo,
      orderDate: s.orderDate || s.createdAt,
      plannedETA: s.plannedETA || null,
      status: s.currentStage || 'Shipment Entry',
      totalAmount: Number(s?.payment?.totalAmount || 0),
      supplier: s?.supplierId?.name || '',
      item: s?.itemId?.description || ''
    }));

    const regionFromCountry = (country) => {
      const c = String(country || '').toLowerCase();
      if (c.includes('uae') || c.includes('saudi') || c.includes('oman') || c.includes('qatar')) return 'NA';
      if (c.includes('india') || c.includes('pakistan') || c.includes('china') || c.includes('japan')) return 'Asia';
      if (c.includes('germany') || c.includes('france') || c.includes('italy') || c.includes('uk')) return 'EUR';
      return 'SA';
    };

    const perfRegions = ['NA', 'EUR', 'Asia', 'SA'];
    const perfMap = new Map(perfRegions.map((r) => [r, []]));
    shipments.forEach((s) => {
      const region = regionFromCountry(s?.supplierId?.country);
      perfMap.get(region).push(s);
    });

    const financialPerformance = perfRegions.map((label) => {
      const rows = perfMap.get(label) || [];
      const qtyAvg = rows.length
        ? rows.reduce((sum, r) => sum + Number(r.plannedQtyMT || 0), 0) / rows.length
        : 0;
      return {
        label,
        cashToCash: Math.round(Math.max(qtyAvg * 0.2, -10)),
        accountRec: Math.round(Math.max(qtyAvg * 0.15, 5)),
        inventoryDays: Math.round(Math.max(qtyAvg * 0.25, 8)),
        payableDays: Math.round(Math.max(qtyAvg * 0.3, 12))
      };
    });

    const inventoryMap = new Map();
    shipments.forEach((s) => {
      const key = String(s.itemId?._id || s.itemId?.itemCode || s._id);
      const existing = inventoryMap.get(key) || {
        category: 'Shipment',
        product: s?.itemId?.description || s.shipmentNo,
        sku: s?.itemId?.itemCode || String(s._id).slice(-6).toUpperCase(),
        inStock: 0
      };
      existing.inStock += Math.max(Math.round(Number(s.plannedQtyMT || 0)), 0);
      inventoryMap.set(key, existing);
    });

    const inventory = Array.from(inventoryMap.values()).slice(0, 6);

    const orders = recentShipments.map((s) => ({
      _id: s._id,
      customer: s.supplier || '-',
      orderStatus: s.status,
      orderDate: s.orderDate
    }));

    const monthlyKpis = monthlyTrend.slice(-5).map((entry, index, rows) => {
      const prev = rows[index - 1]?.count ?? entry.count ?? 1;
      const change = prev ? ((entry.count - prev) / prev) * 100 : 0;
      return {
        metric: `${entry.label} ${entry.year}`,
        thisMonth: entry.count,
        pastMonth: prev,
        change: Number(change.toFixed(1))
      };
    });

    const volumeToday = [
      { label: 'Orders to Ship', value: inProgress },
      { label: 'Overdue Shipments', value: overdueShipments },
      { label: 'Open POs', value: total },
      { label: 'Late Vendor Shipments', value: Math.max(totalContainers - arrivedContainers, 0) }
    ];

    res.status(200).json({
      kpis: {
        totalShipments: total,
        completedShipments: completed,
        inProgressShipments: inProgress,
        underClearanceShipments: underClearance,
        totalPaymentExposure: paymentSummary.balanceAmount
      },
      stageBreakdown,
      monthlyTrend,
      arrivalSummary: {
        totalContainers,
        arrivedContainers,
        pendingArrivalContainers: Math.max(totalContainers - arrivedContainers, 0),
        clearedContainers,
        dueThisWeekShipments,
        overdueShipments,
        etaScheduledShipments
      },
      paymentSummary,
      recentShipments,
      shippingStatus: {
        orders,
        volumeToday,
        inventory,
        financialPerformance,
        monthlyKpis
      }
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
            actualSerialNo: a.actualSerialNo,
            commercialInvoiceNo: a.commercialInvoiceNo,
            shipOnBoardDate: a.shipOnBoardDate,
            size: a.size,
            FCL: a.FCL,
            qtyMT: a.qtyMT,
            bags: a.bags,
            pallet: a.pallet,
            buyingUnit: a.buyingUnit,
            receivedOn: a.receivedOn,
            updatedETD: a.updatedETD,
            updatedETA: a.updatedETA,
            CLNo: a.CLNo,
            BLNo: a.BLNo,
            portOfLoading: a.portOfLoading,
            portOfDischarge: a.portOfDischarge,
            noOfContainers: a.noOfContainers,
            noOfBags: a.noOfBags,
            quantityByMt: a.quantityByMt,
            shippingLine: a.shippingLine,
            freeDetentionDays: a.freeDetentionDays,
            maximumDetentionDays: a.maximumDetentionDays,
            freightPrepared: a.freightPrepared,
            billExtractionData: a.billExtractionData || null,
            extractedContainers: a.extractedContainers || [],
            costSheetBookingDocumentUrl: a.costSheetBookingDocumentUrl,
            costSheetBookingDocumentName: a.costSheetBookingDocumentName,
            costSheetBookings: a.costSheetBookings || [],
            storageAllocations: a.storageAllocations || [],
            DHL: a.DHL,
            courierTrackNo: a.courierTrackNo,
            courierServiceProvider: a.courierServiceProvider,
            docArrivalNotes: a.docArrivalNotes,
            expectedDocDate: a.expectedDocDate,
            receiver: a.receiver,
            bankName: a.bankName,
            inwardCollectionAdviceDate: a.inwardCollectionAdviceDate,
            inwardCollectionAdviceDocumentUrl: a.inwardCollectionAdviceDocumentUrl,
            inwardCollectionAdviceDocumentName: a.inwardCollectionAdviceDocumentName,
            murabahaContractReleasedDate: a.murabahaContractReleasedDate,
            murabahaContractApprovedDate: a.murabahaContractApprovedDate,
            murabahaContractSubmittedDate: a.murabahaContractSubmittedDate,
            murabahaContractSubmittedDocumentUrl: a.murabahaContractSubmittedDocumentUrl,
            murabahaContractSubmittedDocumentName: a.murabahaContractSubmittedDocumentName,
            documentsReleasedDate: a.documentsReleasedDate,
            documentsReleasedDocumentUrl: a.documentsReleasedDocumentUrl,
            documentsReleasedDocumentName: a.documentsReleasedDocumentName,
            bankAdvanceAmountDocumentUrl: a.bankAdvanceAmountDocumentUrl,
            bankAdvanceApprovedDocumentUrl: a.bankAdvanceApprovedDocumentUrl,
            bankAdvanceSubmittedOn: a.bankAdvanceSubmittedOn,
            docToBeReleasedOn: a.docToBeReleasedOn,
            arrivalOn: a.arrivalOn,
            shipmentFreeRetentionDate: a.shipmentFreeRetentionDate,
            portRetentionWithPenaltyDate: a.portRetentionWithPenaltyDate,
            arrivalNoticeDate: a.arrivalNoticeDate,
            arrivalNoticeDocumentUrl: a.arrivalNoticeDocumentUrl,
            arrivalNoticeDocumentName: a.arrivalNoticeDocumentName,
            advanceRequestDate: a.advanceRequestDate,
            advanceRequestDocumentUrl: a.advanceRequestDocumentUrl,
            advanceRequestDocumentName: a.advanceRequestDocumentName,
            doReleasedDate: a.doReleasedDate,
            doReleasedDocumentUrl: a.doReleasedDocumentUrl,
            doReleasedDocumentName: a.doReleasedDocumentName,
            doReleasedRemarks: a.doReleasedRemarks,
            dpApprovalDate: a.dpApprovalDate,
            dpApprovalDocumentUrl: a.dpApprovalDocumentUrl,
            dpApprovalDocumentName: a.dpApprovalDocumentName,
            dpApprovalRemarks: a.dpApprovalRemarks,
            tokenReceivedDate: a.tokenReceivedDate,
            municipalityDate: a.municipalityDate,
            municipalityDocumentUrl: a.municipalityDocumentUrl,
            municipalityDocumentName: a.municipalityDocumentName,
            municipalityRemarks: a.municipalityRemarks,
            customsClearanceRemarks: a.customsClearanceRemarks,
            clearExpectedOn: a.clearExpectedOn,
            shipmentArrivedOn: a.shipmentArrivedOn,
            deliveryOrderDocumentUrl: a.deliveryOrderDocumentUrl,
            deliveryOrderDate: a.deliveryOrderDate,
            tokenDocumentUrl: a.tokenDocumentUrl,
            tokenDate: a.tokenDate,
            transportArrangedDocumentUrl: a.transportArrangedDocumentUrl,
            transportArrangedDate: a.transportArrangedDate,
            customsClearanceDocumentUrl: a.customsClearanceDocumentUrl,
            customsClearanceDate: a.customsClearanceDate,
            municipalityClearanceDocumentUrl: a.municipalityClearanceDocumentUrl,
            municipalityClearanceDate: a.municipalityClearanceDate,
            deliverySchedules: a.deliverySchedules || [],
            warehouseSchedules: a.warehouseSchedules || [],
            transportationBooked: a.transportationBooked || [],
            storageSplits: a.storageSplits || [],
            qualityRows: a.qualityRows || [],
            qualityReports: a.qualityReports || [],
            paymentAllocations: a.paymentAllocations || [],
            paymentCostings: a.paymentCostings || [],
            paymentCostingDocumentUrl: a.paymentCostingDocumentUrl,
            paymentCostingDocumentName: a.paymentCostingDocumentName,
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

    for (const row of actual) {
      const signedStep3Doc = await toSignedDocument(row.costSheetBookingDocumentUrl, row.costSheetBookingDocumentName);
      row.costSheetBookingDocumentUrl = signedStep3Doc.url;
      row.costSheetBookingDocumentName = signedStep3Doc.name;

      const signedInwardAdvice = await toSignedDocument(row.inwardCollectionAdviceDocumentUrl, row.inwardCollectionAdviceDocumentName);
      row.inwardCollectionAdviceDocumentUrl = signedInwardAdvice.url;
      row.inwardCollectionAdviceDocumentName = signedInwardAdvice.name;

      const signedMurabaha = await toSignedDocument(row.murabahaContractSubmittedDocumentUrl, row.murabahaContractSubmittedDocumentName);
      row.murabahaContractSubmittedDocumentUrl = signedMurabaha.url;
      row.murabahaContractSubmittedDocumentName = signedMurabaha.name;

      const signedReleased = await toSignedDocument(row.documentsReleasedDocumentUrl, row.documentsReleasedDocumentName);
      row.documentsReleasedDocumentUrl = signedReleased.url;
      row.documentsReleasedDocumentName = signedReleased.name;

      const signedArrivalNotice = await toSignedDocument(row.arrivalNoticeDocumentUrl, row.arrivalNoticeDocumentName);
      row.arrivalNoticeDocumentUrl = signedArrivalNotice.url;
      row.arrivalNoticeDocumentName = signedArrivalNotice.name;

      const signedAdvance = await toSignedDocument(row.advanceRequestDocumentUrl, row.advanceRequestDocumentName);
      row.advanceRequestDocumentUrl = signedAdvance.url;
      row.advanceRequestDocumentName = signedAdvance.name;

      const signedDoReleased = await toSignedDocument(row.doReleasedDocumentUrl, row.doReleasedDocumentName);
      row.doReleasedDocumentUrl = signedDoReleased.url;
      row.doReleasedDocumentName = signedDoReleased.name;

      const signedDpApproval = await toSignedDocument(row.dpApprovalDocumentUrl, row.dpApprovalDocumentName);
      row.dpApprovalDocumentUrl = signedDpApproval.url;
      row.dpApprovalDocumentName = signedDpApproval.name;

      const signedCustoms = await toSignedDocument(row.customsClearanceDocumentUrl, row.customsClearanceDocumentName);
      row.customsClearanceDocumentUrl = signedCustoms.url;
      row.customsClearanceDocumentName = signedCustoms.name;

      const signedMunicipality = await toSignedDocument(row.municipalityDocumentUrl, row.municipalityDocumentName);
      row.municipalityDocumentUrl = signedMunicipality.url;
      row.municipalityDocumentName = signedMunicipality.name;

      const signedPaymentCosting = await toSignedDocument(row.paymentCostingDocumentUrl, row.paymentCostingDocumentName);
      row.paymentCostingDocumentUrl = signedPaymentCosting.url;
      row.paymentCostingDocumentName = signedPaymentCosting.name;

      row.qualityRows = await Promise.all((row.qualityRows || []).map(async (qualityRow) => {
        const plainQualityRow = toPlainObject(qualityRow);
        const inhouse = await toSignedDocument(qualityRow.inhouseReportDocumentUrl, qualityRow.inhouseReportDocumentName);
        const strategic = await toSignedDocument(qualityRow.strategicReportDocumentUrl, qualityRow.strategicReportDocumentName);
        const thirdParty = await toSignedDocument(qualityRow.thirdPartyReportDocumentUrl, qualityRow.thirdPartyReportDocumentName);
        return {
          ...plainQualityRow,
          inhouseReportDocumentUrl: inhouse.url,
          inhouseReportDocumentName: inhouse.name,
          strategicReportDocumentUrl: strategic.url,
          strategicReportDocumentName: strategic.name,
          thirdPartyReportDocumentUrl: thirdParty.url,
          thirdPartyReportDocumentName: thirdParty.name,
        };
      }));

      row.qualityReports = await Promise.all((row.qualityReports || []).map(async (reportRow) => {
        const plainReportRow = toPlainObject(reportRow);
        const signed = await toSignedDocument(reportRow.documentUrl, reportRow.documentName);
        return {
          ...plainReportRow,
          documentUrl: signed.url,
          documentName: signed.name,
        };
      }));

      row.paymentCostings = await Promise.all((row.paymentCostings || []).map(async (costingRow) => {
        const plainCostingRow = toPlainObject(costingRow);
        const signed = await toSignedDocument(costingRow.refBillDocumentUrl, costingRow.refBillDocumentName);
        return {
          ...plainCostingRow,
          refBillDocumentUrl: signed.url,
          refBillDocumentName: signed.name,
        };
      }));
    }

    const signedLpoUrl = shipment.lpoDocumentUrl
      ? await createSignedGetUrl(shipment.lpoDocumentUrl, 900).catch(() => shipment.lpoDocumentUrl)
      : null;
    const signedProformaUrl = shipment.proformaDocumentUrl
      ? await createSignedGetUrl(shipment.proformaDocumentUrl, 900).catch(() => shipment.proformaDocumentUrl)
      : null;
    const signedS1QualityUrl = shipment.s1QualityReportUrl
      ? await createSignedGetUrl(shipment.s1QualityReportUrl, 900).catch(() => shipment.s1QualityReportUrl)
      : null;

    res.status(200).json({
      shipment: {
        _id: shipment._id,
        shipmentNo: shipment.shipmentNo,
        orderNumber: shipment.poNumber,
        poNumber: shipment.poNumber,
        fpoNo: shipment.fpoNo,
        orderDate: shipment.orderDate,
        supplier: shipment.supplierName || shipment.supplierId?.name || null,
        itemCode: shipment.itemCode || shipment.itemId?.itemCode || null,
        commodity: shipment.commodity || null,
        countryOfOrigin: shipment.countryOfOrigin || null,
        itemDescription: shipment.itemDescription || shipment.itemId?.description || null,
        item: shipment.itemId
          ? `${shipment.itemId.itemCode} - ${shipment.itemId.description}`
          : (shipment.itemCode || shipment.itemDescription
            ? `${shipment.itemCode || ''}${shipment.itemCode && shipment.itemDescription ? ' - ' : ''}${shipment.itemDescription || ''}`.trim()
            : null),
        riceName: shipment.brandName || shipment.itemId?.riceName,
        packing: shipment.packing || shipment.itemId?.packing,
        piNo: shipment.piNo,
        totalOrderedQtyMT: shipment.totalOrderedQtyMT,
        plannedQtyMT: shipment.plannedQtyMT,
        actualQtyMT: shipment.actualQtyMT,
        assumedContainerCount: shipment.assumedContainerCount ?? shipment.totalSplitQtyMT,
        currentStage: shipment.currentStage,
        payment: shipment.payment.totalAmount,
        incoterms: shipment.incoterms,
        buyunit: shipment.buyunit,
        fcPerUnit: shipment.fcPerUnit,
        advanceAmount: shipment.advanceAmount,
        paymentTerms: shipment.paymentTerms,
        bankName: shipment.bankName,
        barcode: shipment.barcode,
        variant: shipment.variant,
        hsCode: shipment.hsCode,
        lpoDocumentName: shipment.lpoDocumentName || null,
        lpoDocumentUrl: signedLpoUrl,
        proformaDocumentName: shipment.proformaDocumentName || null,
        proformaDocumentUrl: signedProformaUrl,
        s1QualityReportName: shipment.s1QualityReportName || null,
        s1QualityReportUrl: signedS1QualityUrl,
        q1Report: shipment.q1Report || null,
        plannedETD: shipment.plannedETD,
        plannedETA: shipment.plannedETA,
        containerSize: shipment.containersize,
        noOfShipments: shipment.noOfShipments
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

  // Packaging / quantity (lpo_invoice.packaging e.g. "10 Kg", or performa_invoice.packaging)
  const packaging = pi.packaging ?? lpo.packaging;
  if (packaging != null && packaging !== '') out.packagingType = String(packaging).trim();

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

  // shipment_calculations: pass through and use for fcl, pallet, bags, containerSize
  const sc = pythonRes.shipment_calculations;
  if (sc && typeof sc === 'object') {
    if (sc.fcl != null) out.fcl = Number(sc.fcl);
    if (sc.pallets != null) out.pallet = Number(sc.pallets);
    if (sc.bags != null) out.bags = Number(sc.bags);
    if (sc.container_size != null && sc.container_size !== '') {
      const size = String(sc.container_size).trim().toLowerCase();
      if (size.startsWith('40')) out.containerSize = '40';
      else if (size.startsWith('20')) out.containerSize = '20';
    }
    out.shipmentCalculations = {
      fcl: sc.fcl != null ? Number(sc.fcl) : undefined,
      bags: sc.bags != null ? Number(sc.bags) : undefined,
      container_size: sc.container_size != null ? String(sc.container_size) : undefined,
      bags_per_container: sc.bags_per_container != null ? Number(sc.bags_per_container) : undefined,
      pallets: sc.pallets != null ? Number(sc.pallets) : undefined,
      is_price_matching: sc.is_price_matching === true,
      lpo_price_per_mt: sc.lpo_price_per_mt != null ? Number(sc.lpo_price_per_mt) : undefined,
      pi_price_per_mt: sc.pi_price_per_mt != null ? Number(sc.pi_price_per_mt) : undefined,
      mt_variation: sc.mt_variation != null ? Number(sc.mt_variation) : undefined,
      diff_percent: sc.diff_percent != null ? Number(sc.diff_percent) : undefined
    };
  }

  // S1 quality report payload from Python extraction response
  // Kept as nested object so frontend can use full extracted structure as needed.
  if (pythonRes.s1_quality_report && typeof pythonRes.s1_quality_report === 'object') {
    out.q1Report = pythonRes.s1_quality_report;
  }

  return out;
}

// =======================
// EXTRACT FROM DOCUMENTS — calls Python API, maps response to frontend shape
// Frontend sends: document1 = Purchase order (LPO), document2 = Performa Invoice (PI), s1QualityReport
// Python API expects: lpo_invoice, performa_invoice, rice_quality_report (with optional inco_terms_list, suppliers)
// =======================
exports.extractFromDocuments = async (req, res) => {
  try {
    const files = req.files;
    // document1 = Purchase order → lpo_invoice, document2 = Performa Invoice → performa_invoice,
    // s1QualityReport = quality report → rice_quality_report
    if (!files?.document1?.[0] || !files?.document2?.[0] || !files?.s1QualityReport?.[0]) {
      return res.status(400).json({
        message: 'Purchase order (document1), Pro-forma Invoice (document2), and S1 Quality Report (s1QualityReport) are required'
      });
    }

    const pythonUrl = process.env.PYTHON_EXTRACTION_API_URL || 'http://localhost:8096';
    const endpoint = `${pythonUrl.replace(/\/$/, '')}/shipment-form`;
    const incoTermsList = process.env.PYTHON_INCO_TERMS_LIST || 'CIF,FOB,EXWORKS';
    const suppliersList = process.env.PYTHON_SUPPLIERS_LIST || '';

    const lpoFile = files.document1[0];
    const piFile = files.document2[0];
    const qualityFile = files.s1QualityReport[0];

    const FormData = globalThis.FormData;
    const form = new FormData();
    const lpoBlob = new Blob([lpoFile.buffer], { type: lpoFile.mimetype || 'application/octet-stream' });
    const piBlob = new Blob([piFile.buffer], { type: piFile.mimetype || 'application/octet-stream' });
    const qualityBlob = new Blob([qualityFile.buffer], { type: qualityFile.mimetype || 'application/octet-stream' });
    form.append('lpo_invoice', lpoBlob, lpoFile.originalname || 'lpo.pdf');
    form.append('performa_invoice', piBlob, piFile.originalname || 'pi.pdf');
    form.append('rice_quality_report', qualityBlob, qualityFile.originalname || 'quality-report.pdf');
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

// =======================
// EXTRACT BILL NO — calls Python bill-no endpoint (single file: PDF or image)
// =======================
exports.extractBillNo = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'File is required' });
    }

    const baseUrl = (
      process.env.PYTHON_EXTRACTION_API_URL
    ).replace(/\/$/, '');
    const configuredPath = process.env.PYTHON_BILLNO_PATH;
    const candidatePaths = configuredPath
      ? [configuredPath]
      : ['/purchase-tracker/fetch-details'];

    const FormData = globalThis.FormData;
    let response = null;
    let lastErrorPayload = null;

    for (const path of candidatePaths) {
      const endpoint = `${baseUrl}/${String(path).replace(/^\/+/, '')}`;
      console.log("endpoint", endpoint);
      const form = new FormData();
      const blob = new Blob([req.file.buffer], { type: req.file.mimetype || 'application/octet-stream' });
      form.append('file', blob, req.file.originalname || 'document');

      response = await fetch(endpoint, {
        method: 'POST',
        body: form
      });

      if (response.ok) break;

      const errText = await response.text();
      let errJson;
      try { errJson = JSON.parse(errText); } catch { errJson = { detail: errText }; }
      lastErrorPayload = { endpoint, status: response.status, error: errJson };

      // Common endpoint mismatch; try next candidate route.
      if ([404, 405].includes(response.status)) continue;
      return res.status(response.status).json({
        message: errJson.detail || errJson.message || `Bill-no extraction service returned ${response.status}`,
        error: { ...errJson, endpoint }
      });
    }

    if (!response || !response.ok) {
      return res.status(lastErrorPayload?.status || 502).json({
        message: 'Bill-no extraction endpoint mismatch. Check Python bill-no route configuration.',
        error: lastErrorPayload || {}
      });
    }

    const pythonRes = await response.json();
    return res.status(200).json({
      bill_no: pythonRes.bill_no || pythonRes.billNo || pythonRes.data?.bill_no || '',
      invoice_number: pythonRes.invoice_number || pythonRes.invoiceNumber || pythonRes.data?.invoice_number || '',
      metadata: pythonRes.metadata,
      ...pythonRes
    });
  } catch (err) {
    console.error('Extract bill no error:', err);
    const isNetwork = err.cause?.code === 'ECONNREFUSED' || err.code === 'ECONNREFUSED';
    return res.status(500).json({
      message: isNetwork
        ? 'Bill-no extraction service unavailable. Check PYTHON_BILLNO_API_URL/PYTHON_EXTRACTION_API_URL and that the Python service is running.'
        : (err.message || 'Server error'),
      error: err.message
    });
  }
};
