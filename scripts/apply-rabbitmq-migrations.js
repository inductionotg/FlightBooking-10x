const path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
async function main(){
  for(const [dir,schema,name] of [['Booking_Service','baseline_booking','20261001010000-create-booking-outbox.js'],['ReminderService','baseline_notifications','20261001010000-create-booking-notifications.js']]){
    const config=require(path.join(root,dir,'src/config/config.json')).development;
    assert.equal(config.host,'127.0.0.1');assert.equal(config.port,33306);assert.equal(config.database,schema);
    const S=require(path.join(root,dir,'node_modules/sequelize'));
    const db=new S(config.database,config.username,config.password,{...config,logging:false});
    try{
      await db.query('CREATE TABLE IF NOT EXISTS LocalSchemaChanges (name VARCHAR(255) PRIMARY KEY, appliedAt DATETIME NOT NULL)');
      const [rows]=await db.query('SELECT name FROM LocalSchemaChanges WHERE name=?',{replacements:[name]});
      if(!rows.length){await require(path.join(root,dir,'src/migrations',name)).up(db.getQueryInterface(),S);await db.query('INSERT INTO LocalSchemaChanges VALUES (?,NOW())',{replacements:[name]});}
      console.log(`${dir}: messaging schema ready`);
    }finally{await db.close();}
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
