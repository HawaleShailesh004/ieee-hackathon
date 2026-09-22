// Minimal FHIR R4 REST client.

export class FhirError extends Error {
  constructor(message, status, outcome) {
    super(message);
    this.status = status;
    this.outcome = outcome;
  }
}

export function fhirClient(base) {
  async function request(path, { method = 'GET', body, headers } = {}) {
    const res = await fetch(path.startsWith('http') ? path : `${base}/${path}`, {
      method,
      headers: { Accept: 'application/fhir+json', ...(body && { 'Content-Type': 'application/fhir+json' }), ...headers },
      body: body && JSON.stringify(body),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      const detail = json?.issue?.map((i) => i.diagnostics ?? i.details?.text).join('; ') ?? text.slice(0, 500);
      throw new FhirError(`${method} ${path} -> HTTP ${res.status}: ${detail}`, res.status, json);
    }
    return json;
  }

  return {
    base,
    read: (type, id) => request(`${type}/${id}`),
    update: (resource) => request(`${resource.resourceType}/${resource.id}`, { method: 'PUT', body: resource }),
    create: (resource) => request(resource.resourceType, { method: 'POST', body: resource }),
    transaction: (bundle) => request('', { method: 'POST', body: bundle }),

    /**
     * All matching resources (follows paging). Includes _include/_revinclude matches.
     * Always bypasses the server's search cache: HAPI otherwise reuses results of an identical
     * search for ~60 s, which silently drops records written in between (e.g. a fresh review).
     */
    async search(type, params = {}) {
      const qs = new URLSearchParams({ _count: '200', ...params });
      let bundle = await request(`${type}?${qs}`, { headers: { 'Cache-Control': 'no-cache' } });
      const resources = [];
      for (;;) {
        resources.push(...(bundle.entry ?? []).map((e) => e.resource));
        const next = bundle.link?.find((l) => l.relation === 'next')?.url;
        if (!next) return resources;
        bundle = await request(next);
      }
    },

    /** $validate against a profile. Returns { valid, issues } (errors and fatals make it invalid). */
    async validate(resource, profile) {
      const qs = profile ? `?profile=${encodeURIComponent(profile)}` : '';
      let outcome;
      try {
        outcome = await request(`${resource.resourceType}/$validate${qs}`, { method: 'POST', body: resource });
      } catch (e) {
        // HAPI answers an invalid resource with HTTP 412 and the OperationOutcome.
        if (!(e instanceof FhirError) || !e.outcome?.issue) throw e;
        outcome = e.outcome;
      }
      const issues = (outcome.issue ?? []).filter((i) => ['fatal', 'error', 'warning'].includes(i.severity));
      return { valid: !issues.some((i) => i.severity === 'error' || i.severity === 'fatal'), issues };
    },

    /** Removes tags from the latest version's meta (tags are otherwise carried forward on update). */
    metaDelete: (type, id, tags) => request(`${type}/${id}/$meta-delete`, {
      method: 'POST',
      body: { resourceType: 'Parameters', parameter: [{ name: 'meta', valueMeta: { tag: tags } }] },
    }),
  };
}
