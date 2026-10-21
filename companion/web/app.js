(() => {
  const $ = id => document.getElementById(id), token = document.querySelector('meta[name=companion-session]').content;
  let data, ready = false, currentPage = 'overview', toastTimer, lastAsset = '', sourceOptions = '', serverSignature = '';
  const actions = {idle:'01-idle',look:'02-idle-look',spout:'03-idle-spout',thinking:'04-thinking',typing:'05-typing',music:'06-music',conducting:'07-conducting',building:'08-building',error:'09-error',happy:'10-happy',notification:'11-notification',compacting:'12-compacting',carrying:'13-carrying',sleeping:'14-sleeping',waking:'15-waking','poke-left':'16-poke-left','poke-right':'17-poke-right',tickle:'18-tickle',drag:'19-drag',swim:'20-swim','smile-hearts':'21-smile-hearts','thumbs-up':'22-thumbs-up'};
  $('pet').addEventListener('error',()=>{if(!$('pet').src.endsWith('/assets/pet-placeholder.svg'))$('pet').src='/assets/pet-placeholder.svg';});
  const finite = Number.isFinite, percent = n => finite(n) ? Math.round(n)+'%' : '--', temperature = n => finite(n) ? Math.round(n)+'°C' : '--';
  const escape = text => String(text ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const time = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false});
  const date = new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',weekday:'short'});
  function toast(text) { $('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4000); }
  async function request(route,body) {
    const response=await fetch('/api/v1/'+route,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json',Authorization:'Bearer '+token}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(route==='servers/refresh'?12000:5000)});
    const result=await response.json();if(!response.ok)throw Error(result.error||'操作未成功');return result;
  }
  async function save(patch,message='设置已保存') { try{data=await request('settings',patch);render();toast(message);return true;}catch(error){toast(error.message);return false;} }
  function metrics(items) { return items.map(([label,value])=>{
    const numeric=/%$/.test(value)?Number.parseFloat(value):null;
    const meter=finite(numeric)?'<meter class="usage-meter" min="0" max="100" value="'+Math.max(0,Math.min(100,numeric))+'" aria-label="'+escape(label)+'占用"></meter>':'';
    return '<div class="metric-tile"><span class="metric-label">'+escape(label)+'</span><strong>'+escape(value)+'</strong>'+meter+'</div>';
  }).join(''); }
  function switchPage(page) {
    const titles={overview:['WORKSPACE / OVERVIEW','我的桌面','专注做你的事，其他的交给她。'],servers:['WORKSPACE / SERVERS','远程，也在身边。','你关心的机器，和桌上的小伙伴连在一起。'],device:['WORKSPACE / CONNECTION','让陪伴连上线。','从这台 Mac，到桌上的那一小方天地。'],settings:['WORKSPACE / PREFERENCES','你的节奏，她都懂。','少一点打扰，多一点恰到好处的陪伴。']};
    if(!titles[page])page='overview';currentPage=page;
    document.querySelectorAll('.page').forEach(el=>el.hidden=el.id!=='page-'+page);
    document.querySelectorAll('nav [data-page]').forEach(el=>{el.classList.toggle('selected',el.dataset.page===page);if(el.dataset.page===page)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
    $('eyebrow').textContent=titles[page][0];$('page-title').textContent=titles[page][1];$('page-description').textContent=titles[page][2];
  }
  function render() {
    const {view,settings,mac,agent}=data;
    $('service-state').textContent=settings.paused?'联动已暂停':'本地服务运行中';$('service-dot').classList.toggle('offline',settings.paused);$('pause').textContent=settings.paused?'恢复联动':'暂停联动';
    $('speech').textContent=view.text;$('speech').classList.toggle('important',Boolean(view.important));
    const asset=(actions[view.action]||actions.idle)+'.gif';if(asset!==lastAsset){$('pet').src='/assets/'+asset;lastAsset=asset;}
    $('pet').alt='Deepet companion · '+view.reason;$('scene-reason').textContent=view.reason;
    $('source-label').textContent=view.source.label+(view.source.available?'':' · 过期');$('temperature').textContent=view.source.temperature;
    $('screen-values').replaceChildren(...view.source.metrics.map(text=>{const span=document.createElement('span');span.textContent=text;return span;}));
    const group = settings.source === 'servers', rows = view.serverSources || [];
    const fresh = group ? rows.length > 0 && rows.every(s => s.available) : view.source.available;
    $('single-metrics').hidden = group; $('server-metrics').hidden = !group;
    const screen = document.querySelector('.clock-screen');
    screen.classList.toggle('server-columns', group);
    $('server-screen-rows').innerHTML = Array.from({length:2}, (_,i) => {
      const s=rows[i];
      if(!s)return '<div class="server-screen-card empty"><span class="server-screen-name">未选服务器</span><span class="server-offline">等待选择</span></div>';
      const memory=s.metrics[1].replace(/^VRAM /,'');
      const usedMemory=memory==='--'?'--':memory.split('/')[0]+'G';
      const ram=s.metrics[3].replace(/^RAM /,'');
      return '<div class="server-screen-card' + (s.available ? '' : ' unavailable') + '"><span class="server-screen-name" title="' + escape(s.id) + '">' + escape(s.label) + '</span>' + (s.available ? '<div class="server-card-values"><span class="server-gpu"><small>GPU</small><strong>' + escape(s.metrics[0].replace(/^GPU /, '')) + '</strong></span><span class="server-ram"><small>RAM</small><strong>' + escape(ram) + '</strong></span><span class="server-vram" title="显存（已用/总量）：' + escape(memory) + '"><small>VRAM</small><strong>' + escape(usedMemory) + '</strong></span></div>' : '<span class="server-offline">离线</span>') + '</div>';
    }).join('');
    $('server-display-options').hidden = !group;
    $('server-order-hint').textContent = rows.length ? rows.map((s,i)=>(i?'右侧':'左侧')+' · '+s.label).join('　 /　 ') : '到服务器页，选择你关心的两台机器。';
    $('source-fresh').textContent = fresh ? '实时' : group && rows.some(s => s.available) ? '部分离线' : '数据待更新';
    $('source-fresh').classList.toggle('live', fresh);
    const signature=settings.servers.filter(s=>s.enabled).map(s=>s.id+':'+s.label).join('|');
    if(signature!==sourceOptions||!ready){$('source-select').innerHTML='<option value="mac">我的 Mac</option><option value="rotate">自动轮播</option><option value="servers">双服务器同屏</option>'+settings.servers.filter(s=>s.enabled).map(s=>'<option value="'+escape(s.id)+'">'+escape(s.label)+'</option>').join('');sourceOptions=signature;}
    $('source-select').value=settings.source;
    const valid=mac.available&&Date.now()-mac.sampled_at<15000;
    $('mac-summary').innerHTML=metrics([['CPU',percent(valid?mac.cpu_pct:null)],['GPU',percent(valid?mac.gpu_pct:null)],['内存',percent(valid?mac.ram_used_pct:null)],['磁盘',percent(valid?mac.disk_used_pct:null)]]);
    const labels={thinking:'认真思考中',working:'正在执行工具',waiting:'等待你处理',compacting:'整理上下文',turn_ended:'本轮已结束',idle:'暂时空闲'};
    $('agent-badge').textContent=agent.available?'已连接':'等待接入';$('agent-badge').classList.toggle('live',Boolean(agent.available));
    $('agent-description').textContent=agent.available?(labels[agent.status]||'状态更新中'):'等待下一次灵感。';
    $('agent-meta').textContent=agent.available?((agent.active_count||0)+' 个活跃会话 · 自动联动'):'接入 Codex 后，任务状态会自动同步';
    $('ai-card').dataset.state=agent.available?agent.status:'unknown';
    $('device-result').textContent=data.device.label;$('connection-footer').textContent=data.device.supported?'时钟同步已就绪':'当前展示 Mac 应用效果 · '+data.device.label;
    const connected=data.device.supported&&data.device.status==='ready',details=data.device.details||{};
    $('header-device-state').textContent=connected?'时钟已连接':settings.device.enabled?'时钟待连接':'时钟未连接';
    $('header-connection').classList.toggle('unavailable',!connected);$('side-device-dot').classList.toggle('offline',!connected);
    $('side-device-state').textContent=connected?settings.device.address:'等待连接';
    $('overview-device-label').textContent=data.device.label;$('device-address-short').textContent=settings.device.address||'Wi-Fi 时钟';
    $('device-version').textContent=details.version?'v'+details.version:'等待设备';
    const healthy=connected&&details.sprite_ready&&details.font_ready&&!details.memory_guard;
    $('device-health-badge').textContent=!connected?'待连接':details.memory_guard?'内存压力较高':healthy?'运行正常':'资源准备中';$('device-health-badge').classList.toggle('live',healthy);
    $('device-diagnostics').innerHTML=details.version?[
      ['固件版本','Deepet '+details.version],['存储可用',finite(details.fs_free)?Math.floor(details.fs_free/1024)+' KiB':'--'],
      ['剩余内存',finite(details.free_heap)?(details.free_heap/1024).toFixed(1)+' KiB':'--'],['动画与字库',details.sprite_ready&&details.font_ready?'已就绪':'正在准备']
    ].map(([label,value])=>'<div><span class="diagnostic-label">'+escape(label)+'</span><span class="diagnostic-value">'+escape(value)+'</span></div>').join(''):'<p class="caption">连接后查看固件与存储状态。</p>';
    $('device-token').placeholder=settings.device.hasToken?'已保存令牌；留空保持原值':'填写时钟管理页的令牌';
    $('server-cards').innerHTML=data.servers.length?data.servers.map(server=>{
      const valid=server.available&&Date.now()-server.sampled_at<15000;
      const name=server.hostname?server.hostname+(String(server.kernel).includes('microsoft')?' · WSL2':''):server.id;
      const state=valid?'已连接':server.error||(server.status==='connecting'?'正在连接':'数据过期');
      const gpus=server.gpus?.length?server.gpus:[null];
      return '<article class="card server-card"><div class="card-heading"><span class="server-title"><svg class="icon"><use href="#i-server"/></svg>'+escape(server.label)+'</span><span class="server-state'+(valid?' online':'')+'">'+escape(state)+'</span></div><p class="server-hostname">'+escape(name)+'</p>'+gpus.map(g=>'<div class="gpu-name"><span title="'+escape(g?.name||'')+'">'+escape(g?.name||'GPU 指标暂不可用')+'</span></div><div class="metric-grid">'+metrics([['GPU',percent(valid?g?.gpu_pct:null)],['RAM',percent(valid?server.ram_used_pct:null)],['VRAM',valid&&finite(g?.memory_used_mb)?(g.memory_used_mb/1024).toFixed(1)+'/'+(finite(g.memory_total_mb)?Math.round(g.memory_total_mb/1024):'--')+'G':'--']])+'</div>').join('')+'<div class="server-card-footer"><span>CPU '+escape(percent(valid?server.cpu_pct:null))+'</span><span>'+(server.sampled_at?'最近采样 '+escape(time.format(server.sampled_at)):'等待首次采样')+'</span></div></article>';
    }).join(''):'<article class="card"><h2>还没有启用服务器</h2><p class="caption">从下面的 SSH 别名中选择需要显示的服务器。</p></article>';
    const options=JSON.stringify(settings.servers);
    if(options!==serverSignature){$('server-options').innerHTML=settings.servers.map(s=>'<div class="server-option-row" data-server-row="'+escape(s.id)+'"><label class="check"><input type="checkbox" data-server="'+escape(s.id)+'" '+(s.enabled?'checked':'')+'>'+escape(s.label)+'</label><div class="order-buttons"><button type="button" data-move="up" aria-label="上移 '+escape(s.label)+'">↑</button><button type="button" data-move="down" aria-label="下移 '+escape(s.label)+'">↓</button></div></div>').join('');serverSignature=options;syncOrderButtons();}
    if(!ready){$('note').value=settings.note.text;$('note-pinned').checked=settings.note.pinned;$('device-address').value=settings.device.address;$('device-token').placeholder=settings.device.hasToken?'已保存令牌；留空保持原值':'填写时钟管理页的令牌';$('device-enabled').checked=settings.device.enabled;syncRules();ready=true;if(settings.device.enabled)window.webkit?.messageHandlers?.clockPermission?.postMessage(settings.device.address);}
    $('note-count').textContent=Array.from($('note').value).length+' / 28';
  }
  function syncRules(){const s=data.settings;$('night-start').value=s.rules.nightStart;$('night-end').value=s.rules.nightEnd;$('mac-hot').value=s.rules.macHotC;$('server-hot').value=s.rules.serverHotC;$('rotation-seconds').value=String(s.rotationSeconds);$('idle-action-seconds').value=String(s.idleActionSeconds);}
  document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>switchPage(b.dataset.page)));
  document.querySelector('.brand').addEventListener('click',event=>{event.preventDefault();switchPage('overview');});
  document.querySelectorAll('[data-react]').forEach(b=>b.addEventListener('click',async()=>{try{data=await request('interaction',{kind:b.dataset.react});render();}catch(e){toast(e.message);}}));
  $('source-select').addEventListener('change',()=>save({source:$('source-select').value},'显示来源已切换'));
  $('pause').addEventListener('click',()=>data&&save({paused:!data.settings.paused},data.settings.paused?'联动已恢复':'联动已暂停'));
  $('note').addEventListener('input',()=>{$('note').value=Array.from($('note').value).slice(0,28).join('');$('note-count').textContent=Array.from($('note').value).length+' / 28';});
  $('send-note').addEventListener('click',()=>save({note:{text:$('note').value,pinned:$('note-pinned').checked}},'留言已更新'));
  $('clear-note').addEventListener('click',()=>{$('note').value='';save({note:{text:'',pinned:true}},'留言已收起');});
  function syncOrderButtons(){const rows=[...$('server-options').children];rows.forEach((row,i)=>{row.querySelector('[data-move="up"]').disabled=i===0;row.querySelector('[data-move="down"]').disabled=i===rows.length-1;});}
  function serverSelection(){return [...document.querySelectorAll('[data-server-row]')].map(row=>({...data.settings.servers.find(s=>s.id===row.dataset.serverRow),enabled:row.querySelector('input').checked}));}
  $('server-options').addEventListener('click',event=>{const button=event.target.closest('[data-move]');if(!button)return;const row=button.closest('[data-server-row]');if(button.dataset.move==='up'&&row.previousElementSibling)row.previousElementSibling.before(row);else if(button.dataset.move==='down'&&row.nextElementSibling)row.nextElementSibling.after(row);syncOrderButtons();});
  $('save-servers').addEventListener('click',()=>save({servers:serverSelection()},'服务器选择与顺序已保存'));
  $('show-server-list').addEventListener('click',async()=>{if(await save({servers:serverSelection(),source:'servers'},'已切换为服务器同屏'))switchPage('overview');});
  $('refresh-servers').addEventListener('click',async()=>{const b=$('refresh-servers'),label=b.innerHTML;b.disabled=true;b.textContent='正在查询…';try{data=await request('servers/refresh',{});render();toast('服务器状态已更新');}catch(e){toast(e.message);}finally{b.disabled=false;b.innerHTML=label;}});
  $('device-form').addEventListener('submit',async event=>{event.preventDefault();const device={address:$('device-address').value.trim(),enabled:$('device-enabled').checked};if($('device-token').value)device.token=$('device-token').value;window.webkit?.messageHandlers?.clockPermission?.postMessage(device.address);try{data=await request('device/connect',{device});$('device-token').value='';render();toast(data.device.label);}catch(e){toast(e.message);}});
  $('rules-form').addEventListener('submit',event=>{event.preventDefault();save({rules:{nightStart:$('night-start').value,nightEnd:$('night-end').value,macHotC:Number($('mac-hot').value),serverHotC:Number($('server-hot').value)},rotationSeconds:Number($('rotation-seconds').value),idleActionSeconds:Number($('idle-action-seconds').value)});});
  $('ai-guide').addEventListener('click',()=>$('ai-guide-text').hidden=!$('ai-guide-text').hidden);
  $('open-ai-plugin').addEventListener('click',async()=>{try{await request('integration/open',{});toast('配套插件文件夹已打开');}catch(e){toast(e.message);}});
  async function poll(){try{data=await request('status');render();}catch{$('service-state').textContent='配套程序连接中断';$('service-dot').classList.add('offline');$('connection-footer').textContent='数据暂未更新，请保持配套应用运行';}}
  function tick(){$('clock').textContent=time.format(Date.now());$('date').textContent=date.format(Date.now());}
  switchPage(new URL(location.href).searchParams.get('page')||'overview');tick();poll();setInterval(tick,1000);setInterval(poll,1000);
})();
