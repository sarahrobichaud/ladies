// GLSL ES 3.00 sources. Every primitive draws a unit quad instanced with
// per-item attributes; positions are CSS px mapped to clip space with y
// flipped (DOM coordinates, y down). Fragment SDFs are anti-aliased with
// fwidth and output premultiplied alpha.
//
// Chips render in an oblique projection: faces are circles squashed
// vertically by CHIP_SQUASH, and each chip carries a cylinder wall (the
// `wall` program) so stacks read as real 3D objects. Feature SDFs run in
// unsquashed "circle space" (q = (x, y / SQUASH)) so they stay circular
// in chip space. The face's edge spots and the wall's stripes share the
// same angular paint (W / SPOT_INNER), so the trims read as one continuous
// pattern wrapping over the rim.

import { CHIP_RADIUS, CHIP_SQUASH } from './primitives';

const R = `${CHIP_RADIUS}.0`;
const SQUASH = `${CHIP_SQUASH}`;
const W = '0.08'; // rad — half-width of edge spots and wall stripes
const SPOT_INNER = '0.72'; // × R — inner radius of the face spots

// --- chip face ---------------------------------------------------------------

export const CHIP_VS = `#version 300 es
precision highp float;
in vec2 aCorner;
in vec2 iCenter;
in vec2 iExtent;
in vec3 iFace;
in vec3 iSpot;
in float iDim;
in vec4 iHighlight;
uniform vec2 uResolution;
out vec2 vLocal;
out vec3 vFace;
out vec3 vSpot;
out float vDim;
out vec4 vHighlight;
void main() {
  vLocal = (aCorner * 2.0 - 1.0) * iExtent;
  vec2 world = iCenter + vLocal;
  vec2 ndc = world / uResolution * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
  vFace = iFace;
  vSpot = iSpot;
  vDim = iDim;
  vHighlight = iHighlight;
}`;

export const CHIP_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec3 vFace;
in vec3 vSpot;
in float vDim;
in vec4 vHighlight;
out vec4 frag;

const float R = ${R};
const float SQUASH = ${SQUASH};
const float W = ${W};
const float SPOT_INNER = ${SPOT_INNER} * R;
const float PI_4 = 0.7853981633974483;
const float PI_8 = 0.39269908169872414;

