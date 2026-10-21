const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Settings,validAddress}=require('../lib/settings.cjs');
const {AgentEvents,StateEngine}=require('../lib/state.cjs');
const {DeviceLink}=require('../lib/device.cjs');
const {classify}=require('../lib/ssh.cjs');
function settings(){return{source:'mac',rotationSeconds:15,paused:false,servers:[],rules:{nightStart:'21:00',nightEnd:'07:00',macHotC:85,serverHotC:80},note:{text:'',pinned:true,expiresAt:null}};}
const now=Date.parse('2026-10-20T12:00:00+08:00');
const mac=t=>({available:true,sampled_at:t,cpu_pct:17,gpu_pct:9,ram_used_pct:50,disk_used_pct:85,cpu_temperature_c:40,user_idle_seconds:30});
test('stale and failed metrics remain unknown; stale GPU is never presented as zero',()=>{
 const engine=new StateEngine(),s=settings();s.source='srv';const server={id:'srv',label:'GPU',available:false,sampled_at:now-20000,gpus:[{gpu_pct:0,temperature_c:88}]};
 const view=engine.compose(s,mac(now),[server],{available:false},{},now);assert.equal(view.source.available,false);assert.deepEqual(view.source.metrics,['GPU --','VRAM --','CPU --','RAM --']);assert.equal(view.source.temperature,'--°C');
});
test('temperature reminders require duration and honor customized recovery thresholds',()=>{
 const engine=new StateEngine(),s=settings();s.rules.macHotC=65;const hot=t=>({...mac(t),cpu_temperature_c:70});
 assert.notEqual(engine.compose(s,hot(now),[],{}, {},now).reason,'Mac 温度提醒');
 assert.equal(engine.compose(s,hot(now+30000),[],{}, {},now+30000).reason,'Mac 温度提醒');
 assert.ok(engine.policy.config.macRecoverC<s.rules.macHotC);
});
test('temporary notes consume visible time and survive important reminders',()=>{
 const engine=new StateEngine(),s=settings();s.note={text:'继续加油',pinned:false,expiresAt:now+8000};
 assert.equal(engine.compose(s,mac(now),[],{}, {},now).text,'继续加油');
 engine.compose(s,{...mac(now+2000),thermal_state:'critical'},[],{}, {},now+2000);
 engine.compose(s,{...mac(now+30000),thermal_state:'critical'},[],{}, {},now+30000);
 assert.equal(engine.compose(s,mac(now+31000),[],{}, {},now+31000).text,'继续加油');
 assert.notEqual(engine.compose(s,mac(now+38000),[],{}, {},now+38000).text,'继续加油');
});
test('ordinary web interactions do not override important alerts',()=>{
 const engine=new StateEngine();assert.throws(()=>engine.react('greet',{important:true}));
 assert.throws(()=>engine.react('bogus',{important:false}));
});
test('agent events reject unsupported input, lease work states, and distinguish turn end from success',()=>{
 const events=new AgentEvents();assert.throws(()=>events.accept({event:'succeeded',session_id:'a'}));
 events.accept({event:'UserPromptSubmit',session_id:'a',prompt:'ignored'});const at=Date.now();
 assert.equal(events.current(at).status,'thinking');assert.equal(events.current(at+121000).available,false);
 events.accept({event:'Stop',session_id:'a'});assert.equal(events.current(Date.now()).status,'turn_ended');
 assert.equal(JSON.stringify(events.events).includes('ignored'),false);
});
test('settings are durable, secrets redacted, invalid updates atomic',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'desk-settings-'));
 try{const store=new Settings(directory);store.update({device:{token:'private-value'},note:{text:'你好',pinned:true}});assert.equal(store.public().device.token,undefined);assert.equal(store.public().device.hasToken,true);assert.equal(fs.statSync(store.filename).mode&0o777,0o600);const saved=JSON.stringify(store.value);assert.throws(()=>store.update({source:'unconfigured',paused:true}));assert.equal(JSON.stringify(store.value),saved);assert.equal(new Settings(directory).value.note.text,'你好');assert.equal(validAddress('http://192.168.1.100'),false);assert.equal(validAddress('192.168.1.100'),true);assert.equal(validAddress('192.168.999.2'),false);}finally{fs.rmSync(directory,{recursive:true});}
});
test('device compatibility gate prevents state POSTs to an old firmware',async()=>{
 const link=new DeviceLink();let writes=0;link.request=async(d,r,m)=>{if(m==='POST')writes++;throw Error('unsupported');};
 await link.probe({token:'x'});assert.equal(link.latest.status,'firmware_update_needed');
 await link.tick({enabled:true,token:'x'}, {},false);assert.equal(writes,0);
});
test('device uses bounded state messages, sessions and monotonic sequence',async()=>{
 const link=new DeviceLink(),requests=[];link.latest={supported:true};link.lastProbe=Date.now();link.request=async(d,r,m,b)=>{requests.push({r,m,b});return{ok:true};};
 const view={action:'idle',text:'你好',source:{id:'mac'},sources:[{id:'mac'}],mode:'mac',rotationSeconds:15};
 await link.tick({enabled:true},view,false);await link.tick({enabled:true},view,false);
 const states=requests.filter(r=>r.r.endsWith('/state'));assert.equal(states.length,2);assert.ok(states[1].b.seq>states[0].b.seq);assert.equal(states[1].b.bridge,states[0].b.bridge);const previous=requests.length;await link.tick({enabled:true},view,true);assert.equal(requests.length,previous);
});
test('SSH authentication, host identity and network errors are distinct',()=>{
 assert.equal(classify({stderr:'Permission denied (publickey)'})[0],'authentication');
 assert.equal(classify({stderr:'Host key verification failed'})[0],'host_identity');
 assert.equal(classify({stderr:'Connection timed out'})[0],'unreachable');
});

