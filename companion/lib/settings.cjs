const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const aliasPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
function aliases() {
  try { return [...fs.readFileSync(path.join(os.homedir(), '.ssh/config'), 'utf8').matchAll(/^\s*Host\s+([^#\n]+)/gm)]
    .flatMap(match => match[1].trim().split(/\s+/)).filter(value => aliasPattern.test(value)); } catch { return []; }
}
const defaults = () => ({ version: 1, paused: false, source: 'mac', rotationSeconds: 15, idleActionSeconds: 45, serverLimit: 2,
  servers: aliases().map(alias => ({ id: alias, label: alias, enabled: false })),
  rules: { nightStart: '21:00', nightEnd: '07:00', macHotC: 85, serverHotC: 80 },
  note: { text: '', pinned: true, expiresAt: null }, device: { address: '', token: '', enabled: false } });
function validAddress(address) {
  // Only a same-LAN IPv4 clock; arbitrary network targets and URL credentials are rejected.
  if (typeof address !== 'string' || !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address)) return false;
  const parts = address.split('.');
  return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
class Settings {
  constructor(directory) {
    this.directory = directory; this.filename = path.join(directory, 'settings.json');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.value = defaults();
    if (fs.existsSync(this.filename)) {
      const saved = JSON.parse(fs.readFileSync(this.filename, 'utf8'));
      this.value = { ...this.value, ...saved, rules: { ...this.value.rules, ...saved.rules }, device: { ...this.value.device, ...saved.device } };
    }
    this.value.serverLimit = 2; // Migrate the earlier optional three-row layout.
    if (![30, 45, 60].includes(this.value.idleActionSeconds)) this.value.idleActionSeconds = 45;
  }
  save() {
    const temporary = this.filename + '.new';
    fs.writeFileSync(temporary, JSON.stringify(this.value, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(temporary, this.filename); fs.chmodSync(this.filename, 0o600);
  }
  public() { const result = structuredClone(this.value); result.device.hasToken = Boolean(result.device.token); delete result.device.token; return result; }
  update(patch) {
    const next = structuredClone(this.value);
    if ('paused' in patch) { if (typeof patch.paused !== 'boolean') throw Error('暂停设置无效'); next.paused = patch.paused; }
    if ('source' in patch) {
      if (!['mac', 'rotate', 'servers', ...next.servers.filter(s => s.enabled).map(s => s.id)].includes(patch.source)) throw Error('请选择已启用的数据来源');
      next.source = patch.source;
    }
    if ('rotationSeconds' in patch) {
      if (![10, 15, 30, 60].includes(patch.rotationSeconds)) throw Error('轮播间隔无效'); next.rotationSeconds = patch.rotationSeconds;
    }
    if ('idleActionSeconds' in patch) {
      if (![30, 45, 60].includes(patch.idleActionSeconds)) throw Error('日常动作间隔请选择30、45或60秒');
      next.idleActionSeconds = patch.idleActionSeconds;
    }
    if ('serverLimit' in patch) {
      if (patch.serverLimit !== 2) throw Error('双服务器同屏固定显示2台');
      next.serverLimit = patch.serverLimit;
    }
    if ('servers' in patch) {
      const available = new Set(aliases());
      if (!Array.isArray(patch.servers) || patch.servers.length > 12) throw Error('服务器列表无效');
      next.servers = patch.servers.map(s => {
        if (!aliasPattern.test(s.id) || !available.has(s.id) || typeof s.enabled !== 'boolean') throw Error('服务器必须使用本机现有 SSH 别名');
        return { id: s.id, label: String(s.label || s.id).slice(0, 32), enabled: s.enabled };
      });
      if (new Set(next.servers.map(s => s.id)).size !== next.servers.length) throw Error('服务器重复');
      if (next.servers.filter(s => s.enabled).length > 7) throw Error('时钟最多同时显示7台服务器');
      if (!['mac', 'rotate', 'servers', ...next.servers.filter(s => s.enabled).map(s => s.id)].includes(next.source)) next.source = 'mac';
    }
    if ('rules' in patch) {
      const rules = { ...next.rules, ...patch.rules };
      for (const key of ['nightStart', 'nightEnd']) if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(rules[key])) throw Error('时间格式无效');
      for (const key of ['macHotC', 'serverHotC']) if (!Number.isFinite(rules[key]) || rules[key] < 50 || rules[key] > 105) throw Error('提醒温度须在50–105°C之间');
      next.rules = rules;
    }
    if ('device' in patch) {
      const d = patch.device;
      if ('address' in d && !validAddress(d.address)) throw Error('请输入时钟的局域网 IPv4 地址');
      if ('token' in d && (typeof d.token !== 'string' || d.token.length > 256)) throw Error('连接令牌无效');
      if ('enabled' in d && typeof d.enabled !== 'boolean') throw Error('设备开关无效');
      for (const key of ['address', 'token', 'enabled']) if (key in d) next.device[key] = d[key];
    }
    if ('note' in patch) {
      const text = String(patch.note.text || '').trim();
      if (Array.from(text).length > 28) throw Error('留言最多28个字');
      const pinned = Boolean(patch.note.pinned);
      next.note = { text, pinned, expiresAt: text && !pinned ? Date.now() + 8000 : null };
    }
    this.value = next; this.save(); return this.public();
  }
}
module.exports = { Settings, aliases, validAddress, aliasPattern };
