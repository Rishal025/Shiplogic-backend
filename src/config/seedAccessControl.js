const Role = require('../models/role.model');
const Permission = require('../models/permission.model');
const RolePermission = require('../models/rolePermission.model');

const DEFAULT_ROLES = [
  { key: 'Admin', name: 'Admin', description: 'Full system access', isSystem: true },
  { key: 'Purchase', name: 'Purchase', description: 'Purchase and shipment entry team', isSystem: true },
  { key: 'Logistic', name: 'Logistic', description: 'Logistics and operations team', isSystem: true },
  { key: 'FAS', name: 'FAS', description: 'Finance and accounting services', isSystem: true },
  { key: 'Manager', name: 'Manager', description: 'Cross-functional management access', isSystem: true },
];

const MENU_PERMISSION_TEMPLATES = [
  { key: 'menu.dashboard.view', resource: 'menu', screen: 'dashboard', type: 'screen', label: 'View Dashboard Menu', sortOrder: 10 },
  { key: 'menu.shipments.view', resource: 'menu', screen: 'shipments', type: 'screen', label: 'View Shipments Menu', sortOrder: 20 },
  { key: 'menu.suppliers.view', resource: 'menu', screen: 'suppliers', type: 'screen', label: 'View Suppliers Menu', sortOrder: 30 },
  { key: 'menu.reports.view', resource: 'menu', screen: 'reports', type: 'screen', label: 'View Reports Menu', sortOrder: 40 },
  { key: 'menu.access_control.view', resource: 'menu', screen: 'access_control', type: 'screen', label: 'View Access Control Menu', sortOrder: 50 },
  { key: 'menu.settings.view', resource: 'menu', screen: 'settings', type: 'screen', label: 'View Settings Menu', sortOrder: 60 },
];

