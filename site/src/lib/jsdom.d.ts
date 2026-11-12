// jsdom ships no types and @types/jsdom is not installed (package.json is
// orchestrator-owned). lib/plot.ts needs only this much of the API.
declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string);
    readonly window: Window & typeof globalThis;
  }
}
