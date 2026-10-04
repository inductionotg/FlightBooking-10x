const express = require('express');
const bodyParser = require('body-parser');
const {PORT} = require('./config/server-config');
const telemetry = require('./observability');
const app = express();
telemetry.install(app, 'booking');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended:true}));
app.use('/api', require('./routes/index'));
app.use(telemetry.errorHandler);
app.listen(PORT, () => {
  telemetry.log('service.started', {port:PORT});
  require('./services/booking-recovery').startRecovery();
  require('./services/outbox-publisher').startPublisher();
  if (process.env.DB_SYNC) require('./models').sequelize.sync({alter:true});
});
