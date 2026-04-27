/**
 * Enhanced Authorization Middleware
 * 
 * Supports both legacy role-based and new permission-based authorization
 * with dual-mode operation for zero-downtime migration.
 */

const { normalizeRole, normalizeRoles } = require('./roleHelpers');
const { authConfig, getAuthModeForRoute } = require('../../config/authConfig');
const { permissionService } = require('../services/permissionService');

/**
 * Main authorize function - supports multiple input formats
 * @param {Array|string|Object} requirements - Authorization requirements
 * @returns {Function} Express middleware function
 */
module.exports = function authorize(requirements) {
    return async (req, res, next) => {
        try {
            const user = req.user; // assumed from auth middleware
            
            // Basic authentication check
            if (!user) {
                return res.status(401).json({ 
                    error: "Unauthorized",
                    message: "Authentication required"
                });
            }

            // Determine authorization mode for this route
            const authMode = getAuthModeForRoute(req.path);
            
            // Parse requirements based on input type
            const parsedRequirements = _parseRequirements(requirements);
            
            // Perform authorization based on mode
            let authorized = false;
            let authResult = null;

            switch (authMode) {
                case 'legacy':
                    authResult = await _checkLegacyAuthorization(user, parsedRequirements);
                    authorized = authResult.authorized;
                    break;
                    
                case 'permissions':
                    authResult = await _checkPermissionAuthorization(user, parsedRequirements);
                    authorized = authResult.authorized;
                    break;
                    
                case 'dual':
                    authResult = await _checkDualAuthorization(user, parsedRequirements);
                    authorized = authResult.authorized;
                    break;
                    
                default:
                    console.error(`Invalid auth mode: ${authMode}`);
                    return res.status(500).json({ 
                        error: "Internal Server Error",
                        message: "Invalid authorization configuration"
                    });
            }

            if (authorized) {
                // Log successful authorization if debug enabled
                _logDebug(`Authorization granted for user ${user._id} on ${req.path} (mode: ${authMode})`);
                return next();
            } else {
                // Log failed authorization
                _logAuthFailure(user, req, parsedRequirements, authResult);
                
                return res.status(403).json({
                    error: "Forbidden",
                    message: authResult.message || "Insufficient permissions for this resource",
                    required: authResult.required,
                    userPermissions: authResult.userPermissions,
                    code: "PERMISSION_DENIED"
                });
            }

        } catch (error) {
            console.error('Authorization middleware error:', error);
            
            // Fallback to legacy authorization in case of system error
            if (authConfig.migration.enableLegacyBypass) {
                try {
                    const fallbackResult = await _checkLegacyAuthorizationFallback(req.user, requirements);
                    if (fallbackResult.authorized) {
                        console.warn('Authorization system fallback activated', {
                            userId: req.user._id,
                            route: req.path,
                            error: error.message
                        });
                        
                        return res.status(200).json({
                            warning: "Authorization system unavailable, using legacy authorization",
                            fallback: true,
                            code: "AUTH_SYSTEM_FALLBACK"
                        });
                    }
                } catch (fallbackError) {
                    console.error('Fallback authorization also failed:', fallbackError);
                }
            }
            
            return res.status(500).json({ 
                error: "Authorization Error",
                message: "Authorization system temporarily unavailable",
                code: "AUTH_SYSTEM_ERROR"
            });
        }
    };
};

/**
 * Parse authorization requirements from various input formats
 * @param {Array|string|Object} requirements - Input requirements
 * @returns {Object} Parsed requirements object
 * @private
 */
function _parseRequirements(requirements) {
    // Handle legacy array format: ['Purchase', 'Manager']
    if (Array.isArray(requirements)) {
        // Check if it's an array of roles (legacy) or permissions (new)
        const isLegacyRoles = requirements.every(req => 
            typeof req === 'string' && !req.includes(':')
        );
        
        if (isLegacyRoles) {
            return {
                type: 'legacy',
                roles: requirements,
                permissions: []
            };
        } else {
            return {
                type: 'permissions',
                roles: [],
                permissions: requirements
            };
        }
    }
    
    // Handle single permission string: 'shipments:read'
    if (typeof requirements === 'string') {
        if (requirements.includes(':')) {
            return {
                type: 'permissions',
                roles: [],
                permissions: [requirements]
            };
        } else {
            // Single role (legacy)
            return {
                type: 'legacy',
                roles: [requirements],
                permissions: []
            };
        }
    }
    
    // Handle dual-mode object: { legacy: ['Purchase'], permissions: ['shipments:read'], mode: 'dual' }
    if (typeof requirements === 'object' && requirements !== null) {
        return {
            type: requirements.mode || 'dual',
            roles: requirements.legacy || requirements.roles || [],
            permissions: requirements.permissions || []
        };
    }
    
    // Default to empty requirements
    return {
        type: 'legacy',
        roles: [],
        permissions: []
    };
}

