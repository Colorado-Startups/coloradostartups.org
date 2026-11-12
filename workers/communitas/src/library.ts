// Everything Communitas may say on its own, validated when the Worker starts.
// Source: data/communitas/{threads,slack}.yaml and data/team/dwarves.yaml,
// bundled as generated/library.json by scripts/sync-library.mjs. A library
// that fails this schema throws at startup, so it fails tests and the deploy
// instead of reaching Slack.

import { ThreadOpenerSchema } from "@cs/shared";
import * as z from "zod";

import raw from "./generated/library.json";

const SitePath = z.string().regex(/^\/[a-z0-9/-]*$/, "a site path such as /links/");
const Line = z.string().min(1).max(300);

const LinkSchema = z.object({ label: z.string().min(1).max(80), path: SitePath }).strict();

const MessageSchema = z
  .object({
    lines: z.array(Line).min(1).max(6),
    links: z.array(LinkSchema).max(4),
  })
  .strict();

export const LibrarySchema = z
  .object({
    _generated: z.string(),
    threads: z.array(ThreadOpenerSchema).min(3),
    slack: z
      .object({
        welcome: MessageSchema.extend({ id: z.string().min(1) }),
        help: MessageSchema,
        answer: z
          .object({
            resources_heading: Line,
            canvas_label: Line,
            canvas_path: SitePath,
            empty_question: Line,
            too_long: Line,
            rate_limited: Line,
            fallback: z
              .object({
                budget: Line,
                "rate-limit": Line,
                error: Line,
                unsafe: Line,
                "no-match": Line,
              })
              .strict(),
          })
          .strict(),
      })
      .strict(),
    disclosure: z.object({ communitas: z.string().min(20), resourcus: z.string().min(20) }).strict(),
  })
  .strict();

export type Library = z.infer<typeof LibrarySchema>;
export type SlackMessageCopy = z.infer<typeof MessageSchema>;

export const LIBRARY: Library = LibrarySchema.parse(raw);
