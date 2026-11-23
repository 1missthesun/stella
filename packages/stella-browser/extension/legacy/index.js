/**
 * Page commands the extension runs itself, for desktops whose service does not
 * use the debugger pipe. Nothing outside this folder depends on it except
 * background.js, so it goes away in one piece: see README.md here.
 */
import { handleProfileMark, handleProfileUnmark } from "../commands/profile-mark.js";
import { getOwnerTabIds, onForgotten } from "../commands/tabs.js";
import { hideAgentCursor, takeAgentCursorTabs } from "./agent-cursor-overlay.js";
import {
  handleContent,
  handleEvaluate,
  handleGetAttribute,
  handleGetText,
  handlePdf,
  handleScreenshot,
  handleSnapshot,
} from "./capture.js";
import { handleChain } from "./chain.js";
import {
  handleCheck,
  handleClear,
  handleClick,
  handleClipboard,
  handleDblclick,
  handleDrag,
  handleFill,
  handleFocus,
  handleHover,
  handleInsertText,
  handleKeyDown,
  handleKeyUp,
  handleMouseDown,
  handleMouseMove,
  handleMouseUp,
  handlePress,
  handleScroll,
  handleScrollIntoView,
  handleSelect,
  handleType,
  handleUncheck,
  handleWait,
} from "./interaction.js";
import { handleBack, handleForward, handleNavigate, handleReload } from "./navigation.js";
import {
  handleHarStart,
  handleHarStop,
  handleRequests,
  handleResponseBody,
  handleRoute,
  handleUnroute,
} from "./network.js";
import { clearCdpEvents } from "./page-debugger.js";
import {
  handleBoundingBox,
  handleCount,
  handleInnerHtml,
  handleInnerText,
  handleInputValue,
  handleIsChecked,
  handleIsEnabled,
  handleIsVisible,
  handleStyles,
  handleWaitForUrl,
} from "./queries.js";
import { clearOwnerRefMaps, clearTabRefMap } from "./selector.js";

const PAGE_HANDLERS = {
  navigate: handleNavigate,
  open: handleNavigate,
  back: handleBack,
  forward: handleForward,
  reload: handleReload,

  click: handleClick,
  dblclick: handleDblclick,
  fill: handleFill,
  type: handleType,
  hover: handleHover,
  select: handleSelect,
  press: handlePress,
  scroll: handleScroll,
  scrollintoview: handleScrollIntoView,
  clear: handleClear,
  check: handleCheck,
  uncheck: handleUncheck,
  focus: handleFocus,
  drag: handleDrag,
  mousemove: handleMouseMove,
  mousedown: handleMouseDown,
  mouseup: handleMouseUp,
  keydown: handleKeyDown,
  keyup: handleKeyUp,
  inserttext: handleInsertText,
  clipboard: handleClipboard,

  wait: handleWait,
  waitforurl: handleWaitForUrl,

  screenshot: handleScreenshot,
  snapshot: handleSnapshot,
  pdf: handlePdf,
  content: handleContent,
  evaluate: handleEvaluate,
  gettext: handleGetText,
  getattribute: handleGetAttribute,
  innertext: handleInnerText,
  innerhtml: handleInnerHtml,
  inputvalue: handleInputValue,
  boundingbox: handleBoundingBox,
  isvisible: handleIsVisible,
  isenabled: handleIsEnabled,
  ischecked: handleIsChecked,
  count: handleCount,
  styles: handleStyles,

  requests: handleRequests,
  responsebody: handleResponseBody,
  route: handleRoute,
  unroute: handleUnroute,
  har_start: handleHarStart,
  har_stop: handleHarStop,

  site_mod_set: (command) => handleProfileMark({ ...command, marker: command.pattern }),
  site_mod_remove: handleProfileUnmark,
};

export function legacyHandlers(handlers) {
  const chainable = { ...handlers, ...PAGE_HANDLERS };
  return { ...PAGE_HANDLERS, chain: (command) => handleChain(command, chainable) };
}

export async function hideOwnerAgentCursors(command) {
  const tabIds = new Set(takeAgentCursorTabs(command.ownerId));
  for (const tabId of await getOwnerTabIds(command).catch(() => [])) {
    tabIds.add(tabId);
  }
  await Promise.all([...tabIds].map((tabId) => hideAgentCursor(tabId)));
}

onForgotten((ownerId, tabId) => {
  if (tabId == null) {
    clearOwnerRefMaps(ownerId ?? undefined);
    return;
  }
  clearTabRefMap(ownerId, tabId);
  clearCdpEvents(tabId);
});
