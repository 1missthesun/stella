/**
 * Right-click menus. Electron main owns the menu: on a right-click it asks
 * the renderer what the clicked thing offers, merges that with what only it
 * knows (spelling, cut/copy/paste state), and shows one native menu. A pick
 * goes back to the renderer by item id.
 */

export type ContextMenuWireItem =
  | {
      type: "action";
      id: string;
      label: string;
      enabled?: boolean;
      checked?: boolean;
    }
  | { type: "separator" }
  | {
      type: "submenu";
      label: string;
      enabled?: boolean;
      items: ContextMenuWireItem[];
    };

/** What main tells the renderer about the right-click it is answering. */
export type ContextMenuCollectRequest = {
  requestId: number;
  x: number;
  y: number;
  selectionText: string;
  isEditable: boolean;
  linkURL: string;
  mediaType: string;
  srcURL: string;
};

export type ContextMenuCollectReply = {
  requestId: number;
  /** Placed right after Copy when text is selected. */
  selection: ContextMenuWireItem[];
  /** The clicked thing's own groups, innermost first. */
  sections: ContextMenuWireItem[][];
  /**
   * The selection is only the word the right-click itself selected on a
   * button, pill or image (macOS does this); leave out its Copy and Look up.
   */
  ignoreSelection?: boolean;
};

/** The item picked from the menu `requestId` showed. */
export type ContextMenuSelection = {
  requestId: number;
  itemId: string;
};