void main() {
  // Circle space: unsquash y so chip-space features stay circular.
  vec2 q = vec2(vLocal.x, vLocal.y / SQUASH);
  float r = length(q);
  float aa = max(fwidth(r), 1e-4);

  vec3 rgb = vFace * vDim;
  vec3 spot = vSpot * vDim;

  float body = 1.0 - smoothstep(R - aa, R + aa, r);

  // 8 edge spots: rim wedges (abs(atan) mirrors the upper half onto the
  // lower, so four angles cover all eight), continuous with the stripes
  // painted on the wall below the rim.
  float angAbs = abs(atan(q.y, q.x));
  float aaA = max(fwidth(angAbs), 1e-4);
  float spots = 0.0;
  for (int k = 0; k < 4; k++) {
    float a = float(k) * PI_4 + PI_8;
    float d = abs(angAbs - a);
    spots = max(spots, 1.0 - smoothstep(W - aaA, W + aaA, d));
  }
  spots *= smoothstep(SPOT_INNER - aa, SPOT_INNER + aa, r) * body;
  rgb = mix(rgb, spot, spots);

  // Dashed inner ring: width 1.5, dash 4/3.
  float arc = abs(angAbs) * R * 0.568;
  float dash = step(mod(arc, 7.0), 4.0);
  float ringA = (1.0 - smoothstep(-aa, aa, abs(r - R * 0.568) - 0.75)) * dash * body;
  rgb = mix(rgb, spot, ringA * 0.8);

  // Hairline rim + bottom arc seam, both reduced to be less prominent.
  float rimA = (1.0 - smoothstep(-aa, aa, abs(r - R) - 0.5)) * 0.18;
  rgb = mix(rgb, vec3(0.0), rimA);
  float arcA = (1.0 - smoothstep(-aa, aa, abs(r - R) - 1.0)) * smoothstep(-aa, aa, vLocal.y) * 0.20;
  rgb = mix(rgb, vec3(0.0), arcA);

  // Highlight ring (merge target).
  float hiA = (1.0 - smoothstep(-aa, aa, abs(r - R - 2.0) - 1.0)) * vHighlight.a;
  rgb = mix(rgb, vHighlight.rgb, hiA);

  float alpha = max(body, max(rimA, max(arcA, hiA)));
  frag = vec4(rgb * alpha, alpha);
}`;

// --- chip wall ----------------------------------------------------------------

export const WALL_VS = `#version 300 es
precision highp float;
in vec2 aCorner;
in vec2 iCenter;
in vec2 iExtent;
in vec3 iFace;
in vec3 iSpot;
in float iDim;
in float iThick;
uniform vec2 uResolution;
out vec2 vLocal;
out vec3 vFace;
out vec3 vSpot;
out float vDim;
out float vThick;
void main() {
  vLocal = (aCorner * 2.0 - 1.0) * iExtent;
  vec2 world = iCenter + vLocal;
  vec2 ndc = world / uResolution * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
  vFace = iFace;
  vSpot = iSpot;
  vDim = iDim;
  vThick = iThick;
}`;

export const WALL_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec3 vFace;
in vec3 vSpot;
in float vDim;
in float vThick;
out vec4 frag;

const float R = ${R};
const float SQUASH = ${SQUASH};
const float W = ${W};
const float PI_4 = 0.7853981633974483;
const float PI_8 = 0.39269908169872414;

void main() {
  // Circle space: un-squash y so the elliptical faces become circles.
  vec2 q = vec2(vLocal.x, vLocal.y / SQUASH);
  float T = vThick / SQUASH;

  // Cylinder wall SDF. In circle space the visible wall band is the strip:
  //   h(x) <= y <= T + h(x),  |x| <= R,  where h(x) = sqrt(R^2 - x^2).
  // All three boundaries are combined into one min-SDF so every edge gets
  // a single clean AA transition with no alpha compounding at corners.
  float h = sqrt(max(0.0, R * R - q.x * q.x));
  float dInner = q.y - h;           // +ve below top arc  (into wall)
  float dOuter = T + h - q.y;       // +ve above base arc (into wall)
  float dSide  = R - abs(q.x);      // +ve inside side tangents
  float dWall  = min(min(dInner, dOuter), dSide);
  float aa = max(fwidth(dWall), 1e-4);
  float wall = smoothstep(-aa, aa, dWall);

  // Edge trims: stripes keyed to x-position on the rim (acos(x/R)), so
  // they project straight down rather than following the face's oblique angle.
  float angAbs = acos(clamp(q.x / R, -1.0, 1.0));
  float aaA = max(fwidth(angAbs), 1e-4);
  float stripe = 0.0;
  for (int k = 0; k < 4; k++) {
    float a = float(k) * PI_4 + PI_8;
    float d = abs(angAbs - a);
    stripe = max(stripe, 1.0 - smoothstep(W - aaA, W + aaA, d));
  }

  // Cylinder shading: brighter at front (curve), darker toward base (AO).
  float curve = h / R;
  float down  = clamp(dInner / max(T, 0.001), 0.0, 1.0);
  vec3 base = mix(vFace, vSpot, stripe) * vDim;
  base *= 0.60 + 0.28 * curve;
  base *= 1.0 - 0.22 * down;

  // Groove line at the base seam.
  float dBot = length(q - vec2(0.0, T)) - R;
  float groove = (1.0 - smoothstep(-aa, aa, abs(dBot) - 0.5)) * smoothstep(-aa, aa, q.y - T);
  base = mix(base, vec3(0.0), groove * 0.38);

  frag = vec4(base * wall, wall);
}`;

// --- ellipse ring ---------------------------------------------------------------