const SHIPMENT_PERMISSION_TEMPLATES = [
  // ─── Create Shipment Screen ───────────────────────────────────────────────
  { key: 'shipment.screen.create_shipment.view',    resource: 'shipment', screen: 'create_shipment', type: 'screen', label: 'View Create Shipment', sortOrder: 10 },
  { key: 'shipment.screen.create_shipment.save',    resource: 'shipment', screen: 'create_shipment', type: 'action', action: 'save',    label: 'Save Shipment', sortOrder: 20 },
  { key: 'shipment.screen.create_shipment.extract', resource: 'shipment', screen: 'create_shipment', type: 'action', action: 'extract', label: 'Extract Shipment Documents', sortOrder: 30 },

  // ─── Shipment Tracker Screen ──────────────────────────────────────────────
  { key: 'shipment.screen.shipment_tracker.view', resource: 'shipment', screen: 'shipment_tracker', type: 'screen', label: 'View Shipment Tracker', sortOrder: 40 },

  // ─── Shipment Entry Tab ───────────────────────────────────────────────────
  { key: 'shipment.tab.shipment_entry.view', resource: 'shipment', screen: 'shipment_tracker', tab: 'shipment_entry', type: 'tab',    label: 'View Shipment Entry', sortOrder: 100 },
  // Fields
  { key: 'shipment.field.shipment_entry.piNo.edit',         resource: 'shipment', screen: 'shipment_tracker', tab: 'shipment_entry', field: 'piNo',          type: 'field', action: 'edit', label: 'Edit PI No.',        sortOrder: 101 },
  { key: 'shipment.field.shipment_entry.supplierEmail.edit', resource: 'shipment', screen: 'create_shipment',  tab: 'shipment_entry', field: 'supplierEmail', type: 'field', action: 'edit', label: 'Edit Supplier Email', sortOrder: 102 },

  // ─── Shipment Tracker Split Tab ───────────────────────────────────────────
  { key: 'shipment.tab.shipment_tracker_split.view',          resource: 'shipment', screen: 'shipment_tracker', tab: 'shipment_tracker_split', type: 'tab',    label: 'View Shipment Tracker Split', sortOrder: 110 },
  { key: 'shipment.tab.shipment_tracker_split.edit',          resource: 'shipment', screen: 'shipment_tracker', tab: 'shipment_tracker_split', type: 'action', action: 'edit',          label: 'Edit Shipment Tracker Split', sortOrder: 111 },
  { key: 'shipment.tab.shipment_tracker_split.lock_baseline', resource: 'shipment', screen: 'shipment_tracker', tab: 'shipment_tracker_split', type: 'action', action: 'lock_baseline', label: 'Lock Baseline',               sortOrder: 112 },
  // Fields
  { key: 'shipment.field.shipment_tracker_split.plannedEtd.edit', resource: 'shipment', screen: 'shipment_tracker', tab: 'shipment_tracker_split', field: 'planned.etd', type: 'field', action: 'edit', label: 'Edit Planned ETD', sortOrder: 113 },
  { key: 'shipment.field.shipment_tracker_split.plannedEta.edit', resource: 'shipment', screen: 'shipment_tracker', tab: 'shipment_tracker_split', field: 'planned.eta', type: 'field', action: 'edit', label: 'Edit Planned ETA', sortOrder: 114 },

  // ─── BL Details Tab ───────────────────────────────────────────────────────
  { key: 'shipment.tab.bl_details.view', resource: 'shipment', screen: 'shipment_tracker', tab: 'bl_details', type: 'tab',    label: 'View BL Details', sortOrder: 130 },
  { key: 'shipment.tab.bl_details.edit', resource: 'shipment', screen: 'shipment_tracker', tab: 'bl_details', type: 'action', action: 'edit', label: 'Edit BL Details', sortOrder: 131 },
  // Fields
  { key: 'shipment.field.bl_details.blNo.edit', resource: 'shipment', screen: 'shipment_tracker', tab: 'bl_details', field: 'blNo', type: 'field', action: 'edit', label: 'Edit BL Number', sortOrder: 132 },

  // ─── Document Tracker Tab ─────────────────────────────────────────────────
  { key: 'shipment.tab.document_tracker.view',    resource: 'shipment', screen: 'shipment_tracker', tab: 'document_tracker', type: 'tab',    label: 'View Document Tracker', sortOrder: 140 },
  { key: 'shipment.tab.document_tracker.edit',    resource: 'shipment', screen: 'shipment_tracker', tab: 'document_tracker', type: 'action', action: 'edit',             label: 'Edit Document Tracker',      sortOrder: 141 },
  { key: 'shipment.tab.document_tracker.preview', resource: 'shipment', screen: 'shipment_tracker', tab: 'document_tracker', type: 'action', action: 'preview_document', label: 'Preview Shipment Documents', sortOrder: 142 },
  // POINT 9: Milestone-level permissions — Purchase (M1, M2) and FAS (M3–M6)
  { key: 'shipment.milestone.purchase.edit', resource: 'shipment', screen: 'shipment_tracker', tab: 'document_tracker', type: 'action', action: 'milestone_purchase_edit', label: 'Edit Purchase Milestones (M1, M2)', sortOrder: 143 },
  { key: 'shipment.milestone.fas.edit',      resource: 'shipment', screen: 'shipment_tracker', tab: 'document_tracker', type: 'action', action: 'milestone_fas_edit',      label: 'Edit FAS Milestones (M3–M6)',      sortOrder: 144 },

  // ─── Port & Customs Tab ───────────────────────────────────────────────────
  { key: 'shipment.tab.port_customs.view', resource: 'shipment', screen: 'shipment_tracker', tab: 'port_customs', type: 'tab',    label: 'View Port & Customs', sortOrder: 150 },
  { key: 'shipment.tab.port_customs.edit', resource: 'shipment', screen: 'shipment_tracker', tab: 'port_customs', type: 'action', action: 'edit', label: 'Edit Port & Customs', sortOrder: 151 },

  // ─── Storage Tab ──────────────────────────────────────────────────────────
  // Parent tab access
  { key: 'shipment.tab.storage.view', resource: 'shipment', screen: 'shipment_tracker', tab: 'storage', type: 'tab', label: 'View Storage', sortOrder: 160 },
  // Sub-tab: Storage Allocation
  { key: 'shipment.tab.storage.storage_allocation.view', resource: 'shipment', screen: 'shipment_tracker', tab: 'storage', type: 'action', action: 'storage_allocation_view', label: 'View Storage Allocation', sortOrder: 161 },
  { key: 'shipment.tab.storage.storage_allocation.edit', resource: 'shipment', screen: 'shipment_tracker', tab: 'storage', type: 'action', action: 'storage_allocation_edit', label: 'Edit Storage Allocation', sortOrder: 162 },
  // Sub-tab: Storage Arrival
  { key: 'shipment.tab.storage.storage_arrival.view', resource: 'shipment', screen: 'shipment_tracker', tab: 'storage', type: 'action', action: 'storage_arrival_view', label: 'View Storage Arrival', sortOrder: 163 },
  { key: 'shipment.tab.storage.storage_arrival.edit', resource: 'shipment', screen: 'shipment_tracker', tab: 'storage', type: 'action', action: 'storage_arrival_edit', label: 'Edit Storage Arrival', sortOrder: 164 },

  // ─── Quality Tab ──────────────────────────────────────────────────────────
  { key: 'shipment.tab.quality.view', resource: 'shipment', screen: 'shipment_tracker', tab: 'quality', type: 'tab',    label: 'View Quality', sortOrder: 170 },
  { key: 'shipment.tab.quality.edit', resource: 'shipment', screen: 'shipment_tracker', tab: 'quality', type: 'action', action: 'edit', label: 'Edit Quality', sortOrder: 171 },

  // ─── Payment & Costing Tab ────────────────────────────────────────────────
  // Parent tab access
  { key: 'shipment.tab.payment_costing.view', resource: 'shipment', screen: 'shipment_tracker', tab: 'payment_costing', type: 'tab', label: 'View Payment & Costing', sortOrder: 180 },
  // Sub-tab: Payment Allocation
  { key: 'shipment.tab.payment_costing.payment_allocation.view', resource: 'shipment', screen: 'shipment_tracker', tab: 'payment_costing', type: 'action', action: 'payment_allocation_view', label: 'View Payment Allocation', sortOrder: 181 },
  { key: 'shipment.tab.payment_costing.payment_allocation.edit', resource: 'shipment', screen: 'shipment_tracker', tab: 'payment_costing', type: 'action', action: 'payment_allocation_edit', label: 'Edit Payment Allocation', sortOrder: 182 },
  // Sub-tab: Payment Costing
  { key: 'shipment.tab.payment_costing.costing_table.view', resource: 'shipment', screen: 'shipment_tracker', tab: 'payment_costing', type: 'action', action: 'costing_table_view', label: 'View Payment Costing Table', sortOrder: 183 },
  { key: 'shipment.tab.payment_costing.costing_table.edit', resource: 'shipment', screen: 'shipment_tracker', tab: 'payment_costing', type: 'action', action: 'costing_table_edit', label: 'Edit Payment Costing Table', sortOrder: 184 },
  // Sub-tab: Packaging Expenses
  { key: 'shipment.tab.payment_costing.packaging_expenses.view', resource: 'shipment', screen: 'shipment_tracker', tab: 'payment_costing', type: 'action', action: 'packaging_expenses_view', label: 'View Packaging Expenses', sortOrder: 185 },
  { key: 'shipment.tab.payment_costing.packaging_expenses.edit', resource: 'shipment', screen: 'shipment_tracker', tab: 'payment_costing', type: 'action', action: 'packaging_expenses_edit', label: 'Edit Packaging Expenses', sortOrder: 186 },
  // Actions
  { key: 'shipment.tab.payment_costing.generate_report', resource: 'shipment', screen: 'shipment_tracker', tab: 'payment_costing', type: 'action', action: 'generate_report', label: 'Generate Payment Report', sortOrder: 187 },
  // Fields
  { key: 'shipment.field.payment_costing.paidAmount.edit', resource: 'shipment', screen: 'shipment_tracker', tab: 'payment_costing', field: 'paymentAllocations.paidAmount', type: 'field', action: 'edit', label: 'Edit Paid Amount', sortOrder: 188 },

  // ─── Reports Screen ───────────────────────────────────────────────────────
  { key: 'shipment.action.reports.view', resource: 'shipment', screen: 'shipment_reports', type: 'screen', action: 'view', label: 'View Shipment Reports', sortOrder: 280 },
];

