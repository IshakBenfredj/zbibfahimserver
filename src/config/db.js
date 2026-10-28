const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    const uri =
      process.env.MONGODB_URI || "mongodb://localhost:27017/en_panne_db";
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log(
      `[MongoDB] Connected successfully to host: ${conn.connection.host}`,
    );
    console.log(`[MongoDB] Database Name: ${conn.connection.name}`);

    // Clean up seed accounts so no account is verified unless explicitly approved by admin
    const User = require("../models/User");
    const cleanup = await User.updateMany(
      { isVerified: true },
      { $set: { isVerified: false } },
    );
    if (cleanup.modifiedCount > 0) {
      console.log(
        `[DB Verification Reset] Unverified ${cleanup.modifiedCount} auto-verified seed accounts.`,
      );
    }
  } catch (error) {
    console.error(`[MongoDB] Connection warning/error: ${error.message}`);
    console.error(
      `[MongoDB] Please ensure MONGODB_URI is set on Render and Atlas Network Access allows 0.0.0.0/0.`,
    );
    // Do not exit process in production to allow web service to remain online and handle health checks
  }
};

module.exports = connectDB;
