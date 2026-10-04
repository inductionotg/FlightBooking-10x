const express = require('express');
const bodyParser = require('body-parser');
const {PORT} = require('./config/serverConfig');
const telemetry = require('./observability');
const app = express();
telemetry.install(app, 'notifications');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended:true}));
app.use('/api', require('./routes/index'));
app.use(telemetry.errorHandler);
app.listen(PORT, () => {
  telemetry.log('service.started', {port:PORT});
  require('./utils/job').setupJobs();
  require('./services/booking-consumer').startConsumer();
  require('./services/booking-delivery').startDelivery();
  if (process.env.DB_SYNC) require('./models').sequelize.sync({alter:true});
});
