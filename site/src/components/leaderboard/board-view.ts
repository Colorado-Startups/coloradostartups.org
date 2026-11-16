// The honorees board's Table and Cards switch (L3b). One list, two layouts:
// the switch sets data-view on the board's wrapper, and honorees-cards.css
// lays the same rows out as cards. Sort, search, filters, row ids and the
// city map's #company- links all act on the one DOM, so there is no second
// copy to keep in step. The choice is kept on this device only
// (localStorage), and a storage that throws or is missing never stops the
// switch. Without JavaScript the switch stays hidden and the table shows as
// it always has. Owner: L3b.

export const VIEWS = ["table", "cards"] as const;
export type BoardView = (typeof VIEWS)[number];

/** The table stays the default on every screen; a visitor picks cards. */
export const DEFAULT_VIEW: BoardView = "table";

/** The localStorage key that remembers the choice on this device. */
export const VIEW_KEY = "cs-leaderboard-view";

/** A stored or attribute value as a view, or the default when it is not one. */
export function parseView(value: unknown): BoardView {
  return VIEWS.includes(value as BoardView) ? (value as BoardView) : DEFAULT_VIEW;
}

type ViewStorage = Pick<Storage, "getItem" | "setItem">;

/** The saved view, or the default when nothing is saved or storage throws. */
export function readView(storage: ViewStorage | null | undefined): BoardView {
  try {
    return parseView(storage?.getItem(VIEW_KEY));
  } catch {
    return DEFAULT_VIEW;
  }
}

/** Saves the view; returns false when storage is missing or refuses. */
export function saveView(storage: ViewStorage | null | undefined, view: BoardView): boolean {
  try {
    if (!storage) return false;
    storage.setItem(VIEW_KEY, view);
    return true;
  } catch {
    return false;
  }
}

/** The live status line after a switch. */
export function viewStatus(view: BoardView): string {
  return view === "cards" ? "Showing the companies as cards." : "Showing the companies as a table.";
}

/** Sets the board's view and each switch button's aria-pressed to match. */
export function applyView(root: HTMLElement, view: BoardView): void {
  root.dataset.view = view;
  for (const button of root.querySelectorAll<HTMLButtonElement>("button[data-view-option]")) {
    button.setAttribute("aria-pressed", String(button.dataset.viewOption === view));
  }
}

/** The page's localStorage, or null where reading it throws. */
function deviceStorage(win: Window): ViewStorage | null {
  try {
    return win.localStorage;
  } catch {
    return null;
  }
}

/**
 * Wires the switch on one board: shows it, applies the saved view, and saves
 * each new choice. `storage` defaults to the page's localStorage.
 */
export function initBoardView(root: HTMLElement, storage: ViewStorage | null = deviceStorage(window)): void {
  const group = root.querySelector<HTMLElement>("[data-board-view]");
  if (!group) return;
  const status = root.querySelector<HTMLElement>("[data-view-status]");
  applyView(root, readView(storage));
  for (const button of group.querySelectorAll<HTMLButtonElement>("button[data-view-option]")) {
    button.addEventListener("click", () => {
      const view = parseView(button.dataset.viewOption);
      if (root.dataset.view === view) return;
      applyView(root, view);
      saveView(storage, view);
      if (status) status.textContent = viewStatus(view);
    });
  }
  group.hidden = false;
}
