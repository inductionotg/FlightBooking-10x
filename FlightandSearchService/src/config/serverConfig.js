const dotenv = require('dotenv')

dotenv.config();

module.exports={
    PORT:process.env.PORT,
    RESERVATION_SERVICE_KEY:process.env.RESERVATION_SERVICE_KEY
}
