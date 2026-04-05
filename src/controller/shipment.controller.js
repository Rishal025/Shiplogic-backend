
const Shipment = require('../models/shipment.model');
const Container = require('../models/container.model');
const Supplier = require('../models/supplier.model');
const SupplierAccount = require('../models/supplierAccount.model');
const Item = require('../models/item.model');
const logAudit = require('../models/auditLog.model');
const { uploadBufferToS3, createSignedGetUrl } = require('../core/utils/s3Upload');
const { calculateSupplierOnboardingState } = require('../core/utils/supplierOnboarding');
const { sendSupplierInviteEmail } = require('../services/mail.service');
const mongoose = require('mongoose');
const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');
const crypto = require('crypto');

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

const toTimeString = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 5);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
  }
  return '';
};

const combineDateTime = (dateValue, timeValue) => {
  const date = toDateOrNull(dateValue);
  const time = toTimeString(timeValue);
  if (!date || !time) return null;
  const [hours, minutes] = time.split(':').map((part) => Number(part));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  const combined = new Date(date);
  combined.setHours(hours, minutes, 0, 0);
  return combined;
};

const calculateDelayHours = (transportDateValue, transportTimeValue, receivedDateValue, receivedTimeValue) => {
  const transportDateTime = combineDateTime(transportDateValue, transportTimeValue);
  const receivedDateTime = combineDateTime(receivedDateValue, receivedTimeValue);
  if (!transportDateTime || !receivedDateTime) return 0;
  const diffHours = (receivedDateTime.getTime() - transportDateTime.getTime()) / (1000 * 60 * 60);
  return diffHours > 0 ? Number(diffHours.toFixed(2)) : 0;
};

const addDays = (dateValue, days) => {
  const date = toDateOrNull(dateValue);
  if (!date || !Number.isFinite(Number(days))) return null;
  const result = new Date(date);
  result.setDate(result.getDate() + Number(days));
  return result;
};

