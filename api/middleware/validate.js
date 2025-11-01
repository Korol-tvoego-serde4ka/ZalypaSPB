const { validationResult } = require('express-validator');

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'validation_error', details: errors.array().map(e => ({ field: e.param, msg: e.msg })) });
  }
  next();
}

module.exports = { validate };
