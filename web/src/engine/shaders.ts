// GLSL ES 3.00 sources. Every primitive draws a unit quad instanced with
// per-item attributes; positions are CSS px mapped to clip space with y
// flipped (DOM coordinates, y down). Fragment SDFs are anti-aliased with
// fwidth and output premultiplied alpha.
//
// Chips render in an oblique projection: faces are circles squashed
// vertically by CHIP_SQUASH, and each chip carries a cylinder wall (the
// `wall` program) so stacks read as real 3D objects. Feature SDFs run in
// unsquashed "circle space" (q = (x, y / SQUASH)) so they stay circular
// in chip space.

import { CHIP_RADIUS, CHIP_SQUASH } from './primitives';

const R = `${CHIP_RADIUS}.0`;
const SQUASH = `${CHIP_SQUASH}`;

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
const float PI_4 = 0.7853981633974483;
const float PI_8 = 0.39269908169872414;

float sdEllipse(vec2 p, vec2 ab) {
  return (length(p / ab) - 1.0) * min(ab.x, ab.y);
}

void main() {
  // Circle space: unsquash y so chip-space features stay circular.
  vec2 q = vec2(vLocal.x, vLocal.y / SQUASH);
  float r = length(q);
  float aa = max(fwidth(r), 1e-4);

  vec3 rgb = vFace * vDim;
  vec3 spot = vSpot * vDim;

  float body = 1.0 - smoothstep(R - aa, R + aa, r);

  // 8 edge spots, elongated along the radius.
  float spots = 1e9;
  for (int k = 0; k < 8; k++) {
    float a = float(k) * PI_4 + PI_8;
    vec2 dir = vec2(cos(a), sin(a));
    vec2 t = mat2(dir.x, -dir.y, dir.y, dir.x) * (q - dir * R * 0.795);
    spots = min(spots, sdEllipse(t, vec2(R * 0.136, R * 0.068)));
  }
  rgb = mix(rgb, spot, (1.0 - smoothstep(-aa, aa, spots)) * body);

  // Dashed inner ring: width 1.5, dash 4/3.
  float arc = abs(atan(q.y, q.x)) * R * 0.568;
  float dash = step(mod(arc, 7.0), 4.0);
  float ringA = (1.0 - smoothstep(-aa, aa, abs(r - R * 0.568) - 0.75)) * dash * body;
  rgb = mix(rgb, spot, ringA * 0.8);

  // Hairline rim (1px, black 0.4) + stronger bottom arc (2px, black 0.45);
  // the bottom arc doubles as the seam where the face meets the wall.
  float rimA = (1.0 - smoothstep(-aa, aa, abs(r - R) - 0.5)) * 0.4;
  rgb = mix(rgb, vec3(0.0), rimA);
  float arcA = (1.0 - smoothstep(-aa, aa, abs(r - R) - 1.0)) * step(0.0, vLocal.y) * 0.45;
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
const float PI_4 = 0.7853981633974483;
const float PI_8 = 0.39269908169872414;
const float STRIPE = 0.1396; // 8 deg half-width

void main() {
  vec2 q = vec2(vLocal.x, vLocal.y / SQUASH);
  float T = vThick / SQUASH;
  float dTop = length(q) - R;
  float dBot = length(q - vec2(0.0, T)) - R;
  float aa = max(fwidth(dTop), 1e-4);

  // The wall: inside the base rim circle, outside the top face circle.
  float wall = (1.0 - smoothstep(-aa, aa, dBot)) * smoothstep(-aa, aa, dTop);

  // Edge trims: 8 stripes around the rim, aligned with the face spots.
  float ang = atan(q.y, q.x);
  float aaA = max(fwidth(ang), 1e-4);
  float stripe = 0.0;
  for (int k = 0; k < 8; k++) {
    float a = float(k) * PI_4 + PI_8;
    float d = abs(ang - a);
    stripe = max(stripe, 1.0 - smoothstep(STRIPE - aaA, STRIPE + aaA, d));
  }

  // Cylinder shading: darker toward the silhouette, AO toward the base.
  float curve = sqrt(max(0.0, 1.0 - (q.x / R) * (q.x / R)));
  float down = clamp((q.y - sqrt(max(0.0, R * R - q.x * q.x))) / T, 0.0, 1.0);
  vec3 base = mix(vFace, vSpot, stripe) * vDim;
  base *= 0.58 + 0.20 * curve;
  base *= 1.0 - 0.22 * down;

  // Groove line at the base of this chip's wall — the seam with the chip
  // below (its wall continues directly beneath).
  base = mix(base, vec3(0.0), (1.0 - smoothstep(-aa, aa, abs(dBot) - 0.75)) * 0.4);

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