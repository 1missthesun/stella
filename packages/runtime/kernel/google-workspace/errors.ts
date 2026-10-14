/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as Data from "effect/Data";

export class GoogleWorkspaceProjectRootError extends Data.TaggedError(
  "@stella/runtime/google-workspace/GoogleWorkspaceProjectRootError",
) {
  override get message() {
    return "Google Workspace project root is not under Stella state.";
  }
}

export class GoogleWorkspaceNotConnectedError extends Data.TaggedError(
  "@stella/runtime/google-workspace/GoogleWorkspaceNotConnectedError",
) {
  override get message() {
    return "Google Workspace is not connected.";
  }
}

export class GoogleWorkspaceReconnectRequiredError extends Data.TaggedError(
  "@stella/runtime/google-workspace/GoogleWorkspaceReconnectRequiredError",
) {
  override get message() {
    return "Google Workspace needs to be reconnected.";
  }
}