test('server list limits retain selection order and offline slots, without inventing zero usage',()=>{
 const engine=new StateEngine(),s=settings();s.source='servers';s.serverLimit=2;
 const server=(id,available,gpu_pct=10)=>({id,label:id,available,sampled_at:now,gpus:[{gpu_pct,temperature_c:52}]});
 const servers=[server('offline',false,99),server('online',true,82),server('third',true),server('fourth',true)];
 let view=engine.compose(s,mac(now),servers,{}, {},now);
 assert.deepEqual(view.serverSources.map(item=>item.id),['offline','online']);
 assert.equal(view.serverSources[0].metrics[0],'GPU --');assert.equal(view.serverSources[0].temperature,'--°C');
 assert.equal(view.serverSources[1].metrics[0],'GPU 82%');assert.notEqual(view.reason,'服务器忙碌');
 s.serverLimit=3;view=engine.compose(s,mac(now),servers,{}, {},now);
 assert.deepEqual(view.serverSources.map(item=>item.id),['offline','online']);
 view=engine.compose(s,mac(now),servers.slice().reverse(),{}, {},now);
 assert.deepEqual(view.serverSources.map(item=>item.id),['fourth','third']);
 view=engine.compose(s,mac(now),[],{}, {},now);assert.deepEqual(view.serverSources,[]);assert.equal(view.mode,'servers');
});

test('two-column display migrates older settings and rejects other counts atomically',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'deepet-list-settings-'));
 try{
  const store=new Settings(directory);assert.equal(store.value.serverLimit,2);
  store.update({source:'servers',serverLimit:2});assert.equal(new Settings(directory).value.serverLimit,2);
  fs.writeFileSync(store.filename,JSON.stringify({...store.value,serverLimit:3}));assert.equal(new Settings(directory).value.serverLimit,2);
  for(const serverLimit of [0,1,3,4,'2',null]){
   assert.throws(()=>store.update({serverLimit,paused:true}));assert.equal(store.value.paused,false);assert.equal(store.value.serverLimit,2);
  }
  store.update({servers:[]});assert.equal(store.value.source,'servers');
 }finally{fs.rmSync(directory,{recursive:true});}
});

