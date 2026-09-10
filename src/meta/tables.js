import { MetaRegistry } from './registry.js';
import { MetaResources } from './resources.js';

// Ports of, and kept in sync with:
//   bond        cli.meta.roles.applications.bond
//   complexity  cli.meta.roles.applications.complexity
export class MetaTables extends MetaResources {
  // {"consumer|provider": {bond, serviceKey, enabled}}. A role's entry
  // for its own entity is skipped: it carries unrelated topics such as users
  // or domains, not a bond to another role.
  bondEdges() {
    const edges = new Map();
    for (const consumer of this.roles) {
      for (const [serviceKey, entry] of Object.entries(this._services(consumer))) {
        const conf = MetaRegistry._map(entry);
        const bond = MetaRegistry.parseBond(conf.bond);
        if (bond === null) continue;
        const provider = this.providerOf(serviceKey);
        if (!provider || provider === consumer) continue;
        edges.set(`${consumer}|${provider}`, { bond, serviceKey, enabled: conf.enabled });
      }
    }
    return edges;
  }

  static bondParticipants(edges) {
    const seen = new Set();
    for (const pair of edges.keys()) {
      const [consumer, provider] = pair.split('|');
      seen.add(consumer);
      seen.add(provider);
    }
    return [...seen].sort();
  }

  // Only an enabled entry counts. bondEdges() deliberately does not filter,
  // because that path mirrors the bond CLI exactly.
  bondsOf(role, variant) {
    const bonds = new Map();
    for (const [serviceKey, entry] of Object.entries(this.variantServices(role, variant))) {
      const conf = MetaRegistry._map(entry);
      const bond = MetaRegistry.parseBond(conf.bond);
      if (bond === null) continue;
      if (!MetaRegistry._isExplicitTruth(conf.enabled)) continue;
      const provider = this.providerOf(serviceKey);
      if (!provider || provider === role) continue;
      bonds.set(provider, { bond, serviceKey });
    }
    return bonds;
  }

  _variantIndices(role, variantAware) {
    const count = variantAware ? this.variantCount(role) : 0;
    return count ? Array.from({ length: count }, (_, index) => index) : [null];
  }

  _directDepRoles(services) {
    const seen = new Set();
    const out = [];
    for (const [serviceKey, entry] of Object.entries(MetaRegistry._map(services))) {
      const conf = MetaRegistry._map(entry);
      if (Object.keys(conf).length === 0) continue;
      if (!(MetaRegistry._isExplicitTruth(conf.enabled) && MetaRegistry._isExplicitTruth(conf.shared))) {
        continue;
      }
      const provider = this.providerOf(serviceKey);
      if (provider && !seen.has(provider)) {
        seen.add(provider);
        out.push(provider);
      }
    }
    return out;
  }

  _graphs() {
    const forward = {};
    const reverse = {};
    for (const consumer of this.roles) {
      const providers = this._directDepRoles(this._services(consumer));
      forward[consumer] = providers;
      for (const provider of providers) {
        (reverse[provider] = reverse[provider] || []).push(consumer);
      }
    }
    return { forward, reverse };
  }

  static _resolveTransitively(start, graph, maxLevel) {
    const seen = new Set([start]);
    const order = [];
    const queue = (graph[start] || []).map(role => [role, 1]);
    while (queue.length) {
      const [role, depth] = queue.shift();
      if (seen.has(role)) continue;
      seen.add(role);
      order.push(role);
      if (maxLevel !== null && depth >= maxLevel) continue;
      for (const next of graph[role] || []) {
        if (!seen.has(next)) queue.push([next, depth + 1]);
      }
    }
    return order;
  }

  _lifecycle(role) {
    for (const entry of Object.values(this._services(role))) {
      const conf = MetaRegistry._map(entry);
      if (conf.lifecycle) return String(conf.lifecycle);
    }
    return '';
  }

  // Only the forward edges are recomputed per variant. Who embeds the role is
  // a catalog-level fact its own variant choice cannot move.
  complexityRows(variantAware = false) {
    const { forward, reverse } = this._graphs();
    const rows = [];
    for (const name of Object.keys(this.applications).sort()) {
      for (const variant of this._variantIndices(name, variantAware)) {
        const scoped = variant === null
          ? forward
          : { ...forward, [name]: this._directDepRoles(this.variantServices(name, variant)) };
        const services = MetaTables._resolveTransitively(name, scoped, null);
        const consumers = MetaTables._resolveTransitively(name, reverse, null);
        const servicesDirect = MetaTables._resolveTransitively(name, scoped, 1);
        const consumersDirect = MetaTables._resolveTransitively(name, reverse, 1);
        rows.push({
          name,
          variant,
          lifecycle: this._lifecycle(name),
          embeds: services.length,
          consumers: consumers.length,
          embeds_direct: servicesDirect.length,
          consumers_direct: consumersDirect.length,
          weight: services.length + consumers.length + servicesDirect.length + consumersDirect.length,
          integrated: servicesDirect.length > 0,
          services,
          dna: [...new Set([name, ...services])].sort().join('\n'),
        });
      }
    }

    const byDna = new Map();
    for (const row of rows) {
      if (!byDna.has(row.dna)) byDna.set(row.dna, []);
      byDna.get(row.dna).push(row);
    }
    for (const group of byDna.values()) {
      const original = group.reduce(
        (best, row) => (row.weight > best.weight || (row.weight === best.weight && row.name > best.name) ? row : best)
      );
      for (const row of group) {
        row.siblings = group.filter(other => other !== row).map(other => other.name).sort();
        row.clone = row.name !== original.name;
      }
    }
    return rows;
  }
}
