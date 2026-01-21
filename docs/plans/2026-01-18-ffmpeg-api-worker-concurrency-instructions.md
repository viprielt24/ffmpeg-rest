# FFmpeg API: Enable Parallel Worker Processing

**Date:** 2026-01-18
**Priority:** High
**Estimated Time:** 15 minutes

---

## Summary

Change the BullMQ worker concurrency from 1 to 4 to enable parallel video muxing. This allows the client to send multiple mux requests simultaneously, reducing total processing time by ~3-4x.

---

## Why This Change

Currently, the FFmpeg API processes jobs one at a time. When a user clicks "Mux All Scenes" for a 10-scene video:

| Current (sequential) | After (parallel) |
|---------------------|------------------|
| 10 jobs × 30 sec = **5 minutes** | 3 batches × 30 sec = **1.5 minutes** |

The client will send up to 4 concurrent requests. Without this change, they'll queue up and still process sequentially.

---

## What to Change

### Locate the BullMQ Worker

Find where the BullMQ Worker is initialized. It likely looks like:

```typescript
import { Worker } from 'bullmq';

const worker = new Worker(
  'ffmpeg-jobs',  // queue name
  async (job) => {
    // job processing logic
  },
  {
    connection: redisConnection,
    // other options...
  }
);
```

### Add Concurrency Option

Add `concurrency: 4` to the worker options:

```typescript
const worker = new Worker(
  'ffmpeg-jobs',
  async (job) => {
    // job processing logic (no changes needed here)
  },
  {
    connection: redisConnection,
    concurrency: 4,  // ← ADD THIS LINE
  }
);
```

That's it. No other code changes required.

---

## Why 4 Workers?

Railway hobby plan specs: **8 vCPU / 8 GB RAM**

Each FFmpeg mux operation uses:
- ~1-2 CPU cores during encoding
- ~500 MB RAM

With 4 concurrent workers:
- CPU: 4-8 cores utilized (within 8 vCPU limit)
- RAM: ~2 GB used (within 8 GB limit)
- Leaves headroom for API server and Redis

**If you see memory pressure:** Reduce to `concurrency: 3`

---

## Deployment

1. Make the change
2. Commit: `git commit -m "feat: increase worker concurrency to 4 for parallel processing"`
3. Push to main (Railway auto-deploys)
4. Monitor Railway dashboard for successful deployment

---

## Verification

### Check Logs

After deployment, when multiple mux jobs come in, you should see interleaved logs like:

```
[Worker] Starting job abc123 (mux)
[Worker] Starting job def456 (mux)
[Worker] Starting job ghi789 (mux)
[Worker] Starting job jkl012 (mux)
[Worker] Completed job abc123 (4.2s)
[Worker] Starting job mno345 (mux)  ← New job starts immediately
[Worker] Completed job def456 (4.5s)
...
```

### Check Railway Metrics

During parallel processing:
- CPU should spike to 50-80% (was ~15-25% with single worker)
- Memory should stay under 4 GB

---

## Rollback

If issues occur, change back to:

```typescript
concurrency: 1
```

Push and redeploy. This immediately reverts to sequential processing.

---

## Questions?

Contact the leads-management team if anything is unclear.
