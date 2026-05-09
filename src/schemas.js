const { z } = require('zod');

// Reusable primitives. Numeric path/query params arrive as strings, so use
// coerce.number; body fields stay strict so we can spot frontend bugs.
const idParam = z.object({ id: z.coerce.number().int().positive() });
const libraryIdParam = z.object({ libraryId: z.string().min(1).max(200) });
const itemIdParam = z.object({ itemId: z.string().min(1).max(200) });

const paginatedListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0)
}).passthrough();

const libraryItemsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  startIndex: z.coerce.number().int().min(0).default(0),
  searchTerm: z.string().max(200).optional()
}).passthrough();

const recentItemsQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(7),
  limit: z.coerce.number().int().min(1).max(10000).default(1000)
}).passthrough();

const libraryCountQuery = z.object({
  recent: z.enum(['true', 'false']).optional(),
  days: z.coerce.number().int().min(1).max(365).default(7)
}).passthrough();

const streamQuery = z.object({
  mediaSourceId: z.string().min(1).max(200),
  deviceId: z.string().min(1).max(200),
  playSessionId: z.string().max(200).optional(),
  videoCodec: z.string().max(50).optional(),
  audioCodec: z.string().max(50).optional(),
  maxBitrate: z.coerce.number().int().min(1).max(100_000_000).default(20_000_000),
  maxWidth: z.coerce.number().int().min(1).max(3840).default(1920),
  maxHeight: z.coerce.number().int().min(1).max(2160).default(1080)
}).passthrough();

const configTestBody = z.object({
  jellyfinUrl: z.string().url(),
  apiKey: z.string().min(1).max(500)
});

// Config update is intentionally permissive — db.updateConfig already filters
// by an internal allowlist, so we accept any shape here and rely on the DB
// layer to drop unknown keys. We do enforce the few fields that are typed.
const configUpdateBody = z.object({
  jellyfinUrl: z.string().url().optional(),
  apiKey: z.string().min(1).max(500).optional(),
  scanInterval: z.coerce.number().int().min(0).optional(),
  scanLibraryIds: z.string().optional(),
  maxParallelTests: z.coerce.number().int().min(1).max(100).optional(),
  showPreviews: z.coerce.number().int().min(0).max(1).optional()
}).passthrough();

const deviceBody = z.object({
  name: z.string().min(1).max(200),
  deviceId: z.string().min(1).max(200),
  videoCodec: z.string().max(50).optional(),
  audioCodec: z.string().max(50).optional(),
  maxBitrate: z.coerce.number().int().min(1).optional(),
  maxWidth: z.coerce.number().int().min(1).optional(),
  maxHeight: z.coerce.number().int().min(1).optional(),
  is10bit: z.coerce.boolean().optional()
}).passthrough();

const deviceUpdateBody = deviceBody.partial();

const testRunBody = z.object({
  itemId: z.string().min(1).max(200),
  deviceId: z.coerce.number().int().positive(),
  duration: z.coerce.number().int().min(1).max(86_400).optional()
});

const testRunCreateBody = z.object({
  devices: z.array(z.any()).min(1, 'At least one device is required'),
  mediaItems: z.array(z.any()).optional(),
  mediaScope: z.any().optional(),
  testConfig: z.any().optional(),
  totalTests: z.number().optional()
}).superRefine((val, ctx) => {
  const hasMedia = Array.isArray(val.mediaItems) && val.mediaItems.length > 0;
  if (!hasMedia && !val.mediaScope) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'At least one media item or a media scope is required',
      path: ['mediaItems']
    });
  }
});

const scheduleBody = z.object({
  name: z.string().min(1).max(200),
  frequency: z.enum(['daily', 'weekly']),
  dayOfWeek: z.coerce.number().int().min(0).max(6).optional(),
  timeOfDay: z.string().regex(/^\d{2}:\d{2}$/, 'timeOfDay must be HH:MM')
}).passthrough();

const scheduleUpdateBody = scheduleBody.partial();

module.exports = {
  idParam,
  libraryIdParam,
  itemIdParam,
  paginatedListQuery,
  libraryItemsQuery,
  recentItemsQuery,
  libraryCountQuery,
  streamQuery,
  configTestBody,
  configUpdateBody,
  deviceBody,
  deviceUpdateBody,
  testRunBody,
  testRunCreateBody,
  scheduleBody,
  scheduleUpdateBody
};
