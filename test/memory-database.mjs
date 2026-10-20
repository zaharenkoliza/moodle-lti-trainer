// Test double only. The real application always uses MongoDB.
import { randomUUID } from 'node:crypto';
export class MemoryDatabase {
  platforms = new Map(); tokens = new Map(); nonces = new Set(); access = new Map();
  async listen() {}
  async close() {}
  async getPlatforms(filter = {}) {
    return [...this.platforms.values()].filter(p =>
      (!filter.url || p.url === filter.url) &&
      (!filter.name || p.name === filter.name) &&
      (!filter.clientId || (Array.isArray(filter.clientId) ? filter.clientId.includes(p.clientId) : p.clientId === filter.clientId)));
  }
  async getPlatformById(id) { return this.platforms.get(id); }
  async getPlatformByUrlAndClientId(url, clientId) { return (await this.getPlatforms({ url, clientId }))[0]; }
  async savePlatform(attributes) { const id = randomUUID(); this.platforms.set(id, { ...attributes, id }); return id; }
  async updatePlatformById(id, fields) { this.platforms.set(id, { ...this.platforms.get(id), ...fields }); }
  async deletePlatformById(id) { this.platforms.delete(id); }
  async getAccessToken(url, clientId, scopes) { return this.access.get(JSON.stringify([url, clientId, scopes])); }
  async saveAccessToken(url, clientId, scopes, token) { this.access.set(JSON.stringify([url, clientId, scopes]), token); return randomUUID(); }
  async getIdToken(id) { return this.tokens.get(id); }
  async saveIdToken(token) { const id = randomUUID(); this.tokens.set(id, { ...token, id }); return id; }
  async saveNonce(nonce) { this.nonces.add(nonce); return nonce; }
  async consumeNonce(nonce) { return this.nonces.delete(nonce); }
}
