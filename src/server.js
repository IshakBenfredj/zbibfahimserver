const http = require("http");
const express = require("express");
const cors = require("cors");
const path = require("path");
const dotenv = require("dotenv");
const connectDB = require("./config/db");
const errorHandler = require("./middlewares/errorHandler");
const { initSocket } = require("./utils/socket");
const job = require("./cron");

// Load env variables
dotenv.config();

// Connect to Database
connectDB();

const app = express();
const server = http.createServer(app);

// Initialize Socket.io Realtime Service
initSocket(server);

// Body Parser & URL Encoded
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
job.start();
// Enable CORS for mobile app & dashboard
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// Serve static uploads
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "online",
    service: "En Panne API",
    version: "1.0.0",
    realtime: "Socket.io enabled",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

// Mount API Routes
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/providers", require("./routes/providerRoutes"));
app.use("/api/requests", require("./routes/partRequestRoutes"));
app.use("/api/quotes", require("./routes/quoteRoutes"));
app.use("/api/reviews", require("./routes/reviewRoutes"));
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api/upload", require("./routes/uploadRoutes"));

// 404 Route Not Found Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `المسار (${req.originalUrl}) غير موجود / Route non trouvée`,
  });
});

// Global Error Handler Middleware
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`🚀 [En Panne API] Server running on port ${PORT}`);
  console.log(`⚡ [Realtime] Socket.io initialized & listening`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`🌐 Base URL: http://localhost:${PORT}`);
  console.log(`🩺 Health Check: http://localhost:${PORT}/api/health`);
  console.log(`===============================================`);
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (err) => {
  console.error(`[Unhandled Rejection]: ${err.message}`);
});

module.exports = { app, server };
