import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, verify, createPublicKey, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { createTool, registerMoodle } from '../src/tool.mjs';
import { MemoryDatabase } from './memory-database.mjs';
import { tasks } from '../src/grading.mjs';
const CLAIM = 'https://purl.imsglobal.org/spec/lti/claim/';
const AGS = 'https://purl.imsglobal.org/spec/lti-ags/';
const LEARNER = 'http://purl.imsglobal.org/vocab/lis/v2/membership#Learner';
const jwt = (payload, key) => {
  const enc = x => Buffer.from(JSON.stringify(x)).toString('base64url');
  const body = enc({ alg: 'RS256', kid: 'fake-moodle-key', typ: 'JWT' }) + '.' + enc(payload);
  return body + '.' + sign('RSA-SHA256', Buffer.from(body), key).toString('base64url');
};
const claims = token => JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));

test('signed LTI launch, AGS, isolation, replay and failure recovery', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'lti-lab-'));
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...keys.publicKey.export({ format: 'jwk' }), alg: 'RS256', use: 'sig', kid: 'fake-moodle-key' };
  const platformApp = express(); platformApp.use(express.urlencoded({ extended: false }));
  platformApp.use(express.json({ type: ['application/json', 'application/*+json'] }));
  const platformServer = createServer(platformApp);
  await new Promise(resolve => platformServer.listen(0, '127.0.0.1', resolve));
  const issuer = 'http://127.0.0.1:' + platformServer.address().port;
  const reserve = createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
  const base = 'http://127.0.0.1:' + port;
  const config = { port, publicUrl: base, label: 'Test', dataDir, issuer, clientId: 'client-1', deploymentId: 'deployment-1',
    authUrl: issuer + '/auth', tokenUrl: issuer + '/token', jwksUrl: issuer + '/jwks' };
  const db = new MemoryDatabase();
  const { provider, timer } = createTool(config, db);
  const received = []; let rejectScore = false;
  platformApp.get('/jwks', (_req, res) => res.json({ keys: [jwk] }));
  platformApp.post('/token', async (req, res) => {
    const platform = await provider.platformManager.getPlatformByUrlAndClientId(issuer, config.clientId);
    const token = req.body.client_assertion;
    const pieces = token.split('.');
    assert.ok(verify('RSA-SHA256', Buffer.from(pieces.slice(0, 2).join('.')), createPublicKey(platform.keys.public), Buffer.from(pieces[2], 'base64url')));
    assert.equal(claims(token).aud, config.tokenUrl); assert.equal(claims(token).sub, config.clientId);
    assert.equal(req.body.scope, AGS + 'scope/score');
    res.json({ access_token: 'fake-access', token_type: 'Bearer', expires_in: 3600 });
  });
  platformApp.post('/lineitem/scores', (req, res) => {
    assert.equal(req.query.type_id, '7'); assert.equal(req.get('authorization'), 'Bearer fake-access');
    assert.match(req.get('content-type'), /application\/vnd\.ims\.lis\.v1\.score\+json/);
    if (rejectScore) return res.status(503).json({ error: 'Test outage' });
    received.push(req.body); res.sendStatus(204);
  });
  let replayBody;
  async function launch(user, role = LEARNER, deployment = config.deploymentId) {
    const login = new URL('/lti/login', base);
    for (const [key, value] of Object.entries({ iss: issuer, client_id: config.clientId, login_hint: user, target_link_uri: base + '/lti/launch' })) login.searchParams.set(key, value);
    const response = await fetch(login); const html = await response.text();
    assert.equal(response.status, 200);
    const data = JSON.parse(html.match(/id="ltijs-login-data">([\s\S]*?)<\/script>/)[1]);
    const auth = new URL(data.targetUrl); const now = Math.floor(Date.now() / 1000);
    const payload = { iss: issuer, aud: config.clientId, sub: user, iat: now, exp: now + 300, nonce: auth.searchParams.get('nonce'),
      [CLAIM + 'version']: '1.3.0', [CLAIM + 'message_type']: 'LtiResourceLinkRequest',
      [CLAIM + 'deployment_id']: deployment, [CLAIM + 'roles']: [role],
      [CLAIM + 'target_link_uri']: base + '/lti/launch', [CLAIM + 'resource_link']: { id: 'activity-1' },
      [CLAIM + 'context']: { id: 'course-1' },
      [AGS + 'claim/endpoint']: { scope: [AGS + 'scope/score'], lineitem: issuer + '/lineitem?type_id=7' }
    };
    const body = new URLSearchParams({ state: data.state, id_token: jwt(payload, keys.privateKey), ltijs_recovered_state: data.recoveryToken });
    replayBody = body;
    const launchResponse = await fetch(base + '/lti/launch', { method: 'POST', body, headers: { 'Sec-Fetch-Site': 'same-origin' }, redirect: 'manual' });
    if (deployment !== config.deploymentId) { assert.equal(launchResponse.status, 403); return; }
    assert.equal(launchResponse.status, 302, await launchResponse.text());
    const start = await fetch(new URL(launchResponse.headers.get('location'), base), { redirect: 'manual' });
    assert.equal(start.status, 303);
    const cookie = start.headers.get('set-cookie').split(';')[0];
    const session = await (await fetch(base + '/api/session', { headers: { cookie } })).json();
    return { cookie, session };
  }
  async function post(client, route, body, overrides = {}) {
    return fetch(base + route, { method: 'POST', headers: { cookie: client.cookie, Origin: base,
      'X-CSRF-Token': client.session.csrf, 'Content-Type': 'application/json', ...overrides }, body: JSON.stringify(body) });
  }
  try {
    await provider.listen({ silent: true }); await registerMoodle(provider, config);
    assert.equal((await fetch(base + '/api/session')).status, 401);
    assert.equal((await fetch(base + '/app')).status, 401);
    const a = await launch('learner-a');
    const replay = await fetch(base + '/lti/launch', { method: 'POST', body: replayBody, headers: { 'Sec-Fetch-Site': 'same-origin' }, redirect: 'manual' });
    assert.equal(replay.status, 400);
    const correctAnswers = Object.fromEntries(tasks.map(t => [t.id, t.answer]));
    const body = { requestId: randomUUID(), answers: { ...correctAnswers, q1: ' ' + correctAnswers.q1.toUpperCase() + ' ' } };
    assert.equal((await post(a, '/api/submit', { ...body, userId: 'learner-b' })).status, 400);
    assert.equal((await post(a, '/api/submit', body, { 'X-CSRF-Token': 'wrong' })).status, 403);
    let response = await post(a, '/api/submit', body); assert.equal(response.status, 200, await response.clone().text());
    assert.equal(received.length, 1); assert.equal(received[0].userId, 'learner-a'); assert.equal(received[0].scoreGiven, 10);
    assert.equal((await post(a, '/api/submit', body)).status, 200); assert.equal(received.length, 1);
    const b = await launch('learner-b'); assert.equal(b.session.current, null);
    response = await post(b, '/api/submit', { requestId: randomUUID(), answers: { q1: '', q2: '', q3: '' } });
    assert.equal(response.status, 200); assert.equal(received.at(-1).userId, 'learner-b'); assert.equal(received.at(-1).scoreGiven, 0);
    const instructor = await launch('teacher', 'http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor');
    assert.equal((await post(instructor, '/api/submit', body)).status, 403);
    await launch('wrong-deployment', LEARNER, 'other-deployment');
    await post(a, '/api/new-attempt', {}); rejectScore = true;
    const pendingBody = { requestId: randomUUID(), answers: { ...correctAnswers, q2: '__wrong__' } };
    response = await post(a, '/api/submit', pendingBody); assert.equal(response.status, 502);
    const pending = (await response.json()).current; assert.equal(pending.scoreGiven, 7); assert.equal(pending.sentAt, null);
    assert.equal((await post(a, '/api/new-attempt', {})).status, 409);
    rejectScore = false; response = await post(a, '/api/submit', pendingBody);
    assert.equal(response.status, 200); const sent = (await response.json()).current;
    assert.equal(sent.id, pending.id); assert.equal(sent.createdAt, pending.createdAt); assert.ok(sent.sentAt);
    assert.ok(Date.parse(sent.lastDeliveryAt) > Date.parse(pending.lastDeliveryAt));
    const aState = await (await fetch(base + '/api/session', { headers: { cookie: a.cookie } })).json();
    assert.equal(aState.history.length, 1); assert.equal(aState.current.scoreGiven, 7);
  } finally {
    clearInterval(timer); await provider.close();
    await new Promise(resolve => platformServer.close(resolve)); await rm(dataDir, { recursive: true, force: true });
  }
});
