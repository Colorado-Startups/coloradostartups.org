// Paul's standing rule for Fusion Canyon (decision 45): "Named for the canyon.
// Built on the plain." Copy never places the region inside a canyon. Shared by
// the unit test on data/regions/ and the DOM test on the built page.
export const INSIDE_A_CANYON =
  /\b(?:in|inside|within|into|down|deep in|at the bottom of|on the floor of)\s+(?:the|a|its)\s+canyon\b|\bcanyon\s+(?:floor|walls?|bottom)\b/i;
