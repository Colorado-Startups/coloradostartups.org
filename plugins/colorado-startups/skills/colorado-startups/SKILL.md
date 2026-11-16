---
name: colorado-startups
description: Use for questions about starting or growing a company in Colorado. Covers Colorado startup resources (programs, investors, coworking and services for founders) and upcoming Colorado startup events. Also covers the companies on the Colorado Startups Leaderboard, the founder guides and the three Colorado Startups regions. Answers from the Colorado Startups MCP server, which is read-only and needs no key.
---

# Colorado Startups

Answer from the Colorado Startups MCP server at https://coloradostartups.org/mcp. It is read-only and needs no key. Founders building in Colorado come first.

## Which tool for which question

| The founder asks | Call | Arguments |
| --- | --- | --- |
| Where do I start, or what next at my stage? | `path` | `stage`; add `need` and `region` to narrow it |
| A program, investor, space, company or guide by words | `search` | `words`; add `type` and `region` |
| One Leaderboard company | `search` with type company, then `company` | `id` from the search |
| One founder guide in full | `search` with type guide, then `guide` | `slug` from the search |
| What is on this week? | `this_week` | `region` |
| Events between two days | `events` | `from` and `to` as YYYY-MM-DD; add `region` |
| What is in my part of Colorado? | `region` | `id` |

## In what order

| Step | Do |
| --- | --- |
| 1 | Ask for the founder's stage and city when the question does not give them |
| 2 | Call the tool from the table above |
| 3 | For a company or guide the results name, call `company` or `guide` for the full record |
| 4 | When `this_week` finds nothing, call `events` with a longer range, or `region` |

For a whole plan, use a prompt. Each one sets out the tools to call, in order.

| Prompt | Use when the founder wants |
| --- | --- |
| `plan_my_founder_week` | a plan for the week ahead: events, next steps and a guide |
| `find_my_first_resources` | their first Startup Resources, with the region's overview and a guide |

## Stages and regions

| Argument | Values |
| --- | --- |
| `stage` | `idea`, `launch`, `growth` or `support` |
| `region` | `photon-mountain`: Boulder, Golden, Arvada and Denver |
| `region` | `space-peak`: Colorado Springs and Fountain |
| `region` | `fusion-canyon`: Fort Collins, Loveland and Windsor |

## Limits

| Tool | Returns at most |
| --- | --- |
| Every tool | 25 results, best or soonest first |
| `path` | 5 Startup Resources, each with one line on why it fits |
| `this_week` | 10 events in the next 7 days, today included |
| `region` | 10 resources, 10 companies and 5 upcoming events |

Days and times are Mountain Time.

## How to cite

| Do | How |
| --- | --- |
| Link each result | Use the link to its page on coloradostartups.org that each result carries |
| Credit the data | The data is free under CC BY 4.0: credit Colorado Startups and link https://coloradostartups.org/data/. |
| Send people to the source | Tell people to check each organization's own site, since listings change |

## What the server does not know

| Not in the data | Answer |
| --- | --- |
| Member lists, or who belongs to Colorado Startups | Say the server has no member lists |
| People: founders, staff, contact details | Say it holds organizations, companies, events and guides, not people |
| Private or paid data | Say it holds only the site's open data |
| Anything the results do not show | Say you do not know; do not fill the gap from memory |
