(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PetPolicy = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const defaults = Object.freeze({
    timezone: 'Asia/Shanghai', nightStart: '21:00', nightEnd: '07:00', staleMs: 15000,
    macHotC: 85, macRecoverC: 78, serverHotC: 80, serverRecoverC: 75,
    hotHoldMs: 30000, recoverHoldMs: 60000, repeatAlertMs: 300000,
    lowDiskBytes: 10 * 1024 ** 3, diskHoldMs: 60000, restAfterMs: 50 * 60000
  });
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  function minutesAt(time, timezone) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(time);
    return Number(parts.find(part => part.type === 'hour').value) * 60 + Number(parts.find(part => part.type === 'minute').value);
  }
  const parseTime = value => { const [hours, minutes] = value.split(':').map(Number); return hours * 60 + minutes; };
  function isNight(now, config) {
    const minute = minutesAt(now, config.timezone), start = parseTime(config.nightStart), end = parseTime(config.nightEnd);
    if (start === end) return false;
    return start > end ? minute >= start || minute < end : minute >= start && minute < end;
  }
  class Engine {
    constructor(config = {}) { this.config = { ...defaults, ...config }; this.since = new Map(); this.latched = new Set(); this.lastReminder = new Map(); this.activeMs = 0; this.lastNow = null; this.lastNight = null; this.wakeUntil = 0; this.restUntil = 0; }
    held(key, value, milliseconds, now) {
      if (!value) { this.since.delete(key); return false; }
      if (!this.since.has(key)) this.since.set(key, now);
      return now - this.since.get(key) >= milliseconds;
    }
    hot(key, value, limit, recover, now) {
      if (!finite(value)) { this.since.delete(key + ':high'); this.since.delete(key + ':cool'); return false; }
      const high = this.held(key + ':high', value >= limit, this.config.hotHoldMs, now);
      const cool = this.held(key + ':cool', value < recover, this.config.recoverHoldMs, now);
      if (high) this.latched.add(key);
      if (cool) this.latched.delete(key);
      return this.latched.has(key);
    }
    emit(key, now) {
      const previous = this.lastReminder.get(key);
      if (previous !== undefined && now - previous > 8000 && now - previous < this.config.repeatAlertMs) return false;
      if (previous === undefined || now - previous >= this.config.repeatAlertMs) this.lastReminder.set(key, now);
      return true;
    }
    evaluate(input, now = Date.now()) {
      const cfg = this.config;
      const night = isNight(now, cfg);
      if (this.lastNight === true && !night) this.wakeUntil = now + 30000;
      this.lastNight = night;
      const fresh = item => item && item.available !== false && finite(item.sampled_at) && now - item.sampled_at <= cfg.staleMs && now >= item.sampled_at - 2000;
      const mac = fresh(input.mac) ? input.mac : null;
      const agent = input.agent && input.agent.available && fresh(input.agent) ? input.agent : null;
      const delta = this.lastNow === null ? 0 : Math.max(0, Math.min(10000, now - this.lastNow));
      this.lastNow = now;
      if (mac && finite(mac.user_idle_seconds) && mac.user_idle_seconds < 300 && !night) this.activeMs += delta;
      else if (night || !mac || !finite(mac.user_idle_seconds) || mac.user_idle_seconds >= 300) this.activeMs = 0;
      const make = (action, text, reason, important = false) => ({ action, text, reason, important, night, label: reason, auto: true });
      if (input.transport_online === false) return make('look', '数据连接中断，本地时钟还在。', '连接中断', true);
      if (mac && mac.thermal_state === 'critical') return make('notification', 'Mac 系统提示需要降温。', '系统温度提醒', true);
      if (agent && ['waiting', 'permission'].includes(agent.status)) return make('notification', '有个问题，需要你来回答哦。', '等待你处理', true);
      if (agent && agent.status === 'failed') return make('error', '任务报告失败，一起看看原因吧。', '明确失败', true);
      if (mac) {
        const temps = [mac.cpu_temperature_c, mac.gpu_temperature_c].filter(finite);
        const peak = temps.length ? Math.max(...temps) : null;
        const hot = this.hot('mac', peak, cfg.macHotC, cfg.macRecoverC, now);
        const serious = this.held('mac:serious', mac.thermal_state === 'serious', 10000, now);
        if ((hot || serious) && this.emit('mac-hot', now)) return make('notification', 'Mac 温度持续偏高，看看吧。', 'Mac 温度提醒', true);
      } else {
        this.since.delete('mac:high'); this.since.delete('mac:cool'); this.since.delete('mac:serious');
      }
      for (const server of input.servers || []) {
        const key = 'server:' + server.id;
        if (!fresh(server)) { this.since.delete(key + ':high'); this.since.delete(key + ':cool'); continue; }
        if (this.hot(key, server.gpu_temperature_c, cfg.serverHotC, cfg.serverRecoverC, now) && this.emit(key, now)) return make('notification', '服务器 GPU 持续偏热，看看吧。', '服务器温度提醒', true);
      }
      if (mac && this.held('disk', finite(mac.disk_free_bytes) && mac.disk_free_bytes < cfg.lowDiskBytes, cfg.diskHoldMs, now) && this.emit('disk', now)) return make('notification', 'Mac 磁盘可用空间少于 10 GiB。', '磁盘空间提醒', true);
      if (!mac) this.since.delete('disk');
      if (agent && finite(agent.event_at) && now - agent.event_at >= 0 && now - agent.event_at < 7000) {
        if (agent.status === 'succeeded') return make('spout', '任务明确完成啦，辛苦啦！', '任务成功', true);
        if (agent.status === 'turn_ended') return make('happy', '这一轮结束啦，来看看结果吧！', '本轮结束', true);
      }
      if (agent) {
        const phases = { thinking: ['thinking', '让我认真想一想。'], working: ['typing', '正在认真写代码，等我一下下。'], building: ['building', '正在运行构建和检查。'], compacting: ['compacting', '整理一下上下文，再继续。'], reading: ['carrying', '正在查看资料和文件。'] };
        if (phases[agent.status]) {
          if (Number(agent.active_count) >= 2) return make('conducting', '几个小帮手一起努力中。', '多个任务进行中');
          return make(...phases[agent.status], 'AI 任务进行中');
        }
      }
      if (mac && this.held('machine-busy', (finite(mac.cpu_pct) && mac.cpu_pct >= 75) || (finite(mac.gpu_pct) && mac.gpu_pct >= 75), 10000, now)) return make('building', '电脑正忙碌，我陪你等一会儿。', '电脑忙碌');
      if (!mac) this.since.delete('machine-busy');
      if (!night && now < this.restUntil) return make('notification', '已经忙了挺久，起来喝口水吧。', '休息提醒', true);
      if (!night && this.activeMs >= cfg.restAfterMs) {
        if (this.emit('rest', now)) { this.activeMs = 0; this.restUntil = now + 8000; return make('notification', '已经忙了挺久，起来喝口水吧。', '休息提醒', true); }
      }
      if (night) return make('sleeping', '晚上九点后，安静陪你休息。', '夜间陪伴');
      if (now < this.wakeUntil) return make('waking', '早上好，新的一天一起加油。', '早安');
      return make('idle', '今天也一起慢慢做好吧。', '白天陪伴');
    }
  }
  return { defaults, Engine, isNight };
});
