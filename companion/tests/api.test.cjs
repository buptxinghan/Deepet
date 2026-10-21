const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn,spawnSync}=require('node:child_process');
const {Settings}=require('../lib/settings.cjs');
test('local API authentication, validation, persistence and actual hook reporter',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'desk-api-')),directory=path.join(home,'Library/Application Support/Deepet');
 const settings=new Settings(directory);settings.update({servers:[],device:{enabled:false}});
 const child=spawn(process.execPath,[path.resolve(__dirname,'../server.cjs')],{env:{...process.env,DESK_COMPANION_DATA:directory,DESK_COMPANION_PORT:'0'},stdio:['ignore','pipe','pipe']});
 try{
  const base=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('API startup timeout')),15000);child.stdout.on('data',chunk=>{text+=chunk;const ready=text.split('\n').find(line=>line.startsWith('READY '));if(ready){clearTimeout(timer);resolve(JSON.parse(ready.slice(6)).url);}});child.once('exit',code=>{clearTimeout(timer);reject(Error('API exited '+code));});});
  const runtime=JSON.parse(fs.readFileSync(path.join(directory,'runtime.json'))),headers={'Content-Type':'application/json',Authorization:'Bearer '+runtime.token};
  let response=await fetch(base+'/api/v1/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,401);
  response=await fetch(base+'/api/v1/status',{headers:{Origin:'https://outside.invalid'}});assert.equal(response.status,403);
  response=await fetch(base+'/api/v1/settings',{method:'POST',headers,body:JSON.stringify({source:'missing-server',paused:true})});assert.equal(response.status,400);assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'settings.json'))).paused,false);
  response=await fetch(base+'/api/v1/settings',{method:'POST',headers,body:JSON.stringify({source:'rotate',note:{text:'接口验收',pinned:true},device:{token:'must-not-appear'}})});assert.equal(response.status,200);const saved=await response.json();assert.equal(saved.settings.source,'rotate');assert.equal(JSON.stringify(saved).includes('must-not-appear'),false);
  response=await fetch(base+'/api/v1/settings',{method:'POST',headers,body:JSON.stringify({device:{address:'127.0.0.1'}})});assert.equal(response.status,400);
  const hook=spawnSync('/usr/bin/python3',[path.resolve(__dirname,'../../integration/codex-plugin/hooks/report.py')],{env:{...process.env,HOME:home},input:JSON.stringify({hook_event_name:'UserPromptSubmit',session_id:'acceptance-session',prompt:'do-not-forward-prompt',tool_input:{command:'do-not-forward-command'}}),encoding:'utf8',timeout:3000});
  assert.equal(hook.status,0);assert.equal(hook.stdout,'');assert.equal(hook.stderr,'');
  response=await fetch(base+'/api/v1/status');const current=await response.json();assert.equal(current.agent.status,'thinking');assert.equal(current.events.length,1);assert.equal(JSON.stringify(current).includes('do-not-forward'),false);assert.notEqual(current.agent.id,'acceptance-session');
  response=await fetch(base+'/%2e%2e/settings.json');assert.equal(response.status,404);
  const html=await(await fetch(base+'/')).text();assert.ok(html.includes('companion-session'));assert.ok(html.includes('Deepet'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'settings.json'))).note.text,'接口验收');
 }finally{child.kill('SIGTERM');await new Promise(resolve=>child.once('close',resolve));fs.rmSync(home,{recursive:true,force:true});}
});
