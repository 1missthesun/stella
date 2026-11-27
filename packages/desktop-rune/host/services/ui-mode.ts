// The build desktop-ui runs as: production under a launcher, as Electron's renderer is built there,
// else development; STELLA_RUNE_UI_MODE overrides. React, one external shared by the host's
// reconciler and the UI bundle, follows it: its packages pick their build from NODE_ENV when first
// required, and a launcher leaves NODE_ENV unset.

export const uiBuildMode = (): "production" | "development" => {
  const forced = process.env.STELLA_RUNE_UI_MODE;
  if (forced === "production" || forced === "development") return forced;
  return process.env.STELLA_LAUNCHER === "1" ? "production" : "development";
};

const REACT_MODULES = ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-reconciler", "react-reconciler/constants"];

/** Loads React's packages in the build of the UI mode; runs before anything else requires React. */
export function pinReactBuild() {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = uiBuildMode();
  try {
    for (const name of REACT_MODULES) require(name);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
}
