// "Join the Slack" in one place. WAYS_IN.slack opens a Google Form today, so
// every Join the Slack link on home is described by one visible note that
// says so: the hero shows the note, and the doors' links point at it with
// aria-describedby (WelcomeDesk compact). When the join link switches to the
// on-site form (/join/slack/, step P5a), change the note here.
import { WAYS_IN } from "@cs/shared";

export const SLACK_JOIN = {
  href: WAYS_IN.slack,
  label: "Join the Slack",
  /** The note's element id. The hero renders it; other links on home reference it. */
  noteId: "slack-form-note",
  note: "Join the Slack opens a Google Form.",
} as const;
