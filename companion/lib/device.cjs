const { validAddress } = require('./settings.cjs');
class DeviceLink {
  constructor() { this.latest = { status: 'not_paired', label: '尚未连接时钟', supported: false }; this.busy = false; this.lastProbe = 0; this.sequence = 0; this.generation = require('node:crypto').randomBytes(6).toString('hex'); this.settingsDirty = true; this.seenRevision = null; this.requestedSource = null; }
  async request(device, route, method = 'GET', body) {
    if (!validAddress(device.address)) throw Error('Invalid clock address');
    const payload = body ? JSON.stringify(body) : undefined;
    let response;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await fetch('http://' + device.address + route, { method, headers: { Authorization: 'Bearer ' + device.token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: payload, redirect: 'error', signal: AbortSignal.timeout(2500) });
        break;
      } catch (error) {
        // The clock can close a TCP connection before replying. State messages
        // retain their sequence on retry; settings writes are idempotent.
        if (attempt || !['ECONNRESET', 'UND_ERR_SOCKET', 'EPIPE'].includes(error.cause?.code)) throw error;
        await require('node:timers/promises').setTimeout(150);
      }
    }
    if (response.status === 401) throw Error('unauthorized');
    if (response.status === 404) throw Error('unsupported');
    if (!response.ok) throw Error('http_' + response.status);
    return response.json();
  }
  async probe(device) {
    this.lastProbe = Date.now();
    if (!device.token) { this.latest = { status: 'not_paired', label: '填写连接令牌后连接', supported: false }; return this.latest; }
    try {
      const data = await this.request(device, '/api/v1/companion/status');
      if (data.protocol !== 1) throw Error('unsupported');
      if (this.seenRevision !== null && data.revision !== this.seenRevision && !this.settingsDirty) this.requestedSource = { source: data.source, rotationSeconds: data.rotation_seconds || 15, serverLimit: 2 };
      this.seenRevision = data.revision;
      this.latest = { status: 'ready', label: '时钟已连接', supported: true, last_seen: Date.now(), details: data };
    } catch (error) {
      const code = error.message;
      this.latest = { status: code === 'unsupported' ? 'firmware_update_needed' : code === 'unauthorized' ? 'unauthorized' : 'unreachable',
        label: code === 'unsupported' ? '时钟需要更新桌宠固件' : code === 'unauthorized' ? '连接令牌不正确' : '暂时联系不上时钟', supported: false,
        diagnostic_code: String(error.cause?.code || error.name || 'unknown') };
    }
    return this.latest;
  }
  async tick(device, view, paused) {
    if (this.busy || !device.enabled || paused) return;
    this.busy = true;
    try {
      if (!this.latest.supported || Date.now() - this.lastProbe > 10000) {
        if (Date.now() - this.lastProbe > 10000) await this.probe(device);
        if (!this.latest.supported) return;
      }
      if (view.mode === 'servers' && !this.latest.details?.server_columns) {
        this.latest = { ...this.latest, status: 'firmware_update_needed', label: '时钟需要更新双服务器固件', supported: false };
        return;
      }
      await this.request(device, '/api/v1/companion/state', 'POST', {
        protocol: 1, bridge: this.generation, seq: ++this.sequence, action: view.action, text: view.text,
        important: Boolean(view.important), source: view.source, sources: view.sources,
        source_mode: view.mode, rotation_seconds: view.rotationSeconds, server_limit: 2, night: Boolean(view.night)
      });
      if(this.settingsDirty) { await this.request(device, '/api/v1/companion/settings', 'POST', {source:view.mode,rotation_seconds:view.rotationSeconds,server_limit:2}); this.settingsDirty=false; }
      this.latest = { ...this.latest, status: 'ready', label: '时钟已连接', last_sent: Date.now() };
    } catch (error) { this.latest = { status: 'unreachable', label: '时钟连接中断，稍后重试', supported: false, diagnostic_code: String(error.cause?.code || error.name || 'unknown') }; this.lastProbe = Date.now(); }
    finally { this.busy = false; }
  }
}
module.exports = { DeviceLink };
