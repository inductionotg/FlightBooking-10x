const dotenv = require('dotenv')

dotenv.config()

module.exports = {
    PORT: process.env.PORT,
    FLIGHT_SERVICE_PATH : process.env.FLIGHT_SERVICE_PATH,
    RESERVATION_SERVICE_KEY: process.env.RESERVATION_SERVICE_KEY
}

