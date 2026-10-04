const express = require('express');
const rateLimiter = require('express-rate-limit');
const axios = require('axios');
const {createProxyMiddleware} = require('http-proxy-middleware');
const {PORT} = require('./config/config');
const telemetry = require('./observability');
const app = express();
telemetry.install(app, 'gateway');
app.use(rateLimiter({windowMs:2*60*1000,max:5}));
app.use(async(req,res,next)=>{
  try {
    await telemetry.span('auth','authenticate',traceHeaders=>axios.get('http://localhost:3001/api/v1/isAuthenticated',{
      headers:{...traceHeaders,'x-access-token':req.headers['x-access-token']}
    }));
    next();
  } catch(error) {
    telemetry.log('authentication.rejected',{errorType:error.name},'warn');
    res.status(401).json({message:'UNaUTHORIZED REQUEST'});
  }
});
app.use('/flightService',(req,res,next)=>{req.telemetryRoute='/flightService/*';next();},createProxyMiddleware({
  target:'http://localhost:3002/',changeOrigin:true,
  pathRewrite:{'^/flightService(?=/|$)':''},
  logLevel:'silent',
  onProxyReq(proxyReq){for(const [name,value] of Object.entries(telemetry.headers()))proxyReq.setHeader(name,value);},
  onError(error,req,res){
    telemetry.log('proxy.failed',{dependency:'flights',errorType:error.name},'error');
    if(!res.headersSent)res.writeHead(502,{'Content-Type':'application/json'});
    res.end(JSON.stringify({success:false,message:'Flight service unavailable'}));
  }
}));
app.use(telemetry.errorHandler);
app.listen(PORT,()=>telemetry.log('service.started',{port:PORT}));
