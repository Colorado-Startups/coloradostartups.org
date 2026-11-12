// Types for library.mjs, for the TypeScript tests that import it.
export interface LibrarySources {
  threadsYaml: string;
  slackYaml: string;
  dwarvesYaml: string;
}
export declare const SOURCES: LibrarySources;
export declare const OUTPUT: string;
export declare function buildLibrary(sources: LibrarySources, parse: (text: string) => unknown): unknown;
export declare function renderLibrary(library: unknown): string;
