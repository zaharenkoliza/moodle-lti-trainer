import test from 'node:test';
import assert from 'node:assert/strict';
import { grade, normalize, tasks } from '../src/grading.mjs';
test('normalization and zero score', () => {
  assert.equal(normalize('  SpeechRecognition  '), 'speechrecognition');
  assert.equal(grade({ q1: '', q2: '', q3: '' }).scoreGiven, 0);
});
test('maximum and partial result', () => {
  const answers = Object.fromEntries(tasks.map(t => [t.id, t.answer]));
  assert.equal(grade(answers).scoreGiven, 10);
  assert.equal(grade(answers).scoreMaximum, 10);
  answers.q2 = '__wrong__';
  assert.equal(grade(answers).scoreGiven, 7);
});
test('invalid answers cannot become grades', () => {
  assert.throws(() => grade({ q1: 'Promise', q2: '404' }));
  assert.throws(() => grade({ q1: [], q2: '404', q3: 'SpeechRecognition' }));
  assert.throws(() => grade({ q1: 'x'.repeat(201), q2: '404', q3: 'SpeechRecognition' }));
});

test('answers are checked on the server and whitespace is normalized', () => {
  const result = grade({ q1: '  pRoMiSe ', q2: ' 404 ', q3: ' speechrecognition ' });
  assert.deepEqual(result.items.map(item => item.points), [3, 3, 4]);
  assert.throws(() => grade({ q1: 'Promise', q2: '404', q3: 'SpeechRecognition', scoreGiven: 10 }));
});
