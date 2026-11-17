/**
 * The /security hero: a white wall in a white studio, stopping black shots.
 *
 * Pass 1 ray-marches the still scene (floor, wall, the laptop it shelters)
 * with soft shadows and occlusion, draws the shots as analytic spheres and
 * writes depth. Pass 2 draws the pieces each shot breaks into as lit sphere
 * impostors, depth-tested against pass 1. Everything is a pure function of
 * time (no simulation state), so pausing, resuming and the reduced-motion
 * still frame are just "render at t".
 */

type Vec3 = [number, number, number];
type Mat4 = Float32Array;

export type WallLayout = {
  /** Where the wall's middle sits on the canvas, in NDC (-1..1). */
  centerX: number;
  centerY: number;
  /** How much of the canvas height (0..1) the wall's height takes. */
  wallHeight: number;
  /** Never let the scene's width exceed this share of the canvas width. */
  maxWidth: number;
};

export type WallScene = {
  render: (t: number) => void;
  resize: (width: number, height: number, dpr: number, layout: WallLayout) => void;
  setScreen: (source: TexImageSource) => void;
  dispose: () => void;
};

// ---------------------------------------------------------------- scene setup

const WALL_ANGLE = (40 * Math.PI) / 180;
/**
 * Which side the shots come from: +1 from the right. The copy sits on the
 * left of the hero, so the shots enter from the empty right edge and the
 * laptop shelters on the copy's side of the wall.
 */
const SIDE = 1;
/** Outward normal of the face the shots hit, and the wall's long axis. */
const WN: Vec3 = [SIDE * Math.cos(WALL_ANGLE), 0, Math.sin(WALL_ANGLE)];
const WT: Vec3 = [-SIDE * Math.sin(WALL_ANGLE), 0, Math.cos(WALL_ANGLE)];
const WC: Vec3 = [0, 1.2, 0];
const WH: Vec3 = [0.12, 1.2, 1.8];

const LAPTOP_POS: Vec3 = [-SIDE * 1.22, 0, 0.32];
const CAMERA_TARGET: Vec3 = [-SIDE * 0.45, 1.0, 0.4];
const CAMERA_DIST = 13;
const CAMERA_YAW = (-SIDE * 14 * Math.PI) / 180;
const CAMERA_PITCH = (11 * Math.PI) / 180;

const LIGHT: Vec3 = normalize([SIDE * 0.5, 0.86, 0.3]);
const FILL: Vec3 = normalize([-SIDE * 0.9, 0.35, 0.4]);

const SHOT_R = 0.12;
const SHOT_SPEED = 6.2;
const SHOT_GAP = 1.75;
const MAX_SHOTS = 6;
const MAX_RIPPLES = 4;
const MAX_PIECES = 640;
const PIECE_LIFE = 2.6;

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Deterministic noise in [0, 1): the same shot always flies the same way. */
function hash(n: number) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/** The laptop faces the viewer, turned a little toward the wall. */
const LAPTOP_YAW =
  Math.atan2(
    Math.sin(CAMERA_YAW) * CAMERA_DIST + CAMERA_TARGET[0] - LAPTOP_POS[0],
    Math.cos(CAMERA_YAW) * CAMERA_DIST + CAMERA_TARGET[2] - LAPTOP_POS[2],
  ) + SIDE * 0.3;
const LX: Vec3 = [Math.cos(LAPTOP_YAW), 0, -Math.sin(LAPTOP_YAW)];
const LZ: Vec3 = [Math.sin(LAPTOP_YAW), 0, Math.cos(LAPTOP_YAW)];

const glslVec = (v: Vec3) => `vec3(${v.map((n) => n.toFixed(6)).join(",")})`;

// ------------------------------------------------------------------- shaders

const QUAD_VS = /* glsl */ `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const SCENE_FS = /* glsl */ `#version 300 es
precision highp float;

uniform vec2 uRes;
uniform mat4 uInvViewProj;
uniform mat4 uViewProj;
uniform vec3 uCam;
uniform vec4 uShot[${MAX_SHOTS}];
uniform vec4 uRipple[${MAX_RIPPLES}];
uniform sampler2D uScreen;

