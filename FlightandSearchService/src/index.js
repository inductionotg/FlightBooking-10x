const express = require('express');
const bodyParser = require('body-parser');
const {PORT} = require('./config/serverConfig');
const telemetry = require('./observability');
const app = express();
telemetry.install(app, 'flights');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended:true}));
app.use('/api', require('./routes/index'));
app.use(telemetry.errorHandler);
app.listen(PORT, () => {
  telemetry.log('service.started', {port:PORT});

  if (process.env.SYNC_DB) require('./models').sequelize.sync({alter:true});
});
