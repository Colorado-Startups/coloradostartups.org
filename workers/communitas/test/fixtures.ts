// Signed Slack request fixtures. Each one is built and signed the way Slack
// does it (v0 HMAC-SHA256 over "v0:<timestamp>:<raw body>"), so the tests run
// the real verification in slack-cloudflare-workers, not a stub of it.

export const SIGNING_SECRET = "test-signing-secret";

export async function slackSignature(secret: string, timestamp: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`v0:${timestamp}:${body}`));
  return `v0=${[...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export async function signedRequest(
  path: string,
  body: string,
  options: {
    secret?: string;
    /** Seconds since the epoch, or any string to sign a malformed header. */
    timestamp?: number | string;
    contentType?: string;
    headers?: Record<string, string>;
    unsigned?: boolean;
  } = {},
): Promise<Request> {
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000));
  const headers = new Headers({
    "Content-Type": options.contentType ?? "application/json",
    ...options.headers,
  });
  if (!options.unsigned) {
    headers.set("X-Slack-Request-Timestamp", timestamp);
    headers.set("X-Slack-Signature", await slackSignature(options.secret ?? SIGNING_SECRET, timestamp, body));
  }
  return new Request(`https://communitas.example${path}`, { method: "POST", headers, body });
}

const envelope = (event: Record<string, unknown>) => ({
  token: "legacy-token-unused",
  team_id: "T0TEST",
  api_app_id: "A0TEST",
  event,
  type: "event_callback",
  event_id: "Ev0TEST",
  event_time: 1700000000,
  authorizations: [
    { enterprise_id: null, team_id: "T0TEST", user_id: "U0BOT", is_bot: true, is_enterprise_install: false },
  ],
});

export const appMention = (over: Record<string, unknown> = {}) =>
  JSON.stringify(
    envelope({
      type: "app_mention",
      user: "U0ASKER",
      text: "<@U0BOT> who helps first-time founders in Boulder?",
      ts: "1700000000.000001",
      channel: "C0GENERAL",
      event_ts: "1700000000.000001",
      ...over,
    }),
  );

export const teamJoin = (over: Record<string, unknown> = {}) =>
  JSON.stringify(
    envelope({
      type: "team_join",
      user: { id: "U0NEW", team_id: "T0TEST", name: "newfounder", deleted: false, is_bot: false, ...over },
      event_ts: "1700000000.000002",
    }),
  );

export const urlVerification = () =>
  JSON.stringify({ token: "legacy-token-unused", challenge: "challenge-abc123", type: "url_verification" });

export const slashCommand = (text = "help") =>
  new URLSearchParams({
    token: "legacy-token-unused",
    team_id: "T0TEST",
    channel_id: "C0GENERAL",
    user_id: "U0ASKER",
    command: "/communitas",
    text,
    response_url: "https://hooks.slack.com/commands/T0TEST/1/abc",
    trigger_id: "1.2.3",
  }).toString();
