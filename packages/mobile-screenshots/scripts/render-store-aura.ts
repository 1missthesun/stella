import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { chromium } from "playwright";

import { vertex, fragment } from "./store-aura-shader";

const source = await readFile(path.resolve("scripts/store-aura-shader.ts"), "utf8");
const targets = {
  // Feature graphic and Chrome Web Store.
  panorama: { file: "store-aura-panorama", width: 6144, height: 1600, domain: [0.4, 1], liftWhite: false,
    uniforms: { uTime: 8, uAspect: 6144 / 1600 / 0.6, uStrength: 1, uScale: 1600 / 900 } },
  // Mobile store set: one continuous strip behind all eight slides. Curtains stay at full
  // strength; only the flat wash between them is lifted toward white.
  set: { file: "store-aura-set", width: 8192, height: 2224, domain: [0.75, 1.75], liftWhite: true,
    uniforms: { uTime: 8, uAspect: 10, uStrength: 1, uScale: 1 } },
} as const;
const target = targets[(process.argv[2] ?? "set") as keyof typeof targets];
if (!target) throw new Error("Use: render-store-aura.ts [set|panorama]");
const { width, height, uniforms, liftWhite } = target;
const [domainStart, domainEnd] = target.domain;
const directory = path.resolve("public/brand");
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "chrome",
  args: ["--enable-webgl", "--enable-unsafe-swiftshader"] });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 500 } });
  const result = await page.evaluate(({ vertex, fragment, width, height, domainStart, domainEnd, uniforms, liftWhite }) => {
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: false,
      antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL unavailable; do not substitute a CSS gradient");
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!; gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "Shader compile failed");
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment)); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "Shader link failed");
    gl.useProgram(program);
    const attribute = (name: string, values: number[]) => {
      const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW);
      const location = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
    };
    attribute("position", [-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]);
    attribute("uv", [domainStart,0, domainEnd,0, domainStart,1,
      domainStart,1, domainEnd,0, domainEnd,1]);
    for (const [name, value] of Object.entries(uniforms)) gl.uniform1f(gl.getUniformLocation(program, name), value);
    gl.viewport(0, 0, width, height); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.BLEND); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.finish();
    const error = gl.getError(); if (error !== gl.NO_ERROR) throw new Error(`WebGL error ${error}`);
    const flat = document.createElement("canvas");
    flat.width = width; flat.height = height;
    const context = flat.getContext("2d")!;
    context.drawImage(canvas, 0, 0);
    if (liftWhite) {
      const image = context.getImageData(0, 0, width, height);
      for (let i = 3; i < image.data.length; i += 4) {
        const alpha = image.data[i] / 255;
        image.data[i] = Math.round(255 * (alpha < 0.34 ? (alpha / 0.34) * 0.15 : 0.15 + ((alpha - 0.34) / 0.66) * 0.85));
      }
      context.putImageData(image, 0, 0);
    }
    return { bytes: (liftWhite ? flat.toDataURL("image/webp", 0.95) : canvas.toDataURL("image/png")).split(",")[1], renderer: gl.getParameter(gl.RENDERER) as string };
  }, { vertex, fragment, width, height, domainStart, domainEnd, uniforms, liftWhite });
  const bytes = Buffer.from(result.bytes, "base64");
  const output = path.join(directory, `${target.file}.${liftWhite ? "webp" : "png"}`);
  await writeFile(output, bytes);
  await writeFile(path.join(directory, target.file === "store-aura-set" ? "store-aura-set-provenance.json" : "store-aura-provenance.json"), JSON.stringify({
    source: "packages/mobile-screenshots/scripts/store-aura-shader.ts",
    sourceSha256: createHash("sha256").update(source).digest("hex"),
    vertexSha256: createHash("sha256").update(vertex).digest("hex"),
    fragmentSha256: createHash("sha256").update(fragment).digest("hex"),
    shaderChanged: false, frozenTime: "Website reduced-motion still:8seconds",
    width, height, domain: { x: [domainStart, domainEnd], y: [0,1] }, uniforms,
    washLiftedTowardWhite: liftWhite,
    alpha: "Transparent straight-alpha shader output, composited over white by store layout",
    continuity: "One shared panorama; adjacent index/count segments, no per-slide shader reset",
    renderer: result.renderer, outputSha256: createHash("sha256").update(bytes).digest("hex"),
  }, null, 2) + "\n");
  console.log(`Rendered aura: ${output}`);
} finally { await browser.close(); }
