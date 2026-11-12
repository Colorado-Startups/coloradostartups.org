// The one Slack Web API client Communitas posts through. It calls two fixed
// methods on slack.com and nothing else, so no code path can reach a URL a
// member supplied. Every post goes out with link_names false and unfurls off,
// set after the caller's fields so no caller can turn them back on.

const API = "https://slack.com/api/";

export interface SlackPost {
  channel: string;
  text: string;
  thread_ts?: string;
  blocks?: unknown[];
}

export interface SlackClient {
  postMessage(message: SlackPost): Promise<{ ts?: string }>;
  openDm(userId: string): Promise<string>;
}

export class SlackApiError extends Error {
  override name = "SlackApiError";
  constructor(
    readonly method: string,
    readonly code: string,
  ) {
    super(`Slack ${method} failed: ${code}`);
  }
}

// A Slack Web API client for the two calls Communitas makes
// (chat.postMessage, conversations.open). Tests pass their own `fetchImpl`.
export function createSlackClient(
  token: string,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): SlackClient {
  async function call<T>(method: "chat.postMessage" | "conversations.open", body: object): Promise<T> {
    const res = await fetchImpl(API + method, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new SlackApiError(method, `http_${res.status}`);
    const data = (await res.json()) as { ok?: boolean; error?: string } & T;
    if (!data.ok) throw new SlackApiError(method, data.error ?? "unknown_error");
    return data;
  }

  return {
    async postMessage(message) {
      const { ts } = await call<{ ts?: string }>("chat.postMessage", {
        ...message,
        link_names: false,
        unfurl_links: false,
        unfurl_media: false,
      });
      return { ts };
    },
    async openDm(userId) {
      const data = await call<{ channel?: { id?: string } }>("conversations.open", { users: userId });
      if (!data.channel?.id) throw new SlackApiError("conversations.open", "no_channel");
      return data.channel.id;
    },
  };
}
