const Supplier = require('../models/supplier.model');
const logAudit = require('../core/utils/auditLogger');

// Create Supplier
exports.createSupplier = async (req, res) => {
  try {
    const { supplierCode, name, country } = req.body;

    // Check if supplier code already exists
    const existing = await Supplier.findOne({ supplierCode });
    if (existing) return res.status(400).json({ message: "Supplier code already exists" });

    const supplier = await Supplier.create({ supplierCode, name, country });

    // Audit log
    await logAudit({
      userId: req.user._id,
      module: "Master",
      entity: "Supplier",
      entityId: supplier._id,
      action: "Created",
      before: {},
      after: { supplierCode, name, country },
      remarks: "Supplier created"
    });

    res.status(201).json({ message: "Supplier created", supplier });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// Get supplier by ID
exports.getSupplierById = async (req, res) => {
  try {
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) return res.status(404).json({ message: "Supplier not found" });
    res.json(supplier);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};
