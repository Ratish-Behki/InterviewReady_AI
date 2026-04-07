const jwt = require('jsonwebtoken')
const tokenBlackListModel = require('../models/blacklist.model')

async function authUser(req, res, next){

    try{

        const token = req.cookies?.token

        // 1️⃣ token check
        if(!token){
            return res.status(401).json({
                message: "token not found"
            })
        }

        // 2️⃣ blacklist check
        const isTokenBlackList = await tokenBlackListModel.findOne({ token })

        if(isTokenBlackList){
            return res.status(401).json({
                message: "token blacklisted"
            })
        }

        // 3️⃣ verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET)

        req.user = decoded

        // 4️⃣ move to next middleware/controller
        return next()

    }
    catch(err){

        return res.status(401).json({
            message: "invalid token"
        })

    }
}

module.exports = { authUser }