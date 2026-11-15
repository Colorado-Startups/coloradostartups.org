// MapLibre's CSP build ships without its own types; it is the same API as the main entry.
declare module "maplibre-gl/dist/maplibre-gl-csp.js" {
  import maplibregl from "maplibre-gl";
  export default maplibregl;
}
