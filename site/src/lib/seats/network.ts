// The connector diagram on a seat page: you at the center, the people you
// meet around you. The layouts are tables in network-layouts.ts; a phone
// drawing places each label clear of the links (#192, #329). viz.ts
// re-exports networkDiagram.

import { LAYOUTS, narrowLayout, type DiagramNode, type Edge, type EdgeStyle, type NetworkSeat, type NodeKind } from "./network-layouts";
import { andList } from "../text";
import { esc, f1, openSvg, overlaps, PHONE_TYPE, SEAT_NARROW_WIDTH, type Box, type FigureOptions } from "./svg";

export type { NetworkSeat } from "./network-layouts";

/** Greedy word wrap: "Slack Community Lead" becomes Slack / Community / Lead at width 10. */
function wrap(label: string, width: number): string[] {
  const lines: string[] = [];
  for (const word of label.split(" ")) {
    const last = lines[lines.length - 1];
    if (last !== undefined && last.length + 1 + word.length <= width) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

/** Plain-language <desc>: who sits at the center and who they connect. */
function describe(nodes: readonly DiagramNode[]): string {
  const center = nodes.find((n) => n.kind === "you")!.label;
  const home = nodes.find((n) => n.kind === "label")?.label;
  const names: string[] = [];
  for (const n of nodes) if (n.kind !== "you" && n.kind !== "label" && !names.includes(n.label)) names.push(n.label);
  return `${center}${home ? ` in ${home}` : ""} at the center, connected to ${andList(names)}.`;
}

const NET_TITLES: Readonly<Record<NetworkSeat, string>> = {
  "photon-mountain-connector": "Diagram: the Photon Mountain Connector links Boulder, Golden and Denver",
  "fusion-canyon-connector": "Diagram: the Fusion Canyon Connector links Northern Colorado with the other outposts",
  "space-peak-connector": "Diagram: the Space Peak Connector links the Pikes Peak region with the other outposts",
  "slack-community-lead": "Diagram: the Slack Community Lead links all three outposts online",
};

// One drawing: its size, its nodes and links, and a node by id.
interface Net {
  narrow: boolean;
  W: number;
  H: number;
  nodes: readonly DiagramNode[];
  edges: readonly Edge[];
  at: (id: string) => DiagramNode;
}

// A link as a quadratic curve from (x1, y1) to (x2, y2) through (cx, cy).
interface Curve {
  style: EdgeStyle;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  cx: number;
  cy: number;
}

/** The connector diagram for a seat: you at the center, the people you meet around you. */
export function networkDiagram(seat: NetworkSeat, { narrow = false }: FigureOptions = {}): string {
  const { nodes, edges, H } = narrow ? narrowLayout(seat) : { ...LAYOUTS[seat], H: 452 };
  const pos = new Map(nodes.map((n) => [n.id, n]));
  const net: Net = { narrow, W: narrow ? SEAT_NARROW_WIDTH : 680, H, nodes, edges, at: (id) => pos.get(id)! };
  const id = `net-${seat}${narrow ? "-n" : ""}`;
  const curves = edgeCurves(net);
  const place = labelPlacer(net, curves);
  return [
    openSvg("sv sv-net", net.W, H, `${id}-t ${id}-d`, narrow),
    `<title id="${id}-t">${esc(NET_TITLES[seat])}</title>`,
    `<desc id="${id}-d">${esc(describe(nodes))}</desc>`,
    ...curves.map(({ style, x1, y1, x2, y2, cx, cy }) => `<path class="sv-edge sv-edge--${style}" d="M${x1} ${y1}Q${f1(cx)} ${f1(cy)} ${x2} ${y2}"/>`),
    ...nodes.flatMap((n) => drawNode(net, n, place)),
    "</svg>",
  ].join("");
}

/** Each link as a quadratic curve; a bridge bows 18 units to one side. */
function edgeCurves({ edges, at }: Net): Curve[] {
  return edges.map(([a, b, style]) => {
    const { x: x1, y: y1 } = at(a);
    const { x: x2, y: y2 } = at(b);
    const bend = style === "bridge" ? 18 : 0;
    const dx = y2 - y1;
    const dy = x1 - x2;
    const ln = Math.hypot(dx, dy) || 1;
    return { style, x1, y1, x2, y2, cx: (x1 + x2) / 2 + (dx / ln) * bend, cy: (y1 + y2) / 2 + (dy / ln) * bend };
  });
}

/** 31 points along a link, its ends left out, for keeping labels off it. */
function curvePoints({ x1, y1, x2, y2, cx, cy }: Curve): (readonly [number, number])[] {
  return Array.from({ length: 31 }, (_, i) => {
    const t = (i + 1) / 32;
    const u = 1 - t;
    return [u * u * x1 + 2 * u * t * cx + t * t * x2, u * u * y1 + 2 * u * t * cy + t * t * y2] as const;
  });
}

/**
 * A label as one line, or on a phone drawing wrapped at 12 characters into
 * lines 1.15 em apart. `last` keeps the last line on y, for labels above a node.
 */
function nodeLabel(narrow: boolean, cls: string, x: number, y: number, text: string, anchor: string, last = false): string {
  const lines = narrow ? wrap(text, 12) : [text];
  const first = last ? -(lines.length - 1) * 1.15 : 0;
  const spans = lines.map((t, i) => `<tspan x="${x}" dy="${(i === 0 ? first : 1.15).toFixed(2)}em">${esc(t)}</tspan>`).join("");
  return lines.length === 1
    ? `<text class="${cls}" x="${x}" y="${y}" text-anchor="${anchor}">${esc(text)}</text>`
    : `<text class="${cls}" x="${x}" y="${y}" text-anchor="${anchor}">${spans}</text>`;
}

type LabelSide = "below" | "above" | "right" | "left" | "below-right" | "below-left" | "above-right" | "above-left";
const ALL_SIDES: readonly LabelSide[] = ["below", "above", "right", "left", "below-right", "below-left", "above-right", "above-left"];
// Every side, the given one first.
const sidesFrom = (first: LabelSide) => [first, ...ALL_SIDES.filter((sd) => sd !== first)];
// Every node's disc for label placement; "You" is drawn 30 units or more across on a phone drawing.
const DISC_R: Readonly<Record<NodeKind, number>> = { you: 34, hub: 22, far: 26, ai: 15, sat: 8, label: 0 };

/** A w-by-h label's box on one side of a node of radius r. */
function sideBox(n: DiagramNode, side: LabelSide, w: number, h: number, r: number): Box {
  const d = r * 0.75 + 4; // a diagonal label starts clear of the disc
  switch (side) {
    case "below":
      return [n.x - w / 2, n.y + r + 4, n.x + w / 2, n.y + r + 4 + h];
    case "above":
      return [n.x - w / 2, n.y - r - 6 - h, n.x + w / 2, n.y - r - 6];
    case "right":
      return [n.x + r + 6, n.y - h / 2, n.x + r + 6 + w, n.y + h / 2];
    case "left":
      return [n.x - r - 6 - w, n.y - h / 2, n.x - r - 6, n.y + h / 2];
    case "below-right":
      return [n.x + d, n.y + d, n.x + d + w, n.y + d + h];
    case "below-left":
      return [n.x - d - w, n.y + d, n.x - d, n.y + d + h];
    case "above-right":
      return [n.x + d, n.y - d - h, n.x + d + w, n.y - d];
    default:
      return [n.x - d - w, n.y - d - h, n.x - d, n.y - d];
  }
}

type PlaceLabel = (n: DiagramNode, cls: string, size: number, r: number, sides: readonly LabelSide[]) => string;

/**
 * A phone drawing's label placer. Each node's label goes on the first side
 * whose box is inside the drawing and clear of every link and of every label
 * placed before it, so no link runs through a label at its larger relative
 * size. Boxes are estimated: 0.55 em a character, lines 1.15 em apart.
 */
function labelPlacer(net: Net, curves: readonly Curve[]): PlaceLabel {
  const points = curves.flatMap(curvePoints);
  const discs = net.nodes.filter((n) => DISC_R[n.kind] > 0);
  const placed: Box[] = discs.map((n): Box => {
    const r = DISC_R[n.kind];
    return [n.x - r, n.y - r, n.x + r, n.y + r];
  });
  const linkIn = (b: Box) => points.some(([px, py]) => px > b[0] && px < b[2] && py > b[1] && py < b[3]);
  return (n, cls, size, r, sides) => {
    const lines = wrap(n.label, 12);
    const own = placed[discs.indexOf(n)];
    const w = Math.max(...lines.map((t) => t.length)) * 0.55 * size;
    const h = lines.length * 1.15 * size;
    const clear = (b: Box) =>
      b[0] >= 2 && b[2] <= net.W - 2 && b[1] >= 2 && b[3] <= net.H - 2 && !linkIn(b) && !placed.some((o) => o !== own && overlaps(b, o));
    const side = sides.find((sd) => clear(sideBox(n, sd, w, h, r))) ?? sides[0]!;
    const box = sideBox(n, side, w, h, r);
    placed.push(box);
    return placedLabel(n, cls, size, side, box, w);
  };
}

/** The text of a label placed on `side` in `box`. */
function placedLabel(n: DiagramNode, cls: string, size: number, side: LabelSide, [bx0, by0, , by1]: Box, w: number): string {
  const ascent = 0.8 * size;
  if (side === "below") return nodeLabel(true, cls, n.x, Math.round(by0 + ascent), n.label, "middle");
  if (side === "above") return nodeLabel(true, cls, n.x, Math.round(by1 - 0.25 * size), n.label, "middle", true);
  const firstBase = Math.round(by0 + ascent);
  return side.endsWith("right")
    ? nodeLabel(true, cls, Math.round(bx0), firstBase, n.label, "start")
    : nodeLabel(true, cls, Math.round(bx0 + w), firstBase, n.label, "end");
}

/** The y of the node a leaf hangs from, so its label can sit on the far side, clear of the spoke. */
function hubY({ edges, at }: Net, id: string): number {
  for (const [a, b] of edges) {
    if (b === id) return at(a).y;
    if (a === id) return at(b).y;
  }
  return 0;
}

type DiscKind = "hub" | "far" | "ai" | "sat";
const STRONG = "sv-label-strong sv-node-strong sv-halo";
const PLAIN = "sv-label sv-node sv-halo";
// Each disc node's circle class, radius, label class and phone label size.
const DISC: Readonly<Record<DiscKind, { circle: string; r: number; cls: string; size: number }>> = {
  hub: { circle: "sv-hub", r: 22, cls: STRONG, size: PHONE_TYPE.strong },
  far: { circle: "sv-far", r: 26, cls: STRONG, size: PHONE_TYPE.strong },
  ai: { circle: "sv-ai", r: 15, cls: PLAIN, size: PHONE_TYPE.label },
  sat: { circle: "sv-sat", r: 8, cls: PLAIN, size: PHONE_TYPE.label },
};

/** Where a disc node's label goes: its offset on the wide drawing, and the sides a phone drawing tries first. */
function labelSpot(net: Net, n: DiagramNode): { dy: number; last: boolean; sides: readonly LabelSide[] } {
  if (n.kind === "hub") return { dy: 42, last: false, sides: ALL_SIDES };
  if (n.kind === "ai") return { dy: -24, last: true, sides: sidesFrom("above") };
  const hub = hubY(net, n.id);
  if (n.kind === "far") {
    const above = n.y < hub;
    return { dy: above ? -38 : 48, last: above, sides: sidesFrom(above ? "above" : "below") };
  }
  const below = n.y > hub;
  return { dy: below ? 27 : -16, last: !below, sides: sidesFrom(below ? "below" : "above") };
}

/** One node: the center disc, a region name, or a disc with its label. */
function drawNode(net: Net, n: DiagramNode, place: PlaceLabel): string[] {
  if (n.kind === "you") return youNode(n, net.narrow);
  if (n.kind === "label") return [`<text class="sv-region sv-node-strong sv-halo" x="${n.x}" y="${n.y}" text-anchor="start">${esc(n.label)}</text>`];
  const s = DISC[n.kind];
  const spot = labelSpot(net, n);
  return [
    `<circle class="${s.circle}" cx="${n.x}" cy="${n.y}" r="${s.r}"/>`,
    net.narrow ? place(n, s.cls, s.size, s.r, spot.sides) : nodeLabel(false, s.cls, n.x, n.y + spot.dy, n.label, "middle", spot.last),
  ];
}

/**
 * The center disc and its words. The disc is sized for the text: the wide
 * drawing's for a 22-unit phone size, as the kit sized it; the phone
 * drawing's for its PHONE_TYPE.center. Line offsets are in em, so the block
 * stays centered when the phone rule changes the size.
 */
function youNode({ x, y, label }: DiagramNode, narrow: boolean): string[] {
  const lines = wrap(label, 10);
  const longest = Math.max(...lines.map((t) => t.length));
  const r = narrow
    ? Math.max(30, Math.round((longest * 0.75 * PHONE_TYPE.center) / 2 + 10), Math.round((lines.length * PHONE_TYPE.center * 1.1) / 2 + 16))
    : Math.max(40, Math.round((longest * 0.75 * 22) / 2 + 10), Math.round((lines.length * 24) / 2 + 16));
  const first = 0.35 - (lines.length - 1) * 0.55;
  const spans = lines.map((t, i) => `<tspan x="${x}" dy="${(i === 0 ? first : 1.1).toFixed(2)}em">${esc(t)}</tspan>`).join("");
  return [
    `<circle class="sv-you" cx="${x}" cy="${y}" r="${r}"/>`,
    `<text class="sv-center${lines.length > 1 ? " sv-center-multi" : ""}" x="${x}" y="${y}" text-anchor="middle">${spans}</text>`,
  ];
}
