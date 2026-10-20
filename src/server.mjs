import { resolve } from 'node:path';
import { createTool, registerMoodle } from './tool.mjs';

const config = {
  port: Number(process.env.PORT ?? 3000), publicUrl: process.env.PUBLIC_URL,
  label: process.env.APP_LABEL ?? 'Тренажер: три задания',
  mongoUrl: process.env.MONGO_URL, dataDir: resolve(process.env.DATA_DIR ?? './data'),
  attemptsDbName: process.env.ATTEMPTS_DB_NAME ?? 'lti_lab_attempts',
  issuer: process.env.MOODLE_ISSUER, clientId: process.env.MOODLE_CLIENT_ID,
  deploymentId: process.env.MOODLE_DEPLOYMENT_ID,
  authUrl: process.env.MOODLE_AUTH_URL, tokenUrl: process.env.MOODLE_TOKEN_URL,
  jwksUrl: process.env.MOODLE_JWKS_URL
};
for (const key of ['publicUrl', 'mongoUrl', 'issuer', 'authUrl', 'tokenUrl', 'jwksUrl']) {
  if (!config[key]) throw new Error('Не заполнена настройка ' + key + ' в .env');
}
if (new URL(config.publicUrl).protocol !== 'https:') throw new Error('PUBLIC_URL должен использовать HTTPS.');
if (config.clientId && !config.deploymentId) throw new Error('Укажите MOODLE_DEPLOYMENT_ID.');
const { provider } = createTool(config);
await provider.listen();
await registerMoodle(provider, config);
console.log('Готово. Проверка стенда: ' + config.publicUrl + '/healthz');
