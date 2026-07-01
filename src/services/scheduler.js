const EventEmitter = require('events');
const log = require('../utils/logger');

class Scheduler extends EventEmitter {
  constructor(db, jellyfinClient, testRunManager) {
    super();
    this.db = db;
    this.jellyfinClient = jellyfinClient;
    this.testRunManager = testRunManager;
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this._tick(), 30000);
    this._tick();
    log.info('[Scheduler] Started');
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    log.info('[Scheduler] Stopped');
  }

  async _tick() {
    if (this.running) return;
    this.running = true;
    try {
      const schedules = this.db.getEnabledScheduledRuns();
      const now = new Date();

      for (const schedule of schedules) {
        if (!schedule.nextRunAt) {
          this.db.updateScheduledRun(schedule.id, {
            nextRunAt: Scheduler.computeNextRun(schedule.frequency, schedule.dayOfWeek, schedule.timeOfDay)
          });
          continue;
        }

        const nextRun = new Date(schedule.nextRunAt);
        if (now >= nextRun) {
          await this.executeSchedule(schedule);
          this.db.updateScheduledRun(schedule.id, {
            lastRunAt: now.toISOString(),
            nextRunAt: Scheduler.computeNextRun(schedule.frequency, schedule.dayOfWeek, schedule.timeOfDay)
          });
        }
      }
    } catch (err) {
      log.error('[Scheduler] Error:', err.message);
    }
    this.running = false;
  }

  async executeSchedule(schedule) {
    log.info(`[Scheduler] Executing schedule: ${schedule.name}`);
    try {
      const allDevices = this.db.getAllDevices();
      const devices = allDevices.filter(d => schedule.deviceIds.includes(d.id));
      if (devices.length === 0) {
        log.warn(`[Scheduler] No matching devices for schedule ${schedule.id}`);
        return;
      }

      const mediaScope = {
        type: schedule.mediaScope === 'recent' ? 'recent' : 'all',
        libraryIds: schedule.libraryIds,
        days: schedule.mediaDays || 7
      };

      const config = {
        devices,
        mediaScope,
        testConfig: {
          duration: schedule.testDuration || 30
        }
      };

      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const runName = `${schedule.name} — ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
      const testRun = this.testRunManager.createTestRun(config, runName);
      log.info(`[Scheduler] Created test run ${testRun.id} for schedule ${schedule.name}`);
      // Pass the schedule's parallelism explicitly — startTestRun would
      // otherwise override it with the global config value.
      await this.testRunManager.startTestRun(testRun.id, { maxParallelTests: schedule.parallelTests || 2 });
      this.emit('scheduledRunStarted', { scheduleId: schedule.id, testRunId: testRun.id });
    } catch (err) {
      log.error(`[Scheduler] Failed to execute schedule ${schedule.id}:`, err.message);
    }
  }

  static computeNextRun(frequency, dayOfWeek, timeOfDay) {
    const [hours, minutes] = timeOfDay.split(':').map(Number);
    const now = new Date();
    const candidate = new Date(now);
    candidate.setSeconds(0, 0);
    candidate.setHours(hours, minutes);

    if (frequency === 'daily') {
      if (candidate <= now) candidate.setDate(candidate.getDate() + 1);
    } else if (frequency === 'weekly') {
      const currentDay = candidate.getDay();
      let daysUntil = ((dayOfWeek ?? 0) - currentDay + 7) % 7;
      if (daysUntil === 0 && candidate <= now) daysUntil = 7;
      candidate.setDate(candidate.getDate() + daysUntil);
    } else if (frequency === 'every12h' || frequency === 'every6h') {
      // Keep adding intervals until we land in the future — a single hop can
      // still be in the past (e.g. every6h anchored at 01:00 when it's 20:00),
      // which would make the schedule fire on every tick.
      const intervalMs = (frequency === 'every12h' ? 12 : 6) * 60 * 60 * 1000;
      while (candidate <= now) candidate.setTime(candidate.getTime() + intervalMs);
    }

    return candidate.toISOString();
  }
}

module.exports = Scheduler;
