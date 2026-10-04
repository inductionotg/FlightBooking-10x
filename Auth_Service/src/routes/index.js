const express = require('express')

const router = express.Router()

const V1ApiRoutes = require('./V1/index')

router.use('/v1',V1ApiRoutes)

module.exports = router