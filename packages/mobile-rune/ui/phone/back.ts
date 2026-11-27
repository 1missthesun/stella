// Android's back button (the app sends `phone.back`; iOS has none). Like a native Android app, it
// closes the topmost thing first: an open menu, dialog or sheet, the pairing page, then a drawer, then a full-screen
// view. With nothing open it goes back to the Chat tab, and from Chat it leaves the app, which
// stays alive in the background (`app.background`), as React Native's back does.

import { dismissTopModal } from "../../../desktop-rune/host/reconciler";
import { onPhoneEvent, phonePost } from "../native/app";
import { phoneNav } from "./nav";
import { phoneViewScreen } from "./ViewScreen";
import { connectComputer } from "../computer/ConnectComputer";

function back() {
  if (dismissTopModal()) return;
  if (connectComputer.isOpen()) return connectComputer.close();
  const { tab, drawer } = phoneNav.get();
  if (drawer) return phoneNav.closeDrawer();
  if (phoneViewScreen.isOpen()) return phoneViewScreen.close();
  if (tab !== "chat") return phoneNav.selectTab("chat");
  phonePost({ cmd: "app.background" });
}

let installed = false;

export function installBackButton() {
  if (installed) return;
  installed = true;
  onPhoneEvent("back", back);
}