// Keep legacy keys as aliases so existing DB records still resolve correctly
const LEGACY_PERMISSION_TEMPLATES = [
  { key: 'shipment.tab.storage_arrival.view', resource: 'shipment', screen: 'shipment_tracker', tab: 'storage_arrival', type: 'tab',    label: '[Legacy] View Storage & Arrival', sortOrder: 900 },
  { key: 'shipment.tab.storage_arrival.edit', resource: 'shipment', screen: 'shipment_tracker', tab: 'storage_arrival', type: 'action', action: 'edit', label: '[Legacy] Edit Storage & Arrival', sortOrder: 901 },
  { key: 'shipment.action.document_tracker.preview',         resource: 'shipment', screen: 'shipment_tracker', tab: 'document_tracker', type: 'action', action: 'preview_document', label: '[Legacy] Preview Shipment Documents', sortOrder: 902 },
  { key: 'shipment.action.payment_costing.generate_report',  resource: 'shipment', screen: 'shipment_tracker', tab: 'payment_costing',  type: 'action', action: 'generate_report',  label: '[Legacy] Generate Payment Report',   sortOrder: 903 },
];

const ALL_PERMISSION_TEMPLATES = [
  ...MENU_PERMISSION_TEMPLATES,
  ...SHIPMENT_PERMISSION_TEMPLATES,
  ...LEGACY_PERMISSION_TEMPLATES,
];

