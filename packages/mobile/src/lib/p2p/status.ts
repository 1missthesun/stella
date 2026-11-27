import type { P2pComputer } from "@stella/contracts/p2p";

/** The catalog key for how a paired computer's link stands (desktop's `devices.status.*`). */
export const computerStatusKey = (computer: P2pComputer): string => {
  switch (computer.link.state) {
    case "online":
      return computer.link.path?.kind === "relay" ? "devices.status.onlineRelay" : "devices.status.online";
    case "offline":
      return "devices.status.offline";
    case "revoked":
    case "not_paired":
      return "devices.status.unpaired";
    default:
      return "devices.status.connecting";
  }
};
