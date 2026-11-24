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
  selection: ContextMenuWireItem[];
  sections: ContextMenuWireItem[][];
  /** macOS selects the word under a right-click on a button, pill or image. */
  ignoreSelection?: boolean;
};

export type ContextMenuSelection = {
  requestId: number;
  itemId: string;
};
