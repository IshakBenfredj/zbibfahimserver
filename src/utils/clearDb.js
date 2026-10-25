const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: __dirname + '/../../.env' });

const clearDatabase = async () => {
  try {
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/en_panne_db';
    console.log(`[ClearDB] Connecting to MongoDB: ${uri}`);
    await mongoose.connect(uri);

    const collections = await mongoose.connection.db.listCollections().toArray();
    for (const c of collections) {
      await mongoose.connection.db.collection(c.name).deleteMany({});
      console.log(`[ClearDB] Cleared collection: ${c.name}`);
    }

    console.log('✅ [ClearDB] All collections successfully cleared. Ready for clean testing from zero.');
    process.exit(0);
  } catch (err) {
    console.error('❌ [ClearDB] Error clearing database:', err);
    process.exit(1);
  }
};

clearDatabase();
