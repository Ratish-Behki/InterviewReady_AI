const mongoose = require('mongoose')

const blackListTokenSchema = new mongoose.Schema({
    token:{
        type:String,
        required:[true,"token not find"]
    }
},{timestamps:true})

const tokenBlackListModel= mongoose.model("blackListToken",blackListTokenSchema)

module.exports = tokenBlackListModel