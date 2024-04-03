const { Decimal128 } = require("mongodb");
const mongoose = require("mongoose");
const PageSchema = new mongoose.Schema({
    url: String,  
    title:String,
    paragraph:String,
    outgoingLinks: [String],
    incomingLinks:[String],
    domain: String,
    pr: Number,
    score: Number,
    name: {
        type: String,
        default:"Jeremy Pierce-Lord"
    }
});

module.exports = mongoose.model("Page", PageSchema);