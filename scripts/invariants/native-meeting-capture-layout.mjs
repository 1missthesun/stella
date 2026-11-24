import { readFileSync } from "node:fs";
import path from "node:path";

const helpers = ["packages/native/src/meeting_capture.swift", "packages/native/src/meeting_capture.cpp"];

const sharedNames = [
  "meeting_capture.pid",
  "meeting_capture.state.json",
  "session.json",
  "segments.jsonl",
  "seg-",
  '"system"',
  '"mic"',
  "running",
  "recording",
  "paused",
  "sessionId",
  "startedAtMs",
  "endedAtMs",
  "segmentSeconds",
  "streams",
];

export async function check(root) {
  const problems = [];
  for (const helper of helpers) {
    const source = readFileSync(path.join(root, helper), "utf8");
    for (const name of sharedNames) {
      if (!source.includes(name)) {
        problems.push(`${helper}: no longer uses ${name}; the macOS and Windows meeting recorders must write the same on-disk layout`);
      }
    }
  }
  return problems;
}
