import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';

// One Node.js process. Separate atomic JSON file per learner/resource.
export class Store {
  constructor(directory) { this.directory = directory; this.locks = new Map(); }
  async read(key) {
    try { return JSON.parse(await readFile(join(this.directory, key + '.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return { history: [], current: null }; throw error; }
  }
  async save(key, data) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const target = join(this.directory, key + '.json');
    const temp = target + '.' + randomUUID() + '.tmp';
    await writeFile(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
    await rename(temp, target);
  }
  async exclusive(key, work) {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const result = previous.catch(() => {}).then(work);
    this.locks.set(key, result);
    try { return await result; }
    finally { if (this.locks.get(key) === result) this.locks.delete(key); }
  }
}

// Render's free filesystem disappears when the service sleeps. Persist attempts
// in Atlas alongside the LTI registration so a new process can restore them.
export class MongoStore extends Store {
  constructor(url, database = 'lti_lab_attempts') {
    super('');
    this.client = new MongoClient(url);
    this.database = database;
    this.connection = null;
  }
  async collection() {
    this.connection ??= this.client.connect().then(() => this.client.db(this.database).collection('attempts'))
      .catch(error => { this.connection = null; throw error; });
    return this.connection;
  }
  async read(key) {
    const entry = await (await this.collection()).findOne({ _id: key });
    return entry?.data ?? { history: [], current: null };
  }
  async save(key, data) {
    await (await this.collection()).updateOne({ _id: key }, { $set: { data } }, { upsert: true });
  }
  async close() { await this.client.close(); }
}
