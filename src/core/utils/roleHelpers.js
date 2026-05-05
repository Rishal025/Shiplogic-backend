const ROLE_ALIASES = {
  Logistics: 'Logistic',
  'Fas manager': 'FasManager',
  'FAS Manager': 'FasManager',
};

function normalizeRole(role) {
  return ROLE_ALIASES[role] || role;
}

function normalizeRoles(roles = []) {
  return roles.map(normalizeRole);
}

module.exports = {
  normalizeRole,
  normalizeRoles,
};
