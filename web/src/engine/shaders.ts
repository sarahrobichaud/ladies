// GLSL ES 3.00 sources. Every primitive draws a unit quad instanced with
// per-item attributes; positions are CSS px mapped to clip space with y
// flipped (DOM coordinates, y down). Fragment SDFs are anti-aliased with
// fwidth and output premultiplied alpha.

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

const float R = 22.0;
const float PI_4 = 0.7853981633974483;
const float PI_8 = 0.39269908169872414;

float sdEllipse(vec2 p, vec2 ab) {
  return (length(p / ab) - 1.0) * min(ab.x, ab.y);
}

void main() {
  vec2 p = vLocal;
  float r = length(p);
  float aa = max(fwidth(r), 1e-4);

  vec3 rgb = vFace * vDim;
  vec3 spot = vSpot * vDim;

  float body = 1.0 - smoothstep(R - aa, R + aa, r);

  // 8 edge spots, elongated along the radius.
  float spots = 1e9;
  for (int k = 0; k < 8; k++) {
    float a = float(k) * PI_4 + PI_8;
    vec2 dir = vec2(cos(a), sin(a));
    vec2 q = mat2(dir.x, -dir.y, dir.y, dir.x) * (p - dir * 17.5);
    spots = min(spots, sdEllipse(q, vec2(3.0, 1.5)));
  }
  rgb = mix(rgb, spot, (1.0 - smoothstep(-aa, aa, spots)) * body);

  // Dashed inner ring: r 12.5, width 1.5, dash 4/3.
  float arc = abs(atan(p.y, p.x)) * 12.5;
  float dash = step(mod(arc, 7.0), 4.0);
  float ringA = (1.0 - smoothstep(-aa, aa, abs(r - 12.5) - 0.75)) * dash * body;
  rgb = mix(rgb, spot, ringA * 0.8);

  // Hairline rim (1px, black 0.4) + stronger bottom arc (2px, black 0.45).
  float rimA = (1.0 - smoothstep(-aa, aa, abs(r - R) - 0.5)) * 0.4;
  rgb = mix(rgb, vec3(0.0), rimA);
  float arcA = (1.0 - smoothstep(-aa, aa, abs(r - R) - 1.0)) * step(0.0, p.y) * 0.45;
  rgb = mix(rgb, vec3(0.0), arcA);

  // Highlight ring at r 24 (merge target).
  float hiA = (1.0 - smoothstep(-aa, aa, abs(r - 24.0) - 1.0)) * vHighlight.a;
  rgb = mix(rgb, vHighlight.rgb, hiA);

  float alpha = max(body, max(rimA, max(arcA, hiA)));
  frag = vec4(rgb * alpha, alpha);
}`;

// --- chip edge ----------------------------------------------------------------

export const EDGE_VS = `#version 300 es
precision highp float;
in vec2 aCorner;
in vec2 iCenter;
in vec2 iExtent;
in vec3 iFace;
in float iDim;
uniform vec2 uResolution;
out vec2 vLocal;
out vec3 vFace;
out float vDim;
void main() {
  vLocal = (aCorner * 2.0 - 1.0) * iExtent;
  vec2 world = iCenter + vLocal;
  vec2 ndc = world / uResolution * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
  vFace = iFace;
  vDim = iDim;
}`;

export const EDGE_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec3 vFace;
in float vDim;
out vec4 frag;

const float R = 22.0;

float sdEllipse(vec2 p, vec2 ab) {
  return (length(p / ab) - 1.0) * min(ab.x, ab.y);
}

void main() {
  vec2 p = vLocal;
  float r = length(p);
  float aa = max(fwidth(r), 1e-4);

  float body = 1.0 - smoothstep(R - aa, R + aa, r);
  vec3 rgb = vFace * vDim;

  // 4 dark edge dashes along the bottom rim.
  float dash = 1e9;
  for (int k = 0; k < 4; k++) {
    vec2 c = vec2(float(k) * 6.0 - 9.0, 19.0);
    dash = min(dash, sdEllipse(p - c, vec2(3.0, 2.0)));
  }
  rgb = mix(rgb, vec3(0.0), (1.0 - smoothstep(-aa, aa, dash)) * body * 0.5);

  // Bottom-rim arc doubling as the border with the crescent below.
  float arcA = (1.0 - smoothstep(-aa, aa, abs(r - R) - 1.0)) * step(0.0, p.y) * 0.45;
  rgb = mix(rgb, vec3(0.0), arcA);

  float alpha = max(body, arcA);
  frag = vec4(rgb * alpha, alpha);
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
in vec4 iStroke;
in vec4 iFill;
uniform vec2 uResolution;
out vec2 vLocal;
out vec2 vRadii;
out float vHalfWidth;
out vec2 vDash;
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
  vStroke = iStroke;
  vFill = iFill;
}`;

export const RING_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec2 vRadii;
in float vHalfWidth;
in vec2 vDash;
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
  float fillA = 1.0 - smoothstep(-aa, aa, d);

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