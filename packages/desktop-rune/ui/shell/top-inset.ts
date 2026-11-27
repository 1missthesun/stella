import { createContext, useContext } from "react";

/**
 * How far a surface that runs to the window top under the floating glass top bar keeps its
 * content down: a scroll view pads its content by it so rows pass under the capsules, and
 * anything fixed starts below it. 0 where nothing floats above.
 */
export const TopInsetContext = createContext(0);

export const useTopInset = () => useContext(TopInsetContext);
