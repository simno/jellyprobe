const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const validate = require('../middleware/validate');
const Scheduler = require('../services/scheduler');
const { idParam, scheduleBody, scheduleUpdateBody } = require('../schemas');

function createSchedulesRouter({ db, scheduler }) {
  const router = express.Router();

  router.get('/', asyncHandler('Failed to fetch schedules', (_req, res) => {
    res.json(db.getAllScheduledRuns());
  }));

  router.post('/',
    validate({ body: scheduleBody }),
    asyncHandler('Failed to create schedule', (req, res) => {
      const data = req.body;
      data.nextRunAt = Scheduler.computeNextRun(data.frequency, data.dayOfWeek, data.timeOfDay);
      const id = db.createScheduledRun(data);
      res.json({ success: true, id, schedule: db.getScheduledRun(id) });
    })
  );

  router.put('/:id',
    validate({ params: idParam, body: scheduleUpdateBody }),
    asyncHandler('Failed to update schedule', (req, res) => {
      const { id } = req.params;
      const data = req.body;
      if (data.frequency || data.dayOfWeek !== undefined || data.timeOfDay) {
        const existing = db.getScheduledRun(id);
        if (!existing) return res.status(404).json({ error: 'Schedule not found' });
        data.nextRunAt = Scheduler.computeNextRun(
          data.frequency || existing.frequency,
          data.dayOfWeek ?? existing.dayOfWeek,
          data.timeOfDay || existing.timeOfDay
        );
      }
      db.updateScheduledRun(id, data);
      res.json({ success: true, schedule: db.getScheduledRun(id) });
    })
  );

  router.delete('/:id',
    validate({ params: idParam }),
    asyncHandler('Failed to delete schedule', (req, res) => {
      db.deleteScheduledRun(req.params.id);
      res.json({ success: true });
    })
  );

  router.post('/:id/run',
    validate({ params: idParam }),
    asyncHandler('Failed to run schedule', async (req, res) => {
      const schedule = db.getScheduledRun(req.params.id);
      if (!schedule) return res.status(404).json({ error: 'Schedule not found' });
      await scheduler.executeSchedule(schedule);
      res.json({ success: true });
    })
  );

  return router;
}

module.exports = { createSchedulesRouter };
