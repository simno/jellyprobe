const EventEmitter = require('events');

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
    console.log('[Scheduler] Started');
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[Scheduler] Stopped');
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
      console.error('[Scheduler] Error:', err.message);
    }
    this.running = false;
  }

  async executeSchedule(schedule) {
    console.log(`[Scheduler] Executing schedule: ${schedule.name}`);
    try {
      const allDevices = this.db.getAllDevices();
      const devices = allDevices.filter(d => schedule.deviceIds.includes(d.id));
      if (devices.length === 0) {
        console.warn(`[Scheduler] No matching devices for schedule ${schedule.id}`);
        return;
      }

      const mediaScope = {
        type: schedule.mediaScope === 'recent' ? 'recent' : 'all',
        libraryIds: schedule.libraryIds,
        days: schedule.mediaDays || 7
      };

      this.testRunManager.testRunner.setMaxParallelTests(schedule.parallelTests || 2);

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
      console.log(`[Scheduler] Created test run ${testRun.id} for schedule ${schedule.name}`);
      await this.testRunManager.startTestRun(testRun.id);
      this.emit('scheduledRunStarted', { scheduleId: schedule.id, testRunId: testRun.id });
    } catch (err) {
      console.error(`[Scheduler] Failed to execute schedule ${schedule.id}:`, err.message);
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
    } else if (frequency === 'every12h') {
      if (candidate <= now) candidate.setTime(candidate.getTime() + 12 * 60 * 60 * 1000);
    } else if (frequency === 'every6h') {
      if (candidate <= now) candidate.setTime(candidate.getTime() + 6 * 60 * 60 * 1000);
    }

    return candidate.toISOString();
  }
}

module.exports = Scheduler;
