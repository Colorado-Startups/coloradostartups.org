// The connector diagrams' layouts (network.ts): the nodes and links per
// seat, and their phone positions (#329). Tables only.

export type NetworkSeat = "slack-community-lead" | "photon-mountain-connector" | "fusion-canyon-connector" | "space-peak-connector";
export type NodeKind = "you" | "hub" | "sat" | "ai" | "far" | "label";
export type EdgeStyle = "main" | "bridge" | "thin" | "faint" | "ai";
export interface DiagramNode {
  id: string;
  label: string;
  x: number;
  y: number;
  kind: NodeKind;
}
export type Edge = readonly [string, string, EdgeStyle];
interface Layout {
  nodes: readonly DiagramNode[];
  edges: readonly Edge[];
}

const node = (id: string, label: string, x: number, y: number, kind: NodeKind): DiagramNode => ({ id, label, x, y, kind });

/** Fusion Canyon's or Space Peak's diagram: its helpers around you, and the other two outposts. */
function outpostLayout(home: string, others: readonly [string, string]): Layout {
  return {
    nodes: [
      node("you", "You", 250, 215, "you"),
      node("s1", "Founders", 90, 100, "sat"),
      node("s2", "Builders", 60, 215, "sat"),
      node("s3", "Mentors", 90, 330, "sat"),
      node("s4", "Event hosts", 250, 380, "sat"),
      node("s5", "Talent", 350, 55, "sat"),
      node("f1", others[0], 540, 110, "far"),
      node("f2", others[1], 540, 320, "far"),
      node("home", home, 20, 36, "label"),
    ],
    edges: [
      ["you", "s1", "main"],
      ["you", "s2", "main"],
      ["you", "s3", "main"],
      ["you", "s4", "main"],
      ["you", "s5", "main"],
      ["you", "f1", "bridge"],
      ["you", "f2", "bridge"],
      ["f1", "f2", "faint"],
    ],
  };
}

// Nodes and edges per seat. The diagrams show the helpers a seat meets;
// investors go to Paul, so none appear.
export const LAYOUTS: Readonly<Record<NetworkSeat, Layout>> = {
  "photon-mountain-connector": {
    nodes: [
      node("you", "You", 330, 215, "you"),
      node("bou", "Boulder", 150, 105, "hub"),
      node("gol", "Golden", 150, 330, "hub"),
      node("den", "Denver", 520, 215, "hub"),
      node("b1", "Founders", 50, 50, "sat"),
      node("b2", "Builders", 60, 160, "sat"),
      node("b3", "Mentors", 250, 40, "sat"),
      node("g1", "Founders", 50, 275, "sat"),
      node("g2", "Talent", 60, 390, "sat"),
      node("g3", "Event hosts", 255, 400, "sat"),
      node("d1", "Founders", 610, 120, "sat"),
      node("d2", "Helpers", 630, 230, "sat"),
      node("d3", "Builders", 600, 330, "sat"),
    ],
    edges: [
      ["you", "bou", "main"],
      ["you", "gol", "main"],
      ["you", "den", "main"],
      ["bou", "gol", "bridge"],
      ["gol", "den", "bridge"],
      ["bou", "den", "bridge"],
      ["bou", "b1", "thin"],
      ["bou", "b2", "thin"],
      ["bou", "b3", "thin"],
      ["gol", "g1", "thin"],
      ["gol", "g2", "thin"],
      ["gol", "g3", "thin"],
      ["den", "d1", "thin"],
      ["den", "d2", "thin"],
      ["den", "d3", "thin"],
    ],
  },
  "fusion-canyon-connector": outpostLayout("Fort Collins", ["Photon Mountain", "Space Peak"]),
  "space-peak-connector": outpostLayout("Colorado Springs", ["Photon Mountain", "Fusion Canyon"]),
  "slack-community-lead": {
    nodes: [
      node("you", "You", 330, 215, "you"),
      node("ai", "Communitas, AI agent", 330, 80, "ai"),
      node("pm", "Photon Mountain", 120, 140, "hub"),
      node("fc", "Fusion Canyon", 540, 140, "hub"),
      node("sp", "Space Peak", 120, 330, "hub"),
      node("on", "Founders everywhere", 540, 330, "hub"),
      node("t1", "Monday Welcome", 330, 395, "sat"),
      node("t2", "Wednesday Asks and Offers", 150, 420, "sat"),
      node("t3", "Friday Colorado Wins", 520, 420, "sat"),
    ],
    edges: [
      ["you", "pm", "main"],
      ["you", "fc", "main"],
      ["you", "sp", "main"],
      ["you", "on", "main"],
      ["ai", "you", "ai"],
      ["you", "t1", "thin"],
      ["you", "t2", "thin"],
      ["you", "t3", "thin"],
    ],
  },
};

// Phone positions (#329): the same nodes and edges in a 310-unit portrait
// drawing, as [x, y] by node id, with the drawing's height. Labels longer
// than 12 characters wrap, so they fit the narrow width.
const NARROW_LAYOUTS: Readonly<Record<"photon" | "outpost" | "slack", { H: number; at: Readonly<Record<string, readonly [number, number]>> }>> = {
  photon: {
    H: 520,
    at: {
      you: [156, 262],
      bou: [86, 124],
      gol: [86, 400],
      den: [222, 262],
      b1: [44, 44],
      b2: [40, 220],
      b3: [160, 44],
      g1: [40, 310],
      g2: [44, 486],
      g3: [168, 486],
      d1: [268, 160],
      d2: [272, 372],
      d3: [210, 448],
    },
  },
  outpost: {
    H: 500,
    at: {
      home: [12, 34],
      you: [124, 250],
      s1: [52, 120],
      s2: [44, 300],
      s3: [70, 430],
      s4: [190, 440],
      s5: [176, 104],
      f1: [236, 196],
      f2: [236, 330],
    },
  },
  slack: {
    H: 620,
    at: {
      you: [156, 300],
      ai: [156, 168],
      pm: [64, 84],
      fc: [248, 84],
      sp: [56, 330],
      on: [256, 330],
      t1: [156, 450],
      t2: [70, 540],
      t3: [242, 540],
    },
  },
};

/** A seat's layout moved to its phone positions, with the phone drawing's height. */
export function narrowLayout(seat: NetworkSeat): Layout & { H: number } {
  const { nodes, edges } = LAYOUTS[seat];
  const key = seat === "photon-mountain-connector" ? "photon" : seat === "slack-community-lead" ? "slack" : "outpost";
  const { H, at } = NARROW_LAYOUTS[key];
  return {
    H,
    edges,
    nodes: nodes.map((n) => {
      const xy = at[n.id];
      if (!xy) throw new Error(`network ${seat}: no phone position for ${n.id}`);
      return { ...n, x: xy[0], y: xy[1] };
    }),
  };
}
