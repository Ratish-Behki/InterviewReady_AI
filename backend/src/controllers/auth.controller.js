const userModel = require('../models/user.model')
const tokenBlackListModel = require('../models/blacklist.model')
const bcrypt = require("bcryptjs")
const jwt = require('jsonwebtoken')
const { get } = require('mongoose')

async function registerUserController(req,res) {
    const {username,email,password} = req.body

    if(!username || !email || !password){
        return res.status(400).json({
            message:"provide username,email,password"
        })
    }

    const isUserAlreadyExists = await userModel.findOne({
        $or:[{username},{email}]
    })

    if(isUserAlreadyExists){
        return res.status(400).json({
            message:"account already exist"
        })
    }

    const hash = await bcrypt.hash(password,10)

    const user = await userModel.create({
        username,
        email,
        password:hash
    })
    
    const token = jwt.sign(
        {id:user._id, username:user.username},
        process.env.JWT_SECRET,
        {expiresIn:"1d"}
    )

    // ❌ Current — no options, cookie won't work cross-site
        res.cookie("token", token)

        // ✅ Fixed
        res.cookie("token", token, {
        httpOnly: false,        // JS can't access it (XSS protection)
        secure: true,          // HTTPS only
        sameSite: "None",      // required for cross-origin requests
        maxAge: 24 * 60 * 60 * 1000  // 1 day in ms (matches JWT expiry)
        })

    res.status(201).json({
        message:"user register successfully",
        user:{
            id:user._id,
            username:user.username,
            email:user.email
        },
    })

}

async function loginUserController(req,res) {
    const {email,password} = req.body

    const user = await userModel.findOne({email})

    if(!user){
        return res.status(400).json({
            message:"invalid email or password"
        })
    }

    const isPasswordValid = await bcrypt.compare(password,user.password)

    if(!isPasswordValid){
        return res.status(400).json({
            message:"invalid password"
        })
    }
    
    const token = jwt.sign(
        {id:user._id, username:user.username},
        process.env.JWT_SECRET,
        {expiresIn:"1d"}
    )

    res.cookie("token",token, {
        httpOnly: false,        // JS can't access it (XSS protection)
        secure: true,          // HTTPS only
        sameSite: "None",      // required for cross-origin requests
        maxAge: 24 * 60 * 60 * 1000  // 1 day in ms (matches JWT expiry)
        })

    res.status(201).json({
        message:"user login successfully",
        user:{
            id:user._id,
            username:user.username,
            email:user.email
        },
    })

}

async function logoutUserController(req,res) {
    const token = req.cookies.token
   
    if(token){
        await tokenBlackListModel.create({token})
    }

    res.clearCookie("token")

    res.status(200).json({
        message:"user logged out"
    })
}

async function getMeController(req,res) {
    const user = await userModel.findById(req.user.id)

    res.status(200).json({
        message:"user details fetched ",
        user:{
            id:user._id,
            username:user.username,
            email:user.email
        }
    })
}


module.exports = {registerUserController,loginUserController,logoutUserController,getMeController}