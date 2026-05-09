const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const validate = require('../middleware/validate');
const { idParam, deviceBody, deviceUpdateBody } = require('../schemas');
const { normalizeVideoCodec } = require('../shared/video-codecs');

function createDevicesRouter({ db }) {
  const router = express.Router();

  router.get('/', asyncHandler('Failed to fetch devices', (_req, res) => {
    res.json(db.getAllDevices());
  }));

  router.post('/',
    validate({ body: deviceBody }),
    asyncHandler('Failed to add device', (req, res) => {
      const device = { ...req.body, videoCodec: normalizeVideoCodec(req.body.videoCodec) };
      const result = db.addDevice(device);
      res.json({ success: true, id: result.lastInsertRowid });
    })
  );

  router.put('/:id',
    validate({ params: idParam, body: deviceUpdateBody }),
    asyncHandler('Failed to update device', (req, res) => {
      const updates = req.body;
      if (Object.hasOwn(updates, 'videoCodec')) {
        updates.videoCodec = normalizeVideoCodec(updates.videoCodec);
      }
      db.updateDevice(req.params.id, updates);
      res.json({ success: true });
    })
  );

  router.delete('/:id',
    validate({ params: idParam }),
    asyncHandler('Failed to delete device', (req, res) => {
      db.deleteDevice(req.params.id);
      res.json({ success: true });
    })
  );

  return router;
}

module.exports = { createDevicesRouter };
