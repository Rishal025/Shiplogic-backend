require('dotenv').config();
const app = require('./app');
const {databaseConnect} = require('./config/db');
const {createFirstAdmin} = require('./config/createFirstAdmin');

const PORT = process.env.PORT || 5000;

// Start listening FIRST so CORS preflight requests are always handled
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Connect to DB after server is up
(async () => {
    try {
        await databaseConnect(process.env.MONGO_URI);
        await createFirstAdmin();
        console.log('✅ Database connected and admin seeded');
    } catch (err) {
        console.error('❌ Database connection error:', err.message);
        console.error('⚠️  Server is running but DB is unavailable — API calls will fail until DB reconnects');
    }
})();

