const crypto = require('crypto');
const {createClient} = require('redis');
const {monitorEventLoopDelay, performance} = require('node:perf_hooks');
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const generationScript = "local v=redis.call('GET',KEYS[1]); if not v then v=ARGV[1]; redis.call('SET',KEYS[1],v,'EX',120); end; return v";
const fillScript = "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('SET',KEYS[2],ARGV[2],'PX',ARGV[3]) end; return nil";
const invalidateScript = "for i,k in ipairs(KEYS) do redis.call('SET',k,ARGV[i],'EX',120) end; return #KEYS";

class FlightCache {
  constructor({url = process.env.REDIS_URL, prefix = 'flight-cache:v1:', ttlMs = 5000, timeoutMs = 80, maxDbLoads = 10} = {}) {
    this.prefix = prefix;
    this.ttlMs = Math.min(5000, Math.max(100, ttlMs));
    this.timeoutMs = timeoutMs;
    this.maxDbLoads = maxDbLoads;
    this.activeLoads = 0;
    this.inflight = new Map();
    this.openUntil = 0;
    this.stats = {hits: 0, misses: 0, bypasses: 0, sourceLoads: 0, coalesced: 0, errors: 0, connectionErrors: 0, invalidations: 0, invalidationFailures: 0, rejectedLoads: 0,
      commandDeadlines: 0, commandFailures: 0, lateCommandCompletions: 0};
    this.loopDelay = monitorEventLoopDelay({resolution: 20});
    this.loopDelay.enable();
    this.lastLoopUtilization = performance.eventLoopUtilization();
    this.loopStats = {p99Ms: 0, maxMs: 0, utilization: 0};
    this.loopTimer = setInterval(() => {
      const delta = performance.eventLoopUtilization(this.lastLoopUtilization);
      this.lastLoopUtilization = performance.eventLoopUtilization();
      this.loopStats = {p99Ms: this.loopDelay.percentile(99) / 1e6,
        maxMs: this.loopDelay.max / 1e6, utilization: delta.utilization};
      this.loopDelay.reset();
    }, 1000);
    this.loopTimer.unref();
    if (url && process.env.REDIS_ENABLED !== 'false') {
      this.client = createClient({url, disableOfflineQueue: true, commandsQueueMaxLength: 64,
        socket: {connectTimeout: 300, reconnectStrategy: retries => Math.min(100 * (retries + 1), 1000)}});
      this.client.on('error', () => { this.stats.connectionErrors++; this.openUntil = Date.now() + 1000; });
      this.client.connect().catch(() => { this.openUntil = Date.now() + 1000; });
    }
  }
  generationKey(scope) { return `${this.prefix}generation:${scope}`; }
  async command(operation) {
    if (!this.client?.isReady || Date.now() < this.openUntil) return undefined;
    let timer, timedOut = false;
    try {
      const pending = Promise.resolve().then(() => operation(this.client));
      pending.then(() => {if (timedOut) this.stats.lateCommandCompletions++;}, () => {});
      return await Promise.race([pending, new Promise((_, reject) => {
        timer = setTimeout(() => {timedOut = true; reject(new Error('Cache deadline exceeded'));}, this.timeoutMs);
      })]);
    } catch (error) {
      this.stats.errors++;
      if (timedOut) this.stats.commandDeadlines++;
      else this.stats.commandFailures++;
      this.openUntil = Date.now() + 1000;
      return undefined;
    } finally { clearTimeout(timer); }
  }
  async read(scope, identity, load) {
    const generationKey = this.generationKey(scope);
    const generation = scope ? await this.command(client => client.eval(generationScript, {keys: [generationKey], arguments: [crypto.randomUUID()]})) : undefined;
    const key = generation ? `${this.prefix}data:${digest([scope, generation, identity])}` : null;
    if (key) {
      const raw = await this.command(client => client.get(key));
      if (raw) {
        try {
          const cached = JSON.parse(raw);
          if (Number.isFinite(cached.expiresAt) && cached.expiresAt > Date.now() && Object.hasOwn(cached, 'value')) {
            this.stats.hits++; return cached.value;
          }
        } catch (_) { /* Treat invalid cache entries as misses. */ }
      }
      this.stats.misses++;
    } else { this.stats.bypasses++; }
    // A generation change prevents a later request joining a pre-invalidation fill.
    const pendingKey = key || `uncached:${digest([scope, identity])}`;
    if (this.inflight.has(pendingKey)) { this.stats.coalesced++; return this.inflight.get(pendingKey); }
    if (this.activeLoads >= this.maxDbLoads) {
      this.stats.rejectedLoads++;
      throw Object.assign(new Error('Flight reads temporarily busy; retry shortly'), {statusCode: 503});
    }
    const expiresAt = Date.now() + this.ttlMs;
    this.activeLoads++; this.stats.sourceLoads++;
    const promise = (async () => {
      const value = await load();
      const remaining = expiresAt - Date.now();
      if (key && value != null && remaining > 0) {
        const payload = JSON.stringify({expiresAt, value});
        await this.command(client => client.eval(fillScript, {keys: [generationKey, key], arguments: [generation, payload, String(remaining)]}));
      }
      return value;
    })();
    this.inflight.set(pendingKey, promise);
    try { return await promise; }
    finally { this.activeLoads--; this.inflight.delete(pendingKey); }
  }
  async invalidateFlights(...flights) {
    const scopes = new Set();
    for (const flight of flights.filter(Boolean)) {
      scopes.add(`flight:${flight.id}`);
      scopes.add('search:all');
      scopes.add(`search:dep:${flight.departureAirportId}`);
      scopes.add(`search:arr:${flight.arrivalAirportId}`);
      scopes.add(`search:route:${flight.departureAirportId}:${flight.arrivalAirportId}`);
    }
    if (!scopes.size) return;
    const keys = [...scopes].map(scope => this.generationKey(scope));
    const result = await this.command(client => client.eval(invalidateScript, {keys, arguments: keys.map(() => crypto.randomUUID())}));
    if (result !== undefined) this.stats.invalidations++;
    else if (this.client) this.stats.invalidationFailures++;
    // Failure cannot roll back committed MySQL work; cached values expire within 5 seconds.
  }
  snapshot() { return {...this.stats, eventLoop: this.loopStats, enabled: !!this.client, ready: !!this.client?.isReady, ttlMs: this.ttlMs, activeLoads: this.activeLoads}; }
  async close() { clearInterval(this.loopTimer); this.loopDelay.disable(); if (this.client?.isOpen) await this.client.disconnect(); }
}

function searchKey(data) {
  const filters = {};
  for (const field of ['arrivalAirportId', 'departureAirportId', 'minPrice', 'maxPrice']) {
    if (!data[field]) continue;
    if (!['number', 'string'].includes(typeof data[field])) return null;
    // Do not equate JS-only numeric forms (e.g. 0x10) with MySQL's numeric coercion.
    if (!/^-?\d+(?:\.\d+)?$/.test(String(data[field])) || !Number.isFinite(Number(data[field]))) return null;
    filters[field] = field.endsWith('AirportId') ? Number(data[field]) : String(data[field]);
    if (field.endsWith('AirportId') && (!Number.isSafeInteger(filters[field]) || filters[field] <= 0)) return null;
  }
  const dep = filters.departureAirportId, arr = filters.arrivalAirportId;
  const scope = dep && arr ? `search:route:${dep}:${arr}` : dep ? `search:dep:${dep}` : arr ? `search:arr:${arr}` : 'search:all';
  return {scope, filters};
}
module.exports = {cache: new FlightCache(), FlightCache, searchKey};
