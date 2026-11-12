// Every word the sign-up form shows, in one place, so the form, the thanks
// page copy in L6's report and the tests agree. Name and description come from
// decision 23 (the LinkedIn project's newsletter plan, section 2).

export const NEWSLETTER_NAME = "Startupers";

export const newsletterCopy = {
  title: `Get ${NEWSLETTER_NAME}`,
  description:
    "Colorado founders, startups and builders: wins, lessons and events from the Colorado Startups community.",
  why: [
    "It comes every other Tuesday, starting Nov 17, 2026. Each edition has Colorado wins, one builder lesson and what is on the calendar.",
    "We email you a confirmation link first. Nothing else arrives until you click it, and every email has an unsubscribe link.",
  ],
  hint: "We use your address only for Startupers and occasional Colorado Startups news.",
  button: "Subscribe",
  privacyLead: "Kit sends Startupers for us. Read our",
  // One message per error code the Worker can return (worker/routes/subscribe.ts).
  errors: {
    invalid: "Enter an email address like name@example.com.",
    verification: "We could not confirm you are a person. Please try again.",
    ratelimit: "That was a lot of tries. Wait a minute, then try again.",
    delivery: "We could not reach our email service. Please try again in a few minutes.",
    unavailable: "Sign-up is not open yet. Please check back soon.",
  },
} as const;

export type NewsletterErrorCode = keyof typeof newsletterCopy.errors;