/**
 * Check legacy role-based authorization
 * @param {Object} user - User object
 * @param {Object} requirements - Parsed requirements
 * @returns {Promise<Object>} Authorization result
 * @private
 */
async function _checkLegacyAuthorization(user, requirements) {
    const normalizedUserRole = normalizeRole(user.role);
    
    // Manager and Management bypass (legacy behavior)
    if (authConfig.migration.enableLegacyBypass && 
        (normalizedUserRole === "Manager" || normalizedUserRole === "Management")) {
        return {
            authorized: true,
            method: 'legacy_bypass',
            message: 'Manager role bypass'
        };
    }
    
    // Check allowed roles
    const normalizedAllowedRoles = normalizeRoles(requirements.roles);
    const authorized = normalizedAllowedRoles.includes(normalizedUserRole);
    
    return {
        authorized,
        method: 'legacy_roles',
        message: authorized ? 'Role authorized' : 'Role not in allowed list',
        required: requirements.roles,
        userRole: normalizedUserRole
    };
}

/**
 * Check permission-based authorization
 * @param {Object} user - User object
 * @param {Object} requirements - Parsed requirements
 * @returns {Promise<Object>} Authorization result
 * @private
 */
async function _checkPermissionAuthorization(user, requirements) {
    if (requirements.permissions.length === 0) {
        return {
            authorized: true,
            method: 'permissions_empty',
            message: 'No permissions required'
        };
    }
    
    // Check if user has all required permissions
    const authorized = await permissionService.hasAllPermissions(user, requirements.permissions);
    const userPermissions = await permissionService.getUserPermissions(user);
    
    return {
        authorized,
        method: 'permissions',
        message: authorized ? 'All permissions granted' : 'Missing required permissions',
        required: requirements.permissions,
        userPermissions: userPermissions
    };
}

/**
 * Check dual authorization (both legacy and permission-based)
 * @param {Object} user - User object
 * @param {Object} requirements - Parsed requirements
 * @returns {Promise<Object>} Authorization result
 * @private
 */
async function _checkDualAuthorization(user, requirements) {
    // Check legacy authorization
    const legacyResult = await _checkLegacyAuthorization(user, requirements);
    
    // Check permission authorization
    const permissionResult = await _checkPermissionAuthorization(user, requirements);
    
    // In dual mode, either method can authorize (OR logic)
    const authorized = legacyResult.authorized || permissionResult.authorized;
    
    return {
        authorized,
        method: 'dual',
        message: authorized ? 
            `Authorized via ${legacyResult.authorized ? 'legacy' : 'permissions'}` :
            'Neither legacy nor permission authorization succeeded',
        required: [...(requirements.roles || []), ...(requirements.permissions || [])],
        userRole: normalizeRole(user.role),
        userPermissions: permissionResult.userPermissions,
        legacyResult,
        permissionResult
    };
}

/**
 * Fallback legacy authorization for system errors
 * @param {Object} user - User object
 * @param {*} originalRequirements - Original requirements
 * @returns {Promise<Object>} Authorization result
 * @private
 */
async function _checkLegacyAuthorizationFallback(user, originalRequirements) {
    try {
        // Convert to legacy format if needed
        let roles = [];
        
        if (Array.isArray(originalRequirements)) {
            roles = originalRequirements.filter(req => typeof req === 'string' && !req.includes(':'));
        } else if (typeof originalRequirements === 'string' && !originalRequirements.includes(':')) {
            roles = [originalRequirements];
        } else if (typeof originalRequirements === 'object' && originalRequirements.legacy) {
            roles = originalRequirements.legacy;
        }
        
        const requirements = { roles, permissions: [] };
        return await _checkLegacyAuthorization(user, requirements);
    } catch (error) {
        console.error('Fallback authorization error:', error);
        return { authorized: false, method: 'fallback_failed' };
    }
}

