import { readFileSync } from "node:fs";
import path from "node:path";

const macos = "packages/native/src/desktop_automation.swift";
const windows = "packages/native/src/stella_computer_helper.cpp";

export async function check(root) {
  const swift = readFileSync(path.join(root, macos), "utf8");
  const cpp = readFileSync(path.join(root, windows), "utf8");
  const swiftMatch = swift.match(/func softwareCursorImage\(\)[^{]*\{[^}]*\}\s*let encoded = "([A-Za-z0-9+/=]+)"/);
  const cppMatch = cpp.match(/kAgentCursorPngBase64 =((?:\s*"[A-Za-z0-9+/=]*")+)\s*;/);
  if (!swiftMatch) return [`${macos}: softwareCursorImage's inline PNG not found`];
  if (!cppMatch) return [`${windows}: kAgentCursorPngBase64 not found`];
  const cppArtwork = [...cppMatch[1].matchAll(/"([A-Za-z0-9+/=]*)"/g)].map((part) => part[1]).join("");
  if (swiftMatch[1] !== cppArtwork) {
    return ["the macOS and Windows computer-use helpers draw different agent cursor artwork"];
  }
  return [];
}
