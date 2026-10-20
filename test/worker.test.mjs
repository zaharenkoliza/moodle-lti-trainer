import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { gradeAnswers, oauthSignature } from '../worker/index.js';

const origin = 'https://liza.example.test';
const env = { LTI_CONSUMER_KEY: 'liza-web-course', LTI_SHARED_SECRET: 'test-shared-secret', SESSION_SECRET: 'test-cookie-secret' };

test('three original questions have weights 3/3/4 and are graded on the server', () => {
  assert.equal(gradeAnswers({ js: 'Promise', http: 'POST', voice: 'SpeechRecognition' }).points, 10);
  assert.equal(gradeAnswers({ js: 'Строку JSON', http: 'POST', voice: 'MediaRecorder' }).points, 3);
});

test('signed Moodle LTI launch, learner session and grade passback', async () => {
  const params = new URLSearchParams({
    oauth_consumer_key: env.LTI_CONSUMER_KEY,
    oauth_nonce: 'nonce-one',
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: '1.0',
    user_id: 'student-42',
    resource_link_id: 'resource-2',
    context_id: 'course-2',
    roles: 'Learner',
    lis_outcome_service_url: 'https://zaharenkoliza.gnomio.com/mod/lti/service.php',
    lis_result_sourcedid: 'result-42'
  });
  params.set('oauth_signature', await oauthSignature('POST', origin + '/lti/launch', [...params.entries()], env.LTI_SHARED_SECRET));
  const launch = await worker.fetch(new Request(origin + '/lti/launch', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params }), env);
  assert.equal(launch.status, 303);
  const cookie = launch.headers.get('Set-Cookie').split(';')[0];
  const session = JSON.parse(Buffer.from(cookie.split('=')[1].split('.')[0], 'base64url').toString());
  const trainer = await worker.fetch(new Request(origin + '/trainer', { headers: { Cookie: cookie } }), env);
  assert.equal(trainer.status, 200);
  assert.match(await trainer.text(), /Голосовой интерфейс/);

  const originalFetch = globalThis.fetch;
  let sentXml = '';
  try {
    globalThis.fetch = async (_url, options) => {
      sentXml = options.body;
      assert.match(options.headers.Authorization, /^OAuth /);
      return new Response('<imsx_POXEnvelopeResponse><imsx_codeMajor>success</imsx_codeMajor></imsx_POXEnvelopeResponse>');
    };
    const scored = await worker.fetch(new Request(origin + '/api/submit', {
      method: 'POST',
      headers: { Cookie: cookie, Origin: origin, 'X-CSRF-Token': session.csrf, 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: { js: 'Promise', http: 'POST', voice: 'SpeechRecognition' } })
    }), env);
    assert.equal(scored.status, 200);
    assert.equal((await scored.json()).points, 10);
    assert.match(sentXml, /<textString>1\.0<\/textString>/);
    assert.match(sentXml, /result-42/);
  } finally { globalThis.fetch = originalFetch; }
});

test('unsigned launches and anonymous grade requests are rejected', async () => {
  const launch = await worker.fetch(new Request(origin + '/lti/launch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ oauth_consumer_key: env.LTI_CONSUMER_KEY, oauth_signature_method: 'HMAC-SHA1', oauth_version: '1.0', oauth_nonce: 'x', oauth_timestamp: String(Math.floor(Date.now() / 1000)) })
  }), env);
  assert.equal(launch.status, 403);
  const submit = await worker.fetch(new Request(origin + '/api/submit', { method: 'POST', headers: { Origin: origin }, body: '{}' }), env);
  assert.equal(submit.status, 401);
});
