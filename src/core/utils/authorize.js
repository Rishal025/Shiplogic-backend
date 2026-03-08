module.exports = function(allowedRoles = []) {
    return (req, res, next) => {
        const user = req.user; // assumed from auth middleware
        if (!user) return res.status(401).json({ error: "Unauthorized" });

        // Manager can access all modules
        if(user.role === "Manager") return next();

        // Check allowed roles
        if (!allowedRoles.includes(user.role)) {
            return res.status(403).json({ error: "Forbidden" });
        }

        next();
    }
}