out vec4 outColor;

const vec3 WN = ${glslVec(WN)};
const vec3 WT = ${glslVec(WT)};
const vec3 WC = ${glslVec(WC)};
const vec3 WH = ${glslVec(WH)};
const vec3 LP = ${glslVec(LAPTOP_POS)};
const vec3 LX = ${glslVec(LX)};
const vec3 LZ = ${glslVec(LZ)};
const vec3 L = ${glslVec(LIGHT)};
const vec3 FILL = ${glslVec(FILL)};
const float TILT = 0.30;

// The objects all live in this box; rays that miss it only see the floor.
const vec3 BMIN = vec3(-2.4, -0.1, -1.8);
const vec3 BMAX = vec3(2.4, 2.55, 2.0);

float sdRoundBox(vec3 p, vec3 b, float r) {
  vec3 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

vec3 wallLocal(vec3 p) {
  vec3 q = p - WC;
  return vec3(dot(q, WN), q.y, dot(q, WT));
}

// The laptop is modelled at real size and drawn a little larger, so it reads.
const float LS = 1.3;

vec3 laptopLocal(vec3 p) {
  vec3 q = (p - LP) / LS;
  return vec3(dot(q, LX), q.y, dot(q, LZ));
}

vec3 screenLocal(vec3 l) {
  vec3 d = l - vec3(0.0, 0.022, 0.0);
  vec3 up = vec3(0.0, cos(TILT), -sin(TILT));
  vec3 fw = vec3(0.0, sin(TILT), cos(TILT));
  return vec3(d.x, dot(d, up), dot(d, fw));
}

// x: distance, y: material (1 wall, 2 laptop body, 3 screen)
vec2 mapObjects(vec3 p) {
  float w = sdRoundBox(wallLocal(p), WH, 0.045);
  vec3 l = laptopLocal(p);
  float base = sdRoundBox(l - vec3(0.0, 0.011, 0.25), vec3(0.37, 0.011, 0.25), 0.01) * LS;
  vec3 s = screenLocal(l);
  float scr = sdRoundBox(s - vec3(0.0, 0.25, -0.007), vec3(0.37, 0.25, 0.007), 0.012) * LS;
  vec2 res = vec2(w, 1.0);
  if (base < res.x) res = vec2(base, 2.0);
  if (scr < res.x) res = vec2(scr, s.z > -0.0015 && abs(s.x) < 0.352 && s.y > 0.03 && s.y < 0.48 ? 3.0 : 2.0);
  return res;
}

float mapAll(vec3 p) {
  return min(mapObjects(p).x, p.y);
}

vec2 boxHit(vec3 ro, vec3 rd) {
  vec3 inv = 1.0 / rd;
  vec3 t0 = (BMIN - ro) * inv;
  vec3 t1 = (BMAX - ro) * inv;
  vec3 tmin = min(t0, t1);
  vec3 tmax = max(t0, t1);
  return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}

vec3 calcNormal(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  const float h = 0.0008;
  return normalize(
    k.xyy * mapObjects(p + k.xyy * h).x +
    k.yyx * mapObjects(p + k.yyx * h).x +
    k.yxy * mapObjects(p + k.yxy * h).x +
    k.xxx * mapObjects(p + k.xxx * h).x);
}

float softShadow(vec3 ro, vec3 rd) {
  vec2 b = boxHit(ro, rd);
  if (b.x > b.y || b.y < 0.0) return 1.0;
  float t = max(b.x, 0.02);
  float res = 1.0;
  float ph = 1e10;
  for (int i = 0; i < 72; i++) {
    float h = mapObjects(ro + rd * t).x;
    float y = h * h / (2.0 * ph);
    float d = sqrt(max(h * h - y * y, 0.0));
    res = min(res, 6.0 * d / max(0.0, t - y));
    ph = h;
    t += clamp(h, 0.01, 0.12);
    if (res < 0.002 || t > b.y) break;
  }
  res = clamp(res, 0.0, 1.0);
  return res * res * (3.0 - 2.0 * res);
}

float sphereShadow(vec3 ro, vec3 rd, vec4 sph) {
  vec3 oc = ro - sph.xyz;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - sph.w * sph.w;
  float h = b * b - c;
  float d = sqrt(max(0.0, sph.w * sph.w - h)) - sph.w;
  float t = -b - sqrt(max(h, 0.0));
  return t < 0.0 ? 1.0 : smoothstep(0.0, 1.0, 2.2 * d / t * 4.0);
}

float sphereOcclusion(vec3 p, vec3 n, vec4 sph) {
  vec3 di = sph.xyz - p;
  float l = length(di);
  return 1.0 - max(0.0, dot(n, di / l)) * (sph.w * sph.w) / (l * l);
}

float ambientOcclusion(vec3 p, vec3 n) {
  float occ = 0.0;
  float sca = 1.0;
  for (int i = 0; i < 5; i++) {
    float h = 0.02 + 0.13 * float(i);
    float d = mapAll(p + n * h);
    occ += (h - d) * sca;
    sca *= 0.78;
  }
  return clamp(1.0 - 1.35 * occ, 0.0, 1.0);
}

float sphereHit(vec3 ro, vec3 rd, vec4 sph) {
  vec3 oc = ro - sph.xyz;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - sph.w * sph.w;
  float h = b * b - c;
  if (h < 0.0) return -1.0;
  return -b - sqrt(h);
}

// A soft studio: bright overhead, a large softbox where the key light is.
vec3 studio(vec3 r) {
  vec3 c = mix(vec3(0.70), vec3(1.0), smoothstep(-0.25, 0.5, r.y));
  c += vec3(2.6) * smoothstep(0.86, 0.97, dot(r, L));
  c += vec3(0.6) * smoothstep(0.55, 0.95, dot(r, FILL));
  return c;
}

vec3 shadeBlack(vec3 n, vec3 rd) {
  vec3 r = reflect(rd, n);
  float f = 0.035 + 0.965 * pow(1.0 - max(dot(n, -rd), 0.0), 5.0);
  float diff = max(dot(n, L), 0.0);
  return vec3(0.006) + vec3(0.01) * diff + studio(r) * f * 0.85;
}

float rippleField(vec3 p, out vec2 grad) {
  vec3 l = wallLocal(p);
  grad = vec2(0.0);
  if (l.x < WH.x - 0.01) return 0.0;
  // Only the flat of the face ripples; the edges stay crisp.
  float face = smoothstep(0.0, 0.18, WH.y - abs(l.y)) * smoothstep(0.0, 0.18, WH.z - abs(l.z));
  if (face <= 0.0) return 0.0;
  float total = 0.0;
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    vec4 rp = uRipple[i];
    if (rp.w <= 0.0) continue;
    vec2 d = vec2(l.z, l.y) - rp.xy;
    float r = length(d) + 1e-4;
    // One soft ring running out from the hit and settling: the wall takes
    // the blow and is untouched after.
    float front = 0.05 + rp.z * 1.4;
    float x = r - front;
    float k = 60.0;
    float bump = exp(-x * x * k) * exp(-rp.z * 4.5) * rp.w * smoothstep(0.0, 0.06, rp.z) * smoothstep(0.75, 0.4, front);
    total += bump;
    grad += (d / r) * (-2.0 * k * x * bump) * 0.03 * face;
  }
  return total;
}

