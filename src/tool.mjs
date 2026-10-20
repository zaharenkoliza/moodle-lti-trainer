import { Provider, IdTokenValidationMethod } from 'ltijs';
import express from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Store, MongoStore } from './store.mjs';
import { tasks, grade } from './grading.mjs';

const LEARNER = 'http://purl.imsglobal.org/vocab/lis/v2/membership#Learner';
const SCORE_SCOPE = 'https://purl.imsglobal.org/spec/lti-ags/scope/score';
const COOKIE = '__Host-lti_lab';
const fail = (status, message) => Object.assign(new Error(message), { status });
const secret = () => randomBytes(32).toString('hex');

export function createTool(config, databaseManager) {
  const provider = new Provider({
    ...(databaseManager ? { databaseManager } : { database: { url: config.mongoUrl } }),
    server: { port: config.port, cors: false },
    routes: { loginRoute: '/lti/login', launchRoute: '/lti/launch', keysetRoute: '/lti/keys' }
  });
  const app = provider.httpHandler.app;
  const store = config.mongoUrl && !databaseManager
    ? new MongoStore(config.mongoUrl, config.attemptsDbName)
    : new Store(config.dataDir);
  const tickets = new Map();
  const sessions = new Map();
  const origin = new URL(config.publicUrl).origin;
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use('/app', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; object-src 'none'");
    next();
  });
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  function validateLaunch(context) {
    const token = context.idToken;
    if (token.platform.url !== config.issuer || token.platform.clientId !== config.clientId ||
        token.platform.deploymentId !== config.deploymentId) {
      throw fail(403, 'Неверная регистрация или Deployment ID.');
    }
    if (!token.user.id || !token.launch.resource?.id || !token.launch.context?.id) {
      throw fail(400, 'В запуске нет пользователя, ресурса или контекста курса.');
    }
    return token;
  }
  function identityKey(token) {
    return createHash('sha256').update(JSON.stringify([
      token.platform.url, token.platform.clientId, token.platform.deploymentId,
      token.user.id, token.launch.context.id, token.launch.resource.id
    ])).digest('hex');
  }
  provider.onResourceLink(async (context, _request, response) => {
    try {
      const token = validateLaunch(context);
      const ticket = secret();
      tickets.set(ticket, { context, token, expires: Date.now() + 30000 });
      response.redirect('/app/start?ticket=' + ticket);
    } catch (error) { response.status(error.status ?? 500).json({ error: error.message }); }
  });
  app.get('/healthz', (_req, res) => res.json({ ok: true, configured: Boolean(config.clientId) }));
  app.get('/tool-public-key', async (_req, res, next) => {
    try {
      const platform = await provider.platformManager.getPlatformByUrlAndClientId(config.issuer, config.clientId);
      if (!platform) return res.status(503).send('Сначала укажите Client ID и перезапустите приложение.');
      res.type('text/plain').send(await provider.platformManager.getPublicKey(platform));
    } catch (error) { next(error); }
  });
  app.get('/app/start', (req, res) => {
    const ticket = tickets.get(req.query.ticket);
    tickets.delete(req.query.ticket);
    if (!ticket || ticket.expires < Date.now()) return res.status(401).send('Откройте тренажер заново из Moodle.');
    const sid = secret();
    sessions.set(sid, {
      ltik: ticket.context.ltik, key: identityKey(ticket.token),
      csrf: secret(), expires: Date.now() + 45 * 60000
    });
    res.cookie(COOKIE, sid, { secure: true, httpOnly: true, sameSite: 'lax', path: '/', maxAge: 45 * 60000 });
    res.redirect(303, '/app');
  });
  const timer = setInterval(() => {
    for (const [key, item] of tickets) if (item.expires < Date.now()) tickets.delete(key);
    for (const [key, item] of sessions) if (item.expires < Date.now()) sessions.delete(key);
  }, 60000);
  timer.unref();

  app.use(['/app', '/api'], async (req, res, next) => {
    try {
      const sid = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
      const session = sessions.get(sid);
      if (!session || session.expires < Date.now()) throw fail(401, 'Откройте тренажер из Moodle. Сессия длится 45 минут.');
      const context = await provider.getLaunchContext(session.ltik);
      const token = validateLaunch(context);
      if (identityKey(token) !== session.key) throw fail(403, 'Контекст запуска изменился.');
      if (req.method === 'POST') {
        if (!token.user.roles.includes(LEARNER)) throw fail(403, 'Оценку отправляет только роль Learner.');
        if (req.get('origin') !== origin || req.get('x-csrf-token') !== session.csrf) throw fail(403, 'Неверный источник запроса или CSRF-токен.');
      }
      req.lab = { session, context, token };
      next();
    } catch (error) { next(error); }
  });
  app.get('/app', (_req, res) => res.sendFile(fileURLToPath(new URL('../public/index.html', import.meta.url))));
  app.use('/assets', express.static(fileURLToPath(new URL('../public/', import.meta.url)), { dotfiles: 'deny', index: false }));
  app.get('/api/session', async (req, res, next) => {
    try {
      const { token, session } = req.lab;
      const data = await store.read(session.key);
      res.json({
        label: config.label, userId: token.user.id, name: token.user.name ?? token.user.id,
        roles: token.user.roles, course: token.launch.context.id, resource: token.launch.resource.id,
        learner: token.user.roles.includes(LEARNER), csrf: session.csrf,
        agsReady: token.services.assignmentAndGrades.available &&
          Boolean(token.services.assignmentAndGrades.lineItemId) &&
          token.services.assignmentAndGrades.scopes?.includes(SCORE_SCOPE),
        tasks: tasks.map(({ id, prompt, points }) => ({ id, prompt, points })),
        current: data.current, history: data.history
      });
    } catch (error) { next(error); }
  });
  app.post('/api/new-attempt', async (req, res, next) => {
    try {
      if (Object.keys(req.body).length) throw fail(400, 'Тело запроса должно быть пустым объектом.');
      const key = req.lab.session.key;
      const result = await store.exclusive(key, async () => {
        const data = await store.read(key);
        if (data.current && !data.current.sentAt) throw fail(409, 'Сначала повторите отправку сохраненной оценки.');
        if (data.current) data.history.push(data.current);
        data.current = null;
        await store.save(key, data);
        return { ok: true };
      });
      res.json(result);
    } catch (error) { next(error); }
  });
  app.post('/api/submit', async (req, res, next) => {
    try {
      const { answers, requestId } = req.body;
      if (Object.keys(req.body).some(key => !['answers', 'requestId'].includes(key))) {
        throw fail(400, 'Разрешены только answers и requestId.');
      }
      if (typeof requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(requestId)) throw fail(400, 'Нужен UUID requestId.');
      const calculated = grade(answers);
      const { context, token, session } = req.lab;
      const ags = token.services.assignmentAndGrades;
      if (!ags.available || !ags.lineItemId || !ags.scopes?.includes(SCORE_SCOPE)) {
        throw fail(409, 'Нет AGS line item или scope score. Проверьте настройки элемента Moodle и повторите запуск.');
      }
      const result = await store.exclusive(session.key, async () => {
        const data = await store.read(session.key);
        const answerSignature = JSON.stringify(tasks.map(t => answers[t.id]));
        if (data.current) {
          if (data.current.requestId !== requestId || data.current.answerSignature !== answerSignature) {
            throw fail(409, 'Попытка уже сохранена. Для нового ответа нажмите Новая попытка.');
          }
          if (data.current.sentAt) return { ok: true, duplicate: true, current: data.current };
        } else {
          data.current = {
            id: randomUUID(), requestId, answerSignature, answers, ...calculated,
            createdAt: new Date().toISOString(), sentAt: null, status: 'pending'
          };
          await store.save(session.key, data);
        }
        const attempt = data.current;
        const previousTimestamp = Date.parse(data.lastScoreTimestamp ?? '1970-01-01T00:00:00.000Z');
        const deliveryTimestamp = new Date(Math.max(Date.now(), previousTimestamp + 1)).toISOString();
        data.lastScoreTimestamp = deliveryTimestamp;
        attempt.lastDeliveryAt = deliveryTimestamp;
        await store.save(session.key, data);
        try {
          await context.grading.submitScore(ags.lineItemId, {
            userId: token.user.id,
            scoreGiven: attempt.scoreGiven,
            scoreMaximum: attempt.scoreMaximum,
            activityProgress: 'Completed', gradingProgress: 'FullyGraded',
            timestamp: deliveryTimestamp
          });
          attempt.sentAt = new Date().toISOString();
          attempt.status = 'sent';
          await store.save(session.key, data);
          return { ok: true, current: attempt };
        } catch (error) {
          console.error('AGS не подтвердил оценку:', error.name ?? 'Error');
          return { ok: false, current: attempt, error: 'Оценка сохранена в тренажере. Moodle не подтвердил прием. Повторите отправку.' };
        }
      });
      res.status(result.ok ? 200 : 502).json(result);
    } catch (error) { next(error); }
  });
  app.use((error, _req, res, _next) => {
    res.status(error.status ?? 500).json({ error: error.status ? error.message : 'Внутренняя ошибка приложения.' });
  });
  return { provider, store, timer };
}

export async function registerMoodle(provider, config) {
  if (!config.clientId) return;
  const registration = {
    url: config.issuer, clientId: config.clientId, name: 'Moodle',
    authenticationEndpoint: config.authUrl, accessTokenEndpoint: config.tokenUrl,
    idTokenValidation: { method: IdTokenValidationMethod.JwkSet, key: config.jwksUrl }
  };
  const current = await provider.platformManager.getPlatformByUrlAndClientId(config.issuer, config.clientId);
  const platform = current
    ? await provider.platformManager.updatePlatform(current, registration)
    : await provider.platformManager.registerPlatform(registration);
  await provider.platformManager.activatePlatform(platform);
}