export const RING_VS = `#version 300 es
precision highp float;
in vec2 aCorner;
in vec2 iCenter;
in vec2 iExtent;
in vec2 iRadii;
in float iHalfWidth;
in vec2 iDash;
in float iSoft;
in vec4 iStroke;
in vec4 iFill;
uniform vec2 uResolution;
out vec2 vLocal;
out vec2 vRadii;
out float vHalfWidth;
out vec2 vDash;
out float vSoft;
out vec4 vStroke;
out vec4 vFill;
void main() {
  vLocal = (aCorner * 2.0 - 1.0) * iExtent;
  vec2 world = iCenter + vLocal;
  vec2 ndc = world / uResolution * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
  vRadii = iRadii;
  vHalfWidth = iHalfWidth;
  vDash = iDash;
  vSoft = iSoft;
  vStroke = iStroke;
  vFill = iFill;
}`;

export const RING_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec2 vRadii;
in float vHalfWidth;
in vec2 vDash;
in float vSoft;
in vec4 vStroke;
in vec4 vFill;
out vec4 frag;

void main() {
  vec2 p = vLocal;
  float d = (length(p / vRadii) - 1.0) * min(vRadii.x, vRadii.y);
  float aa = max(fwidth(d), 1e-4);

  float dashMask = 1.0;
  if (vDash.x > 0.0) {
    float rMean = (vRadii.x + vRadii.y) * 0.5;
    float arc = abs(atan(p.y, p.x)) * rMean;
    dashMask = step(mod(arc, vDash.x + vDash.y), vDash.x);
  }

  float strokeA = (1.0 - smoothstep(-aa, aa, abs(d) - vHalfWidth)) * dashMask;
  // soft > 0 fades the fill edge over that many px (contact shadows).
  float fillA = 1.0 - smoothstep(-aa, vSoft + aa, d);

  vec4 s = vec4(vStroke.rgb * vStroke.a * strokeA, vStroke.a * strokeA);
  vec4 f = vec4(vFill.rgb * vFill.a * fillA, vFill.a * fillA);
  frag = s + f * (1.0 - s.a);
}`;

// --- rounded panel ---------------------------------------------------------------

export const PANEL_VS = `#version 300 es
precision highp float;
in vec2 aCorner;
in vec2 iCenter;
in vec2 iExtent;
in vec2 iHalfSize;
in float iRadius;
in vec4 iFill;
in vec4 iStroke;
uniform vec2 uResolution;
out vec2 vLocal;
out vec2 vHalfSize;
out float vRadius;
out vec4 vFill;
out vec4 vStroke;
void main() {
  vLocal = (aCorner * 2.0 - 1.0) * iExtent;
  vec2 world = iCenter + vLocal;
  vec2 ndc = world / uResolution * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
  vHalfSize = iHalfSize;
  vRadius = iRadius;
  vFill = iFill;
  vStroke = iStroke;
}`;

export const PANEL_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec2 vHalfSize;
in float vRadius;
in vec4 vFill;
in vec4 vStroke;
out vec4 frag;

void main() {
  vec2 q = abs(vLocal) - vHalfSize + vRadius;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - vRadius;
  float aa = max(fwidth(d), 1e-4);

  float fillA = 1.0 - smoothstep(-aa, aa, d);
  float strokeA = 1.0 - smoothstep(-aa, aa, abs(d) - 0.5);

  vec4 s = vec4(vStroke.rgb * vStroke.a * strokeA, vStroke.a * strokeA);
  vec4 f = vec4(vFill.rgb * vFill.a * fillA, vFill.a * fillA);
  frag = s + f * (1.0 - s.a);
}`;

// --- text -------------------------------------------------------------------------

export const TEXT_VS = `#version 300 es
precision highp float;
in vec2 aCorner;
in vec2 iPos;
in vec2 iSize;
in vec4 iUV;
in vec3 iColor;
uniform vec2 uResolution;
out vec2 vUV;
out vec3 vColor;
void main() {
  vec2 world = iPos + aCorner * iSize;
  vec2 ndc = world / uResolution * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
  vUV = mix(iUV.xy, iUV.zw, aCorner);
  vColor = iColor;
}`;

export const TEXT_FS = `#version 300 es
precision mediump float;
in vec2 vUV;
in vec3 vColor;
uniform sampler2D uAtlas;
out vec4 frag;
void main() {
  float a = texture(uAtlas, vUV).a;
  frag = vec4(vColor * a, a);
}`;