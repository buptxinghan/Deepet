const { Engine } = require('../../preview/pet-policy.js');
const { IdleCycle } = require('./idle-cycle.cjs');
const finite = Number.isFinite;
const pct = n => finite(n) ? Math.round(n) + '%' : '--';
const temp = n => finite(n) ? Math.round(n) + '°C' : '--°C';
const fresh = (item, now) => item && item.available && finite(item.sampled_at) && now - item.sampled_at <= 15000;
const eventNames = Object.freeze({ UserPromptSubmit: 'thinking', PreToolUse: 'working', PostToolUse: 'thinking', PermissionRequest: 'waiting', PreCompact: 'compacting', PostCompact: 'thinking', Stop: 'turn_ended', Interrupt: 'idle', SessionEnd: 'idle' });
class AgentEvents {
  constructor() { this.sessions = new Map(); this.events = []; }
  accept(body) {
    if (!eventNames[body.event] || typeof body.session_id !== 'string' || body.session_id.length > 160) throw Error('AI事件格式无效');
    const now = Date.now(), session = { id: body.session_id, status: eventNames[body.event], sampled_at: now, event_at: now, available: true, event: body.event };
    this.sessions.set(session.id, session);
    this.events.unshift({ event: body.event, at: now }); this.events = this.events.slice(0, 30);
    while (this.sessions.size > 64) this.sessions.delete(this.sessions.keys().next().value);
  }
  current(now) {
    const items = [...this.sessions.values()].filter(s => now - s.sampled_at < 120000);
    const active = items.filter(s => !['idle', 'turn_ended'].includes(s.status));
    const selected = active.find(s => s.status === 'waiting') || active.sort((a,b) => b.sampled_at-a.sampled_at)[0] || items.sort((a,b) => b.sampled_at-a.sampled_at)[0];
    if (!selected) return { available: false, status: 'unknown', event_count: this.events.length };
    // Event state is leased, rather than fabricating a finished task after silence.
    return { ...selected, sampled_at: now, active_count: active.length, event_count: this.events.length, event_age_ms: now - selected.event_at };
  }
}
class StateEngine {
  constructor() { this.policy = null; this.rules = ''; this.reaction = null; this.idleCycle = new IdleCycle(); this.noteKey=''; this.noteRemaining=0; this.noteVisible=false; this.noteLastAt=null; this.serverActivity={since:null,lastAt:null,until:0,lastHint:null}; }
  compose(settings, mac, servers, agent, device, now = Date.now()) {
    const rules = JSON.stringify(settings.rules);
    if (!this.policy || this.rules !== rules) { this.policy = new Engine({...settings.rules,macRecoverC:Math.min(78,settings.rules.macHotC-7),serverRecoverC:Math.min(75,settings.rules.serverHotC-5)}); this.rules = rules; }
    const input = { mac, servers, agent, transport_online: true };
    let scene = this.policy.evaluate(input, now);
    const sources = [{ id: 'mac', label: '我的 Mac', available: fresh(mac, now), sampled_at: mac.sampled_at,
      metrics: ['CPU ' + pct(fresh(mac,now) ? mac.cpu_pct : null), 'GPU ' + pct(fresh(mac,now) ? mac.gpu_pct : null), 'RAM ' + pct(fresh(mac,now) ? mac.ram_used_pct : null), 'SSD ' + pct(fresh(mac,now) ? mac.disk_used_pct : null)], temperature: temp(fresh(mac,now) ? mac.cpu_temperature_c : null) }];
    for (const server of servers) {
      const valid = fresh(server,now), gpu = (server.gpus || []).slice().sort((a,b) => (b.gpu_pct || 0) - (a.gpu_pct || 0))[0];
      const memory = valid && gpu && finite(gpu.memory_used_mb) && finite(gpu.memory_total_mb) ? (gpu.memory_used_mb/1024).toFixed(1) + '/' + (gpu.memory_total_mb/1024).toFixed(0) + 'G' : '--';
      sources.push({ id: server.id, label: server.label, available: valid, sampled_at: server.sampled_at,
        metrics: ['GPU ' + pct(valid ? gpu?.gpu_pct : null), 'VRAM ' + memory, 'CPU ' + pct(valid ? server.cpu_pct : null), 'RAM ' + pct(valid ? server.ram_used_pct : null)], temperature: temp(valid ? gpu?.temperature_c : null) });
    }
    const index = settings.source === 'rotate' ? Math.floor(now / (settings.rotationSeconds * 1000)) % sources.length : Math.max(0, sources.findIndex(s => s.id === settings.source));
    const serverLimit = 2;
    // Selection order is stable, including offline hosts; it is not a load ranking.
    const serverSources = sources.filter(s => s.id !== 'mac').slice(0, serverLimit);
    const source = settings.source === 'servers' ? (serverSources[0] || sources[0]) : sources[index];
    const visibleServers = settings.source === 'servers' ? serverSources : [source];
    const busy = visibleServers.some(s => s.id !== 'mac' && s.available && servers.find(server => server.id === s.id)?.gpus?.some(g => finite(g.gpu_pct) && g.gpu_pct >= 75));
    const activity=this.serverActivity;
    // Load is ambient information. A long training job must not monopolize the pet.
    if(activity.lastAt!==null&&(now<activity.lastAt||now-activity.lastAt>15000)){
      activity.since=null;activity.until=0;
      if(now<activity.lastAt)activity.lastHint=null;
    }
    activity.lastAt=now;
    if(!busy){activity.since=null;activity.until=0;}
    else if(activity.since===null)activity.since=now;
    const canHint=!settings.paused&&!scene.important&&!scene.night&&scene.reason==='白天陪伴';
    if(!canHint)activity.until=0;
    if(canHint&&busy&&now-activity.since>=10000){
      if(now>=activity.until&&(activity.lastHint===null||now-activity.lastHint>=300000)){
        activity.lastHint=now;activity.until=now+6000;
      }
      if(now<activity.until)scene={...scene,action:'typing',text:'服务器正忙碌，我陪你等一会儿。',reason:'服务器忙碌'};
    }
    if (!scene.important && this.reaction && now < this.reaction.until) scene = { ...scene, action: this.reaction.action, text: this.reaction.text, reason: '网页互动' };
    else if (scene.important || (this.reaction && now >= this.reaction.until)) this.reaction = null;
    if (scene.night) this.idleCycle.reset();
    const idle = this.idleCycle.choose(now, !settings.paused && !scene.important && !scene.night && scene.reason === '白天陪伴', settings.idleActionSeconds);
    if (idle) scene = { ...scene, action: idle.action, text: idle.text };
    const noteKey=JSON.stringify(settings.note);
    if(this.noteKey!==noteKey){this.noteKey=noteKey;this.noteRemaining=Math.max(0,(settings.note.expiresAt||0)-now);this.noteVisible=false;}
    else if(this.noteVisible&&this.noteLastAt!==null)this.noteRemaining=Math.max(0,this.noteRemaining-(now-this.noteLastAt));
    this.noteLastAt=now;this.noteVisible=!scene.important&&!settings.paused&&Boolean(settings.note.text)&&(settings.note.pinned||this.noteRemaining>0);
    if(this.noteVisible)scene={...scene,text:settings.note.text,reason:'留言'};
    if (settings.paused) scene = { action: 'sleeping', text: '联动已暂停，安静陪着你。', reason: '联动已暂停', important: false };
    return { ...scene, source, sources, serverSources, serverLimit, mode: settings.source, rotationSeconds: settings.rotationSeconds, updated_at: now, device };
  }
  react(kind, current) {
    if (current?.important) throw Error('当前有重要提醒，结束后再来互动吧');
    const choices = { greet: ['poke-left','咦？是在叫我吗？'], tickle: ['tickle','有点痒啦，嘿嘿。'], praise: ['thumbs-up','做得不错，继续加油！'] };
    if (!choices[kind]) throw Error('互动动作无效');
    this.reaction = { action: choices[kind][0], text: choices[kind][1], until: Date.now()+2400 };
  }
}
module.exports = { StateEngine, AgentEvents, fresh };
