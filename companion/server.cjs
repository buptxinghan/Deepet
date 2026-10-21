const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { Settings, aliases } = require('./lib/settings.cjs');
const { MacCollector } = require('./lib/mac.cjs');
const { SSHCollector } = require('./lib/ssh.cjs');
const { StateEngine, AgentEvents } = require('./lib/state.cjs');
const { DeviceLink } = require('./lib/device.cjs');
const root = __dirname;
// Stable storage identity preserves settings and existing local hook connections.
const dataDir = process.env.DESK_COMPANION_DATA || path.join(os.homedir(), 'Library/Application Support/Deepet');
const settings = new Settings(dataDir), mac = new MacCollector(root), ssh = new SSHCollector(), engine = new StateEngine(), agents = new AgentEvents(), device = new DeviceLink();
const token = crypto.randomBytes(32).toString('hex');
const parentPid = process.ppid;
let view, closing = false;
function status() {
  const servers = ssh.list(settings.value.servers), agent = agents.current(Date.now());
  view = engine.compose(settings.value, mac.latest, servers, agent, device.latest);
  return { version: '0.1.0', sampled_at: Date.now(), mac: mac.latest, servers, agent, events: agents.events.slice(0,8), view, device: device.latest, settings: settings.public(), ssh_aliases: aliases() };
}
function json(response, code, data) { response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(data)); }
async function body(request) {
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > 16384) throw Error('请求过大'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
function authenticated(request) {
  const supplied = Buffer.from(request.headers.authorization || ''), expected = Buffer.from('Bearer ' + token);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}
const types = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.gif':'image/gif','.spr':'application/octet-stream','.json':'application/json' };
const server = http.createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options','nosniff');
  let url; try { url = new URL(request.url, 'http://127.0.0.1'); } catch { json(response,400,{error:'地址无效'}); return; }
  // Protect local privileged routes from cross-site requests and DNS rebinding.
  const allowedHosts = ['127.0.0.1:' + server.address()?.port, 'localhost:' + server.address()?.port];
  if (!allowedHosts.includes(request.headers.host)) { json(response,403,{error:'来源无效'}); return; }
  const origin = request.headers.origin;
  if (origin && !allowedHosts.some(host => origin === 'http://' + host)) { json(response,403,{error:'来源无效'}); return; }
  if (request.method === 'POST' && !authenticated(request)) { json(response,401,{error:'请重新打开配套应用'}); return; }
  try {
    if (url.pathname === '/api/v1/status' && request.method === 'GET') { json(response,200,status()); return; }
    if (request.method === 'POST') {
      const value = await body(request);
      if (url.pathname === '/api/v1/settings') { settings.update(value); if('source' in value || 'rotationSeconds' in value || 'serverLimit' in value)device.settingsDirty=true; json(response,200,status()); return; }
      if (url.pathname === '/api/v1/interaction') { engine.react(value.kind,status().view); json(response,200,status()); return; }
      if (url.pathname === '/api/v1/servers/refresh') {
        const list = settings.value.servers.filter(s => s.enabled && (!value.id || s.id === value.id));
        await Promise.allSettled(list.map(s => ssh.collect(s,true))); json(response,200,status()); return;
      }
      if (url.pathname === '/api/v1/device/connect') { if (value.device) settings.update({device:value.device}); await device.probe(settings.value.device); json(response,200,status()); return; }
      if (url.pathname === '/api/v1/events') { agents.accept(value); json(response,200,{ok:true}); return; }
      if (url.pathname === '/api/v1/integration/open') {
        const folder=path.resolve(root,'../integration/codex-plugin');
        if(!fs.existsSync(folder))throw Error('插件资源未打包，请从项目 integration/codex-plugin 打开');
        await require('node:util').promisify(require('node:child_process').execFile)('/usr/bin/open',[folder]);json(response,200,{ok:true});return;
      }
      json(response,404,{error:'未找到操作'}); return;
    }
    if (!['GET','HEAD'].includes(request.method)) { json(response,405,{error:'不支持的操作'}); return; }
    let base, relative;
    if (url.pathname.startsWith('/assets/')) { base = path.join(root,'assets'); relative = decodeURIComponent(url.pathname.slice(8)); }
    else { base = path.join(root,'web'); relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1)); }
    const filename = path.resolve(base,relative);
    if (!filename.startsWith(base + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile() || !fs.realpathSync(filename).startsWith(fs.realpathSync(base)+path.sep)) { json(response,404,{error:'页面不存在'}); return; }
    response.setHeader('Content-Type',types[path.extname(filename)] || 'application/octet-stream');
    response.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
    if (request.method === 'HEAD') { response.end(); return; }
    if (path.extname(filename) === '.html') response.end(fs.readFileSync(filename,'utf8').replace('<!--SESSION-->','<meta name="companion-session" content="'+token+'">'));
    else fs.createReadStream(filename).pipe(response);
  } catch (error) { json(response,400,{error: String(error.message).slice(0,160)}); }
});
const timers = [];
function collectServers() { if (!settings.value.paused) for (const item of settings.value.servers.filter(s => s.enabled)) ssh.collect(item).catch(()=>{}); }
async function start() {
  await mac.sample(); await new Promise(resolve => setTimeout(resolve,1250)); await mac.sample();
  const port = Number(process.env.DESK_COMPANION_PORT || 18766);
  server.listen(port,'127.0.0.1',()=> {
    const runtime = { port:server.address().port, token, pid:process.pid, version:'0.1.0' };
    fs.writeFileSync(path.join(dataDir,'runtime.json'),JSON.stringify(runtime),{mode:0o600});
    process.stdout.write('READY '+JSON.stringify({url:'http://127.0.0.1:'+runtime.port,version:runtime.version})+'\n');
    collectServers();
    timers.push(setInterval(()=>{if(!settings.value.paused)mac.sample();},5000),setInterval(collectServers,2000),setInterval(()=>{if(device.requestedSource){try{settings.update(device.requestedSource);}catch{}device.requestedSource=null;}status();device.tick(settings.value.device,view,settings.value.paused);},2000));
  });
}
server.on('error', error => { process.stderr.write('后台服务启动失败: '+error.code+'\n'); process.exit(1); });
function stop() { if(closing)return;closing=true;timers.forEach(clearInterval);server.close();try{const file=path.join(dataDir,'runtime.json');if(JSON.parse(fs.readFileSync(file)).pid===process.pid)fs.unlinkSync(file);}catch{} setTimeout(()=>process.exit(0),150).unref(); }
process.on('SIGTERM',stop);process.on('SIGINT',stop);
// A forced app termination must not leave an invisible SSH poller behind.
setInterval(()=>{if(process.ppid!==parentPid)stop();},3000).unref();
start().catch(error=>{process.stderr.write(String(error.message)+'\n');process.exit(1);});
