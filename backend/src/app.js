const express = require('express')
const cookieParser = require('cookie-parser')
const cors = require("cors");

const app = express();

const allowedOrigins = [
  "https://interviewready-ai-frontend-ibzl.onrender.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173"
];

app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('CORS policy: origin not allowed'));
    }
  },
  credentials: true
}));

app.use(express.json())
app.use(cookieParser())

const authRoute = require('./routes/auth.routes')
const interviewRoute = require('./routes/interview.routes')

app.use("/api/auth",authRoute)
app.use("/api/interview",interviewRoute)

// dev-only debug endpoint to inspect incoming cookies and origin
if (process.env.NODE_ENV !== 'production') {
  app.get('/api/debug/cookies', (req, res) => {
    return res.json({
      origin: req.get('origin') || null,
      cookies: req.cookies || {}
    })
  })
}

module.exports = app