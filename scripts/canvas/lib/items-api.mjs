// A small client for the AI Search Items REST API (built-in storage):
//   GET    .../items?page=&per_page=   list (per_page max 50)
//   POST   .../items                   upload, multipart: file, metadata
//   DELETE .../items/{item_id}         delete
// Base: https://api.cloudflare.com/client/v4/accounts/{account}/ai-search/
//       namespaces/{namespace}/instances/{instance}
// Source: developers.cloudflare.com/api/resources/ai_search (read 2026-10-08).
// It talks to api.cloudflare.com only, never to a resource's own site.

const API = "https://api.cloudflare.com/client/v4";
const PER_PAGE = 50;

export const INSTANCE_RE = /^[a-z0-9_-]{1,64}$/;

/**
 * @param {{ accountId: string, token: string, namespace?: string, instance: string, fetchImpl?: typeof fetch }} cfg
 */
export function itemsClient({ accountId, token, namespace = "default", instance, fetchImpl = fetch }) {
  if (!INSTANCE_RE.test(instance)) throw new Error(`instance name ${JSON.stringify(instance)} is not valid`);
  const base = `${API}/accounts/${encodeURIComponent(accountId)}/ai-search/namespaces/${encodeURIComponent(namespace)}/instances/${instance}/items`;
  const auth = { Authorization: `Bearer ${token}` };

  async function call(url, init) {
    const res = await fetchImpl(url, { ...init, headers: { ...auth, ...(init?.headers ?? {}) } });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok || body?.success === false) {
      const detail = body?.errors?.map((e) => e.message).join("; ") || res.statusText;
      throw new Error(`${init?.method ?? "GET"} ${url.replace(base, "items")} failed: ${res.status} ${detail}`);
    }
    return body;
  }

  return {
    /** Every item in the instance, all pages. */
    async list() {
      const items = [];
      for (let page = 1; page < 10_000; page += 1) {
        const body = await call(`${base}?page=${page}&per_page=${PER_PAGE}`, { method: "GET" });
        const batch = body?.result ?? [];
        items.push(...batch);
        const total = body?.result_info?.total_count;
        if (batch.length < PER_PAGE || (typeof total === "number" && items.length >= total)) break;
      }
      return items;
    },

    /** Uploads one markdown document; returns the API's warnings, if any. */
    async upload(key, text, metadata) {
      const form = new FormData();
      form.append("file", new Blob([text], { type: "text/markdown" }), key);
      form.append("metadata", JSON.stringify(metadata));
      const body = await call(base, { method: "POST", body: form });
      return body?.result?.warnings ?? [];
    },

    async remove(itemId) {
      await call(`${base}/${encodeURIComponent(itemId)}`, { method: "DELETE" });
    },
  };
}
