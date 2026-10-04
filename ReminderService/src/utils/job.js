const cron = require('node-cron');
const sender = require('../config/email-config');
const TicketService = require('../services/email-service');
const telemetry = require('../observability');
const mailAll = new TicketService();
const setupJobs = () => {
  cron.schedule('*/1 * * * *',()=>telemetry.job('notifications.poll',async()=>{
    const emails = await mailAll.fetchPendingEmails();
    await Promise.all(emails.map(email=>new Promise(resolve=>{
      sender.sendMail({to:email.recepientEmail,subject:email.subject,text:email.content},async(error)=>{
        try {
          if(error)throw error;
          await mailAll.updateTicket(email.id,{status:'SUCCESS'});
          telemetry.add('notification_deliveries_total',{outcome:'success'});
          telemetry.log('notification.delivered',{ticketId:email.id});
        } catch(error) {
          telemetry.add('notification_deliveries_total',{outcome:'error'});
          telemetry.log('notification.failed',{ticketId:email.id,errorType:error.name},'error');
        } finally {resolve();}
      });
    })));
  }).catch(()=>{}));
};
module.exports = {setupJobs};
