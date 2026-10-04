const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
for(const dir of ['Auth_Service','Booking_Service','FlightandSearchService','ReminderService','AIRLINE-MANAGEMENT_API_GATEWAY']) {
  fs.copyFileSync(path.join(root,'observability/runtime.js'),path.join(root,dir,'src/observability.js'));
}
console.log('Observability runtime copied into all five service repositories.');