test('server list cannot silently reach a clock without list support',async()=>{
 const link=new DeviceLink();let writes=0;link.latest={supported:true,details:{protocol:1}};link.lastProbe=Date.now();
 link.request=async()=>{writes++;};
 await link.tick({enabled:true},{mode:'servers'},false);
 assert.equal(writes,0);assert.equal(link.latest.status,'firmware_update_needed');
});

test('server list settings travel to the clock and clock-side changes return together',async()=>{
 const link=new DeviceLink(),requests=[];link.latest={supported:true,details:{server_list:true,server_columns:true}};link.lastProbe=Date.now();
 link.request=async(d,r,m,b)=>{requests.push({r,m,b});return{protocol:1,revision:3,source:'servers',server_limit:2,rotation_seconds:30,server_list:true,server_columns:true};};
 const view={action:'idle',text:'陪伴',source:{id:'s1'},sources:[{id:'s1'},{id:'s2'},{id:'s3'}],mode:'servers',rotationSeconds:15,serverLimit:2};
 await link.tick({enabled:true},view,false);
 assert.equal(requests.find(r=>r.r.endsWith('/state')).b.server_limit,2);
 assert.equal(requests.find(r=>r.r.endsWith('/settings')).b.server_limit,2);
 link.seenRevision=2;await link.probe({token:'x'});
 assert.deepEqual(link.requestedSource,{source:'servers',rotationSeconds:30,serverLimit:2});
});

test('server load does not permanently pin the pet to the busy scene',()=>{
 const engine=new StateEngine(),s=settings();s.source='servers';
 const at=delta=>{const time=now+delta;return engine.compose(s,mac(time),[{id:'srv',label:'GPU',available:true,sampled_at:time,gpus:[{gpu_pct:94,temperature_c:55}]}],{}, {},time);};
 const scenes=[0,10000,17000,60000,120000].map(at);
 assert.ok(scenes.some(view=>view.reason==='服务器忙碌'),'持续高负载应有短暂提示');
 assert.notEqual(scenes.at(-1).reason,'服务器忙碌','持续负载不能一直占用陪伴画面');
 assert.equal(scenes.at(-1).reason,'白天陪伴');
});

test('server load never overrides the configured night companion',()=>{
 const engine=new StateEngine(),s=settings();s.source='servers';const time=Date.parse('2026-10-20T21:30:00+08:00');
 const view=engine.compose(s,mac(time),[{id:'srv',label:'GPU',available:true,sampled_at:time,gpus:[{gpu_pct:94,temperature_c:55}]}],{}, {},time);
 assert.equal(view.night,true);assert.equal(view.action,'sleeping');assert.equal(view.reason,'夜间陪伴');
});

test('server load hints last six seconds and repeat no more than every five minutes',()=>{
 const engine=new StateEngine(),s=settings();s.source='servers';const hints=[];
 for(let delta=0;delta<=310000;delta+=1000){
  const time=now+delta,server={id:'srv',label:'GPU',available:true,sampled_at:time,gpus:[{gpu_pct:94,temperature_c:55}]};
  const view=engine.compose(s,mac(time),[server],{}, {},time);
  if(view.reason==='服务器忙碌')hints.push(delta);
 }
 assert.deepEqual(hints,[10000,11000,12000,13000,14000,15000,310000]);
});

test('real AI work and important reminders preempt a server load hint',()=>{
 const engine=new StateEngine(),s=settings();s.source='servers';
 const at=(delta,agent={},critical=false)=>{const time=now+delta;return engine.compose(s,{...mac(time),...(critical?{thermal_state:'critical'}:{})},[{id:'srv',label:'GPU',available:true,sampled_at:time,gpus:[{gpu_pct:94,temperature_c:55}]}],agent.available?{...agent,sampled_at:time}:agent, {},time);};
 at(0);assert.equal(at(10000).reason,'服务器忙碌');
 assert.equal(at(11000,{available:true,status:'working'}).reason,'AI 任务进行中');
 assert.equal(at(12000,{available:true,status:'waiting'}).reason,'等待你处理');
 assert.equal(at(13000,{},true).reason,'系统温度提醒');
 assert.equal(at(17000).reason,'白天陪伴');
});