const formatDateValue = (value) => {
  const date = toDateOrNull(value);
  if (!date) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

const formatDateTimeValue = (value) => {
  const date = toDateOrNull(value);
  if (!date) return '';
  return date.toLocaleString('en-US', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
};

const SHIPMENT_REPORT_COLUMNS = [
  { header: 'S/N', key: 'sn', width: 8 },
  { header: 'Year', key: 'year', width: 10 },
  { header: 'Shipment No.', key: 'shipmentNo', width: 24 },
  { header: 'Date', key: 'date', width: 14 },
  { header: 'Supplier', key: 'supplier', width: 28 },
  { header: 'Country', key: 'country', width: 16 },
  { header: 'Variant', key: 'variant', width: 18 },
  { header: 'Item Description', key: 'itemDescription', width: 34 },
  { header: 'Rice Name', key: 'riceName', width: 18 },
  { header: 'Packing', key: 'packing', width: 12 },
  { header: 'PI No.', key: 'piNo', width: 20 },
  { header: 'CI No.', key: 'ciNo', width: 20 },
  { header: 'FCL', key: 'fcl', width: 10 },
  { header: 'Cont. Size', key: 'containerSize', width: 12 },
  { header: 'Buying Unit', key: 'buyingUnit', width: 14 },
  { header: 'Buying Qty (MT)', key: 'buyingQtyMT', width: 16 },
  { header: 'FC per Unit', key: 'fcPerUnit', width: 14 },
  { header: 'Total FC', key: 'totalFC', width: 16 },
  { header: 'Inco Terms', key: 'incoterms', width: 14 },
  { header: 'PO Number', key: 'poNumber', width: 20 },
  { header: 'FPO Number', key: 'fpoNo', width: 20 },
  { header: 'Bank Name', key: 'bankName', width: 18 },
  { header: 'Payment Terms', key: 'paymentTerms', width: 18 },
  { header: 'Current Stage', key: 'currentStage', width: 18 },
  { header: 'No. of Shipments', key: 'noOfShipments', width: 16 },
  { header: 'Port of Loading', key: 'portOfLoading', width: 20 },
  { header: 'Port of Discharge', key: 'portOfDischarge', width: 20 },
  { header: 'Planned ETD', key: 'plannedETD', width: 14 },
  { header: 'Planned ETA', key: 'plannedETA', width: 14 },
  { header: 'Advance Amount', key: 'advanceAmount', width: 16 },
  { header: 'Bags', key: 'bags', width: 12 },
  { header: 'Pallet', key: 'pallet', width: 12 },
];

const formatReportCellValue = (value, key) => {
  if (value == null || value === '') return '';
  if (typeof value === 'number') {
    if (['fcPerUnit', 'totalFC', 'advanceAmount'].includes(key)) {
      return Number(value).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    }
    return value;
  }
  return String(value);
};

const hasValue = (value) => String(value ?? '').trim().length > 0;

const generateTempPassword = (length = Number(process.env.INVITE_PASSWORD_LENGTH || 10)) => {
  const targetLength = Number.isFinite(length) && length >= 8 ? length : 10;
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const bytes = crypto.randomBytes(targetLength);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
};

const generateSupplierCode = async () => {
  let unique = false;
  let code = '';

  while (!unique) {
    code = `SUP-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    // eslint-disable-next-line no-await-in-loop
    const existing = await Supplier.findOne({ supplierCode: code }).lean();
    if (!existing) {
      unique = true;
    }
  }

  return code;
};

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const findSupplierByName = async (name) => {
  if (!hasValue(name)) return null;
  const normalizedName = escapeRegex(String(name).trim());
  return Supplier.findOne({
    $or: [{ name: new RegExp(`^${normalizedName}$`, 'i') }, { companyName: new RegExp(`^${normalizedName}$`, 'i') }],
  });
};

const ensureSupplierPortalAccessForShipment = async (shipment) => {
  const normalizedSupplierEmail = normalizeEmail(shipment?.supplierEmail);
  if (!hasValue(normalizedSupplierEmail) || !hasValue(shipment?.supplierName)) {
    return {
      supplier: shipment?.supplierId ? await Supplier.findById(shipment.supplierId) : null,
      supplierCreated: false,
      inviteSent: null,
      inviteStatusMessage: '',
    };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedSupplierEmail)) {
    throw new Error('A valid supplierEmail is required before locking the baseline.');
  }

  let supplier = shipment?.supplierId ? await Supplier.findById(shipment.supplierId) : null;
  let supplierAccount = null;
  let supplierCreated = false;
  let inviteSent = null;
  let inviteStatusMessage = '';
  let temporaryPassword = '';

  if (supplier) {
    supplierAccount = await SupplierAccount.findOne({ supplierId: supplier._id });
  } else {
    supplierAccount = await SupplierAccount.findOne({ email: normalizedSupplierEmail });
    if (supplierAccount) {
      supplier = await Supplier.findById(supplierAccount.supplierId);
    }

    if (!supplier) {
      supplier = await Supplier.findOne({ contactEmail: normalizedSupplierEmail });
      if (supplier) {
        supplierAccount = await SupplierAccount.findOne({ supplierId: supplier._id });
      }
    }

    if (!supplier) {
      supplier = await findSupplierByName(shipment.supplierName);
      if (supplier) {
        supplierAccount = await SupplierAccount.findOne({ supplierId: supplier._id });
      }
    }
  }

  if (supplier && supplier.contactEmail && normalizeEmail(supplier.contactEmail) !== normalizedSupplierEmail) {
    throw new Error('Supplier email does not match the existing supplier record.');
  }

  if (!supplier) {
    if (!hasValue(shipment.countryOfOrigin)) {
      throw new Error('Country of origin is required to create a new supplier invite.');
    }

    const supplierCode = await generateSupplierCode();
    const onboardingState = calculateSupplierOnboardingState({
      name: shipment.supplierName,
      companyName: shipment.supplierName,
      country: shipment.countryOfOrigin,
      contactEmail: normalizedSupplierEmail,
    });

    supplier = await Supplier.create({
      supplierCode,
      name: shipment.supplierName,
      companyName: shipment.supplierName,
      country: shipment.countryOfOrigin,
      status: 'Pending',
      contactEmail: normalizedSupplierEmail,
      registrationStage: onboardingState.registrationStage,
      profileCompletionPercent: onboardingState.profileCompletionPercent,
      profileCompletedAt: onboardingState.profileCompletedAt,
    });

    temporaryPassword = generateTempPassword();
    supplierAccount = await SupplierAccount.create({
      supplierId: supplier._id,
      email: normalizedSupplierEmail,
      password: temporaryPassword,
      isActive: true,
      mustChangePassword: true,
    });
    supplierCreated = true;
  } else if (!supplierAccount) {
    temporaryPassword = generateTempPassword();
    supplierAccount = await SupplierAccount.create({
      supplierId: supplier._id,
      email: normalizedSupplierEmail,
      password: temporaryPassword,
      isActive: true,
      mustChangePassword: true,
    });
    supplierCreated = true;
  }

  let supplierChanged = false;
  if (supplier && !supplier.contactEmail) {
    supplier.contactEmail = normalizedSupplierEmail;
    supplierChanged = true;
  }
  if (supplier && !shipment.supplierId) {
    shipment.supplierId = supplier._id;
    supplierChanged = true;
  }
  if (supplierChanged) {
    await supplier.save();
    await shipment.save();
  }

  if (temporaryPassword && supplierAccount) {
    try {
      await sendSupplierInviteEmail({
        to: supplierAccount.email,
        supplierName: supplier.name || supplier.companyName || shipment.supplierName || 'Supplier',
        temporaryPassword,
      });
      inviteSent = true;
      inviteStatusMessage = 'Invite email sent successfully.';
    } catch (mailError) {
      inviteSent = false;
      inviteStatusMessage = mailError.message || 'Supplier account was created, but invite email could not be sent.';
    }
  }

  return { supplier, supplierCreated, inviteSent, inviteStatusMessage };
};

const buildShipmentReportRows = async () => {
  const shipments = await Shipment.find({})
    .populate('supplierId', 'name')
    .populate('itemId', 'description')
    .sort({ createdAt: -1, orderDate: -1 })
    .lean();

  const shipmentIds = shipments.map((shipment) => shipment._id);
  const containers = await Container.find({ shipmentId: { $in: shipmentIds } })
    .sort({ createdAt: 1 })
    .lean();

  const containerMap = new Map();
  containers.forEach((container) => {
    const key = String(container.shipmentId);
    if (!containerMap.has(key)) {
      containerMap.set(key, []);
    }
    containerMap.get(key).push(container);
  });

  const rows = shipments.map((shipment, index) => {
    const shipmentContainers = containerMap.get(String(shipment._id)) || [];
    const firstContainer = shipmentContainers[0] || null;
    const actual = firstContainer?.actual || {};
    const planned = firstContainer?.planned || {};

    return {
      sn: index + 1,
      year: shipment.year || '',
      shipmentNo: shipment.shipmentNo || '',
      date: formatDateValue(shipment.orderDate),
      supplier: shipment.supplierId?.name || shipment.supplierName || '',
      country: shipment.countryOfOrigin || '',
      variant: shipment.variant || '',
      itemDescription: shipment.itemId?.description || shipment.itemDescription || '',
      riceName: shipment.brandName || '',
      packing: shipment.packing || '',
      piNo: shipment.piNo || '',
      ciNo: actual.commercialInvoiceNo || '',
      fcl: actual.FCL ?? planned.FCL ?? shipment.fcl ?? '',
      containerSize: actual.size || planned.size || shipment.containersize || '',
      buyingUnit: actual.buyingUnit || planned.buyingUnit || shipment.buyunit || '',
      buyingQtyMT: actual.qtyMT ?? planned.qtyMT ?? shipment.plannedQtyMT ?? '',
      fcPerUnit: shipment.fcPerUnit ?? '',
      totalFC: shipment.totalFC ?? '',
      incoterms: shipment.incoterms || '',
      poNumber: shipment.poNumber || '',
      fpoNo: shipment.fpoNo || '',
      bankName: shipment.bankName || '',
      paymentTerms: shipment.paymentTerms || '',
      currentStage: shipment.currentStage || '',
      noOfShipments: shipment.noOfShipments ?? shipment.assumedContainerCount ?? '',
      portOfLoading: shipment.portOfLoading || actual.portOfLoading || '',
      portOfDischarge: shipment.portOfDischarge || actual.portOfDischarge || '',
      plannedETD: formatDateValue(shipment.plannedETD || planned.etd || actual.updatedETD),
      plannedETA: formatDateValue(shipment.plannedETA || planned.eta || actual.updatedETA),
      advanceAmount: shipment.advanceAmount ?? '',
      bags: actual.bags ?? planned.bags ?? shipment.bags ?? '',
      pallet: actual.pallet ?? shipment.pallet ?? '',
    };
  });

  return rows;
};

// Stage order — used to advance shipment status only forward
const STAGE_ORDER = [
  "Shipment Entry",
  "Planned Split",
  "Shipment Split",
  "B/L Details",
  "Documentation",
  "Port & Customs",
  "Storage",
  "Quality",
  "Payment Costing",
  "Completed"
];

const advanceShipmentStage = (shipment, newStage) => {
  const current = STAGE_ORDER.indexOf(shipment.currentStage);
  const next = STAGE_ORDER.indexOf(newStage);
  if (next > current) {
    shipment.currentStage = newStage;
  }
};

exports.createShipment = async (req, res) => {
  try {
    const {
      orderDate,
      poNumber,
      year,
      supplierId,
      supplierName,
      supplierEmail,
      piNo,
      piDate,
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
      fcl,
      pallet,
      bags,
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
      ,
      itemsJson
    } = req.body;

    const files = req.files || {};
    const lpoDocument = files?.lpoDocument?.[0];
    const proformaDocument = files?.proformaDocument?.[0];
    const s1QualityReport = files?.s1QualityReport?.[0];

    // 1️⃣ Basic validation (itemId now optional)
    const parsedQ1Report = parseJsonField(q1Report);
    const parsedItems = parseJsonField(itemsJson);
    const normalizedLineItems = Array.isArray(parsedItems)
      ? parsedItems.map((item, index) => {
          const quantity = Number(item?.plannedContainers) || 0;
          const price = Number(item?.fcPerUnit) || 0;
          const total = item?.totalUSD != null && item?.totalUSD !== '' ? Number(item.totalUSD) : quantity * price;
          return {
            lineNo: Number(item?.lineNo) || index + 1,
            itemCode: String(item?.itemCode || '').trim(),
            itemDescription: String(item?.itemDescription || '').trim(),
            commodity: String(item?.commodity || '').trim(),
            countryOfOrigin: String(item?.countryOfOrigin || '').trim(),
            brandName: String(item?.brandName || '').trim(),
            packagingType: String(item?.packagingType || '').trim(),
            containerSize: item?.containerSize != null && item?.containerSize !== '' ? String(item.containerSize).trim() : '',
            plannedContainers: quantity,
            fcl: Number(item?.fcl) || 0,
            pallet: Number(item?.pallet) || 0,
            bags: Number(item?.bags) || 0,
            buyingUnit: String(item?.buyingUnit || '').trim(),
            fclPerUnit: Number(item?.fclPerUnit) || 0,
            fcPerUnit: price,
            totalUSD: total,
            totalAED: item?.totalAED != null && item?.totalAED !== '' ? Number(item.totalAED) : Math.round(total * 3.67 * 100) / 100,
            expectedETD: toDateOrNull(item?.expectedETD),
            expectedETA: toDateOrNull(item?.expectedETA)
          };
        }).filter((item) => item.itemCode || item.itemDescription || item.plannedContainers || item.totalUSD)
      : [];

    const derivedLineItems = normalizedLineItems.length ? normalizedLineItems : [];
    const derivedQty = derivedLineItems.length ? derivedLineItems.reduce((sum, item) => sum + (item.plannedContainers || 0), 0) : Number(plannedQtyMT) || 0;
    const derivedFcl = derivedLineItems.length ? derivedLineItems.reduce((sum, item) => sum + (item.fcl || 0), 0) : Number(fcl) || 0;
    const derivedPallet = derivedLineItems.length ? derivedLineItems.reduce((sum, item) => sum + (item.pallet || 0), 0) : Number(pallet) || 0;
    const derivedBags = derivedLineItems.length ? derivedLineItems.reduce((sum, item) => sum + (item.bags || 0), 0) : Number(bags) || 0;
    const derivedTotalAmount = derivedLineItems.length ? derivedLineItems.reduce((sum, item) => sum + (item.totalUSD || 0), 0) : null;
    const derivedRate = derivedLineItems.length
      ? (derivedQty > 0 ? Number((derivedTotalAmount / derivedQty).toFixed(2)) : Number(derivedLineItems[0]?.fcPerUnit) || 0)
      : Number(fcPerUnit) || 0;
    const uniqueJoin = (values, fallback = '') => {
      const cleaned = [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
      if (!cleaned.length) return fallback;
      return cleaned.length === 1 ? cleaned[0] : `Multiple (${cleaned.length})`;
    };
    const primaryItem = derivedLineItems[0] || null;

    if (!poNumber || !orderDate || !(supplierId || supplierName) || !(derivedQty || plannedQtyMT) || !piNo || !incoterms || !(buyunit || derivedLineItems.length) || !paymentTerms || !totalSplitQtyMT || !supplierEmail) {
      return res.status(400).json({ message: "Required fields missing" });
    }
    if (!lpoDocument || !s1QualityReport) {
      return res.status(400).json({
        message: 'Required documents missing: lpoDocument and s1QualityReport are mandatory'
      });
    }

    // 2️⃣ Validate supplier
    const normalizedSupplierEmail = normalizeEmail(supplierEmail);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedSupplierEmail)) {
      return res.status(400).json({ message: 'A valid supplierEmail is required' });
    }

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

    const extractPurchaseSuffix = (value) => {
      const cleaned = String(value || '')
        .toUpperCase()
        .trim();

      const poMatch = cleaned.match(/PO[\s\-_/]*([A-Z0-9]+)/);
      if (poMatch?.[1]) {
        return `PO${poMatch[1]}`;
      }

      const parts = cleaned.split(/[^A-Z0-9]+/).filter(Boolean);
      const tail = parts[parts.length - 1];
      return tail ? `PO${tail}` : 'PO00';
    };

    let shipmentRunningNo = (await Shipment.countDocuments()) + 1;
    let trackerSerial = `RHST-${String(shipmentRunningNo).padStart(4, '0')}/${extractPurchaseSuffix(fpoNo || poNumber)}`;
    while (await Shipment.exists({ shipmentNo: trackerSerial })) {
      shipmentRunningNo += 1;
      trackerSerial = `RHST-${String(shipmentRunningNo).padStart(4, '0')}/${extractPurchaseSuffix(fpoNo || poNumber)}`;
    }

    // Auto generate shipment number from running tracker sequence + source PO suffix
    const shipmentNo = `${trackerSerial}-${1}(${derivedQty || plannedQtyMT}MT)`;

    const yearStr = orderDateObj.getFullYear();

    const qty = derivedQty;
    const rate = derivedRate;

    const totalAmount = derivedTotalAmount != null ? derivedTotalAmount : qty * rate;

    // 4️⃣ Upload all mandatory documents to S3
    const uploads = await Promise.all([
      uploadBufferToS3(lpoDocument, 'shipments/lpo'),
      proformaDocument ? uploadBufferToS3(proformaDocument, 'shipments/proforma') : Promise.resolve(null),
      uploadBufferToS3(s1QualityReport, 'shipments/quality/s1')
    ]);
    const [lpoUpload, proformaUpload, s1Upload] = uploads;

    // 5️⃣ Create shipment with persisted document URLs
    const shipment = await Shipment.create({
      poNumber: autoPoNumber,
      year: yearStr,
      orderDate,
      supplierId: supplier?._id,
      supplierName: supplierName || supplier?.name || '',
      supplierEmail: normalizedSupplierEmail,
      itemId: itemId || undefined,
      itemCode: uniqueJoin(derivedLineItems.map((item) => item.itemCode), itemCode || ''),
      itemDescription: derivedLineItems.length > 1
        ? `Multiple Items (${derivedLineItems.length})`
        : (primaryItem?.itemDescription || itemDescription || ''),
      commodity: uniqueJoin(derivedLineItems.map((item) => item.commodity), commodity || ''),
      countryOfOrigin: uniqueJoin(derivedLineItems.map((item) => item.countryOfOrigin), countryOfOrigin || ''),
      brandName: uniqueJoin(derivedLineItems.map((item) => item.brandName), brandName || ''),
      barcode: barcode || '',
      variant: variant || '',
      hsCode: hsCode || '',
      packing: uniqueJoin(derivedLineItems.map((item) => item.packagingType), packing || ''),
      portOfLoading: portOfLoading || '',
      portOfDischarge: portOfDischarge || '',
      shipmentNo,
      plannedQtyMT: qty,
      estimatedContainerCount,
      estimatedContainerSize,
      plannedETD: primaryItem?.expectedETD || plannedETD,
      plannedETA: primaryItem?.expectedETA || plannedETA,
      piNo,
      piDate: toDateOrNull(piDate),
      fpoNo,
      fcl: derivedFcl,
      pallet: derivedPallet,
      bags: derivedBags,
      fcPerUnit: rate,
      totalFC,
      paymentTerms,
      bankName: bankName || '',
      advanceAmount,
      advanceAmountDate,
      q1Report: parsedQ1Report,
      lineItems: derivedLineItems,
      lpoDocumentName: lpoUpload.fileName,
      lpoDocumentUrl: lpoUpload.url,
      proformaDocumentName: proformaUpload?.fileName || '',
      proformaDocumentUrl: proformaUpload?.url || '',
      s1QualityReportName: s1Upload.fileName,
      s1QualityReportUrl: s1Upload.url,
      payment: {
        totalAmount,   // from req.body
        paidAmount: 0,                   // initially 0
        balanceAmount: totalAmount, // initially same as total
        paymentStatus: "Pending"         // default
      },
      incoterms,
      buyunit: uniqueJoin(derivedLineItems.map((item) => item.buyingUnit), buyunit || ''),
      totalSplitQtyMT,
      containersize: Number(uniqueJoin(derivedLineItems.map((item) => item.containerSize), estimatedContainerSize || '')) || Number(estimatedContainerSize) || 0
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
      message: 'Shipment created successfully. Supplier invite will be checked when the baseline is locked.',
      data: shipment,
      documents: {
        lpo: { name: lpoUpload.fileName, url: lpoUpload.url },
        proforma: proformaUpload ? { name: proformaUpload.fileName, url: proformaUpload.url } : null,
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
    const existingPlannedContainers = await Container.find({ shipmentId, status: "Planned" }).sort({ createdAt: 1 });
    const previousPlannedSnapshot = existingPlannedContainers.map((container) => ({
      containerId: container._id,
      size: container.planned?.size,
      FCL: container.planned?.FCL,
      qtyMT: container.planned?.qtyMT,
      bags: container.planned?.bags,
      etd: container.planned?.etd,
      eta: container.planned?.eta,
      weekWiseShipment: container.planned?.weekWiseShipment,
      buyingUnit: container.planned?.buyingUnit,
      status: container.status,
    }));

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
          etd: toDateOrNull(c.etd),
          eta: toDateOrNull(c.eta),
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
    const supplierInviteResult = await ensureSupplierPortalAccessForShipment(shipment);

    const updatedPlannedSnapshot = processedContainers.map((container) => ({
      containerId: container._id,
      size: container.planned?.size,
      FCL: container.planned?.FCL,
      qtyMT: container.planned?.qtyMT,
      bags: container.planned?.bags,
      etd: container.planned?.etd,
      eta: container.planned?.eta,
      weekWiseShipment: container.planned?.weekWiseShipment,
      buyingUnit: container.planned?.buyingUnit,
      status: container.status,
    }));

    if (req.user?._id) {
      await logAudit.create({
        userId: req.user._id,
        module: "Purchase",
        entity: "Shipment",
        entityId: shipment._id,
        action: previousPlannedSnapshot.length > 0 ? "ScheduledBaselineUpdated" : "ScheduledBaselineCreated",
        before: { plannedContainers: previousPlannedSnapshot },
        after: {
          plannedContainers: updatedPlannedSnapshot,
          noOfShipments: shipment.noOfShipments,
          plannedQtyMT: shipment.plannedQtyMT,
        },
        remarks: previousPlannedSnapshot.length > 0
          ? "Scheduled baseline updated from Step 2"
          : "Scheduled baseline created from Step 2",
      });
    }

    res.status(200).json({
      message:
        supplierInviteResult.inviteSent === false
          ? 'Planned containers replaced successfully, but the supplier invite email could not be sent.'
          : supplierInviteResult.supplierCreated
            ? 'Planned containers replaced successfully and the supplier invite email was sent.'
            : 'Planned containers replaced successfully',
      supplierCreated: supplierInviteResult.supplierCreated,
      inviteSent: supplierInviteResult.inviteSent,
      inviteStatusMessage: supplierInviteResult.inviteStatusMessage,
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
    const files = req.files || {};
    const blDocument = files?.blDocument?.[0];


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

    if (blDocument) {
      const uploaded = await uploadBufferToS3(blDocument, 'shipments/actual/bl-document');
      container.actual.blDocumentUrl = uploaded.url;
      container.actual.blDocumentName = uploaded.fileName;
    }

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
        requestAmount: Number(row.requestAmount ?? 0),
        paidAmount: Number(row.paidAmount ?? 0)
      }));
    }
    if (Array.isArray(parsedStorageAllocations)) {
      container.actual.storageAllocations = parsedStorageAllocations.map((row) => ({
        sn: Number(row.sn) || 0,
        containerSerialNo: row.containerSerialNo || '',
        bags: Number(row.bags ?? row.pkgCt ?? 0) || 0,
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

    // Advance shipment stage to B/L Details
    const shipmentForBL = await Shipment.findById(container.shipmentId);
    if (shipmentForBL) {
      advanceShipmentStage(shipmentForBL, 'B/L Details');
      await shipmentForBL.save();
    }

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

    // Advance shipment stage to Documentation
    const shipmentForDoc = await Shipment.findById(container.shipmentId);
    if (shipmentForDoc) {
      advanceShipmentStage(shipmentForDoc, 'Documentation');
      await shipmentForDoc.save();
    }

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
      maximumRetentionDate,
      arrivalNoticeDate,
      arrivalNoticeFreeRetentionDays,
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
      sectionKey,
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
    if (arrivalNoticeFreeRetentionDays !== undefined) {
      container.actual.arrivalNoticeFreeRetentionDays = Number(arrivalNoticeFreeRetentionDays) || 0;
    }
    const effectiveArrivalOn = arrivalOn !== undefined ? arrivalOn : container.actual.arrivalOn;
    const effectiveFreeRetentionDays =
      Number(container.actual.arrivalNoticeFreeRetentionDays) > 0
        ? Number(container.actual.arrivalNoticeFreeRetentionDays)
        : Number(container.actual.freeDetentionDays) || 0;
    const computedFreeRetentionDate = addDays(effectiveArrivalOn, effectiveFreeRetentionDays);
    const computedMaximumRetentionDate = addDays(effectiveArrivalOn, container.actual.maximumDetentionDays);
    if (shipmentFreeRetentionDate !== undefined || computedFreeRetentionDate) {
      container.actual.shipmentFreeRetentionDate = computedFreeRetentionDate || toDateOrNull(shipmentFreeRetentionDate);
    }
    if (portRetentionWithPenaltyDate !== undefined || computedMaximumRetentionDate) {
      container.actual.portRetentionWithPenaltyDate = computedMaximumRetentionDate || toDateOrNull(portRetentionWithPenaltyDate);
    }
    if (maximumRetentionDate !== undefined || computedMaximumRetentionDate) {
      container.actual.maximumRetentionDate = computedMaximumRetentionDate || toDateOrNull(maximumRetentionDate);
    }
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
        bookingTime: toTimeString(row.bookingTime),
        transportDate: toDateOrNull(row.transportDate),
        transportTime: toTimeString(row.transportTime),
        delayHours: Number(row.delayHours ?? 0) || 0
      }));
    }

    if (Array.isArray(container.actual.transportationBooked)) {
      container.actual.transportationBooked = container.actual.transportationBooked.map((row) => {
        const matchingStorage = (container.actual.storageSplits || []).find(
          (split) => split.containerSerialNo === row.containerSerialNo
        );
        return {
          ...toPlainObject(row),
          delayHours: calculateDelayHours(
            row.transportDate,
            row.transportTime,
            matchingStorage?.receivedOnDate,
            matchingStorage?.receivedOnTime
          )
        };
      });
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

    // Advance shipment stage to Port & Customs
    const shipmentForLogistics = await Shipment.findById(container.shipmentId);
    if (shipmentForLogistics) {
      advanceShipmentStage(shipmentForLogistics, 'Port & Customs');
      await shipmentForLogistics.save();
    }

    const shipment = await Shipment.findById(container.shipmentId);
    if (!shipment) {
      return res.status(500).json({ message: "Shipment not found" });
    }

    res.status(200).json({
      message: sectionKey ? `${sectionKey} updated successfully` : "Logistics details updated successfully",
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

    const files = normalizeUploadedFiles(req.files);
    const { storageSplits } = req.body;
    const parsedStorageSplits = parseJsonField(storageSplits);
    if (!Array.isArray(parsedStorageSplits)) {
      return res.status(400).json({ message: 'storageSplits must be an array' });
    }

    container.actual.storageSplits = parsedStorageSplits.map((row, index) => {
      const rowUpload = files[`storageSplits_${index}_document`]?.[0];
      const existing = container.actual?.storageSplits?.[index] || {};
      return {
        containerSerialNo: row.containerSerialNo || '',
        bags: Number(row.bags ?? 0) || 0,
        warehouse: row.warehouse || '',
        storageAvailability: Number(row.storageAvailability) || 0,
        receivedOnDate: toDateOrNull(row.receivedOnDate),
        receivedOnTime: toTimeString(row.receivedOnTime),
        customsInspection: row.customsInspection || 'No',
        grn: row.grn || '',
        batch: row.batch || '',
        productionDate: toDateOrNull(row.productionDate),
        expiryDate: toDateOrNull(row.expiryDate),
        remarks: row.remarks || '',
        documentUrl: rowUpload ? undefined : (row.documentUrl || existing.documentUrl || ''),
        documentName: rowUpload ? undefined : (row.documentName || existing.documentName || '')
      };
    });

    for (let index = 0; index < container.actual.storageSplits.length; index++) {
      const rowUpload = files[`storageSplits_${index}_document`]?.[0];
      if (!rowUpload) continue;
      const uploaded = await uploadBufferToS3(rowUpload, `shipments/storage/row-${index + 1}`);
      container.actual.storageSplits[index].documentUrl = uploaded.url;
      container.actual.storageSplits[index].documentName = uploaded.fileName;
    }

    const globalStorageDocument = files?.storageDocument?.[0];
    if (globalStorageDocument) {
      const uploaded = await uploadBufferToS3(globalStorageDocument, 'shipments/storage/global');
      container.actual.storageDocumentUrl = uploaded.url;
      container.actual.storageDocumentName = uploaded.fileName;
    }

    if (Array.isArray(container.actual.transportationBooked)) {
      container.actual.transportationBooked = container.actual.transportationBooked.map((row) => {
        const matchingStorage = container.actual.storageSplits.find(
          (split) => split.containerSerialNo === row.containerSerialNo
        );
        return {
          ...toPlainObject(row),
          delayHours: calculateDelayHours(
            row.transportDate,
            row.transportTime,
            matchingStorage?.receivedOnDate,
            matchingStorage?.receivedOnTime
          )
        };
      });
    }

    await container.save();

    // Advance shipment stage to Storage
    const shipmentForStorage = await Shipment.findById(container.shipmentId);
    if (shipmentForStorage) {
      advanceShipmentStage(shipmentForStorage, 'Storage');
      await shipmentForStorage.save();
    }

    res.status(200).json({ message: 'Storage details updated successfully', container });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

exports.updateStorageArrivalRow = async (req, res) => {
  try {
    const container = await Container.findById(req.params.id);
    if (!container) return res.status(404).json({ message: 'Container not found' });
    if (!container.actual) return res.status(400).json({ message: 'Actual not created yet' });

    const rowIndex = Number(req.params.rowIndex);
    if (!Number.isInteger(rowIndex) || rowIndex < 0) {
      return res.status(400).json({ message: 'Invalid row index' });
    }

    const files = normalizeUploadedFiles(req.files);
    container.actual.storageSplits = Array.isArray(container.actual.storageSplits) ? container.actual.storageSplits : [];

    const existing = container.actual.storageSplits[rowIndex] || {};
    container.actual.storageSplits[rowIndex] = {
      containerSerialNo: req.body.containerSerialNo || existing.containerSerialNo || '',
      bags: Number(req.body.bags ?? existing.bags ?? 0) || 0,
      warehouse: req.body.warehouse || existing.warehouse || '',
      storageAvailability: Number(req.body.storageAvailability ?? existing.storageAvailability ?? 0) || 0,
      receivedOnDate: req.body.receivedOnDate !== undefined ? toDateOrNull(req.body.receivedOnDate) : existing.receivedOnDate || null,
      receivedOnTime: req.body.receivedOnTime !== undefined ? toTimeString(req.body.receivedOnTime) : existing.receivedOnTime || '',
      customsInspection: req.body.customsInspection || existing.customsInspection || 'No',
      grn: req.body.grn || existing.grn || '',
      batch: req.body.batch || existing.batch || '',
      productionDate: req.body.productionDate !== undefined ? toDateOrNull(req.body.productionDate) : existing.productionDate || null,
      expiryDate: req.body.expiryDate !== undefined ? toDateOrNull(req.body.expiryDate) : existing.expiryDate || null,
      remarks: req.body.remarks || existing.remarks || '',
      documentUrl: req.body.documentUrl || existing.documentUrl || '',
      documentName: req.body.documentName || existing.documentName || '',
    };

    const rowUpload = files?.storageRowDocument?.[0];
    if (rowUpload) {
      const uploaded = await uploadBufferToS3(rowUpload, `shipments/storage/row-${rowIndex + 1}`);
      container.actual.storageSplits[rowIndex].documentUrl = uploaded.url;
      container.actual.storageSplits[rowIndex].documentName = uploaded.fileName;
    }

    if (Array.isArray(container.actual.transportationBooked)) {
      container.actual.transportationBooked = container.actual.transportationBooked.map((row) => {
        const matchingStorage = container.actual.storageSplits.find(
          (split) => split.containerSerialNo === row.containerSerialNo
        );
        return {
          ...toPlainObject(row),
          delayHours: calculateDelayHours(
            row.transportDate,
            row.transportTime,
            matchingStorage?.receivedOnDate,
            matchingStorage?.receivedOnTime
          ),
        };
      });
    }

    await container.save();
    res.json({ message: 'Storage arrival row updated successfully', container });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
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
        const attachmentUpload = uploadedByField[`qualityRows_${index}_attachment`];
        const existing = container.actual?.qualityRows?.[index] || {};
        const existingReport = container.actual?.qualityReports?.[index] || {};
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
          thirdPartyReportDocumentName: thirdPartyUpload?.fileName || row.thirdPartyReportDocumentName || existing.thirdPartyReportDocumentName || '',
          remarks: row.remarks || existing.remarks || existingReport.remarks || '',
          attachmentDocumentUrl: attachmentUpload?.url || row.attachmentDocumentUrl || existing.attachmentDocumentUrl || existingReport.documentUrl || '',
          attachmentDocumentName: attachmentUpload?.fileName || row.attachmentDocumentName || existing.attachmentDocumentName || existingReport.documentName || ''
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
    } else {
      container.actual.qualityReports = [];
    }

    container.status = 'GRN';
    await container.save();

    // Advance shipment stage to Quality
    const shipmentForQuality = await Shipment.findById(container.shipmentId);
    if (shipmentForQuality) {
      advanceShipmentStage(shipmentForQuality, 'Quality');
      await shipmentForQuality.save();
    }

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
    const { paymentAllocations, paymentCostings, packagingExpenses } = req.body;
    const parsedAllocations = parseJsonField(paymentAllocations);
    const parsedCostings = parseJsonField(paymentCostings);
    const parsedPackagingExpenses = parseJsonField(packagingExpenses);

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
        paidAmount: Number(row.paidAmount) || 0,
        reference: row.reference || ''
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

    if (Array.isArray(parsedPackagingExpenses)) {
      container.actual.packagingExpenses = parsedPackagingExpenses.map((row, index) => ({
        sn: Number(row.sn) || index + 1,
        item: row.item || '',
        packing: row.packing || '',
        qty: Number(row.qty) || 0,
        uom: row.uom || '',
        unitCostFC: Number(row.unitCostFC) || 0,
        unitCostDH: Number(row.unitCostDH) || 0,
        totalCostFC: Number(row.totalCostFC) || 0,
        totalCostDH: Number(row.totalCostDH) || 0,
        expenseAllocationFactor: Number(row.expenseAllocationFactor) || 0,
        expensesAllocated: Number(row.expensesAllocated) || 0,
        totalValueWithExpenses: Number(row.totalValueWithExpenses) || 0,
        landedCostPerUnit: Number(row.landedCostPerUnit) || 0,
        reference: row.reference || '',
      }));
    }

    const overallDoc = files?.paymentCostingDocument?.[0];
    if (overallDoc) {
      const uploaded = await uploadBufferToS3(overallDoc, 'shipments/payment-costing/overall');
      container.actual.paymentCostingDocumentUrl = uploaded.url;
      container.actual.paymentCostingDocumentName = uploaded.fileName;
    }

    await container.save();

    // Advance shipment stage to Payment Costing
    const shipmentForPayment = await Shipment.findById(container.shipmentId);
    if (shipmentForPayment) {
      advanceShipmentStage(shipmentForPayment, 'Payment Costing');
      await shipmentForPayment.save();
    }

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
      supplier: s.supplierId?.name || s.supplierName || null,
      description: s.itemId?.description || s.itemDescription || null,
      buyingQty: s.plannedQtyMT || s.totalOrderedQtyMT || 0,
      fcPerUnit: s.fcPerUnit || 0,
      totalFC: s.totalFC || 0,
      noOfShipments: s.noOfShipments || s.assumedContainerCount || 0,
      status: s.currentStage
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

exports.getShipmentReportExportData = async (req, res) => {
  try {
    const rows = await buildShipmentReportRows();

    return res.status(200).json({
      rows,
      totalRecords: rows.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Unable to prepare shipment export data' });
  }
};

exports.downloadShipmentReportExcel = async (req, res) => {
  try {
    const rows = await buildShipmentReportRows();
    const downloadedBy = req.user?.name || 'Royal Horizon User';
    const downloadedAt = formatDateTimeValue(new Date());
    const title = 'Royal Horizon Group';
    const subtitle = 'Shipment Master Report';
    const totalColumns = SHIPMENT_REPORT_COLUMNS.length;

    const sheetData = [
      [title],
      [subtitle],
      [`Downloaded By: ${downloadedBy}`, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', `Downloaded At: ${downloadedAt}`],
      [],
      SHIPMENT_REPORT_COLUMNS.map((column) => column.header),
      ...rows.map((row) => SHIPMENT_REPORT_COLUMNS.map((column) => formatReportCellValue(row[column.key], column.key))),
      [],
      ['Printed from Royal Horizon Systems'],
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
    worksheet['!cols'] = SHIPMENT_REPORT_COLUMNS.map((column) => ({ wch: column.width }));
    worksheet['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: totalColumns - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: totalColumns - 1 } },
      { s: { r: rows.length + 7, c: 0 }, e: { r: rows.length + 7, c: totalColumns - 1 } },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Shipment Report');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const filename = `royal-horizon-shipment-report-${new Date().toISOString().slice(0, 10)}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buffer);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Unable to generate Excel report' });
  }
};

exports.downloadShipmentReportPdf = async (req, res) => {
  try {
    const rows = await buildShipmentReportRows();
    const downloadedBy = req.user?.name || 'Royal Horizon User';
    const downloadedAt = formatDateTimeValue(new Date());
    const filename = `royal-horizon-shipment-report-${new Date().toISOString().slice(0, 10)}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const doc = new PDFDocument({
      size: 'A3',
      layout: 'landscape',
      margin: 34,
      bufferPages: true,
    });

    doc.pipe(res);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const startX = 34;
    const usableWidth = pageWidth - startX * 2;
    const tableTop = 120;
    const rowHeight = 24;
    const footerY = pageHeight - 24;
    const totalWeight = SHIPMENT_REPORT_COLUMNS.reduce((sum, column) => sum + column.width, 0);
    const columnWidths = SHIPMENT_REPORT_COLUMNS.map((column) => (column.width / totalWeight) * usableWidth);

    const drawHeader = () => {
      doc.font('Helvetica-Bold').fontSize(24).text('Royal Horizon Group', startX, 26, { align: 'center', width: usableWidth });
      doc.font('Helvetica-Bold').fontSize(18).text('Shipment Master Report', startX, 56, { align: 'center', width: usableWidth });
      doc.font('Helvetica').fontSize(12).text(`Downloaded By: ${downloadedBy}`, startX, 92, { align: 'left', width: usableWidth / 2 });
      doc.font('Helvetica').fontSize(12).text(`Downloaded At: ${downloadedAt}`, startX, 92, { align: 'right', width: usableWidth });
    };

    const drawTableHeader = (y) => {
      let x = startX;
      doc.font('Helvetica-Bold').fontSize(8);
      SHIPMENT_REPORT_COLUMNS.forEach((column, index) => {
        const width = columnWidths[index];
        doc.rect(x, y, width, rowHeight).fillAndStroke('#f1f5f9', '#0f172a');
        doc.fillColor('#0f172a').text(column.header, x + 4, y + 7, {
          width: width - 8,
          ellipsis: true,
        });
        x += width;
      });
      doc.fillColor('#0f172a');
    };

    const drawRow = (row, y) => {
      let x = startX;
      doc.font('Helvetica').fontSize(7.5);
      SHIPMENT_REPORT_COLUMNS.forEach((column, index) => {
        const width = columnWidths[index];
        doc.rect(x, y, width, rowHeight).stroke('#0f172a');
        doc.text(String(formatReportCellValue(row[column.key], column.key)), x + 4, y + 7, {
          width: width - 8,
          ellipsis: true,
        });
        x += width;
      });
    };

    drawHeader();
    let currentY = tableTop;
    drawTableHeader(currentY);
    currentY += rowHeight;

    rows.forEach((row) => {
      if (currentY + rowHeight > footerY - 18) {
        doc.addPage();
        drawHeader();
        currentY = tableTop;
        drawTableHeader(currentY);
        currentY += rowHeight;
      }
      drawRow(row, currentY);
      currentY += rowHeight;
    });

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      doc.font('Helvetica-Oblique').fontSize(12).text('Printed from Royal Horizon Systems', startX, footerY, {
        align: 'center',
        width: usableWidth,
      });
      doc.font('Helvetica').fontSize(12).text(`Page ${i + 1} of ${range.count}`, startX, footerY, {
        align: 'right',
        width: usableWidth,
      });
    }

    doc.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      return res.status(500).json({ message: 'Unable to generate PDF report' });
    }
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

    // Chart Data Generation
    const mapStageToStatus = (stage) => {
      if (['Shipment Entry', 'Planned Split'].includes(stage)) return 'Yet to be scheduled';
      if (['Shipment Split', 'B/L Details'].includes(stage)) return 'Goods on transit';
      if (['Documentation'].includes(stage)) return 'At Port / Waiting for document';
      if (['Port & Customs', 'Under Clearance'].includes(stage)) return 'At Port / Clearance on progress';
      if (['Storage', 'Quality', 'Payment Costing', 'GRN Completed', 'Completed', 'Cleared', 'Released'].includes(stage)) return 'Delivered WH';
      return 'Yet to be scheduled';
    };

    const mapStageToYearlyStatus = (stage) => {
      if (['Shipment Entry', 'Planned Split', 'Shipment Split', 'B/L Details'].includes(stage)) return 'ETA yet to due';
      if (['Documentation', 'Port & Customs', 'Under Clearance'].includes(stage)) return 'At the Port';
      if (['Storage', 'Quality', 'Payment Costing', 'GRN Completed', 'Completed', 'Cleared', 'Released'].includes(stage)) return 'Delivered WH';
      return 'ETA yet to due';
    };

    const qtyMappingMap = new Map();
    const valueMappingMap = new Map();
    const yearlyQtyMappingMap = new Map();
    const supplierAvgFcMap = new Map();
    const supplierYearlyQtyMap = new Map();

    shipments.forEach(s => {
      const itemDesc = s.itemId?.description || s.itemDescription || 'Unknown Item';
      const supplierName = s.supplierId?.name || s.supplierName || 'Unknown Supplier';
      const status = mapStageToStatus(s.currentStage);
      const yearlyStatus = mapStageToYearlyStatus(s.currentStage);
      const qty = Number(s.plannedQtyMT || 0);
      const fc = Number(s.totalFC || 0);
      const fcPerUnit = Number(s.fcPerUnit || 0);
      
      // 1. Qty Mapping
      if (!qtyMappingMap.has(itemDesc)) qtyMappingMap.set(itemDesc, { rowLabel: itemDesc });
      qtyMappingMap.get(itemDesc)[status] = (qtyMappingMap.get(itemDesc)[status] || 0) + qty;
      
      // 2. Value Mapping
      if (!valueMappingMap.has(itemDesc)) valueMappingMap.set(itemDesc, { rowLabel: itemDesc });
      valueMappingMap.get(itemDesc)[status] = (valueMappingMap.get(itemDesc)[status] || 0) + fc;

      // 3. Yearly Qty Mapping
      if (!yearlyQtyMappingMap.has(itemDesc)) yearlyQtyMappingMap.set(itemDesc, { rowLabel: itemDesc });
      yearlyQtyMappingMap.get(itemDesc)[yearlyStatus] = (yearlyQtyMappingMap.get(itemDesc)[yearlyStatus] || 0) + qty;

      // 4. Supplier Avg FC
      if (!supplierAvgFcMap.has(itemDesc)) supplierAvgFcMap.set(itemDesc, { rowLabel: itemDesc });
      const supAvg = supplierAvgFcMap.get(itemDesc);
      if (!supAvg[`${supplierName}_sum`]) {
        supAvg[`${supplierName}_sum`] = 0;
        supAvg[`${supplierName}_count`] = 0;
      }
      supAvg[`${supplierName}_sum`] += fcPerUnit;
      supAvg[`${supplierName}_count`] += 1;

      // 5. Supplier Yearly Qty
      if (!supplierYearlyQtyMap.has(supplierName)) supplierYearlyQtyMap.set(supplierName, { rowLabel: supplierName });
      supplierYearlyQtyMap.get(supplierName)[yearlyStatus] = (supplierYearlyQtyMap.get(supplierName)[yearlyStatus] || 0) + qty;
    });

    const formatSupplierAvgFc = Array.from(supplierAvgFcMap.values()).map(row => {
      const newRow = { rowLabel: row.rowLabel };
      Object.keys(row).forEach(k => {
        if (k.endsWith('_sum')) {
          const supplier = k.replace('_sum', '');
          newRow[supplier] = Number((row[`${supplier}_sum`] / row[`${supplier}_count`]).toFixed(2));
        }
      });
      return newRow;
    });

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
      },
      chartData: {
        qtyMapping: Array.from(qtyMappingMap.values()),
        valueMapping: Array.from(valueMappingMap.values()),
        yearlyQtyMapping: Array.from(yearlyQtyMappingMap.values()),
        supplierAvgFc: formatSupplierAvgFc,
        supplierYearlyQty: Array.from(supplierYearlyQtyMap.values())
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
    const scheduledHistoryLogs = await logAudit
      .find({
        module: "Purchase",
        entity: "Shipment",
        entityId: shipmentId,
        action: { $in: ["ScheduledBaselineCreated", "ScheduledBaselineUpdated"] },
      })
      .sort({ createdAt: -1 })
      .populate("userId", "name email");

    // Planned array
    const planned = containers.map(c => ({
      containerId: c._id,
      size: c.planned?.size,
      FCL: c.planned?.FCL,
      qtyMT: c.planned?.qtyMT,
      bags: c.planned?.bags,
      etd: c.planned?.etd,
      eta: c.planned?.eta,
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
            blDocumentUrl: a.blDocumentUrl,
            blDocumentName: a.blDocumentName,
            extractedContainers: a.extractedContainers || [],
            costSheetBookingDocumentUrl: a.costSheetBookingDocumentUrl,
            costSheetBookingDocumentName: a.costSheetBookingDocumentName,
            costSheetBookings: a.costSheetBookings || [],
            storageAllocations: a.storageAllocations || [],
            maximumRetentionDate: a.maximumRetentionDate,
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
            maximumRetentionDate: a.maximumRetentionDate,
            arrivalNoticeDate: a.arrivalNoticeDate,
            arrivalNoticeFreeRetentionDays: a.arrivalNoticeFreeRetentionDays,
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
            storageDocumentUrl: a.storageDocumentUrl || null,
            storageDocumentName: a.storageDocumentName || null,
            storageDocumentUrl: a.storageDocumentUrl,
            storageDocumentName: a.storageDocumentName,
            qualityRows: a.qualityRows || [],
            qualityReports: a.qualityReports || [],
            paymentAllocations: a.paymentAllocations || [],
            paymentCostings: a.paymentCostings || [],
            packagingExpenses: a.packagingExpenses || [],
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

      const signedBlDocument = await toSignedDocument(row.blDocumentUrl, row.blDocumentName);
      row.blDocumentUrl = signedBlDocument.url;
      row.blDocumentName = signedBlDocument.name;

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
        const attachment = await toSignedDocument(qualityRow.attachmentDocumentUrl, qualityRow.attachmentDocumentName);
        return {
          ...plainQualityRow,
          inhouseReportDocumentUrl: inhouse.url,
          inhouseReportDocumentName: inhouse.name,
          strategicReportDocumentUrl: strategic.url,
          strategicReportDocumentName: strategic.name,
          thirdPartyReportDocumentUrl: thirdParty.url,
          thirdPartyReportDocumentName: thirdParty.name,
          attachmentDocumentUrl: attachment.url,
          attachmentDocumentName: attachment.name,
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

      row.storageSplits = await Promise.all((row.storageSplits || []).map(async (storageRow) => {
        const plainStorageRow = toPlainObject(storageRow);
        const signed = await toSignedDocument(storageRow.documentUrl, storageRow.documentName);
        return {
          ...plainStorageRow,
          documentUrl: signed.url,
          documentName: signed.name,
        };
      }));

      const signedStorageDocument = await toSignedDocument(row.storageDocumentUrl, row.storageDocumentName);
      row.storageDocumentUrl = signedStorageDocument.url;
      row.storageDocumentName = signedStorageDocument.name;
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
        piDate: shipment.piDate,
        portOfLoading: shipment.portOfLoading || null,
        portOfDischarge: shipment.portOfDischarge || null,
        fcl: shipment.fcl ?? null,
        pallet: shipment.pallet ?? null,
        bags: shipment.bags ?? null,
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
        lineItems: Array.isArray(shipment.lineItems)
          ? shipment.lineItems.map((item) => ({
              lineNo: item.lineNo ?? null,
              itemCode: item.itemCode || null,
              itemDescription: item.itemDescription || null,
              commodity: item.commodity || null,
              countryOfOrigin: item.countryOfOrigin || null,
              brandName: item.brandName || null,
              packagingType: item.packagingType || null,
              containerSize: item.containerSize || null,
              plannedContainers: item.plannedContainers ?? null,
              fcl: item.fcl ?? null,
              pallet: item.pallet ?? null,
              bags: item.bags ?? null,
              buyingUnit: item.buyingUnit || null,
              fclPerUnit: item.fclPerUnit ?? null,
              fcPerUnit: item.fcPerUnit ?? null,
              totalUSD: item.totalUSD ?? null,
              totalAED: item.totalAED ?? null,
              expectedETD: item.expectedETD || null,
              expectedETA: item.expectedETA || null,
            }))
          : [],
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
      actual,
      scheduledHistory: scheduledHistoryLogs.map((entry) => ({
        id: entry._id,
        action: entry.action,
        remarks: entry.remarks || "",
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        user: entry.userId || entry.after?.historyActorName || entry.before?.historyActorName
          ? {
              id: entry.userId?._id || entry.userId || null,
              name:
                (entry.userId && entry.userId.name) ||
                entry.after?.historyActorName ||
                entry.before?.historyActorName ||
                "",
              email:
                (entry.userId && entry.userId.email) ||
                entry.after?.historyActorEmail ||
                entry.before?.historyActorEmail ||
                "",
            }
          : null,
        before: entry.before?.plannedContainers || [],
        after: entry.after?.plannedContainers || [],
      })),
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
  const sc = pythonRes.shipment_calculations || {};

  const getIndexedValue = (value, index) => {
    if (Array.isArray(value)) return value[index];
    return value;
  };

  const toContainerSizeValue = (value) => {
    if (value == null || value === '') return undefined;
    const size = String(value).trim().toLowerCase();
    if (size.startsWith('40')) return '40';
    if (size.startsWith('20')) return '20';
    return undefined;
  };

  const mapBuyingUnit = (value) => {
    const normalized = String(value || '').trim().toUpperCase();
    if (!normalized) return undefined;
    if (normalized === 'BAG' || normalized === 'BAGS') return 'Bag';
    if (normalized === 'PALLET' || normalized === 'PALLETS') return 'Pallet';
    if (normalized === 'KG' || normalized === 'MT') return normalized;
    return undefined;
  };

  const normalizeItemShape = (itemLike, index = 0) => {
    const item = itemLike || {};
    const line = {};

    const lineItemCode = item.item_code ?? item.itemCode ?? getIndexedValue(lpo.item_code, index);
    if (lineItemCode != null && lineItemCode !== '') line.itemCode = String(lineItemCode).trim();

    const lineDescription = item.item ?? item.description ?? item.itemDescription ?? getIndexedValue(lpo.item, index);
    if (lineDescription != null && lineDescription !== '') line.itemDescription = String(lineDescription).trim();

    const lineCommodity = item.commodity ?? getIndexedValue(lpo.commodity, index);
    if (lineCommodity != null && lineCommodity !== '') line.commodity = String(lineCommodity).trim();

    const lineCountry = item.country_of_origin ?? item.countryOfOrigin ?? getIndexedValue(lpo.country_of_origin, index);
    if (lineCountry != null && lineCountry !== '') line.countryOfOrigin = String(lineCountry).trim();

    const linePackaging = item.packaging ?? item.packing ?? getIndexedValue(lpo.packaging, index);
    if (linePackaging != null && linePackaging !== '') line.packagingType = String(linePackaging).trim();

    const lineBuyingUnit = mapBuyingUnit(item.buying_unit ?? item.buyingUnit ?? item.unit ?? getIndexedValue(lpo.buying_unit, index) ?? getIndexedValue(lpo.unit, index));
    if (lineBuyingUnit) line.buyingUnit = lineBuyingUnit;

    const lineQuantityMt = item.quantity_in_mt ?? item.quantityInMt ?? getIndexedValue(sc.quantity_in_mt, index) ?? getIndexedValue(lpo.quantity_in_mt, index) ?? getIndexedValue(lpo.quantity, index);
    const parsedQtyMt = parseNum(lineQuantityMt);
    if (parsedQtyMt != null) line.plannedContainers = parsedQtyMt;

    const lineFcl = item.fcl ?? getIndexedValue(sc.fcl, index);
    const parsedFcl = parseNum(lineFcl);
    if (parsedFcl != null) line.fcl = parsedFcl;

    const linePallet = item.pallets ?? item.pallet ?? getIndexedValue(sc.pallets, index);
    const parsedPallet = parseNum(linePallet);
    if (parsedPallet != null) line.pallet = parsedPallet;

    const lineBags = item.bags ?? item.quantity_in_bags ?? item.quantityInBags ?? getIndexedValue(sc.bags, index) ?? getIndexedValue(lpo.quantity_in_bags, index);
    const parsedBags = parseNum(lineBags);
    if (parsedBags != null) line.bags = parsedBags;

    const lineFclPerUnit = item.fcl_per_unit ?? item.fclPerUnit ?? getIndexedValue(sc.fcl_per_unit, index);
    const parsedFclPerUnit = parseNum(lineFclPerUnit);
    if (parsedFclPerUnit != null) line.fclPerUnit = parsedFclPerUnit;

    const linePrice = item.price_per_mt ?? item.pricePerMt ?? item.unit_price ?? item.unitPrice ?? getIndexedValue(sc.price_per_mt, index) ?? getIndexedValue(lpo.price_per_mt, index);
    const parsedPrice = parseNum(linePrice);
    if (parsedPrice != null) line.fcPerUnit = parsedPrice;

    const lineTotal = item.total_amount ?? item.totalAmount ?? item.total_price ?? item.totalPrice ?? item.price ?? getIndexedValue(lpo.total_amount, index);
    const parsedTotal = parseNum(lineTotal);
    if (parsedTotal != null) {
      line.totalUSD = parsedTotal;
      line.totalAED = Math.round(parsedTotal * 3.67 * 100) / 100;
    }

    const lineContainerSize = toContainerSizeValue(item.container_size ?? item.containerSize ?? getIndexedValue(sc.container_size, index));
    if (lineContainerSize) line.containerSize = lineContainerSize;

    const lineNo = parseNum(item.line_no ?? item.lineNo ?? item.s_no ?? index + 1);
    if (lineNo != null) line.lineNo = lineNo;

    return line;
  };

  const inferItemsFromArrays = () => {
    const candidateFields = [
      lpo.item_code,
      lpo.item,
      lpo.commodity,
      lpo.packaging,
      lpo.buying_unit,
      lpo.unit,
      lpo.quantity_in_mt,
      lpo.quantity_in_bags,
      lpo.price_per_mt,
      lpo.total_amount,
      sc.quantity_in_mt,
      sc.fcl,
      sc.pallets,
      sc.bags,
      sc.fcl_per_unit,
      sc.price_per_mt,
      sc.container_size,
    ];

    const inferredLength = candidateFields.reduce((max, value) => (Array.isArray(value) ? Math.max(max, value.length) : max), 0);
    if (!inferredLength) return [];

    return Array.from({ length: inferredLength }, (_, index) => normalizeItemShape({}, index));
  };

  // Shipment info
  if (lpo.po_number != null && lpo.po_number !== '') out.fpoNo = String(lpo.po_number).trim();
  if (lpo.po_date != null && lpo.po_date !== '') out.purchaseDate = String(lpo.po_date).trim();
  if (lpo.inco_terms != null && lpo.inco_terms !== '') out.incoTerms = String(lpo.inco_terms).trim();
  if (lpo.port_of_loading != null && lpo.port_of_loading !== '') out.portOfLoading = String(lpo.port_of_loading).trim();
  if (lpo.port_of_discharge != null && lpo.port_of_discharge !== '') out.portOfDischarge = String(lpo.port_of_discharge).trim();
  if (lpo.commodity != null && lpo.commodity !== '') out.commodity = String(lpo.commodity).trim();
  const itemDesc = lpo.item ?? '';
  if (itemDesc !== '') out.itemDescription = String(itemDesc).trim();

  // Supplier (Python returns names only)
  const supplierName = lpo.vendor ?? '';
  if (supplierName !== '') out.supplierName = String(supplierName).trim();

  // Item
  if (lpo.payment_terms != null && lpo.payment_terms !== '') out.paymentTerms = String(lpo.payment_terms).trim();

  // shipment_calculations: pass through and use for quantity, fcl, pallet, bags, containerSize
  if (sc && typeof sc === 'object') {
    if (!Array.isArray(sc.quantity_in_mt) && sc.quantity_in_mt != null) out.plannedContainers = Number(sc.quantity_in_mt);
    if (!Array.isArray(sc.fcl) && sc.fcl != null) out.fcl = Number(sc.fcl);
    if (!Array.isArray(sc.pallets) && sc.pallets != null) out.pallet = Number(sc.pallets);
    if (!Array.isArray(sc.bags) && sc.bags != null) out.bags = Number(sc.bags);
    if (!Array.isArray(sc.fcl_per_unit) && sc.fcl_per_unit != null) out.fclPerUnit = Number(sc.fcl_per_unit);
    if (!Array.isArray(sc.container_size)) {
      const size = toContainerSizeValue(sc.container_size);
      if (size) out.containerSize = size;
    }
    out.shipmentCalculations = {
      fcl: !Array.isArray(sc.fcl) && sc.fcl != null ? Number(sc.fcl) : undefined,
      bags: !Array.isArray(sc.bags) && sc.bags != null ? Number(sc.bags) : undefined,
      quantity_in_mt: !Array.isArray(sc.quantity_in_mt) && sc.quantity_in_mt != null ? Number(sc.quantity_in_mt) : undefined,
      container_size: !Array.isArray(sc.container_size) && sc.container_size != null ? String(sc.container_size) : undefined,
      bags_per_container: !Array.isArray(sc.bags_per_container) && sc.bags_per_container != null ? Number(sc.bags_per_container) : undefined,
      fcl_per_unit: !Array.isArray(sc.fcl_per_unit) && sc.fcl_per_unit != null ? Number(sc.fcl_per_unit) : undefined,
      pallets: !Array.isArray(sc.pallets) && sc.pallets != null ? Number(sc.pallets) : undefined,
      price_per_mt: !Array.isArray(sc.price_per_mt) && sc.price_per_mt != null ? Number(sc.price_per_mt) : undefined,
      is_price_matching: sc.is_price_matching === true,
      lpo_price_per_mt: !Array.isArray(sc.lpo_price_per_mt) && sc.lpo_price_per_mt != null ? Number(sc.lpo_price_per_mt) : undefined,
      pi_price_per_mt: !Array.isArray(sc.pi_price_per_mt) && sc.pi_price_per_mt != null ? Number(sc.pi_price_per_mt) : undefined,
      mt_variation: !Array.isArray(sc.mt_variation) && sc.mt_variation != null ? Number(sc.mt_variation) : undefined,
      diff_percent: !Array.isArray(sc.diff_percent) && sc.diff_percent != null ? Number(sc.diff_percent) : undefined
    };
  }

  const rawItems = Array.isArray(lpo.items) ? lpo.items.map((item, index) => normalizeItemShape(item, index)) : inferItemsFromArrays();
  out.items = (rawItems.length ? rawItems : [normalizeItemShape({}, 0)]).map((item, index) => ({
    lineNo: item.lineNo ?? index + 1,
    ...item,
  }));

  const firstItem = out.items[0] || {};
  if (firstItem.itemCode) out.itemCode = firstItem.itemCode;
  if (firstItem.itemDescription) out.itemDescription = firstItem.itemDescription;
  if (firstItem.commodity) out.commodity = firstItem.commodity;
  if (firstItem.countryOfOrigin) out.countryOfOrigin = firstItem.countryOfOrigin;
  if (firstItem.packagingType) out.packagingType = firstItem.packagingType;
  if (firstItem.plannedContainers != null) out.plannedContainers = firstItem.plannedContainers;
  if (firstItem.buyingUnit) out.buyingUnit = firstItem.buyingUnit;
  if (firstItem.fcPerUnit != null) out.fcPerUnit = firstItem.fcPerUnit;
  if (firstItem.totalUSD != null) out.totalUSD = firstItem.totalUSD;
  if (firstItem.totalAED != null) out.totalAED = firstItem.totalAED;
  if (firstItem.fcl != null) out.fcl = firstItem.fcl;
  if (firstItem.pallet != null) out.pallet = firstItem.pallet;
  if (firstItem.bags != null) out.bags = firstItem.bags;
  if (firstItem.fclPerUnit != null) out.fclPerUnit = firstItem.fclPerUnit;
  if (firstItem.containerSize) out.containerSize = firstItem.containerSize;

  // S1 quality report payload from Python extraction response
  // Kept as nested object so frontend can use full extracted structure as needed.
  if (pythonRes.s1_quality_report && typeof pythonRes.s1_quality_report === 'object') {
    out.q1Report = pythonRes.s1_quality_report;
  }

  return out;
}

// =======================
// EXTRACT FROM DOCUMENTS — calls Python API, maps response to frontend shape
// Frontend sends: document1 = Purchase order (LPO), s1QualityReport
// Python API expects: lpo_invoice, rice_quality_report (with optional inco_terms_list, suppliers)
// =======================
exports.extractFromDocuments = async (req, res) => {
  try {
    const files = req.files;
    // document1 = Purchase order → lpo_invoice, s1QualityReport = quality report → rice_quality_report
    if (!files?.document1?.[0] || !files?.s1QualityReport?.[0]) {
      return res.status(400).json({
        message: 'Purchase order (document1) and S1 Quality Report (s1QualityReport) are required'
      });
    }

    const pythonUrl = process.env.PYTHON_EXTRACTION_API_URL || 'http://localhost:8096';
    const endpoint = `${pythonUrl.replace(/\/$/, '')}/shipment-form`;
    const incoTermsList = process.env.PYTHON_INCO_TERMS_LIST || 'CIF,FOB,EXWORKS';
    const suppliersList = process.env.PYTHON_SUPPLIERS_LIST || '';

    const lpoFile = files.document1[0];
    const qualityFile = files.s1QualityReport[0];

    const FormData = globalThis.FormData;
    const form = new FormData();
    const lpoBlob = new Blob([lpoFile.buffer], { type: lpoFile.mimetype || 'application/octet-stream' });
    const qualityBlob = new Blob([qualityFile.buffer], { type: qualityFile.mimetype || 'application/octet-stream' });
    form.append('lpo_invoice', lpoBlob, lpoFile.originalname || 'lpo.pdf');
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

exports.extractArrivalNotice = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'File is required' });
    }

    const baseUrl = (process.env.PYTHON_EXTRACTION_API_URL || 'http://localhost:8096').replace(/\/$/, '');
    const endpoint = `${baseUrl}/arrival-notice/extract`;
    const FormData = globalThis.FormData;
    const form = new FormData();
    const blob = new Blob([req.file.buffer], { type: req.file.mimetype || 'application/octet-stream' });
    form.append('file', blob, req.file.originalname || 'arrival-notice');

    const response = await fetch(endpoint, {
      method: 'POST',
      body: form
    });

    if (!response.ok) {
      const errText = await response.text();
      let errJson;
      try { errJson = JSON.parse(errText); } catch { errJson = { detail: errText }; }
      return res.status(response.status).json({
        message: errJson.detail || errJson.message || `Arrival notice extraction service returned ${response.status}`,
        error: errJson
      });
    }

    const pythonRes = await response.json();
    const rawDays = pythonRes?.free_retension_days ?? pythonRes?.free_retention_days ?? '';
    const freeRetentionDays = Number.parseInt(String(rawDays).match(/\d+/)?.[0] || '0', 10) || 0;

    return res.status(200).json({
      arrival_on: pythonRes?.arrival_on || null,
      free_retension_days: freeRetentionDays,
      metadata: pythonRes?.metadata || null,
    });
  } catch (err) {
    console.error('Extract arrival notice error:', err);
    const isNetwork = err.cause?.code === 'ECONNREFUSED' || err.code === 'ECONNREFUSED';
    return res.status(500).json({
      message: isNetwork
        ? 'Arrival notice extraction service unavailable. Check PYTHON_EXTRACTION_API_URL and that the Python service is running.'
        : (err.message || 'Server error'),
      error: err.message
    });
  }
};
