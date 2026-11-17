import { json, Router, type ErrorRequestHandler } from 'express';
import { addAbortListener } from 'node:events';
import { logger } from '../lib/logger.js';
import { parseStudioPack, studioBriefSchema, type StudioBrief } from './drafts.js';

export interface StudioService {
  authenticate: (authorization: string | undefined) => string | null;
  /** Return a retry delay in seconds when the user or deployment quota is exhausted. */
  consumeQuota: (userId: string, signal: AbortSignal) => Promise<number | null>;
  generate: (brief: StudioBrief, signal: AbortSignal) => Promise<string>;
}

async function checkQuota(service: StudioService, userId: string, signal: AbortSignal) {
  signal.throwIfAborted();
  let abortListener: ReturnType<typeof addAbortListener> | undefined;
  try {
    return await Promise.race([
      service.consumeQuota(userId, signal),
      new Promise<never>((_, reject) => { abortListener = addAbortListener(signal, () => reject(signal.reason)); }),
    ]);
  } finally { abortListener?.[Symbol.dispose](); }
}

export function createStudioRouter(service?: StudioService, timeoutMs = 25_000) {
  const router = Router();
  let inFlight = 0;

  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/status', (req, res) => {
    if (!service) { res.json({ mode: 'template', reason: 'unconfigured' }); return; }
    if (!service.authenticate(req.get('Authorization'))) { res.json({ mode: 'template', reason: 'sign-in' }); return; }
    res.json({ mode: 'live' });
  });

  router.post('/drafts', (req, res, next) => {
    if (!service) { res.status(503).json({ code: 'STUDIO_UNAVAILABLE' }); return; }
    const userId = service.authenticate(req.get('Authorization'));
    if (!userId) { res.status(401).json({ code: 'STUDIO_AUTH_REQUIRED' }); return; }
    res.locals['studioUserId'] = userId;
    next();
  }, json({ limit: '8kb', inflate: false }), async (req, res) => {
    if (!service) return;
    const brief = studioBriefSchema.safeParse(req.body);
    if (!brief.success) { res.status(400).json({ code: 'STUDIO_BRIEF_INVALID' }); return; }
    if (inFlight >= 4) { res.set('Retry-After', '5').status(503).json({ code: 'STUDIO_BUSY' }); return; }

    const userId = res.locals['studioUserId'] as string;
    const disconnect = new AbortController();
    const close = () => disconnect.abort();
    res.once('close', close);
    inFlight += 1;
    try {
      let retryAfter: number | null;
      try {
        retryAfter = await checkQuota(service, userId, AbortSignal.any([AbortSignal.timeout(2_000), disconnect.signal]));
      } catch {
        if (!disconnect.signal.aborted) {
          logger.warn('Studio quota check unavailable');
          res.status(503).json({ code: 'STUDIO_BUSY' });
        }
        return;
      }
      if (disconnect.signal.aborted) return;
      if (retryAfter !== null) {
        res.set('Retry-After', String(retryAfter)).status(429).json({ code: 'STUDIO_RATE_LIMITED' });
        return;
      }

      const deadline = AbortSignal.timeout(timeoutMs);
      const signal = AbortSignal.any([deadline, disconnect.signal]);
      try {
        const output = await service.generate(brief.data, signal);
        if (disconnect.signal.aborted) return;
        signal.throwIfAborted();
        res.json({ pack: parseStudioPack(output) });
      } catch {
        if (disconnect.signal.aborted) return;
        if (deadline.aborted) { res.status(504).json({ code: 'STUDIO_TIMEOUT' }); return; }
        // Provider errors and invalid output can contain user text; never log or echo them.
        logger.warn('Studio provider failed or returned an invalid pack');
        res.status(502).json({ code: 'STUDIO_GENERATION_FAILED' });
      }
    } finally {
      inFlight -= 1;
      res.off('close', close);
    }
  });

  const invalidBody: ErrorRequestHandler = (error: { status?: number }, _req, res, next) => {
    if (!error.status || error.status < 400 || error.status >= 500) { next(error); return; }
    res.status(error.status).json({ code: 'STUDIO_BRIEF_INVALID' });
  };
  router.use(invalidBody);
  return router;
}
