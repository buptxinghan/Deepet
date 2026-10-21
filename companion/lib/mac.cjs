const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile, execFileSync } = require('node:child_process');
const run = require('node:util').promisify(execFile);
class MacCollector {
  constructor(root) {
    const bundled = path.join(root, 'system-metrics');
    if (fs.existsSync(bundled)) this.binary = bundled;
    else {
      const source = path.join(root, '../mac-adapter/SystemMetrics.swift');
      const digest = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex').slice(0, 12);
      const cache = path.join(os.homedir(), 'Library/Caches/Deepet/mac-adapter');
      fs.mkdirSync(cache, { recursive: true }); this.binary = path.join(cache, 'system-metrics-' + digest);
      if (!fs.existsSync(this.binary)) execFileSync('/usr/bin/xcrun', ['swiftc', '-O', '-framework', 'IOKit', source, '-o', this.binary]);
    }
    this.previous = null; this.latest = { available: false, sampled_at: null }; this.busy = false;
  }
  async sample() {
    if (this.busy) return; this.busy = true;
    try {
      const [data, temperatures] = await Promise.all([run(this.binary, [], { timeout: 5000 }), this.temperatures()]);
      const value = { ...JSON.parse(data.stdout), ...temperatures, label: '我的 Mac', id: 'mac' }, ticks = value.cpu_ticks;
      if (this.previous && Array.isArray(ticks)) {
        const changes = ticks.map((n, i) => n >= this.previous[i] ? n - this.previous[i] : 0), total = changes.reduce((a, b) => a + b, 0);
        value.cpu_pct = total ? (1 - changes[2] / total) * 100 : null;
      }
      this.previous = ticks; delete value.cpu_ticks; this.latest = value;
    } catch { this.latest = { ...this.latest, available: false }; }
    finally { this.busy = false; }
  }
  async temperatures() {
    const cpu = new Set(['Te05','Te0S','Te09','Te0H','Tp01','Tp05','Tp09','Tp0D','Tp0V','Tp0Y','Tp0b','Tp0e']);
    const gpu = new Set(['Tg0G','Tg0H','Tg0K','Tg0L','Tg0d','Tg0e','Tg0j','Tg0k']);
    const empty = { cpu_temperature_c: null, gpu_temperature_c: null };
    try {
      const { stdout } = await run('/Applications/Stats.app/Contents/Resources/smc', ['list', '-t'], { timeout: 3500 });
      const readings = [...stdout.matchAll(/\[([^\]]+)\]\s+([-+0-9.eE]+)/g)].map(m => [m[1], Number(m[2])]).filter(([,n]) => n > 0 && n < 130);
      const mean = keys => { const values = readings.filter(([key]) => keys.has(key)).map(([,n]) => n); return values.length ? values.reduce((a,b) => a+b, 0) / values.length : null; };
      return { cpu_temperature_c: mean(cpu), gpu_temperature_c: mean(gpu) };
    } catch { return empty; }
  }
}
module.exports = { MacCollector };
