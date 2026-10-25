const http = require("http");
const express = require("express");
const cors = require("cors");
const path = require("path");
const dotenv = require("dotenv");
const connectDB = require("./config/db");
const errorHandler = require("./middlewares/errorHandler");
const { initSocket } = require("./utils/socket");
const job = require("./cron");
const mongoose = require("mongoose");
const { getOsrmRoute } = require("./utils/distance");

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

// Root route
app.get("/", (req, res) => {
  res.status(200).json({
    service: "En Panne API",
    status: "online",
    version: "1.0.0",
    database: mongoose.connection.readyState === 1 ? "connected" : "connecting_or_disconnected",
    healthCheck: "/api/health",
    timestamp: new Date().toISOString(),
  });
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "online",
    service: "En Panne API",
    version: "1.0.0",
    database: mongoose.connection.readyState === 1 ? "connected" : "connecting_or_disconnected",
    realtime: "Socket.io enabled",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

// Real-time Road Distance & Duration Route (OpenStreetMap & OSRM)
app.get("/api/distance", async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) {
      return res.status(400).json({
        success: false,
        message: "start and end coordinates required in longitude,latitude format. Example: ?start=0.1370,35.4040&end=0.1500,35.4200"
      });
    }

    const [lon1, lat1] = start.split(',').map(s => parseFloat(s.trim()));
    const [lon2, lat2] = end.split(',').map(s => parseFloat(s.trim()));

    if (isNaN(lon1) || isNaN(lat1) || isNaN(lon2) || isNaN(lat2)) {
      return res.status(400).json({
        success: false,
        message: "Coordinates must be valid numbers (longitude,latitude)"
      });
    }

    const route = await getOsrmRoute(lon1, lat1, lon2, lat2);
    if (!route) {
      return res.status(500).json({
        success: false,
        message: "Unable to calculate route between coordinates"
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        distanceKm: route.distanceKm,
        durationMin: route.durationMin,
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
        source: route.source,
        start: `${lon1},${lat1}`,
        end: `${lon2},${lat2}`
      }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// Mount API Routes
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/providers", require("./routes/providerRoutes"));
app.use("/api/requests", require("./routes/partRequestRoutes"));
app.use("/api/quotes", require("./routes/quoteRoutes"));
app.use("/api/reviews", require("./routes/reviewRoutes"));
app.use("/api/notifications", require("./routes/notificationRoutes"));
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

// Handle uncaught exceptions so process never crashes on Render
process.on("uncaughtException", (err) => {
  console.error(`[Uncaught Exception]: ${err.message}`, err.stack);
});

module.exports = { app, server };
