const MOODLE = 'https://zaharenkoliza.gnomio.com';
const QUESTIONS = [
  { id: 'js', topic: 'JavaScript', points: 3, prompt: 'Что возвращает вызов fetch("/api/tasks") до обработки ответа?', choices: ['Массив объектов', 'Promise', 'Строку JSON'], answer: 'Promise', explanation: 'fetch() возвращает Promise, который разрешается объектом Response.' },
  { id: 'http', topic: 'HTTP', points: 3, prompt: 'Какой метод подходит для отправки нового ответа студента на сервер?', choices: ['POST', 'GET', 'HEAD'], answer: 'POST', explanation: 'POST передаёт данные в теле запроса и подходит для создания попытки.' },
  { id: 'voice', topic: 'Голосовой интерфейс', points: 4, prompt: 'Какой браузерный API распознаёт произнесённый ответ при подготовке к ЕГЭ?', choices: ['SpeechRecognition', 'SpeechSynthesis', 'MediaRecorder'], answer: 'SpeechRecognition', explanation: 'SpeechRecognition преобразует речь в текст; SpeechSynthesis озвучивает текст.' }
];
const enc = new TextEncoder();
const str = x => String(x == null ? '' : x);
const escapeHtml = x => str(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pct = x => encodeURIComponent(str(x)).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const b64url = x => btoa(String.fromCharCode(...new Uint8Array(x))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = x => Uint8Array.from(atob(x.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - x.length % 4) % 4)), c => c.charCodeAt(0));
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
const documentReply = (value, status = 200) => new Response(value, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" } });

async function hmac(hash, secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, enc.encode(message));
}
function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
function normalizedParams(pairs) {
  return pairs.filter(([key]) => key !== 'oauth_signature')
    .map(([key, value]) => [pct(key), pct(value)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(pair => pair.join('=')).join('&');
}
function signatureBase(method, address, pairs) {
  const url = new URL(address);
  const base = url.origin.toLowerCase() + url.pathname;
  return [method.toUpperCase(), pct(base), pct(normalizedParams([...pairs, ...url.searchParams.entries()]))].join('&');
}
async function oauthSignature(method, address, pairs, secret) {
  const bytes = await hmac('SHA-1', pct(secret) + '&', signatureBase(method, address, pairs));
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}
async function signSession(data, secret) {
  const payload = b64url(enc.encode(JSON.stringify(data)));
  return payload + '.' + b64url(await hmac('SHA-256', secret, payload));
}
async function readSession(request, secret) {
  const cookie = request.headers.get('Cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith('__Host-liza-lti='));
  if (!cookie || cookie.length > 8192) return null;
  const [payload, mac, extra] = cookie.slice(16).split('.');
  if (!payload || !mac || extra) return null;
  const expected = new Uint8Array(await hmac('SHA-256', secret, payload));
  if (!equalBytes(expected, unb64url(mac))) return null;
  const data = JSON.parse(new TextDecoder().decode(unb64url(payload)));
  return data.expires > Date.now() ? data : null;
}
function layout(title, content, script = '') {
  const css = ':root{font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;color:#1b2940;background:#f5f8fc}*{box-sizing:border-box}body{margin:0}main{max-width:920px;margin:0 auto;padding:48px 20px 80px}header{background:#14395f;color:#fff;padding:32px 20px}header>div{max-width:920px;margin:auto}.eyebrow{font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:800;color:#64d5d0}h1{font-size:clamp(28px,4vw,42px);line-height:1.14;margin:8px 0 10px}h2{font-size:22px;margin:0 0 10px}p{line-height:1.58}.lead{max-width:660px;color:#d5e5f2;margin:0}.card{background:#fff;border:1px solid #dce7f1;border-radius:18px;padding:26px;margin:18px 0;box-shadow:0 8px 25px #23415e0c}.step{color:#197a83;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.choices{display:grid;gap:10px;margin-top:18px}.choice{display:flex;align-items:center;gap:12px;border:1px solid #dce7f1;border-radius:12px;padding:14px;cursor:pointer}.choice:has(input:checked){border-color:#117d85;background:#e9f8f7}input[type=radio]{accent-color:#0e8389;width:18px;height:18px}input[type=text],input[type=password],select{width:100%;max-width:620px;padding:12px 14px;border:1px solid #a8bed0;border-radius:10px;font:inherit}label.field{display:block;font-weight:700;margin:16px 0 6px}button{background:#0d7880;color:#fff;border:0;border-radius:11px;padding:13px 19px;font:inherit;font-weight:750;cursor:pointer}button:disabled{opacity:.5;cursor:wait}.muted{color:#60758a}.error{color:#a52837}.success{color:#116657}.result{border-left:4px solid #0d7880;padding-left:16px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:12px;border-bottom:1px solid #e2eaf2}th{background:#edf5f9}nav a{color:#b9f7ed;margin-right:18px}a{color:#126d82}.small{font-size:13px}output{display:block;margin-top:16px}details{margin-top:20px}@media(max-width:600px){main{padding-top:25px}.card{padding:20px}}';
  return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escapeHtml(title) + '</title><style>' + css + '</style></head><body><header><div><h1>' + escapeHtml(title) + '</h1></div></header><main>' + content + '</main>' + (script ? '<script>' + script + '</script>' : '') + '</body></html>';
}
async function launch(request, env) {
  if (!env.LTI_CONSUMER_KEY || !env.LTI_SHARED_SECRET || !env.SESSION_SECRET) return reply({ error: 'LTI ещё не настроен.' }, 503);
  const body = await request.text();
  if (body.length > 30000 || !request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded')) return reply({ error: 'Некорректный запуск LTI.' }, 400);
  const form = new URLSearchParams(body);
  const timestamp = Number(form.get('oauth_timestamp'));
  if (form.get('oauth_consumer_key') !== env.LTI_CONSUMER_KEY || form.get('oauth_signature_method') !== 'HMAC-SHA1' || form.get('oauth_version') !== '1.0' || !form.get('oauth_nonce') || !Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) return reply({ error: 'Недействительный запуск LTI.' }, 403);
  const actual = form.get('oauth_signature') || '';
  const expected = await oauthSignature('POST', request.url, [...form.entries()], env.LTI_SHARED_SECRET);
  if (!equalBytes(enc.encode(actual), enc.encode(expected))) return reply({ error: 'Неверная подпись LTI.' }, 403);
  if (!form.get('user_id') || !form.get('resource_link_id') || !form.get('context_id')) return reply({ error: 'В запуске нет данных курса.' }, 400);
  const outcome = form.get('lis_outcome_service_url') || '';
  try { if (outcome && new URL(outcome).origin !== MOODLE) return reply({ error: 'Некорректный адрес журнала оценок.' }, 403); }
  catch { return reply({ error: 'Некорректный адрес журнала оценок.' }, 403); }
  const session = { name: form.get('lis_person_name_full') || 'Студент', roles: form.get('roles') || '', user: form.get('user_id'), course: form.get('context_id'), resource: form.get('resource_link_id'), outcome, sourcedid: form.get('lis_result_sourcedid') || '', csrf: crypto.randomUUID(), expires: Date.now() + 45 * 60000 };
  const token = await signSession(session, env.SESSION_SECRET);
  return new Response(null, { status: 303, headers: { Location: '/trainer', 'Set-Cookie': '__Host-liza-lti=' + token + '; Secure; HttpOnly; SameSite=None; Path=/; Max-Age=2700', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
function trainer(session) {
  const blocks = QUESTIONS.map((q, index) => '<section class="card"><div class="step">Вопрос ' + (index + 1) + ' · ' + q.points + ' балла · ' + escapeHtml(q.topic) + '</div><h2>' + escapeHtml(q.prompt) + '</h2><div class="choices">' + q.choices.map(choice => '<label class="choice"><input type="radio" name="' + q.id + '" value="' + escapeHtml(choice) + '" required><span>' + escapeHtml(choice) + '</span></label>').join('') + '</div></section>').join('');
  const script = 'const form=document.querySelector("#quiz"),out=document.querySelector("#result");form.addEventListener("submit",async e=>{e.preventDefault();const button=form.querySelector("button");button.disabled=true;out.textContent="Проверяем ответы и отправляем оценку в Moodle…";try{const response=await fetch("/api/submit",{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":' + JSON.stringify(session.csrf) + '},body:JSON.stringify({answers:Object.fromEntries(new FormData(form))})});const data=await response.json();if(!response.ok)throw Error(data.error||"Не удалось отправить оценку.");out.className="result success";out.replaceChildren();const title=document.createElement("h2");title.textContent="Результат: "+data.points+"/10";out.append(title);for(const item of data.details){const p=document.createElement("p");p.textContent=(item.correct?"✓ ":"✗ ")+item.topic+": "+item.explanation;out.append(p)}const note=document.createElement("p");note.textContent="Оценка передана в журнал Moodle.";out.append(note)}catch(error){out.className="result error";out.textContent=error.message}finally{button.disabled=false}});';
  return layout('Тренажёр: веб-технологии', '<p class="muted">Участник: ' + escapeHtml(session.name) + '. Максимум — 10 баллов. Повторная отправка обновляет результат в Moodle.</p><form id="quiz">' + blocks + '<button type="submit">Проверить и отправить в Moodle</button></form><output id="result" aria-live="polite"></output>', script);
}
function isLearner(roles) { return roles.split(',').some(x => x.trim().split('/').pop() === 'Learner'); }
function gradeAnswers(answers) {
  let points = 0;
  const details = QUESTIONS.map(q => { const correct = answers?.[q.id] === q.answer; if (correct) points += q.points; return { topic: q.topic, correct, explanation: q.explanation }; });
  return { points, details };
}
async function submit(request, env) {
  const session = await readSession(request, env.SESSION_SECRET || '');
  if (!session) return reply({ error: 'Откройте тренажёр заново из Moodle.' }, 401);
  if (request.headers.get('Origin') !== new URL(request.url).origin || request.headers.get('X-CSRF-Token') !== session.csrf) return reply({ error: 'Некорректный источник запроса.' }, 403);
  if (!isLearner(session.roles)) return reply({ error: 'Оценку может отправить только студент.' }, 403);
  if (!session.outcome || !session.sourcedid) return reply({ error: 'Moodle не передал адрес журнала оценок. Проверьте настройки LTI.' }, 409);
  let answers;
  try { answers = JSON.parse(await request.text()).answers; } catch { return reply({ error: 'Некорректный ответ.' }, 400); }
  if (!answers || QUESTIONS.some(q => !q.choices.includes(answers[q.id]))) return reply({ error: 'Ответьте на все три вопроса.' }, 400);
  const result = gradeAnswers(answers);
  const xml = '<?xml version="1.0" encoding="UTF-8"?><imsx_POXEnvelopeRequest xmlns="http://www.imsglobal.org/services/ltiv1p1/xsd/imsoms_v1p0"><imsx_POXHeader><imsx_POXRequestHeaderInfo><imsx_version>V1.0</imsx_version><imsx_messageIdentifier>' + crypto.randomUUID() + '</imsx_messageIdentifier></imsx_POXRequestHeaderInfo></imsx_POXHeader><imsx_POXBody><replaceResultRequest><resultRecord><sourcedGUID><sourcedId>' + escapeHtml(session.sourcedid) + '</sourcedId></sourcedGUID><result><resultScore><language>en</language><textString>' + (result.points / 10).toFixed(1) + '</textString></resultScore></result></resultRecord></replaceResultRequest></imsx_POXBody></imsx_POXEnvelopeRequest>';
  const hash = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-1', enc.encode(xml)))));
  const oauth = [['oauth_consumer_key', env.LTI_CONSUMER_KEY], ['oauth_nonce', crypto.randomUUID()], ['oauth_signature_method', 'HMAC-SHA1'], ['oauth_timestamp', String(Math.floor(Date.now() / 1000))], ['oauth_version', '1.0'], ['oauth_body_hash', hash]];
  oauth.push(['oauth_signature', await oauthSignature('POST', session.outcome, oauth, env.LTI_SHARED_SECRET)]);
  const authorization = 'OAuth ' + oauth.map(([key, value]) => pct(key) + '="' + pct(value) + '"').join(', ');
  let response;
  try { response = await fetch(session.outcome, { method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/xml; charset=utf-8' }, body: xml, redirect: 'manual' }); }
  catch (error) { console.error('LTI outcome connection failed', error?.name, error?.message); return reply({ error: 'Не удалось соединиться с журналом Moodle.' }, 502); }
  if (response.status >= 300 && response.status < 400) {
    console.error('LTI outcome redirected', response.status, response.headers.get('Location'));
    return reply({ error: 'Moodle перенаправил запрос оценки. Проверьте адрес сервиса LTI.' }, 502);
  }
  const body = await response.text();
  if (!response.ok || !/<imsx_codeMajor>\s*success\s*<\/imsx_codeMajor>/i.test(body)) return reply({ error: 'Moodle не подтвердил запись оценки. Проверьте настройку приёма оценок.' }, 502);
  return reply({ ...result, sent: true });
}
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    try {
      if (path === '/healthz') return reply({ ok: true, ltiConfigured: Boolean(env.LTI_CONSUMER_KEY && env.LTI_SHARED_SECRET && env.SESSION_SECRET) });
      if (request.method === 'GET' && path === '/') return Response.redirect(new URL('/trainer', request.url), 302);
      if (request.method === 'POST' && path === '/lti/launch') return launch(request, env);
      if (request.method === 'GET' && path === '/trainer') {
        const session = await readSession(request, env.SESSION_SECRET || '');
        return session ? documentReply(trainer(session)) : documentReply(layout('Откройте тренажёр из Moodle', '<section class="card">Запустите элемент LTI в курсе Лизы.</section>'), 401);
      }
      if (request.method === 'POST' && path === '/api/submit') return submit(request, env);
      return documentReply(layout('Страница не найдена', '<section class="card">Вернитесь на главную страницу.</section>'), 404);
    } catch { return reply({ error: 'Не удалось выполнить запрос.' }, 500); }
  }
};
export { gradeAnswers, normalizedParams, signatureBase, oauthSignature };
