const steps = Object.freeze([
  { action: 'idle', text: '今天也一起慢慢做好吧。' },
  { action: 'look', text: '看看你在忙什么，我在这里。' },
  { action: 'spout', text: '冒个小水花，换换心情。' },
  { action: 'swim', text: '游一小圈，再回来陪你。' },
  { action: 'smile-hearts', text: '今天也要开心一点。' },
  { action: 'music', text: '跟着节奏，放松一下。' },
  { action: 'conducting', text: '给今天配一点小小的节奏。' },
  { action: 'sleeping', text: '打个小盹，一会儿就醒。', seconds: 60 },
  { action: 'waking', text: '醒啦，继续陪着你。', seconds: 30 }
].map(Object.freeze));

// Advance only while ordinary daytime companionship is visible. Task events,
// alerts, pauses and long sampling gaps suspend the remaining visible time.
class IdleCycle {
  constructor() { this.reset(); }
  reset() { this.index = 0; this.elapsed = 0; this.lastAt = null; this.active = false; }
  choose(now, active, seconds = 45) {
    const gap = this.lastAt === null ? 0 : now - this.lastAt;
    if (active && this.active && gap >= 0 && gap <= 15000) this.elapsed += gap;
    this.lastAt = now; this.active = active;
    if (!active) return null;
    const normalSeconds = [30, 45, 60].includes(seconds) ? seconds : 45;
    const duration = () => (steps[this.index].seconds || normalSeconds) * 1000;
    while (this.elapsed >= duration()) {
      this.elapsed -= duration(); this.index = (this.index + 1) % steps.length;
    }
    return steps[this.index];
  }
}

module.exports = { IdleCycle };
