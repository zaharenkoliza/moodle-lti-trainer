const form = document.querySelector('#exercise');
const message = document.querySelector('#message');
const button = document.querySelector('#submit');
const newButton = document.querySelector('#new');
let session;
let requestId;
let pendingAnswers;
const api = async (path, body) => {
  const response = await fetch(path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf },
    body: JSON.stringify(body)
  });
  const result = await response.json();
  if (!response.ok && !result.current) throw new Error(result.error ?? 'Ошибка запроса');
  return result;
};
const status = current => {
  if (!current) return;
  message.textContent = `Результат: ${current.scoreGiven}/${current.scoreMaximum}. ` +
    (current.sentAt ? 'Moodle подтвердил прием оценки.' : 'Оценка сохранена. Повторите отправку.');
  for (const input of form.querySelectorAll('input')) input.disabled = true;
  button.disabled = Boolean(current.sentAt) || !session.learner;
  button.textContent = current.sentAt ? 'Оценка отправлена' : 'Повторить отправку';
  newButton.hidden = !current.sentAt || !session.learner;
};
const load = async () => {
  session = await api('/api/session');
  document.querySelector('#title').textContent = session.label;
  document.querySelector('#identity').textContent = `Пользователь: ${session.name}; LTI userId: ${session.userId}`;
  document.querySelector('#context').textContent = `Курс: ${session.course}; ресурс: ${session.resource}; роль: ${session.learner ? 'Learner' : 'просмотр'}`;
  const container = document.querySelector('#tasks');
  container.replaceChildren();
  for (const task of session.tasks) {
    const label = document.createElement('label');
    label.textContent = `${task.prompt} (${task.points} б.)`;
    const input = document.createElement('input');
    input.name = task.id; input.maxLength = 200; input.autocomplete = 'off';
    input.disabled = !session.learner;
    label.append(input); container.append(label);
  }
  button.disabled = !session.learner || !session.agsReady;
  button.textContent = 'Проверить и отправить в Moodle';
  newButton.hidden = true;
  message.textContent = !session.learner ? 'Преподаватель видит задания, но не отправляет себе оценку.' :
    !session.agsReady ? 'Нет разрешения AGS или строки журнала. Проверьте настройки Moodle и повторите запуск.' : '';
  requestId = session.current?.requestId ?? crypto.randomUUID();
  pendingAnswers = session.current?.answers ?? null;
  if (pendingAnswers) for (const input of form.querySelectorAll('input')) input.value = pendingAnswers[input.name];
  status(session.current);
  const list = document.querySelector('#history');
  list.replaceChildren();
  for (const item of [...session.history, ...(session.current ? [session.current] : [])]) {
    const li = document.createElement('li');
    li.textContent = `${item.scoreGiven}/${item.scoreMaximum}; ${new Date(item.createdAt).toLocaleString()}; ${item.sentAt ? 'отправлена' : 'ожидает отправки'}`;
    list.append(li);
  }
};
form.addEventListener('submit', async event => {
  event.preventDefault(); button.disabled = true;
  pendingAnswers ??= Object.fromEntries(new FormData(form).entries());
  for (const input of form.querySelectorAll('input')) input.disabled = true;
  try {
    const result = await api('/api/submit', { requestId, answers: pendingAnswers });
    status(result.current);
    if (result.error) message.textContent += ' ' + result.error;
    await load();
  } catch (error) {
    message.textContent = error.message + ' Если произошел сбой связи, повторите тот же запрос.';
    button.disabled = false; button.textContent = 'Повторить отправку';
  }
});
newButton.addEventListener('click', async () => {
  try { await api('/api/new-attempt', {}); await load(); }
  catch (error) { message.textContent = error.message; }
});
load().catch(error => { message.textContent = error.message; });
