// Capture the flight process's V8 CPU profile during a short diagnostic k6 run.
// Requires that flight service alone was started with --inspect=127.0.0.1:19229.
const fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const run=process.argv[2];
if(!/^profile-200-[a-z0-9-]+$/.test(run||''))throw new Error('Usage: node scripts/profile-flight-load.cjs profile-200-...');
const folder=path.join(root,'.local/profiles');
fs.mkdirSync(folder,{recursive:true});
const destination=path.join(folder,`${run}.cpuprofile`);
if(fs.existsSync(destination))throw new Error('Refusing to overwrite an existing CPU profile');
async function main(){
  const response=await fetch('http://127.0.0.1:19229/json/list',{signal:AbortSignal.timeout(3000)});
  if(!response.ok)throw new Error(`Inspector HTTP ${response.status}`);
  const targets=await response.json();
  const target=targets.find(x=>x.type==='node'&&x.webSocketDebuggerUrl);
  if(!target)throw new Error('Flight inspector target not found');
  const ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  let nextId=1;const pending=new Map();
  ws.addEventListener('message',event=>{
    const message=JSON.parse(event.data);
    const item=pending.get(message.id);
    if(!item)return;
    pending.delete(message.id);
    if(message.error)item.reject(new Error(message.error.message));else item.resolve(message.result);
  });
  const send=(method)=>new Promise((resolve,reject)=>{
    const id=nextId++;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method}));
  });
  let started=false;
  try{
    await send('Profiler.enable');await send('Profiler.start');started=true;
    const child=spawn(process.execPath,['load-tests/run.cjs','10x',run,'20s'],{cwd:root,stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',chunk=>process.stdout.write(chunk));
    child.stderr.on('data',chunk=>process.stderr.write(chunk));
    const exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
    const result=await send('Profiler.stop');started=false;
    fs.writeFileSync(destination,JSON.stringify(result.profile));
    console.log(JSON.stringify({run,k6ExitCode:exitCode,profile:destination,samples:result.profile.samples?.length}));
    if(exitCode!==0&&exitCode!==99)process.exitCode=exitCode||1;
  }finally{
    if(started)await send('Profiler.stop').catch(()=>{});
    ws.close();
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
