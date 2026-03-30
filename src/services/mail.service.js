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

module.exports = {
  sendSupplierInviteEmail,
};
