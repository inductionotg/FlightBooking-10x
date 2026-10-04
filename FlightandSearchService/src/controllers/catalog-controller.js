const { Airport, Airplane, City } = require('../models');
const telemetry = require('../observability');

async function list(req, res) {
  try {
    const [airports, airplanes, cities] = await Promise.all([
      Airport.findAll({ attributes: ['id', 'name', 'cityId'], order: [['name', 'ASC']] }),
      Airplane.findAll({ attributes: ['id', 'modelNumber', 'capacity'], order: [['modelNumber', 'ASC']] }),
      City.findAll({ attributes: ['id', 'name'], order: [['name', 'ASC']] })
    ]);
    return res.json({ success: true, data: { airports, airplanes, cities } });
  } catch (error) {
    telemetry.log('catalog.list_failed', { errorType: error.name || 'Error' }, 'error');
    return res.status(503).json({ success: false, message: 'Catalog is temporarily unavailable' });
  }
}

async function createAirplane(req, res) {
  const modelNumber = typeof req.body.modelNumber === 'string' ? req.body.modelNumber.trim() : '';
  const capacity = Number(req.body.capacity);
  if (!modelNumber || modelNumber.length > 100 || !Number.isSafeInteger(capacity) || capacity < 1 || capacity > 1000) {
    return res.status(400).json({ success: false, message: 'Provide a model number and a capacity from 1 to 1000' });
  }
  try {
    const airplane = await Airplane.create({ modelNumber, capacity });
    return res.status(201).json({ success: true, data: airplane, message: 'Airplane created' });
  } catch (error) {
    telemetry.log('catalog.airplane_create_failed', { errorType: error.name || 'Error' }, 'error');
    return res.status(503).json({ success: false, message: 'Airplane could not be created' });
  }
}

module.exports = { list, createAirplane };
