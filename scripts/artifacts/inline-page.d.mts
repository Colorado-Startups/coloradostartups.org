// Types for inline-page.mjs, for the TypeScript test that imports it.
export interface ContrastPair {
  fg: string;
  bg: string;
  ratio: number;
  min: number;
}
export declare const MANIFEST: string;
export declare function routeOf(file: string): string;
export declare function normalizeRoute(href: string): string;
export declare function pickCandidate(srcset: string): string | null;
export declare function dropReason(code: string): string | null;
export declare function safeInline(code: string, tag: string): string;
export declare function paletteHtml(tokens: { color: Record<string, string>; roles: Record<string, string> }): string;
export declare function contrastHtml(tokens: { color: Record<string, string>; contrast: ContrastPair[] }): string;
export declare function nearMinimum(ratio: number, min: number): boolean;
export declare function mdSection(md: string, heading: string): string | null;
export declare function mdTableHtml(section: string): string | null;
export declare function bundle(esbuild: unknown, input: { file?: string; code?: string }, distDir?: string): Promise<string>;
export declare function scriptKind(type: string | null | undefined, language?: string | null): "classic" | "module" | "data";
export declare function docImageFile(ref: string, baseDir: string, root?: string): { file: string | null; reason: string | null };
export declare function unlistedPages(dir: string, manifest: { pages: { file: string }[] }): string[];
export declare function texturesCss(dir?: string, allowed?: string): string;
export declare function textureNoteHtml(css: string): string;
export declare function artStatusHtml(n: number): string;
export declare function countArt(dir?: string): number;
