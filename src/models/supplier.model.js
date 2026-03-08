const mongoose = require('mongoose');

const supplierSchema = new mongoose.Schema({
  supplierCode: { type: String, unique:true, required:true },
  name: { type: String, required:true },
  country: { type: String, required:true },
  status: { type: String, enum:["Active","Inactive"], default:"Active" }
}, { timestamps: true });

module.exports = mongoose.model("Supplier", supplierSchema);