void main() {
  vec2 ndc = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  vec4 nearP = uInvViewProj * vec4(ndc, -1.0, 1.0);
  vec4 farP = uInvViewProj * vec4(ndc, 1.0, 1.0);
  vec3 ro = uCam;
  vec3 rd = normalize(farP.xyz / farP.w - nearP.xyz / nearP.w);

  float tFloor = rd.y < 0.0 ? -ro.y / rd.y : 1e9;
  float tHit = 1e9;
  float mat = 0.0;

  vec2 b = boxHit(ro, rd);
  if (b.x < b.y && b.y > 0.0) {
    float t = max(b.x, 0.0);
    float tEnd = min(b.y, tFloor);
    for (int i = 0; i < 110; i++) {
      vec2 h = mapObjects(ro + rd * t);
      if (h.x < 0.0006 * t) { tHit = t; mat = h.y; break; }
      t += h.x;
      if (t > tEnd) break;
    }
  }
  if (tHit > tFloor) { tHit = tFloor; mat = 0.0; }

  int shotHit = -1;
  for (int i = 0; i < ${MAX_SHOTS}; i++) {
    if (uShot[i].w <= 0.0) continue;
    float ts = sphereHit(ro, rd, uShot[i]);
    if (ts > 0.0 && ts < tHit) { tHit = ts; shotHit = i; }
  }

  vec3 col = vec3(1.0);
  float depth = 1.0;

  if (tHit < 1e8) {
    vec3 p = ro + rd * tHit;
    vec4 clip = uViewProj * vec4(p, 1.0);
    depth = clip.z / clip.w * 0.5 + 0.5;

    if (shotHit >= 0) {
      vec4 s = uShot[0];
      for (int i = 0; i < ${MAX_SHOTS}; i++) if (i == shotHit) s = uShot[i];
      vec3 n = normalize(p - s.xyz);
      col = shadeBlack(n, rd);
    } else {
      vec3 n = mat == 0.0 ? vec3(0.0, 1.0, 0.0) : calcNormal(p);
      vec3 albedo = vec3(0.985);
      float spec = 0.0;
      vec3 emit = vec3(0.0);
      if (mat == 1.0) {
        vec2 g;
        rippleField(p, g);
        n = normalize(n + (WT * g.x + vec3(0.0, 1.0, 0.0) * g.y) * 0.5);
        albedo = vec3(0.975);
        spec = 0.05;
      } else if (mat == 2.0) {
        albedo = vec3(0.86, 0.865, 0.875);
        spec = 0.22;
      } else if (mat == 3.0) {
        vec3 s = screenLocal(laptopLocal(p));
        vec2 uv = vec2((s.x + 0.352) / 0.704, 1.0 - (s.y - 0.03) / 0.45);
        emit = texture(uScreen, uv).rgb;
        albedo = vec3(0.0);
        spec = 0.35;
      }

      vec3 sp = p + n * 0.003;
      float sh = softShadow(sp, L);
      float occ = mat == 0.0 && (b.x > b.y || tFloor < b.x - 1.2) ? 1.0 : ambientOcclusion(p, n);
      for (int i = 0; i < ${MAX_SHOTS}; i++) {
        if (uShot[i].w <= 0.0) continue;
        sh *= sphereShadow(sp, L, uShot[i]);
        occ *= sphereOcclusion(p, n, uShot[i]);
      }

      float diff = max(dot(n, L), 0.0);
      float sky = 0.62 + 0.38 * (n.y * 0.5 + 0.5);
      vec3 lin = vec3(0.0);
      lin += sky * vec3(0.78) * occ;
      lin += diff * sh * vec3(0.5, 0.495, 0.48);
      col = albedo * lin;
      col += emit * mix(0.9, 1.0, occ);
      if (spec > 0.0) {
        vec3 r = reflect(rd, n);
        float f = spec * (0.04 + 0.96 * pow(1.0 - max(dot(n, -rd), 0.0), 5.0));
        col = mix(col, studio(r) * occ, f);
        col += pow(max(dot(r, L), 0.0), 60.0) * sh * spec * 0.6;
      }
    }

    // The far floor melts into the page's white.
    float fog = smoothstep(16.0, 34.0, tHit);
    col = mix(col, vec3(1.0), fog);
  }

  col = pow(clamp(col, 0.0, 1.0), vec3(0.4545));
  // Dither away banding in the soft shadows.
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (n - 0.5) / 255.0;
  outColor = vec4(col, 1.0);
  gl_FragDepth = depth;
}
`;

const PIECE_VS = /* glsl */ `#version 300 es
in vec4 aPiece;
uniform mat4 uViewProj;
uniform float uPxScale;
out vec3 vCenter;
out float vSize;
void main() {
  vec4 clip = uViewProj * vec4(aPiece.xyz, 1.0);
  gl_Position = clip;
  float size = 2.0 * aPiece.w * uPxScale / clip.w;
  vSize = size;
  gl_PointSize = max(size + 1.5, 1.0);
  vCenter = aPiece.xyz;
}
`;

const PIECE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vCenter;
in float vSize;
uniform vec3 uCam;
uniform vec3 uRight;
uniform vec3 uUp;
const vec3 L = ${glslVec(LIGHT)};
const vec3 FILL = ${glslVec(FILL)};
out vec4 outColor;

vec3 studio(vec3 r) {
  vec3 c = mix(vec3(0.70), vec3(1.0), smoothstep(-0.25, 0.5, r.y));
  c += vec3(2.6) * smoothstep(0.86, 0.97, dot(r, L));
  c += vec3(0.6) * smoothstep(0.55, 0.95, dot(r, FILL));
  return c;
}

void main() {
  float pad = (vSize + 1.5) / max(vSize, 0.001);
  vec2 q = (gl_PointCoord * 2.0 - 1.0) * pad;
  q.y = -q.y;
  float d2 = dot(q, q);
  float edge = 1.0 - smoothstep(1.0 - 2.0 / max(vSize, 1.0), 1.0 + 1.0 / max(vSize, 1.0), sqrt(d2));
  float cover = edge * clamp(vSize, 0.0, 1.0);
  if (cover <= 0.002) discard;
  vec3 toCam = normalize(uCam - vCenter);
  vec3 n = normalize(uRight * q.x + uUp * q.y + toCam * sqrt(max(0.0, 1.0 - min(d2, 1.0))));
  vec3 rd = -toCam;
  vec3 r = reflect(rd, n);
  float f = 0.035 + 0.965 * pow(1.0 - max(dot(n, -rd), 0.0), 5.0);
  vec3 col = vec3(0.006) + vec3(0.01) * max(dot(n, L), 0.0) + studio(r) * f * 0.85;
  col = pow(clamp(col, 0.0, 1.0), vec3(0.4545));
  outColor = vec4(col * cover, cover);
}
`;

