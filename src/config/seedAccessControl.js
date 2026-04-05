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
];

const SHIPMENT_PERMISSION_TEMPLATES = [
  { key: 'shipment.screen.create_shipment.view', resource: 'shipment', screen: 'create_shipment', type: 'screen', label: 'View Create Shipment', sortOrder: 10 },
  { key: 'shipment.screen.create_shipment.save', resource: 'shipment', screen: 'create_shipment', type: 'action', action: 'save', label: 'Save Shipment', sortOrder: 20 },
  { key: 'shipment.screen.create_shipment.extract', resource: 'shipment', screen: 'create_shipment', type: 'action', action: 'extract', label: 'Extract Shipment Documents', sortOrder: 30 },
  { key: 'shipment.tab.shipment_entry.view', resource: 'shipment', screen: 'shipment_tracker', tab: 'shipment_entry', type: 'tab', label: 'View Shipment Entry', sortOrder: 100 },
  { key: 'shipment.tab.shipment_tracker_split.view', resource: 'shipment', screen: 'shipment_tracker', tab: 'shipment_tracker_split', type: 'tab', label: 'View Shipment Tracker', sortOrder: 110 },
  { key: 'shipment.tab.shipment_tracker_split.lock_baseline', resource: 'shipment', screen: 'shipment_tracker', tab: 'shipment_tracker_split', type: 'action', action: 'lock_baseline', label: 'Lock Baseline', sortOrder: 120 },
  { key: 'shipment.tab.bl_details.view', resource: 'shipment', screen: 'shipment_tracker', tab: 'bl_details', type: 'tab', label: 'View BL Details', sortOrder: 130 },
  { key: 'shipment.tab.document_tracker.view', resource: 'shipment', screen: 'shipment_tracker', tab: 'document_tracker', type: 'tab', label: 'View Document Tracker', sortOrder: 140 },
  { key: 'shipment.tab.port_customs.view', resource: 'shipment', screen: 'shipment_tracker', tab: 'port_customs', type: 'tab', label: 'View Port & Customs', sortOrder: 150 },
  { key: 'shipment.tab.storage_arrival.view', resource: 'shipment', screen: 'shipment_tracker', tab: 'storage_arrival', type: 'tab', label: 'View Storage & Arrival', sortOrder: 160 },
  { key: 'shipment.tab.quality.view', resource: 'shipment', screen: 'shipment_tracker', tab: 'quality', type: 'tab', label: 'View Quality', sortOrder: 170 },
  { key: 'shipment.tab.payment_costing.view', resource: 'shipment', screen: 'shipment_tracker', tab: 'payment_costing', type: 'tab', label: 'View Payment & Costing', sortOrder: 180 },
  { key: 'shipment.field.shipment_entry.piNo.edit', resource: 'shipment', screen: 'shipment_tracker', tab: 'shipment_entry', field: 'piNo', type: 'field', action: 'edit', label: 'Edit PI No.', sortOrder: 200 },
  { key: 'shipment.field.shipment_entry.supplierEmail.edit', resource: 'shipment', screen: 'create_shipment', tab: 'shipment_entry', field: 'supplierEmail', type: 'field', action: 'edit', label: 'Edit Supplier Email', sortOrder: 210 },
  { key: 'shipment.field.shipment_tracker_split.plannedEtd.edit', resource: 'shipment', screen: 'shipment_tracker', tab: 'shipment_tracker_split', field: 'planned.etd', type: 'field', action: 'edit', label: 'Edit Planned ETD', sortOrder: 220 },
  { key: 'shipment.field.shipment_tracker_split.plannedEta.edit', resource: 'shipment', screen: 'shipment_tracker', tab: 'shipment_tracker_split', field: 'planned.eta', type: 'field', action: 'edit', label: 'Edit Planned ETA', sortOrder: 230 },
  { key: 'shipment.field.bl_details.blNo.edit', resource: 'shipment', screen: 'shipment_tracker', tab: 'bl_details', field: 'blNo', type: 'field', action: 'edit', label: 'Edit BL Number', sortOrder: 240 },
  { key: 'shipment.field.payment_costing.paidAmount.edit', resource: 'shipment', screen: 'shipment_tracker', tab: 'payment_costing', field: 'paymentAllocations.paidAmount', type: 'field', action: 'edit', label: 'Edit Paid Amount', sortOrder: 250 },
  { key: 'shipment.action.document_tracker.preview', resource: 'shipment', screen: 'shipment_tracker', tab: 'document_tracker', type: 'action', action: 'preview_document', label: 'Preview Shipment Documents', sortOrder: 260 },
  { key: 'shipment.action.payment_costing.generate_report', resource: 'shipment', screen: 'shipment_tracker', tab: 'payment_costing', type: 'action', action: 'generate_report', label: 'Generate Payment Report', sortOrder: 270 },
  { key: 'shipment.action.reports.view', resource: 'shipment', screen: 'shipment_reports', type: 'screen', action: 'view', label: 'View Shipment Reports', sortOrder: 280 },
];

const ALL_PERMISSION_TEMPLATES = [
  ...MENU_PERMISSION_TEMPLATES,
  ...SHIPMENT_PERMISSION_TEMPLATES,
];

const DEFAULT_ROLE_PERMISSION_MAP = {
  Admin: 'ALL',
  Manager: 'ALL',
  Purchase: [
    'shipment.screen.create_shipment.view',
    'shipment.screen.create_shipment.save',
    'shipment.screen.create_shipment.extract',
    'shipment.tab.shipment_entry.view',
    'shipment.tab.shipment_tracker_split.view',
    'shipment.tab.shipment_tracker_split.lock_baseline',
    'shipment.tab.bl_details.view',
    'shipment.tab.document_tracker.view',
    'shipment.field.shipment_entry.piNo.edit',
    'shipment.field.shipment_entry.supplierEmail.edit',
    'shipment.field.shipment_tracker_split.plannedEtd.edit',
    'shipment.field.shipment_tracker_split.plannedEta.edit',
    'shipment.action.document_tracker.preview',
    'shipment.action.reports.view',
    'menu.dashboard.view',
    'menu.shipments.view',
    'menu.suppliers.view',
    'menu.reports.view',
  ],
  Logistic: [
    'menu.dashboard.view',
    'menu.shipments.view',
    'menu.reports.view',
    'shipment.tab.shipment_tracker_split.view',
    'shipment.tab.document_tracker.view',
    'shipment.tab.port_customs.view',
    'shipment.tab.storage_arrival.view',
    'shipment.tab.quality.view',
    'shipment.field.shipment_tracker_split.plannedEtd.edit',
    'shipment.field.shipment_tracker_split.plannedEta.edit',
    'shipment.action.document_tracker.preview',
  ],
  FAS: [
    'menu.dashboard.view',
    'menu.shipments.view',
    'menu.reports.view',
    'shipment.tab.bl_details.view',
    'shipment.tab.document_tracker.view',
    'shipment.tab.payment_costing.view',
    'shipment.field.bl_details.blNo.edit',
    'shipment.field.payment_costing.paidAmount.edit',
    'shipment.action.document_tracker.preview',
    'shipment.action.payment_costing.generate_report',
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

  for (const template of SHIPMENT_PERMISSION_TEMPLATES) {
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

  for (const template of MENU_PERMISSION_TEMPLATES) {
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
  ALL_PERMISSION_TEMPLATES,
  DEFAULT_ROLE_PERMISSION_MAP,
  ensureRolesSeeded,
  seedShipmentPermissionsAndDefaults,
};
