import express, { Router, type ErrorRequestHandler, type RequestHandler } from 'express';
import { z } from 'zod';
import type { AgentSkillUpdate } from '../../../shared/types/index.js';
import { MAX_SKILLS, parseRepository, SkillError, type Repository, type SkillDraft } from './metadata.js';
import { skillSnapshot, type SkillStore } from './store.js';

interface SkillSession { roomId: string; userId: string }
export interface SkillsRouterOptions {
  available: () => boolean;
  authenticate: (token: string) => SkillSession | null;
  hasAgent: (roomId: string, agentId: string) => boolean | Promise<boolean>;
  consumeQuota: (kind: 'import' | 'activate', userId: string, signal: AbortSignal) => Promise<number | null>;
  importGitHub: (repo: Repository, signal: AbortSignal) => Promise<SkillDraft>;
  store: SkillStore;
  publish: (event: AgentSkillUpdate) => void;
}

const agentIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/u);
const importSchema = z.strictObject({ url: z.string().trim().min(1).max(240) });
const activationSchema = z.strictObject({ active: z.boolean() });
const parseJson = express.json({ limit: '4kb' });
const invalid = () => new SkillError('INVALID_REQUEST', 400);

export function createSkillsRouter(options: SkillsRouterOptions) {
  const router = Router({ mergeParams: true });
  let inFlight = 0;

  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!options.available()) { next(new SkillError('SKILLS_UNAVAILABLE', 503)); return; }
    const token = req.header('authorization')?.match(/^Bearer\s+(\S{1,4096})$/iu)?.[1];
    const session = token ? options.authenticate(token) : null;
    if (!session) { next(new SkillError('SIGN_IN_REQUIRED', 401)); return; }
    res.locals['skillSession'] = session;
    next();
  });

  function handler(action: 'read' | 'import' | 'activate'): RequestHandler {
    return async (req, res, next) => {
      const session = res.locals['skillSession'] as SkillSession;
      const controller = new AbortController();
      const abort = () => controller.abort();
      res.once('close', abort);
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(14_000)]);
      try {
        const agentId = agentIdSchema.safeParse(req.params['agentId']);
        if (!agentId.success) throw invalid();
        const id = agentId.data;
        if (!await options.hasAgent(session.roomId, id)) throw new SkillError('AGENT_NOT_FOUND', 404);
        signal.throwIfAborted();
        if (action === 'read') {
          const catalog = await options.store.get(session.roomId, id);
          if (!controller.signal.aborted) res.json(catalog);
          return;
        }

        if (action === 'import') {
          const body = importSchema.safeParse(req.body);
          if (!body.success) throw invalid();
          const repository = parseRepository(body.data.url);
          const current = await options.store.get(session.roomId, id);
          const existing = current.skills.find((skill) => skill.source.repository === repository.fullName);
          if (existing) { res.json({ ...current, skillId: existing.id, reused: true }); return; }
          if (current.skills.length >= MAX_SKILLS) throw new SkillError('SKILL_LIMIT', 409);
          if (inFlight >= 3) throw new SkillError('SKILLS_BUSY', 503, 5);
          inFlight++;
          try {
            const retry = await options.consumeQuota('import', session.userId, signal);
            if (retry) throw new SkillError('RATE_LIMITED', 429, retry);
            signal.throwIfAborted();
            const skill = await options.importGitHub(repository, signal);
            signal.throwIfAborted();
            const { catalog, created } = await options.store.add(session.roomId, id, skill);
            if (created) options.publish({ roomId: session.roomId, agentId: id, ...skillSnapshot(catalog) });
            const saved = catalog.skills.find((item) => item.source.repository === repository.fullName);
            if (!controller.signal.aborted) res.status(created ? 201 : 200).json({ ...catalog, skillId: saved?.id, reused: !created });
          } finally { inFlight--; }
          return;
        }

        const activation = activationSchema.safeParse(req.body);
        const skillId = z.uuid().safeParse(req.params['skillId']);
        if (!activation.success || !skillId.success) throw invalid();
        const retry = await options.consumeQuota('activate', session.userId, signal);
        if (retry) throw new SkillError('RATE_LIMITED', 429, retry);
        signal.throwIfAborted();
        const catalog = await options.store.activate(session.roomId, id, skillId.data, activation.data.active);
        options.publish({ roomId: session.roomId, agentId: id, ...skillSnapshot(catalog) });
        if (!controller.signal.aborted) res.json(catalog);
      } catch (error) { if (!controller.signal.aborted) next(error); }
      finally { res.off('close', abort); }
    };
  }

  router.get('/', handler('read'));
  router.post('/import-github', parseJson, handler('import'));
  router.patch('/:skillId', parseJson, handler('activate'));
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (res.headersSent || res.destroyed) return;
    const bodyError = error as { type?: unknown };
    const failure = error instanceof SkillError ? error : bodyError.type === 'entity.too.large' ? new SkillError('INVALID_REQUEST', 413)
      : bodyError.type === 'entity.parse.failed' ? invalid() : new SkillError('SKILLS_BUSY', 503);
    if (failure.retryAfter) res.setHeader('Retry-After', String(failure.retryAfter));
    res.status(failure.status).json({ code: failure.code });
  };
  router.use(errors);
  return router;
}
