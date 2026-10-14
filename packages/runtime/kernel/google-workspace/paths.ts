/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

let projectRoot = "";

export function setGoogleWorkspaceProjectRoot(root: string): void {
  projectRoot = root;
}

export function getProjectRoot(): string {
  return projectRoot;
}
