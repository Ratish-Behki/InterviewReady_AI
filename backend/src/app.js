const express = require('express')
const cookieParser = require('cookie-parser')
const cors = require("cors");

const app = express();

app.use(cors({
  origin: "https://interviewready-ai-frontend-ibzl.onrender.com",
  credentials: true
}));

app.use(express.json())
app.use(cookieParser())

const authRoute = require('./routes/auth.routes')
const interviewRoute = require('./routes/interview.routes')

app.use("/api/auth",authRoute)
app.use("/api/interview",interviewRoute)

module.exports = app