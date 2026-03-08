// src/core/utils/authMiddleware.js
const jwt = require('jsonwebtoken');
const User = require('../../models/auth.model');

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if(!authHeader || !authHeader.startsWith('Bearer ')) 
      return res.status(401).json({ message: 'Authorization header missing or invalid' });

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if(!user) return res.status(401).json({ message: 'Invalid token' });

    req.user = user; // attach user to request
    next();

  } catch (err) {
    console.error(err);
    res.status(401).json({ message: 'Unauthorized' });
  }
};

module.exports = authMiddleware;
