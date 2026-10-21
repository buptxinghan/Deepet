const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const { aliasPattern } = require('./settings.cjs');
// Fixed read-only script. No user-provided shell commands, packages or processes.
const remote = String.raw`
import csv,io,json,os,platform,shutil,subprocess,time
def ticks():
    with open('/proc/stat') as f: return list(map(int,f.readline().split()[1:9]))
a=ticks(); time.sleep(0.5); b=ticks(); d=[y-x for x,y in zip(a,b)]; total=sum(d)
mem={}
with open('/proc/meminfo') as f:
    for line in f:
        key,value=line.split(':',1); mem[key]=int(value.split()[0])*1024
disk=shutil.disk_usage('/')
binary=shutil.which('nvidia-smi') or ('/usr/lib/wsl/lib/nvidia-smi' if os.path.isfile('/usr/lib/wsl/lib/nvidia-smi') else None)
gpus=[]; gpu_error=None
def number(value):
    try: return float(value)
    except (ValueError,TypeError): return None
if binary:
    try:
        data=subprocess.check_output([binary,'--query-gpu=uuid,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw','--format=csv,noheader,nounits'],timeout=4,text=True)
        for row in csv.reader(io.StringIO(data)):
            if len(row)!=7: continue
            row=[x.strip() for x in row]
            gpus.append(dict(id=row[0],name=row[1],gpu_pct=number(row[2]),memory_used_mb=number(row[3]),memory_total_mb=number(row[4]),temperature_c=number(row[5]),power_w=number(row[6])))
    except (subprocess.SubprocessError,OSError): gpu_error='query_failed'
else: gpu_error='not_available'
print(json.dumps(dict(hostname=platform.node(),os=platform.system(),kernel=platform.release(),cpu_pct=(100*(1-(d[3]+d[4])/total)) if total else None,ram_used_pct=100*(1-mem.get('MemAvailable',0)/mem['MemTotal']) if mem.get('MemTotal') and 'MemAvailable' in mem else None,disk_used_pct=100*(1-disk.free/disk.total),disk_free_bytes=disk.free,gpus=gpus,gpu_error=gpu_error)))
`;
const quote = text => "'" + text.replace(/'/g, "'\\''") + "'";
function classify(error) {
  const message = String(error.stderr || error.message || '');
  if (/REMOTE HOST IDENTIFICATION|Host key verification|No .* host key.*known/i.test(message)) return ['host_identity', '需要核对主机身份'];
  if (/Permission denied|authentication|sign_and_send_pubkey/i.test(message)) return ['authentication', '需要检查 SSH 免密连接'];
  if (/python3:.*not found|No such file.*python3/i.test(message)) return ['python_missing', '服务器缺少 Python 3'];
  if (error.killed || /timed out|No route|refused|unreachable|resolve hostname|Connection closed/i.test(message)) return ['unreachable', 'SSH 暂时不可达'];
  return ['query_failed', '状态查询未成功'];
}
class SSHCollector {
  constructor() { this.samples = new Map(); this.inflight = new Map(); this.next = new Map(); this.failures = new Map(); }
  async collect(server, force = false) {
    if (!aliasPattern.test(server.id)) throw Error('Invalid SSH alias');
    if (this.inflight.has(server.id)) return this.inflight.get(server.id);
    if (!force && Date.now() < (this.next.get(server.id) || 0)) return this.samples.get(server.id);
    const operation = (async () => {
      const started = Date.now();
      try {
        const { stdout } = await run('/usr/bin/ssh', ['-T', '-n', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-o', 'ConnectionAttempts=1', '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no', '-o', 'PermitLocalCommand=no', '-o', 'ClearAllForwardings=yes', '-o', 'ForwardAgent=no', '-o', 'ForwardX11=no', '-o', 'ControlMaster=no', '-o', 'ControlPath=none', server.id, 'python3 -c ' + quote(remote)], { timeout: 10000, maxBuffer: 128 * 1024 });
        const raw = JSON.parse(stdout.trim());
        if (raw.os !== 'Linux' || !Array.isArray(raw.gpus)) throw Error('Unsupported remote metrics');
        const temps = raw.gpus.map(g => g.temperature_c).filter(Number.isFinite);
        const sample = { ...raw, id: server.id, label: server.label, available: true, sampled_at: Date.now(),
          gpu_temperature_c: temps.length ? Math.max(...temps) : null, latency_ms: Date.now() - started, status: raw.gpus.length ? 'online' : 'no_gpu', error: null };
        this.samples.set(server.id, sample); this.failures.set(server.id, 0); this.next.set(server.id, Date.now() + 10000);
      } catch (error) {
        const count = (this.failures.get(server.id) || 0) + 1; this.failures.set(server.id, count);
        const [code, message] = classify(error), previous = this.samples.get(server.id);
        this.samples.set(server.id, { ...(previous || {}), id: server.id, label: server.label, available: false, status: code, error: message, attempted_at: Date.now(), sampled_at: previous?.sampled_at || null });
        this.next.set(server.id, Date.now() + Math.min(120000, 15000 * 2 ** Math.min(count - 1, 3)));
      }
      return this.samples.get(server.id);
    })();
    this.inflight.set(server.id, operation);
    try { return await operation; } finally { this.inflight.delete(server.id); }
  }
  list(servers) { return servers.filter(s => s.enabled).map(s => this.samples.get(s.id) || { id: s.id, label: s.label, available: false, status: 'connecting', sampled_at: null, error: null }); }
}
module.exports = { SSHCollector, classify, remote };
