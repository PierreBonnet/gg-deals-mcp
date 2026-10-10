import { z } from 'zod';

export const REGIONS = ['au', 'be', 'br', 'ca', 'ch', 'de', 'dk', 'es', 'eu', 'fi', 'fr', 'gb', 'ie', 'it', 'nl', 'no', 'pl', 'se', 'us'];
export const inputSchema = {
  ids: z.array(z.number().int().positive().max(Number.MAX_SAFE_INTEGER)).min(1).max(100)
    .describe('1–100 Steam IDs of the type requested by this tool. Duplicates count once.'),
  region: z.enum(REGIONS).optional().describe('Price region; defaults to GG_DEALS_REGION or fr.'),
};
const requestSchema = z.object(inputSchema);
const amount = z.string().regex(/^\d+(?:\.\d+)?$/).nullable();
const gameSchema = z.object({
  title: z.string(),
  url: z.string().url().refine(value => {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'gg.deals' && !url.username && !url.password;
  }),
  prices: z.object({ currentRetail: amount, currentKeyshops: amount,
    historicalRetail: amount, historicalKeyshops: amount, currency: z.string().regex(/^[A-Z]{3}$/) }),
}).nullable();
const responseSchema = z.object({ success: z.literal(true), data: z.record(z.string(), gameSchema) });
const kinds = new Set(['app', 'sub', 'bundle']);

export class DealsError extends Error {
  constructor(code, message, retryAfterSeconds) {
    super(message);
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class DealsClient {
  #key;
  #fetch;
  #now;
  #cache = new Map();
  #records = [];
  #cooldown = 0;
  #quota = null;
  constructor({ apiKey = process.env.GG_DEALS_API_KEY, region = process.env.GG_DEALS_REGION || 'fr',
    fetchImpl = globalThis.fetch, now = Date.now } = {}) {
    this.#key = apiKey?.trim();
    this.region = region;
    this.#fetch = fetchImpl;
    this.#now = now;
  }
  status() {
    return { configured: Boolean(this.#key && this.#key !== 'REPLACE_LOCALLY'),
      defaultRegion: REGIONS.includes(this.region) ? this.region : null,
      supportedRegions: REGIONS, cacheTtlSeconds: 300,
      limits: { recordsPerMinute: 100, recordsPerHour: 1000, scope: 'this server process' },
      remoteRateLimit: this.#quota };
  }
  #reserve(count, now) {
    if (now < this.#cooldown) throw new DealsError('RATE_LIMIT', 'GG.deals quota exceeded. Retry later.', Math.ceil((this.#cooldown - now) / 1000));
    this.#records = this.#records.filter(time => time > now - 3600000);
    const minute = this.#records.filter(time => time > now - 60000);
    let wait = 0;
    if (minute.length + count > 100) wait = minute[minute.length + count - 101] + 60000 - now;
    if (this.#records.length + count > 1000) wait = Math.max(wait, this.#records[this.#records.length + count - 1001] + 3600000 - now);
    if (wait > 0) throw new DealsError('RATE_LIMIT', 'Local record quota reached. Retry later or request fewer IDs.', Math.ceil(wait / 1000));
    this.#records.push(...Array(count).fill(now));
  }
  async prices(kind, args) {
    const parsed = requestSchema.safeParse(args);
    if (!kinds.has(kind) || !parsed.success) throw new DealsError('INVALID_INPUT', 'Provide 1–100 positive integer Steam IDs and a supported region.');
    const region = parsed.data.region ?? this.region;
    if (!REGIONS.includes(region)) throw new DealsError('INVALID_REGION', 'GG_DEALS_REGION must be a supported region code.');
    if (!this.status().configured) throw new DealsError('MISSING_API_KEY', 'Set GG_DEALS_API_KEY in your local MCP environment. Never send API keys in chat.');
    const ids = [...new Set(parsed.data.ids)].map(String);
    const now = this.#now();
    for (const [key, value] of this.#cache) if (value.expires <= now) this.#cache.delete(key);
    const cacheKey = id => `${kind}:${region}:${id}`;
    const missing = ids.filter(id => !this.#cache.has(cacheKey(id)));
    const cached = new Map(ids.map(id => [id, this.#cache.get(cacheKey(id))]));
    const fetched = new Map();
    if (missing.length) {
      this.#reserve(missing.length, now);
      const url = new URL(`https://api.gg.deals/v1/prices/by-steam-${kind}-id/`);
      url.search = new URLSearchParams({ key: this.#key, ids: missing.join(','), region }).toString();
      let response;
      try {
        response = await this.#fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'error', headers: { Accept: 'application/json' } });
      } catch {
        throw new DealsError('NETWORK_ERROR', 'Could not reach GG.deals within 15 seconds.');
      }
      const numericHeader = name => {
        const value = response.headers.get(name);
        return value !== null && /^\d{1,12}$/.test(value) ? Number(value) : null;
      };
      this.#quota = { limit: numericHeader('x-ratelimit-limit'), remaining: numericHeader('x-ratelimit-remaining'), reset: numericHeader('x-ratelimit-reset') };
      if (response.status === 429) {
        const retry = numericHeader('retry-after');
        const reset = this.#quota.reset;
        const seconds = Math.max(1, retry ?? (reset ? Math.ceil(reset - this.#now() / 1000) : 60));
        this.#cooldown = this.#now() + seconds * 1000;
        throw new DealsError('RATE_LIMIT', 'GG.deals quota exceeded. Retry later or request fewer IDs.', seconds);
      }
      if (response.status === 401 || response.status === 403) throw new DealsError('AUTH_ERROR', 'GG.deals rejected access. Check your local API key and account permissions.');
      if (!response.ok) throw new DealsError('HTTP_ERROR', `GG.deals returned HTTP ${response.status}.`);
      let payload;
      try { payload = responseSchema.parse(await response.json()); }
      catch { throw new DealsError('INVALID_RESPONSE', 'GG.deals returned an unexpected response.'); }
      if (missing.some(id => !Object.hasOwn(payload.data, id))) throw new DealsError('INVALID_RESPONSE', 'GG.deals omitted a requested ID.');
      const fetchedAt = this.#now();
      for (const id of missing) {
        const entry = { value: payload.data[id], fetchedAt: new Date(fetchedAt).toISOString(), expires: fetchedAt + 300000 };
        this.#cache.set(cacheKey(id), entry);
        fetched.set(id, entry);
      }
    }
    const data = {};
    const fetchedAt = {};
    for (const id of ids) {
      const entry = fetched.get(id) ?? cached.get(id);
      data[id] = entry.value;
      fetchedAt[id] = entry.fetchedAt;
    }
    return { source: 'GG.deals', idType: kind, region, data, fetchedAt,
      cachedRecords: ids.length - missing.length, requestedRecords: missing.length, rateLimit: this.#quota };
  }
}