/**
 * Log authorization failure
 * @param {Object} user - User object
 * @param {Object} req - Request object
 * @param {Object} requirements - Parsed requirements
 * @param {Object} authResult - Authorization result
 * @private
 */
function _logAuthFailure(user, req, requirements, authResult) {
    if (authConfig.security.logFailedAttempts) {
        console.warn('Authorization failed', {
            userId: user._id,
            userRole: user.role,
            route: req.path,
            method: req.method,
            requirements: requirements,
            authResult: authResult,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Log debug message if debug logging is enabled
 * @param {string} message - Debug message
 * @private
 */
function _logDebug(message) {
    if (authConfig.performance.enableDebugLogging) {
        console.log(`[Authorize] ${message}`);
    }
}

/**
 * Utility functions for authorization
 */

/**
 * Create authorization middleware for multiple permissions (ALL required)
 * @param {Array<string>} permissions - Array of required permissions
 * @returns {Function} Express middleware
 */
function requireAllPermissions(permissions) {
    return authorize(permissions);
}

/**
 * Create authorization middleware for multiple permissions (ANY required)
 * @param {Array<string>} permissions - Array of permissions (any one is sufficient)
 * @returns {Function} Express middleware
 */
function requireAnyPermission(permissions) {
    return async (req, res, next) => {
        try {
            const user = req.user;
            
            if (!user) {
                return res.status(401).json({ 
                    error: "Unauthorized",
                    message: "Authentication required"
                });
            }

            // Check if user has any of the required permissions
            const hasAny = await permissionService.hasAnyPermission(user, permissions);
            
            if (hasAny) {
                _logDebug(`Authorization granted (any permission) for user ${user._id} on ${req.path}`);
                return next();
            } else {
                const userPermissions = await permissionService.getUserPermissions(user);
                
                _logAuthFailure(user, req, { permissions }, {
                    authorized: false,
                    message: 'User does not have any of the required permissions',
                    required: permissions,
                    userPermissions
                });
                
                return res.status(403).json({
                    error: "Forbidden",
                    message: "You need at least one of the required permissions",
                    required: permissions,
                    userPermissions: userPermissions,
                    code: "INSUFFICIENT_PERMISSIONS"
                });
            }
        } catch (error) {
            console.error('Authorization middleware error (any permission):', error);
            return res.status(500).json({ 
                error: "Authorization Error",
                message: "Authorization system temporarily unavailable",
                code: "AUTH_SYSTEM_ERROR"
            });
        }
    };
}

/**
 * Create authorization middleware with custom logic
 * @param {Function} customCheck - Custom authorization function (user) => Promise<boolean>
 * @param {string} errorMessage - Custom error message
 * @returns {Function} Express middleware
 */
function requireCustomAuthorization(customCheck, errorMessage = "Access denied") {
    return async (req, res, next) => {
        try {
            const user = req.user;
            
            if (!user) {
                return res.status(401).json({ 
                    error: "Unauthorized",
                    message: "Authentication required"
                });
            }

            const authorized = await customCheck(user, req);
            
            if (authorized) {
                _logDebug(`Custom authorization granted for user ${user._id} on ${req.path}`);
                return next();
            } else {
                _logAuthFailure(user, req, { custom: true }, {
                    authorized: false,
                    message: errorMessage
                });
                
                return res.status(403).json({
                    error: "Forbidden",
                    message: errorMessage,
                    code: "CUSTOM_AUTHORIZATION_FAILED"
                });
            }
        } catch (error) {
            console.error('Custom authorization middleware error:', error);
            return res.status(500).json({ 
                error: "Authorization Error",
                message: "Authorization system temporarily unavailable",
                code: "AUTH_SYSTEM_ERROR"
            });
        }
    };
}

// Export additional utility functions
module.exports.requireAllPermissions = requireAllPermissions;
module.exports.requireAnyPermission = requireAnyPermission;
module.exports.requireCustomAuthorization = requireCustomAuthorization;