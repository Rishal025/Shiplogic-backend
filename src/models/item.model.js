const mongoose = require('mongoose');
const { type } = require('os');

const itemSchema = new mongoose.Schema({
  itemCode: { type: String, unique:true, required:true },
  description: { type: String, required:true },
  riceName:{type:String},
  packing: { type: String },
  bagWeightKg: { type: Number },
  unit: { type: String, default:"MT" },
  status: { type: String, enum:["Active","Inactive"], default:"Active" }
}, { timestamps:true });

module.exports = mongoose.model("Item", itemSchema);
