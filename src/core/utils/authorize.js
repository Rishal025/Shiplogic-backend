const { normalizeRole, normalizeRoles } = require('./roleHelpers');

module.exports = function(allowedRoles = []) {
    return (req, res, next) => {
        const user = req.user; // assumed from auth middleware
        if (!user) return res.status(401).json({ error: "Unauthorized" });

        // Manager can access all modules
        const normalizedUserRole = normalizeRole(user.role);
        if(normalizedUserRole === "Manager") return next();

        // Check allowed roles
        const normalizedAllowedRoles = normalizeRoles(allowedRoles);
        if (!normalizedAllowedRoles.includes(normalizedUserRole)) {
            return res.status(403).json({ error: "Forbidden" });
        }

        next();
    }
}
