// Runs axe on a built page inside jsdom's own document. axe reads
// document.title and resolves skip-link targets on the global document, so a
// page parsed into a separate DOMParser document fails document-title and
// region for reasons that are not in the page. innerHTML never runs scripts.
// Color contrast needs layout, so it runs in the browser (e2e/l9.spec.ts).
import axe from "axe-core";

export async function axeViolations(html: string): Promise<string[]> {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  document.documentElement.setAttribute("lang", parsed.documentElement.getAttribute("lang") ?? "");
  document.head.innerHTML = parsed.head.innerHTML;
  document.body.innerHTML = parsed.body.innerHTML;
  const results = await axe.run(document, { rules: { "color-contrast": { enabled: false } } });
  return results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`);
}