// ---------------------------------------------------------------- matrices

function perspective(fovY: number, aspect: number, near: number, far: number, sx: number, sy: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[8] = -sx;
  m[9] = -sy;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

function lookAt(eye: Vec3, target: Vec3): { view: Mat4; right: Vec3; up: Vec3 } {
  const z = normalize(sub(eye, target));
  const x = normalize(cross([0, 1, 0], z));
  const y = cross(z, x);
  const m = new Float32Array(16);
  m[0] = x[0];
  m[4] = x[1];
  m[8] = x[2];
  m[1] = y[0];
  m[5] = y[1];
  m[9] = y[2];
  m[2] = z[0];
  m[6] = z[1];
  m[10] = z[2];
  m[12] = -dot(x, eye);
  m[13] = -dot(y, eye);
  m[14] = -dot(z, eye);
  m[15] = 1;
  return { view: m, right: x, up: y };
}

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

function invert(m: Mat4): Mat4 {
  const inv = new Float32Array(16);
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
  let det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  det = det ? 1 / det : 0;
  for (let i = 0; i < 16; i++) inv[i] *= det;
  return inv;
}

// ------------------------------------------------------------------- shots

type Shot = {
  fire: number;
  hit: number;
  /** Where its centre is when it touches the wall. */
  impact: Vec3;
  dir: Vec3;
  /** Impact point in the wall's own face coordinates (along, up). */
  face: [number, number];
  seed: number;
};

const shotCache = new Map<number, Shot>();

function shotAt(k: number): Shot {
  const cached = shotCache.get(k);
  if (cached) return cached;
  const seed = k * 7.31 + 1.7;
  // Mostly an even rhythm, now and then two close together.
  const pair = hash(seed + 9.1) > 0.78 ? 0.32 : 0;
  const fire = k * SHOT_GAP + (hash(seed) - 0.5) * 0.5 + pair;
  const along = -1.05 + hash(seed + 1.3) * 2.0;
  const up = 0.65 + hash(seed + 2.9) * 1.45;
  const lx = WH[0] + SHOT_R;
  const impact: Vec3 = [
    WC[0] + WN[0] * lx + WT[0] * along,
    WC[1] + up - WH[1],
    WC[2] + WN[2] * lx + WT[2] * along,
  ];
  // In from the open side, travelling a little away from the viewer and
  // up into the face; never grazing it.
  const dir = normalize([-SIDE, 0.03 + hash(seed + 4.2) * 0.05, -0.5 + (hash(seed + 5.7) - 0.5) * 0.24]);
  const dist = 15;
  const shot: Shot = { fire, hit: fire + dist / SHOT_SPEED, impact, dir, face: [along, up], seed };
  shotCache.set(k, shot);
  if (shotCache.size > 64) shotCache.delete(shotCache.keys().next().value as number);
  return shot;
}

function shotPosition(s: Shot, t: number): Vec3 {
  const back = (s.hit - t) * SHOT_SPEED;
  // A slight arc, so they read as thrown rather than drawn on rails.
  const lift = 0.018 * back * back * 0.5;
  return [s.impact[0] - s.dir[0] * back, s.impact[1] - s.dir[1] * back + lift, s.impact[2] - s.dir[2] * back];
}

/** Writes the pieces a shot breaks into at `age` seconds after it hit. */
function writePieces(s: Shot, age: number, out: Float32Array, offset: number): number {
  let n = offset;
  const count = 104;
  for (let i = 0; i < count && n < MAX_PIECES; i++) {
    const h = s.seed * 13.7 + i * 3.17;
    // A few small fragments, the rest fine dust that's gone in about a second.
    const chunk = i < 12;
    const r0 = chunk ? 0.014 + hash(h) * 0.018 : 0.0035 + hash(h) * 0.006;
    const life = chunk ? 1.1 + hash(h + 0.4) * 0.7 : 0.6 + hash(h + 0.4) * 0.8;
    if (age > life) continue;
    // Spray back off the face: outward, fanned along it.
    const outward = chunk ? 1.0 + hash(h + 1.1) * 1.8 : 1.2 + hash(h + 1.1) * 3.4;
    const side = (hash(h + 2.3) - 0.5) * (chunk ? 3.0 : 5.0);
    const lift = (hash(h + 3.9) - 0.4) * (chunk ? 2.6 : 4.2);
    const v: Vec3 = [WN[0] * outward + WT[0] * side, lift, WN[2] * outward + WT[2] * side];
    const drag = chunk ? 2.2 : 3.8;
    const g = chunk ? 3.2 : 0.9;
    const e = 1 - Math.exp(-drag * age);
    const jitter = SHOT_R * 0.7;
    const pos: Vec3 = [
      s.impact[0] + (hash(h + 5.1) - 0.5) * jitter + (v[0] * e) / drag,
      s.impact[1] + (hash(h + 6.3) - 0.5) * jitter + ((v[1] + g / drag) * e) / drag - (g / drag) * age,
      s.impact[2] + (hash(h + 7.7) - 0.5) * jitter + (v[2] * e) / drag,
    ];
    const fade = age / life;
    let r = r0 * (1 - smooth(0.12, 1, fade));
    if (r < 0.0004) continue;
    // Never inside the wall, never through the floor.
    const local = dot(sub(pos, WC), WN);
    const minLocal = WH[0] + r;
    if (local < minLocal) {
      pos[0] += WN[0] * (minLocal - local);
      pos[2] += WN[2] * (minLocal - local);
    }
    if (pos[1] < r) {
      pos[1] = r;
      r *= 0.9;
    }
    out[n * 4] = pos[0];
    out[n * 4 + 1] = pos[1];
    out[n * 4 + 2] = pos[2];
    out[n * 4 + 3] = r;
    n++;
  }
  return n;
}

function smooth(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// -------------------------------------------------------------------- setup

function compile(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const make = (type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(`${type === gl.VERTEX_SHADER ? "vertex" : "fragment"} shader: ${gl.getShaderInfoLog(sh) || "compile failed"}`);
    }
    return sh;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, make(gl.VERTEX_SHADER, vs));
  gl.attachShader(program, make(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || "program link failed");
  }
  return program;
}

export function createWallScene(canvas: HTMLCanvasElement): WallScene | null {
  const gl = canvas.getContext("webgl2", {
    antialias: false,
    alpha: false,
    depth: true,
    premultipliedAlpha: false,
    powerPreference: "high-performance",
  });
  if (!gl) return null;

  let scene: WebGLProgram;
  let pieces: WebGLProgram;
  try {
    scene = compile(gl, QUAD_VS, SCENE_FS);
    pieces = compile(gl, PIECE_VS, PIECE_FS);
  } catch (error) {
    console.warn("[security hero]", error);
    return null;
  }

  const quadVao = gl.createVertexArray();
  gl.bindVertexArray(quadVao);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(scene, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const pieceVao = gl.createVertexArray();
  gl.bindVertexArray(pieceVao);
  const pieceBuf = gl.createBuffer();
  const pieceData = new Float32Array(MAX_PIECES * 4);
  gl.bindBuffer(gl.ARRAY_BUFFER, pieceBuf);
  gl.bufferData(gl.ARRAY_BUFFER, pieceData.byteLength, gl.DYNAMIC_DRAW);
  const aPiece = gl.getAttribLocation(pieces, "aPiece");
  gl.enableVertexAttribArray(aPiece);
  gl.vertexAttribPointer(aPiece, 4, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const screenTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, screenTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([250, 250, 252, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const u = (p: WebGLProgram, name: string) => gl.getUniformLocation(p, name);
  const su = {
    res: u(scene, "uRes"),
    invViewProj: u(scene, "uInvViewProj"),
    viewProj: u(scene, "uViewProj"),
    cam: u(scene, "uCam"),
    shot: u(scene, "uShot"),
    ripple: u(scene, "uRipple"),
    screen: u(scene, "uScreen"),
  };
  const pu = {
    viewProj: u(pieces, "uViewProj"),
    pxScale: u(pieces, "uPxScale"),
    cam: u(pieces, "uCam"),
    right: u(pieces, "uRight"),
    up: u(pieces, "uUp"),
  };

  let width = 1;
  let height = 1;
  let layout: WallLayout = { centerX: 0, centerY: 0, wallHeight: 0.5, maxWidth: 1 };
  const shotData = new Float32Array(MAX_SHOTS * 4);
  const rippleData = new Float32Array(MAX_RIPPLES * 4);

  function camera(t: number) {
    const aspect = width / height;
    // A slow, barely-there drift so the still scene breathes.
    const yaw = CAMERA_YAW + Math.sin(t * 0.21) * 0.035;
    const pitch = CAMERA_PITCH + Math.sin(t * 0.13 + 1.2) * 0.012;
    const eye: Vec3 = [
      CAMERA_TARGET[0] + Math.sin(yaw) * Math.cos(pitch) * CAMERA_DIST,
      CAMERA_TARGET[1] + Math.sin(pitch) * CAMERA_DIST,
      CAMERA_TARGET[2] + Math.cos(yaw) * Math.cos(pitch) * CAMERA_DIST,
    ];
    // Size the lens so the wall fills the asked share of the height, unless
    // the scene would then be wider than the canvas allows.
    const wallWorld = WH[1] * 2 * 1.02;
    const sceneWidth = 5.4;
    const byHeight = wallWorld / layout.wallHeight;
    const byWidth = sceneWidth / layout.maxWidth / aspect;
    const span = Math.max(byHeight, byWidth);
    const fov = 2 * Math.atan(span / 2 / CAMERA_DIST);
    const { view, right, up } = lookAt(eye, CAMERA_TARGET);
    const proj = perspective(fov, aspect, 0.5, 80, layout.centerX, layout.centerY);
    const viewProj = multiply(proj, view);
    return { eye, right, up, viewProj, proj };
  }

  function render(t: number) {
    const { eye, right, up, viewProj, proj } = camera(t);

    // Shots in the air, and the ones that just landed (for ripples and pieces).
    shotData.fill(0);
    rippleData.fill(0);
    let shots = 0;
    let pieceCount = 0;
    const landed: { s: Shot; age: number }[] = [];
    const k0 = Math.floor((t - 8) / SHOT_GAP) - 1;
    const k1 = Math.floor(t / SHOT_GAP) + 2;
    for (let k = Math.max(0, k0); k <= k1; k++) {
      const s = shotAt(k);
      if (t < s.fire) continue;
      if (t < s.hit) {
        if (shots < MAX_SHOTS) {
          const p = shotPosition(s, t);
          shotData.set([p[0], p[1], p[2], SHOT_R], shots * 4);
          shots++;
        }
      } else if (t - s.hit < PIECE_LIFE) {
        landed.push({ s, age: t - s.hit });
      }
    }
    landed.sort((a, b) => a.age - b.age);
    landed.slice(0, MAX_RIPPLES).forEach(({ s, age }, i) => {
      rippleData.set([s.face[0], s.face[1], age, 1], i * 4);
    });
    for (const { s, age } of landed) pieceCount = writePieces(s, age, pieceData, pieceCount);

    gl!.viewport(0, 0, width, height);
    gl!.enable(gl!.DEPTH_TEST);
    gl!.depthFunc(gl!.ALWAYS);
    gl!.depthMask(true);
    gl!.disable(gl!.BLEND);

    gl!.useProgram(scene);
    gl!.bindVertexArray(quadVao);
    gl!.uniform2f(su.res, width, height);
    gl!.uniformMatrix4fv(su.invViewProj, false, invert(viewProj));
    gl!.uniformMatrix4fv(su.viewProj, false, viewProj);
    gl!.uniform3f(su.cam, eye[0], eye[1], eye[2]);
    gl!.uniform4fv(su.shot, shotData);
    gl!.uniform4fv(su.ripple, rippleData);
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, screenTex);
    gl!.uniform1i(su.screen, 0);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);

    if (pieceCount > 0) {
      gl!.depthFunc(gl!.LESS);
      gl!.depthMask(false);
      gl!.enable(gl!.BLEND);
      gl!.blendFunc(gl!.ONE, gl!.ONE_MINUS_SRC_ALPHA);
      gl!.useProgram(pieces);
      gl!.bindVertexArray(pieceVao);
      gl!.bindBuffer(gl!.ARRAY_BUFFER, pieceBuf);
      gl!.bufferSubData(gl!.ARRAY_BUFFER, 0, pieceData, 0, pieceCount * 4);
      gl!.uniformMatrix4fv(pu.viewProj, false, viewProj);
      gl!.uniform1f(pu.pxScale, (proj[5] * height) / 2);
      gl!.uniform3f(pu.cam, eye[0], eye[1], eye[2]);
      gl!.uniform3f(pu.right, right[0], right[1], right[2]);
      gl!.uniform3f(pu.up, up[0], up[1], up[2]);
      gl!.drawArrays(gl!.POINTS, 0, pieceCount);
    }
    gl!.bindVertexArray(null);
  }

  return {
    render,
    resize(w, h, dpr, next) {
      width = Math.max(1, Math.round(w * dpr));
      height = Math.max(1, Math.round(h * dpr));
      layout = next;
      canvas.width = width;
      canvas.height = height;
    },
    setScreen(source) {
      gl.bindTexture(gl.TEXTURE_2D, screenTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    },
    dispose() {
      gl.deleteProgram(scene);
      gl.deleteProgram(pieces);
      gl.deleteBuffer(quad);
      gl.deleteBuffer(pieceBuf);
      gl.deleteTexture(screenTex);
      gl.deleteVertexArray(quadVao);
      gl.deleteVertexArray(pieceVao);
    },
  };
}
