require('dotenv').config();
const app = require('./app');
const {databaseConnect} = require('./config/db');
const {createFirstAdmin} = require('./config/createFirstAdmin');

const PORT = process.env.PORT || 5000;

(async () => {
    await databaseConnect(process.env.MONGO_URI);
    await createFirstAdmin();
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
})();

