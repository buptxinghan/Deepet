const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { IdleCycle } = require('../lib/idle-cycle.cjs');
const { StateEngine } = require('../lib/state.cjs');
const { Settings } = require('../lib/settings.cjs');

test('the full idle cycle shows nine actions for their complete visible durations', () => {
  const cycle = new IdleCycle(), transitions = [];
  let previous;
  for (let at = 0; at <= 405000; at += 1000) {
    const step = cycle.choose(at, true);
    if (step.action !== previous) transitions.push([at, step.action]);
    previous = step.action;
  }
  assert.deepEqual(transitions, [
    [0, 'idle'], [45000, 'look'], [90000, 'spout'], [135000, 'swim'],
    [180000, 'smile-hearts'], [225000, 'music'], [270000, 'conducting'],
    [315000, 'sleeping'], [375000, 'waking'], [405000, 'idle']
  ]);
});

test('task interruptions suspend the visible budget and resume the same idle action', () => {
  const cycle = new IdleCycle();
  for (let at = 0; at <= 20000; at += 1000) assert.equal(cycle.choose(at, true).action, 'idle');
  for (let at = 21000; at < 90000; at += 1000) assert.equal(cycle.choose(at, false), null);
  for (let at = 90000; at < 115000; at += 1000) assert.equal(cycle.choose(at, true).action, 'idle');
  assert.equal(cycle.choose(115000, true).action, 'look');
});

test('sleep gaps and backwards wall-clock changes cannot skip a chain of actions', () => {
  const cycle = new IdleCycle();
  for (let at = 0; at <= 10000; at += 1000) cycle.choose(at, true);
  assert.equal(cycle.choose(3600000, true).action, 'idle');
  assert.equal(cycle.choose(5000, true).action, 'idle');
  for (let at = 6000; at < 40000; at += 1000) assert.equal(cycle.choose(at, true).action, 'idle');
  assert.equal(cycle.choose(40000, true).action, 'look');
});

test('30 and 60 second settings change ordinary dwell without breaking the nap and wake pair', () => {
  for (const seconds of [30, 60]) {
    const cycle = new IdleCycle(), transitions = []; let previous;
    for (let at = 0; at <= seconds * 7000 + 90000; at += 1000) {
      const step = cycle.choose(at, true, seconds);
      if (step.action !== previous) transitions.push([at, step.action]);
      previous = step.action;
    }
    assert.deepEqual(transitions.slice(-3), [
      [seconds * 7000, 'sleeping'], [seconds * 7000 + 60000, 'waking'],
      [seconds * 7000 + 90000, 'idle']
    ]);
  }
});

const noon = Date.parse('2026-10-21T12:00:00+08:00');
const config = () => ({ source: 'mac', rotationSeconds: 15, idleActionSeconds: 45, paused: false,
  rules: { nightStart: '21:00', nightEnd: '07:00', macHotC: 85, serverHotC: 80 },
  note: { text: '', pinned: true, expiresAt: null } });
const mac = at => ({ available: true, sampled_at: at, cpu_pct: 10, gpu_pct: 5,
  cpu_temperature_c: 40, user_idle_seconds: 30 });

test('real tasks, alerts and pause immediately preempt the cycle, then resume music', () => {
  const engine = new StateEngine(), settings = config();
  const at = (delta, agent = {}, critical = false) => {
    const time = noon + delta;
    return engine.compose(settings, { ...mac(time), ...(critical ? { thermal_state: 'critical' } : {}) },
      [], agent.available ? { ...agent, sampled_at: time } : agent, {}, time);
  };
  for (let delta = 0; delta <= 230000; delta += 1000) at(delta);
  assert.equal(at(230000).action, 'music');
  assert.equal(at(231000, { available: true, status: 'working' }).action, 'typing');
  assert.equal(at(232000, {}, true).reason, '系统温度提醒');
  settings.paused = true; assert.equal(at(233000).reason, '联动已暂停');
  settings.paused = false; assert.equal(at(234000).action, 'music');
  settings.note.text = '加油'; assert.equal(at(235000).text, '加油');
  assert.equal(at(235000).action, 'music');
});

test('nighttime keeps sleeping and morning wake lasts 30 seconds before a fresh day cycle', () => {
  const engine = new StateEngine(), settings = config();
  const at = stamp => { const time = Date.parse(stamp + '+08:00'); return engine.compose(settings, mac(time), [], {}, {}, time); };
  at('2026-10-21T20:59:59');
  assert.equal(at('2026-10-21T21:00:00').action, 'sleeping');
  assert.equal(at('2026-10-21T23:00:00').action, 'sleeping');
  assert.equal(at('2026-10-22T07:00:00').action, 'waking');
  assert.equal(at('2026-10-22T07:00:29').action, 'waking');
  assert.equal(at('2026-10-22T07:00:30').action, 'idle');
});

test('idle dwell settings migrate, persist, and reject invalid updates atomically', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deepet-idle-'));
  try {
    const store = new Settings(directory); assert.equal(store.value.idleActionSeconds, 45);
    for (const seconds of [30, 45, 60]) {
      store.update({ idleActionSeconds: seconds });
      assert.equal(new Settings(directory).value.idleActionSeconds, seconds);
    }
    const before = fs.readFileSync(store.filename, 'utf8');
    for (const invalid of [0, 9, 29, 90, '45', null]) {
      assert.throws(() => store.update({ idleActionSeconds: invalid, paused: true }));
      assert.equal(store.value.paused, false);
      assert.equal(fs.readFileSync(store.filename, 'utf8'), before);
    }
    const legacy = JSON.parse(before); delete legacy.idleActionSeconds;
    fs.writeFileSync(store.filename, JSON.stringify(legacy));
    assert.equal(new Settings(directory).value.idleActionSeconds, 45);
  } finally { fs.rmSync(directory, { recursive: true }); }
});
