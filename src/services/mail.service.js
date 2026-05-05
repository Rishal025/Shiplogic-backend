const nodemailer = require('nodemailer');

let cachedTransporter = null;

function getMailerConfig() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;

  if (!host || !user || !pass || !from) {
    throw new Error('SMTP configuration is incomplete. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM.');
  }

  return { host, port, user, pass, from };
}

function getTransporter() {
  if (cachedTransporter) {
    return cachedTransporter;
  }

  const config = getMailerConfig();
  cachedTransporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: false,
    auth: {
      user: config.user,
      pass: config.pass,
    },
    tls: {
      ciphers: 'SSLv3',
    },
  });

  return cachedTransporter;
}

async function sendSupplierInviteEmail({ to, supplierName, temporaryPassword }) {
  const transporter = getTransporter();
  const { from } = getMailerConfig();
  const portalUrl = process.env.SUPPLIER_PORTAL_URL || 'http://localhost:3000/login';

  await transporter.sendMail({
    from,
    to,
    subject: 'Royal Horizon Supplier Portal Invitation',
    text: [
      `Hello ${supplierName},`,
      '',
      'Your supplier portal account has been created by Royal Horizon.',
      `Login URL: ${portalUrl}`,
      `Email: ${to}`,
      `Temporary Password: ${temporaryPassword}`,
      '',
      'Please sign in, complete your supplier profile, and wait for admin activation once your profile reaches 100% completion.',
    ].join('\n'),
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #0f172a;">
        <p>Hello ${supplierName},</p>
        <p>Your supplier portal account has been created by Royal Horizon.</p>
        <p><strong>Login URL:</strong> <a href="${portalUrl}">${portalUrl}</a></p>
        <p><strong>Email:</strong> ${to}<br/><strong>Temporary Password:</strong> ${temporaryPassword}</p>
        <p>Please sign in, complete your supplier profile, and wait for admin activation once your profile reaches 100% completion.</p>
      </div>
    `,
  });
}

async function sendInternalUserInviteEmail({ to, userName, role, temporaryPassword }) {
  const transporter = getTransporter();
  const { from } = getMailerConfig();
  const portalUrl = process.env.INTERNAL_PORTAL_URL || 'http://localhost:4200/auth/login';

  await transporter.sendMail({
    from,
    to,
    subject: 'Royal Horizon Shipment Portal Access',
    text: [
      `Hello ${userName},`,
      '',
      'Your internal user account has been created for the Royal Horizon shipment portal.',
      `Login URL: ${portalUrl}`,
      `Email: ${to}`,
      `Role: ${role}`,
      `Temporary Password: ${temporaryPassword}`,
      '',
      'You will be required to change this password when you sign in for the first time.',
    ].join('\n'),
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #0f172a;">
        <p>Hello ${userName},</p>
        <p>Your internal user account has been created for the Royal Horizon shipment portal.</p>
        <p><strong>Login URL:</strong> <a href="${portalUrl}">${portalUrl}</a></p>
        <p><strong>Email:</strong> ${to}<br/><strong>Role:</strong> ${role}<br/><strong>Temporary Password:</strong> ${temporaryPassword}</p>
        <p>You will be required to change this password when you sign in for the first time.</p>
      </div>
    `,
  });
}

async function sendWorkflowUpdateEmail({
  to,
  userName,
  shipmentNo,
  containerSerialNo,
  sectionLabel,
  updatedBy,
  nextRole,
  approvalStage,
}) {
  const transporter = getTransporter();
  const { from } = getMailerConfig();
  const portalUrl = process.env.INTERNAL_PORTAL_URL || 'http://localhost:4200/auth/login';
  const safeUserName = userName || 'Team member';
  const safeShipmentNo = shipmentNo || 'N/A';
  const safeContainerSerialNo = containerSerialNo || 'N/A';
  const safeSectionLabel = sectionLabel || 'Shipment section';
  const safeUpdatedBy = updatedBy || 'A user';
  const safeNextRole = nextRole || 'Assigned team';
  const safeApprovalStage = approvalStage || '';

  await transporter.sendMail({
    from,
    to,
    subject: `Royal Horizon Shipment Update: ${safeSectionLabel}`,
    text: [
      `Hello ${safeUserName},`,
      '',
      `${safeUpdatedBy} saved the ${safeSectionLabel} section in the shipment workflow.`,
      `Shipment No: ${safeShipmentNo}`,
      `Container Serial No: ${safeContainerSerialNo}`,
      `Responsible Team: ${safeNextRole}`,
      ...(safeApprovalStage ? [`Approval Stage: ${safeApprovalStage}`] : []),
      '',
      `You can review the latest update here: ${portalUrl}`,
    ].join('\n'),
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #0f172a;">
        <p>Hello ${safeUserName},</p>
        <p><strong>${safeUpdatedBy}</strong> saved the <strong>${safeSectionLabel}</strong> section in the shipment workflow.</p>
        <p>
          <strong>Shipment No:</strong> ${safeShipmentNo}<br/>
          <strong>Container Serial No:</strong> ${safeContainerSerialNo}<br/>
          <strong>Responsible Team:</strong> ${safeNextRole}
          ${safeApprovalStage ? `<br/><strong>Approval Stage:</strong> ${safeApprovalStage}` : ''}
        </p>
        <p>You can review the latest update here: <a href="${portalUrl}">${portalUrl}</a></p>
      </div>
    `,
  });
}

module.exports = {
  sendSupplierInviteEmail,
  sendInternalUserInviteEmail,
  sendWorkflowUpdateEmail,
};
