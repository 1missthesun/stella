export type WebGLTier = "hardware" | "software" | "none";

type WebGLProbe = {
  tier: WebGLTier;
  reliableHighp: boolean;
};

let cachedProbe: WebGLProbe | undefined;

function probeWebGL(): WebGLProbe {
  if (cachedProbe !== undefined) return cachedProbe;
  if (typeof window === "undefined") {
    return { tier: "none", reliableHighp: false };
  }

  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) {
      cachedProbe = { tier: "none", reliableHighp: false };
      return cachedProbe;
    }

    let renderer = "";
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    if (debug) {
      renderer = String(
        gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) || "",
      ).toLowerCase();
    }

    // Full highp reports 23 mantissa bits and a range exponent of 127; older Intel iGPUs report less.
    const fmt = gl.getShaderPrecisionFormat?.(
      gl.FRAGMENT_SHADER,
      gl.HIGH_FLOAT,
    );
    const reliableHighp = !!fmt && fmt.precision >= 23 && fmt.rangeMax >= 127;

    gl.getExtension("WEBGL_lose_context")?.loseContext();

    const isSoftware =
      renderer.length > 0 &&
      (renderer.includes("swiftshader") ||
        renderer.includes("llvmpipe") ||
        renderer.includes("software") ||
        renderer.includes("basic render") ||
        renderer.includes("microsoft basic"));

    cachedProbe = {
      tier: isSoftware ? "software" : "hardware",
      reliableHighp,
    };
    return cachedProbe;
  } catch {
    cachedProbe = { tier: "none", reliableHighp: false };
    return cachedProbe;
  }
}

export function getWebGLTier(): WebGLTier {
  return probeWebGL().tier;
}

export function hasReliableHighpFragment(): boolean {
  return probeWebGL().reliableHighp;
}

export function shouldRunAuroraShader(): boolean {
  return getWebGLTier() === "hardware" && hasReliableHighpFragment();
}