const DEFAULT_ROLE_PERMISSION_MAP = {
  Admin: 'ALL',
  Manager: 'ALL',
  Purchase: [
    'menu.dashboard.view',
    'menu.shipments.view',
    'menu.suppliers.view',
    'menu.reports.view',
    'menu.settings.view',
    'shipment.screen.create_shipment.view',
    'shipment.screen.create_shipment.save',
    'shipment.screen.create_shipment.extract',
    'shipment.screen.shipment_tracker.view',
    'shipment.tab.shipment_entry.view',
    'shipment.field.shipment_entry.piNo.edit',
    'shipment.field.shipment_entry.supplierEmail.edit',
    'shipment.tab.shipment_tracker_split.view',
    'shipment.tab.shipment_tracker_split.edit',
    'shipment.tab.shipment_tracker_split.lock_baseline',
    'shipment.field.shipment_tracker_split.plannedEtd.edit',
    'shipment.field.shipment_tracker_split.plannedEta.edit',
    'shipment.tab.bl_details.view',
    'shipment.tab.bl_details.edit',
    'shipment.tab.quality.view',
    'shipment.tab.quality.edit',
    'shipment.action.reports.view',
  ],
  Logistic: [
    'menu.dashboard.view',
    'menu.shipments.view',
    'menu.reports.view',
    'menu.settings.view',
    'shipment.screen.shipment_tracker.view',
    'shipment.tab.port_customs.view',
    'shipment.tab.port_customs.edit',
    'shipment.tab.storage.view',
    'shipment.tab.storage.storage_allocation.view',
    'shipment.tab.storage.storage_allocation.edit',
    'shipment.tab.storage.storage_arrival.view',
    'shipment.tab.storage.storage_arrival.edit',
  ],
  FAS: [
    'menu.dashboard.view',
    'menu.shipments.view',
    'menu.reports.view',
    'menu.settings.view',
    'shipment.screen.shipment_tracker.view',
    'shipment.tab.document_tracker.view',
    'shipment.tab.document_tracker.edit',
    'shipment.tab.document_tracker.preview',
    'shipment.tab.payment_costing.view',
    'shipment.tab.payment_costing.payment_allocation.view',
    'shipment.tab.payment_costing.payment_allocation.edit',
    'shipment.tab.payment_costing.costing_table.view',
    'shipment.tab.payment_costing.costing_table.edit',
    'shipment.tab.payment_costing.packaging_expenses.view',
    'shipment.tab.payment_costing.packaging_expenses.edit',
    'shipment.tab.payment_costing.generate_report',
    'shipment.field.payment_costing.paidAmount.edit',
    'shipment.action.reports.view',
  ],
};

async function ensureRolesSeeded() {
  for (const role of DEFAULT_ROLES) {
    await Role.updateOne(
      { key: role.key },
      {
        $setOnInsert: { key: role.key },
        $set: {
          name: role.name,
          description: role.description,
          isSystem: role.isSystem,
        },
      },
      { upsert: true }
    );
  }
}

async function seedShipmentPermissionsAndDefaults() {
  await ensureRolesSeeded();

  for (const template of ALL_PERMISSION_TEMPLATES) {
    const { key, ...permissionUpdates } = template;
    await Permission.updateOne(
      { key },
      {
        $setOnInsert: { key },
        $set: { ...permissionUpdates, isActive: true },
      },
      { upsert: true }
    );
  }

  for (const roleKey of Object.keys(DEFAULT_ROLE_PERMISSION_MAP)) {
    const configured = DEFAULT_ROLE_PERMISSION_MAP[roleKey];
    const permissionKeys = configured === 'ALL'
      ? ALL_PERMISSION_TEMPLATES.map((permission) => permission.key)
      : configured;

    for (const permissionKey of permissionKeys) {
      await RolePermission.updateOne(
        { roleKey, permissionKey },
        {
          $setOnInsert: { roleKey, permissionKey },
          $set: { allowed: true },
        },
        { upsert: true }
      );
    }
  }
}

module.exports = {
  DEFAULT_ROLES,
  MENU_PERMISSION_TEMPLATES,
  SHIPMENT_PERMISSION_TEMPLATES,
  LEGACY_PERMISSION_TEMPLATES,
  ALL_PERMISSION_TEMPLATES,
  DEFAULT_ROLE_PERMISSION_MAP,
  ensureRolesSeeded,
  seedShipmentPermissionsAndDefaults,
};
