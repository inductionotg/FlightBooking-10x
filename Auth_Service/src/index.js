const express = require('express');
const bodyParser = require('body-parser');
const {PORT} = require('./config/serverConfig');
const telemetry = require('./observability');
const app = express();
telemetry.install(app, 'auth');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended:true}));
app.use('/api', require('./routes/index'));
app.use(telemetry.errorHandler);
app.listen(3001, () => {
  telemetry.log('service.started', {port:3001});

  if (process.env.DB_SYNC) require('./models').sequelize.sync({alter:true});
});
