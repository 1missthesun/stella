import { app } from "electron";
import { getCompileCacheDir } from "node:module";
import { resolveAppInstall } from "../app-identity.js";
import {
  getFileLogger,
  initFileLogger,
  installGlobalErrorLogging,
  type FileLogger,
} from "@stella/runtime/observability/file-logger";
import {
  initDesktopDebugLogging,
  startDesktopNetworkLogging,
} from "./desktop-debug-logging.js";

let registered = false;

const safe = (fn: () => string): string => {
  try {
    return fn();
  } catch {
    return "";
  }
};

export const initMainProcessLogging = (stellaAppDir: string): FileLogger => {
  initDesktopDebugLogging(stellaAppDir);
  const logger = initFileLogger(stellaAppDir, "main");
  if (registered) return logger;
  registered = true;

  installGlobalErrorLogging(logger);
  logger.process("main.starting", {
    pid: process.pid,
    version: safe(() => app.getVersion()),
    electron: process.versions.electron ?? "",
    node: process.versions.node ?? "",
    platform: process.platform,
    arch: process.arch,
    install: resolveAppInstall({ isPackaged: app.isPackaged }),
    startupMs: Math.round(process.uptime() * 1000),
    compileCache: safe(() => (getCompileCacheDir() ? "on" : "off")),
  });

  app.on("ready", () => {
    void startDesktopNetworkLogging();
    logger.process("main.ready", {
      pid: process.pid,
      startupMs: Math.round(process.uptime() * 1000),
      crashDumps: safe(() => app.getPath("crashDumps")),
    });
  });
  app.on("quit", (_event, exitCode) => {
    logger.process("main.quit", { pid: process.pid, exitCode });
  });

  app.on("child-process-gone", (_event, details) => {
    logger.error("main.child-process-gone", {
      processType: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      serviceName: details.serviceName,
      name: details.name,
    });
  });

  app.on("render-process-gone", (_event, _webContents, details) => {
    logger.error("main.render-process-gone", {
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });

  return logger;
};

export const getMainLogger = (): FileLogger | null => getFileLogger();
