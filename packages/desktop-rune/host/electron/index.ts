// The `electron` module as Electron main sees it, for Bun. Resolved by host/electron/plugin.ts.

import { app } from "./app";
import { BaseWindow, BrowserWindow, View, WebContentsView } from "./browser-window";
import { ipcMain } from "./ipc";
import { nativeImage, NativeImage } from "./native-image";
import { clipboard, ClipboardItem, dialog, globalShortcut, Menu, MenuItem, nativeTheme, Notification, powerMonitor, powerSaveBlocker, shell, Tray } from "./native";
import {
  autoUpdater, BrowserView, contentTracing, crashReporter, desktopCapturer, inAppPurchase,
  MessageChannelMain, netLog, pushNotifications, ShareMenu, systemPreferences, TouchBar, utilityProcess, webFrameMain, webUtils,
} from "./misc";
import { safeStorage } from "./safe-storage";
import { screen } from "./screen";
import { net, protocol, session, Session } from "./session";
import { WebContents, webContents } from "./web-contents";

export const electronModule = {
  app,
  autoUpdater,
  BaseWindow,
  BrowserView,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  contentTracing,
  crashReporter,
  desktopCapturer,
  dialog,
  globalShortcut,
  inAppPurchase,
  ipcMain,
  Menu,
  MenuItem,
  MessageChannelMain,
  nativeImage,
  NativeImage,
  nativeTheme,
  net,
  netLog,
  Notification,
  powerMonitor,
  powerSaveBlocker,
  protocol,
  pushNotifications,
  safeStorage,
  screen,
  session,
  Session,
  ShareMenu,
  shell,
  systemPreferences,
  TouchBar,
  Tray,
  utilityProcess,
  View,
  WebContents,
  webContents,
  WebContentsView,
  webFrameMain,
  webUtils,
};

export type ElectronModule = typeof electronModule;
