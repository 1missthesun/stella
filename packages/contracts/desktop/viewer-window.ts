export type ViewerWindowTicket = {
  /** The only `window.open` target name main accepts, good for one window. */
  name: string;
  /** False where the compositor owns window positions (native Wayland). */
  follows: boolean;
};

export type ViewerWindowMove = { name: string; x: number; y: number };

export type ViewerWindowAct = {
  name: string;
  action: "show" | "focus" | "close";
};

export type ViewerWindowClosed = { name: string };
