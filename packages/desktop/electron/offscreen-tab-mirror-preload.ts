// Preload of the panel mirror for offscreen agent tabs (see
// services/in-app-browser/offscreen-tabs.ts). The mirror page is a bare canvas;
// this script draws the frames main sends and returns the user's input.
import { ipcRenderer } from "electron";
import {
  MIRROR_CURSOR_CHANNEL,
  MIRROR_FRAME_ACK_CHANNEL,
  MIRROR_FRAME_CHANNEL,
  MIRROR_INPUT_CHANNEL,
  type MirrorFrame,
  type MirrorInput,
  type MirrorModifier,
} from "./services/in-app-browser/offscreen-mirror-protocol.js";

const VERTEX_SHADER = `#version 300 es
in vec2 position;
out vec2 uv;
void main() {
  uv = vec2((position.x + 1.0) * 0.5, (1.0 - position.y) * 0.5);
  gl_Position = vec4(position, 0.0, 1.0);
}`;

// Frames are BGRA with premultiplied alpha; composite them over white the way
// the page would show in a window.
const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
uniform sampler2D frame;
in vec2 uv;
out vec4 color;
void main() {
  vec4 texel = texture(frame, uv);
  color = vec4(texel.bgr + vec3(1.0 - texel.a), 1.0);
}`;

const LINE_HEIGHT_PX = 40;

const KEY_CODES: Record<string, string> = {
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  " ": "Space",
  Meta: "Meta",
  OS: "Meta",
};

const NAMED_KEYS = new Set([
  "Backspace",
  "Tab",
  "Enter",
  "Escape",
  "Delete",
  "Insert",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Shift",
  "Control",
  "Alt",
  "CapsLock",
  "NumLock",
  "ScrollLock",
  "PrintScreen",
  "ContextMenu",
]);

const keyCodeFor = (key: string): string | undefined => {
  if (KEY_CODES[key]) return KEY_CODES[key];
  if (NAMED_KEYS.has(key) || /^F\d{1,2}$/.test(key)) return key;
  if (key.length === 1) return key;
  return undefined;
};

const modifiersOf = (event: MouseEvent | KeyboardEvent): MirrorModifier[] => {
  const modifiers: MirrorModifier[] = [];
  if (event.shiftKey) modifiers.push("shift");
  if (event.ctrlKey) modifiers.push("control");
  if (event.altKey) modifiers.push("alt");
  if (event.metaKey) modifiers.push("meta");
  if (event instanceof MouseEvent) {
    if (event.buttons & 1) modifiers.push("leftbuttondown");
    if (event.buttons & 2) modifiers.push("rightbuttondown");
    if (event.buttons & 4) modifiers.push("middlebuttondown");
  }
  return modifiers;
};

const BUTTONS = ["left", "middle", "right"] as const;

const send = (input: MirrorInput) => ipcRenderer.send(MIRROR_INPUT_CHANNEL, input);

const compileProgram = (gl: WebGL2RenderingContext) => {
  const shader = (type: number, source: string) => {
    const compiled = gl.createShader(type);
    if (!compiled) throw new Error("WebGL shader creation failed.");
    gl.shaderSource(compiled, source);
    gl.compileShader(compiled);
    return compiled;
  };
  const program = gl.createProgram();
  if (!program) throw new Error("WebGL program creation failed.");
  gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  return program;
};

const start = () => {
  const canvas = document.querySelector("canvas");
  const keyTarget = document.querySelector("textarea");
  if (!canvas || !keyTarget) return;
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    preserveDrawingBuffer: true,
  });
  if (!gl) return;

  const program = compileProgram(gl);
  gl.useProgram(program);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const position = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  let textureWidth = 0;
  let textureHeight = 0;
  ipcRenderer.on(
    MIRROR_FRAME_CHANNEL,
    (_event, frame: MirrorFrame, pixels: Uint8Array) => {
      try {
        if (
          frame.frameWidth !== textureWidth ||
          frame.frameHeight !== textureHeight
        ) {
          textureWidth = frame.frameWidth;
          textureHeight = frame.frameHeight;
          canvas.width = textureWidth;
          canvas.height = textureHeight;
          canvas.style.width = `${textureWidth}px`;
          canvas.style.height = `${textureHeight}px`;
          gl.viewport(0, 0, textureWidth, textureHeight);
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            textureWidth,
            textureHeight,
            0,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            null,
          );
        }
        const rowLength = Math.round(pixels.byteLength / 4 / frame.height);
        gl.pixelStorei(gl.UNPACK_ROW_LENGTH, rowLength);
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          frame.x,
          frame.y,
          frame.width,
          frame.height,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixels,
        );
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      } finally {
        ipcRenderer.send(MIRROR_FRAME_ACK_CHANNEL);
      }
    },
  );

  ipcRenderer.on(MIRROR_CURSOR_CHANNEL, (_event, cursor: string) => {
    canvas.style.cursor = cursor;
  });

  const pointer = (event: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const mouse = (
    type: "mouseDown" | "mouseUp" | "mouseMove" | "mouseLeave",
    event: MouseEvent,
  ) => {
    send({
      type,
      ...pointer(event),
      ...(type === "mouseDown" || type === "mouseUp"
        ? {
            button: BUTTONS[event.button] ?? "left",
            clickCount: Math.max(1, event.detail),
          }
        : {}),
      modifiers: modifiersOf(event),
    });
  };
  canvas.addEventListener("mousedown", (event) => {
    event.preventDefault();
    keyTarget.focus();
    mouse("mouseDown", event);
  });
  window.addEventListener("mouseup", (event) => mouse("mouseUp", event));
  window.addEventListener("mousemove", (event) => mouse("mouseMove", event));
  canvas.addEventListener("mouseleave", (event) => {
    if (event.buttons === 0) mouse("mouseLeave", event);
  });
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? LINE_HEIGHT_PX
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? canvas.clientHeight
            : 1;
      send({
        type: "mouseWheel",
        ...pointer(event),
        deltaX: -event.deltaX * unit,
        deltaY: -event.deltaY * unit,
        modifiers: modifiersOf(event),
      });
    },
    { passive: false },
  );
  window.addEventListener("contextmenu", (event) => event.preventDefault());

  const key = (type: "keyDown" | "keyUp", event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229) return;
    const keyCode = keyCodeFor(event.key);
    if (!keyCode) return;
    event.preventDefault();
    const modifiers = modifiersOf(event);
    send({ type, keyCode, modifiers });
    if (type !== "keyDown") return;
    const altGraph = event.getModifierState("AltGraph");
    if ((event.ctrlKey || event.metaKey) && !altGraph) return;
    if (event.key.length === 1) send({ type: "char", keyCode: event.key, modifiers });
    else if (event.key === "Enter") send({ type: "char", keyCode: "\r", modifiers });
  };
  window.addEventListener("keydown", (event) => key("keyDown", event), true);
  window.addEventListener("keyup", (event) => key("keyUp", event), true);
  keyTarget.addEventListener("compositionend", (event) => {
    if (event.data) send({ type: "insertText", text: event.data });
    keyTarget.value = "";
  });
  window.addEventListener("focus", () => keyTarget.focus());
  keyTarget.focus();
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
