const nodemailer = require('nodemailer');
require('dotenv').config();
let sender;
function transport(){
  if(sender)return sender;
  const host=process.env.SMTP_HOST;
  const port=Number(process.env.SMTP_PORT || 0);
  if(!host || !Number.isInteger(port) || port<1 || port>65535 || !process.env.SMTP_FROM)
    throw new Error('SMTP_HOST, SMTP_PORT and SMTP_FROM are required for email delivery');
  const options={host,port,secure:process.env.SMTP_SECURE==='true',
    connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000};
  if(process.env.SMTP_USER || process.env.SMTP_PASS){
    if(!process.env.SMTP_USER || !process.env.SMTP_PASS)throw new Error('Both SMTP_USER and SMTP_PASS are required');
    options.auth={user:process.env.SMTP_USER,pass:process.env.SMTP_PASS};
  }
  sender=nodemailer.createTransport(options);
  return sender;
}
module.exports={sendMail(message,callback){
  try{return transport().sendMail({from:process.env.SMTP_FROM,...message},callback);}
  catch(error){if(callback){callback(error);return;}return Promise.reject(error);}
}};
