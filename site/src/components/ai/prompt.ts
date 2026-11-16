// The "Ask your AI" row (step A3a of the 2026-11-15 engagement plan): one
// prompt built from the page's subject, and two links that open it in an AI
// chat. Copy prompt is the main action. Neither vendor documents its ?q=
// link, so both links are best effort. Owner: A3a.

export const MCP_URL = "https://coloradostartups.org/mcp";
export const SITE = "https://coloradostartups.org";

/** Each encoded link stays under this many characters. */
export const MAX_LINK = 2000;

const CLAUDE_NEW = "https://claude.ai/new?q=";
const CHATGPT_NEW = "https://chatgpt.com/?q=";

export const DEFAULT_QUESTION = "What should a Colorado founder know about this, and what should they do first?";

export interface AskContext {
  /** What the page is about, in a few words: a guide's title or a region's name. */
  subject: string;
  /** The page's path on the site, such as /guides/funding-programs/. */
  path: string;
  /** The question to ask. Defaults to DEFAULT_QUESTION. */
  question?: string;
}

export interface AskAiLinks {
  prompt: string;
  claude: string;
  chatgpt: string;
}

/** The prompt text for one subject, page and question. */
export function buildPrompt(subject: string, path: string, question: string = DEFAULT_QUESTION): string {
  const page = new URL(path, SITE).href;
  return [
    // The subject comes before the site's name: "the Colorado Startups page
    // \"Funding programs\"" would read as a fund of ours (guides hard
    // constraint 8, test/dom/l23/guides.test.ts).
    `I'm reading "${subject}" (${page}) on Colorado Startups.`,
    `Use the Colorado Startups MCP server at ${MCP_URL} (public, no key needed) to look things up.`,
    question,
    "Name the Colorado Startups pages you used.",
  ].join(" ");
}

export const claudeLink = (prompt: string): string => CLAUDE_NEW + encodeURIComponent(prompt);
export const chatgptLink = (prompt: string): string => CHATGPT_NEW + encodeURIComponent(prompt);

const longest = (prompt: string): number => Math.max(claudeLink(prompt).length, chatgptLink(prompt).length);

/** Cuts text to at most `max` characters at a word break, ending in an ellipsis. */
function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, Math.max(0, max - 1));
  const space = cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * The prompt and both links for one page. A long subject or question is cut
 * at a word break until each encoded link is under MAX_LINK characters; the
 * subject always keeps its first words, so the prompt still names it.
 */
export function askAiLinks({ subject, path, question = DEFAULT_QUESTION }: AskContext): AskAiLinks {
  let s = subject.trim();
  let q = question.trim();
  let prompt = buildPrompt(s, path, q);
  // Trim the question first, then the subject, down to a floor that keeps
  // each one readable.
  while (longest(prompt) >= MAX_LINK && q.length > 40) {
    q = shorten(q, q.length - 20);
    prompt = buildPrompt(s, path, q);
  }
  while (longest(prompt) >= MAX_LINK && s.length > 20) {
    s = shorten(s, s.length - 20);
    prompt = buildPrompt(s, path, q);
  }
  if (longest(prompt) >= MAX_LINK) throw new Error(`Ask-AI prompt for ${path} cannot fit in ${MAX_LINK} characters`);
  return { prompt, claude: claudeLink(prompt), chatgpt: chatgptLink(prompt) };
}

export const COPIED = "Copied. Paste it into any AI chat.";
export const COPY_FAILED = "Your browser blocked the copy. The prompt is selected; copy it from the box.";
