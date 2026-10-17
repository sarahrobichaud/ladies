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
//
// World-coupled constants (chip radius, squash, spot/inner-ring paint) are
// NOT baked — they arrive as uniforms, injected once at program init from
// world.ts (see initWorldUniforms in renderer.ts). Screen-domain px
// (hairline widths, highlight offset, the inner-ring dash period) stay
// baked: they tune crispness, not world scale.
//
// Every pass fades by canvas-space y through uFade = [startY, endY]. The
// felt surface fades by alpha (it is the bottom layer). Scene items instead
// dissolve by mixing their color toward the backdrop while staying opaque,
// so a stack fades as one solid shape tinted into the background — no
// see-through between overlapping chips. The backdrop is sampled by height:
// page background high up, felt color through the felt's own ramp, so the
// chip fade band may overlap the felt ramp safely.

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
in float iAngle;
uniform vec2 uResolution;
uniform vec2 uOrigin;
out vec2 vLocal;
out vec3 vFace;
out vec3 vSpot;
out float vDim;
out vec4 vHighlight;
out float vAngle;
out float vWorldY;
void main() {
  vLocal = (aCorner * 2.0 - 1.0) * iExtent;
  vec2 world = iCenter + vLocal + uOrigin;
  vWorldY = world.y;
  vec2 ndc = world / uResolution * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
  vFace = iFace;
  vSpot = iSpot;
  vDim = iDim;
  vHighlight = iHighlight;
  vAngle = iAngle;
}`;

export const CHIP_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec3 vFace;
in vec3 vSpot;
in float vDim;
in vec4 vHighlight;
in float vAngle;
in float vWorldY;
out vec4 frag;

uniform vec2 uFade;
uniform vec2 uFeltFade;
uniform vec3 uCanvasColor;
uniform vec3 uFeltColor;
uniform float uChipRadius;
uniform float uSquash;
uniform float uSpotHalfWidth;
uniform float uSpotInnerRadius;
uniform float uInnerRingRadius;
uniform vec2 uInnerDash;
const float PI_4 = 0.7853981633974483;
const float PI_8 = 0.39269908169872414;

void main() {
  // Circle space: unsquash y so chip-space features stay circular.
  vec2 q = vec2(vLocal.x, vLocal.y / uSquash);
  float r = length(q);
  float aa = max(fwidth(r), 1e-4);

  vec3 rgb = vFace * vDim;
  vec3 spot = vSpot * vDim;

  float body = 1.0 - smoothstep(uChipRadius - aa, uChipRadius + aa, r);

  // Rotate circle-space coords for angular features (spots, inner ring dash).
  // The body SDF is radially symmetric so it needs no rotation.
  float cosA = cos(vAngle), sinA = sin(vAngle);
  vec2 qr = vec2(q.x * cosA - q.y * sinA, q.x * sinA + q.y * cosA);

  // 8 edge spots: modular check every PI_4, offset by PI_8.
  // Works correctly for any rotation without the abs() symmetry assumption.
  float ang = atan(qr.y, qr.x);
  float aaA = max(fwidth(ang), 1e-4);
  float patAng = mod(ang - PI_8, PI_4);
  float spots = 1.0 - smoothstep(uSpotHalfWidth - aaA, uSpotHalfWidth + aaA, min(patAng, PI_4 - patAng));
  spots *= smoothstep(uSpotInnerRadius - aa, uSpotInnerRadius + aa, r) * body;
  rgb = mix(rgb, spot, spots);

  // Dashed inner ring: keyed to rotated angle so dash phase rotates with chip.
  float arc = ang * uInnerRingRadius;
  float dash = step(mod(arc, uInnerDash.x), uInnerDash.y);
  float ringA = (1.0 - smoothstep(-aa, aa, abs(r - uInnerRingRadius) - 0.75)) * dash * body;
  rgb = mix(rgb, spot, ringA * 0.8);

  // Hairline rim + bottom arc seam, both reduced to be less prominent.
  float rimA = (1.0 - smoothstep(-aa, aa, abs(r - uChipRadius) - 0.5)) * 0.18;
  rgb = mix(rgb, vec3(0.0), rimA);
  float arcA = (1.0 - smoothstep(-aa, aa, abs(r - uChipRadius) - 1.0)) * smoothstep(-aa, aa, vLocal.y) * 0.20;
  rgb = mix(rgb, vec3(0.0), arcA);

  // Highlight ring (merge target).
  float hiA = (1.0 - smoothstep(-aa, aa, abs(r - uChipRadius - 2.0) - 1.0)) * vHighlight.a;
  rgb = mix(rgb, vHighlight.rgb, hiA);

  // Dissolve into the backdrop, sampled by height: page background high up,
  // felt color where the felt's own ramp is still visible. Opaque throughout.
  float feltT = clamp((vWorldY - uFeltFade.x) / max(uFeltFade.y - uFeltFade.x, 0.001), 0.0, 1.0);
  feltT = feltT * feltT * (3.0 - 2.0 * feltT);
  vec3 backdrop = mix(uCanvasColor, uFeltColor, feltT);
  float fade = clamp((vWorldY - uFade.x) / max(uFade.y - uFade.x, 0.001), 0.0, 1.0);
  rgb = mix(backdrop, rgb, fade);
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
in float iAngle;
uniform vec2 uResolution;
uniform vec2 uOrigin;
out vec2 vLocal;
out vec3 vFace;
out vec3 vSpot;
out float vDim;
out float vThick;
out float vAngle;
out float vWorldY;
void main() {
  vLocal = (aCorner * 2.0 - 1.0) * iExtent;
  vec2 world = iCenter + vLocal + uOrigin;
  vWorldY = world.y;
  vec2 ndc = world / uResolution * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
  vFace = iFace;
  vSpot = iSpot;
  vDim = iDim;
  vThick = iThick;
  vAngle = iAngle;
}`;

export const WALL_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec3 vFace;
in vec3 vSpot;
in float vDim;
in float vThick;
in float vAngle;
in float vWorldY;
out vec4 frag;

uniform vec2 uFade;
uniform vec2 uFeltFade;
uniform vec3 uCanvasColor;
uniform vec3 uFeltColor;
uniform float uChipRadius;
uniform float uSquash;
uniform float uSpotHalfWidth;
const float PI_4 = 0.7853981633974483;
const float PI_8 = 0.39269908169872414;

void main() {
  // Circle space: un-squash y so the elliptical faces become circles.
  vec2 q = vec2(vLocal.x, vLocal.y / uSquash);
  float T = vThick / uSquash;

  // Cylinder wall SDF. In circle space the visible wall band is the strip:
  //   h(x) <= y <= T + h(x),  |x| <= R,  where h(x) = sqrt(R^2 - x^2).
  // All three boundaries are combined into one min-SDF so every edge gets
  // a single clean AA transition with no alpha compounding at corners.
  float h = sqrt(max(0.0, uChipRadius * uChipRadius - q.x * q.x));
  float dInner = q.y - h;           // +ve below top arc  (into wall)
  float dOuter = T + h - q.y;       // +ve above base arc (into wall)
  float dSide  = uChipRadius - abs(q.x);      // +ve inside side tangents
  float dWall  = min(min(dInner, dOuter), dSide);
  float aa = max(fwidth(dWall), 1e-4);
  float wall = smoothstep(-aa, aa, dWall);

  // Stripes: keyed to rim x-position (acos(x/R)) offset by chip rotation,
  // using a modular period test matching the face spots above.
  float rimAngle = acos(clamp(q.x / uChipRadius, -1.0, 1.0)) - vAngle;
  float aaA = max(fwidth(rimAngle), 1e-4);
  float patRim = mod(rimAngle - PI_8, PI_4);
  float stripe = 1.0 - smoothstep(uSpotHalfWidth - aaA, uSpotHalfWidth + aaA, min(patRim, PI_4 - patRim));

  // Cylinder shading: brighter at front (curve), darker toward base (AO).
  float curve = h / uChipRadius;
  float down  = clamp(dInner / max(T, 0.001), 0.0, 1.0);
  vec3 base = mix(vFace, vSpot, stripe) * vDim;
  base *= 0.60 + 0.28 * curve;
  base *= 1.0 - 0.22 * down;

  // Groove line at the base seam.
  float dBot = length(q - vec2(0.0, T)) - uChipRadius;
  float groove = (1.0 - smoothstep(-aa, aa, abs(dBot) - 0.5)) * smoothstep(-aa, aa, q.y - T);
  base = mix(base, vec3(0.0), groove * 0.38);

  float feltT = clamp((vWorldY - uFeltFade.x) / max(uFeltFade.y - uFeltFade.x, 0.001), 0.0, 1.0);
  feltT = feltT * feltT * (3.0 - 2.0 * feltT);
  vec3 backdrop = mix(uCanvasColor, uFeltColor, feltT);
  float fade = clamp((vWorldY - uFade.x) / max(uFade.y - uFade.x, 0.001), 0.0, 1.0);
  base = mix(backdrop, base, fade);
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
uniform vec2 uOrigin;
out vec2 vLocal;
out vec2 vRadii;
out float vHalfWidth;
out vec2 vDash;
out float vSoft;
out vec4 vStroke;
out vec4 vFill;
out float vWorldY;
void main() {
  vLocal = (aCorner * 2.0 - 1.0) * iExtent;
  vec2 world = iCenter + vLocal + uOrigin;
  vWorldY = world.y;
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
in float vWorldY;
out vec4 frag;

uniform vec2 uFade;

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

  float fade = clamp((vWorldY - uFade.x) / max(uFade.y - uFade.x, 0.001), 0.0, 1.0);
  vec4 s = vec4(vStroke.rgb * vStroke.a * strokeA, vStroke.a * strokeA) * fade;
  vec4 f = vec4(vFill.rgb * vFill.a * fillA, vFill.a * fillA) * fade;
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
uniform vec2 uOrigin;
out vec2 vLocal;
out vec2 vHalfSize;
out float vRadius;
out vec4 vFill;
out vec4 vStroke;
out float vWorldY;
void main() {
  vLocal = (aCorner * 2.0 - 1.0) * iExtent;
  vec2 world = iCenter + vLocal + uOrigin;
  vWorldY = world.y;
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
in float vWorldY;
out vec4 frag;

uniform vec2 uFade;

void main() {
  vec2 q = abs(vLocal) - vHalfSize + vRadius;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - vRadius;
  float aa = max(fwidth(d), 1e-4);

  float fillA = 1.0 - smoothstep(-aa, aa, d);
  float strokeA = 1.0 - smoothstep(-aa, aa, abs(d) - 0.5);

  float fade = clamp((vWorldY - uFade.x) / max(uFade.y - uFade.x, 0.001), 0.0, 1.0);
  vec4 s = vec4(vStroke.rgb * vStroke.a * strokeA, vStroke.a * strokeA) * fade;
  vec4 f = vec4(vFill.rgb * vFill.a * fillA, vFill.a * fillA) * fade;
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
uniform vec2 uOrigin;
out vec2 vUV;
out vec3 vColor;
out float vWorldY;
void main() {
  vec2 world = iPos + aCorner * iSize + uOrigin;
  vWorldY = world.y;
  vec2 ndc = world / uResolution * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
  vUV = mix(iUV.xy, iUV.zw, aCorner);
  vColor = iColor;
}`;

export const TEXT_FS = `#version 300 es
precision mediump float;
in vec2 vUV;
in vec3 vColor;
in float vWorldY;
uniform sampler2D uAtlas;
uniform vec2 uFade;
uniform vec2 uFeltFade;
uniform vec3 uCanvasColor;
uniform vec3 uFeltColor;
out vec4 frag;
void main() {
  float feltT = clamp((vWorldY - uFeltFade.x) / max(uFeltFade.y - uFeltFade.x, 0.001), 0.0, 1.0);
  feltT = feltT * feltT * (3.0 - 2.0 * feltT);
  vec3 backdrop = mix(uCanvasColor, uFeltColor, feltT);
  float fade = clamp((vWorldY - uFade.x) / max(uFade.y - uFade.x, 0.001), 0.0, 1.0);
  float a = texture(uAtlas, vUV).a;
  frag = vec4(mix(backdrop, vColor, fade) * a, a);
}`;

// --- felt surface ----------------------------------------------------------------

// The gradient wash everything sits on: a rounded rect filled with the
// felt-to-felt-deep radial gradient (lit from above the far edge, like the
// CSS wash it replaces) plus a gentle edge vignette. It fades with its own
// zone so the felt dissolves before the chips riding on it do.

export const FELT_VS = `#version 300 es
precision highp float;
in vec2 aCorner;
in vec2 iCenter;
in vec2 iExtent;
in vec2 iHalfSize;
in float iRadius;
in vec3 iFelt;
in vec3 iFeltDeep;
uniform vec2 uResolution;
uniform vec2 uOrigin;
out vec2 vLocal;
out vec2 vHalfSize;
out float vRadius;
out vec3 vFelt;
out vec3 vFeltDeep;
out float vWorldY;
void main() {
  vLocal = (aCorner * 2.0 - 1.0) * iExtent;
  vec2 world = iCenter + vLocal + uOrigin;
  vWorldY = world.y;
  vec2 ndc = world / uResolution * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
  vHalfSize = iHalfSize;
  vRadius = iRadius;
  vFelt = iFelt;
  vFeltDeep = iFeltDeep;
}`;

export const FELT_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec2 vHalfSize;
in float vRadius;
in vec3 vFelt;
in vec3 vFeltDeep;
in float vWorldY;
out vec4 frag;

uniform vec2 uFade;

void main() {
  vec2 q = abs(vLocal) - vHalfSize + vRadius;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - vRadius;
  float aa = max(fwidth(d), 1e-4);
  float shape = 1.0 - smoothstep(-aa, aa, d);

  // Radial wash: felt holds near the focus above the far edge, then
  // deepens toward the gradient ellipse rim.
  vec2 p = vLocal + vHalfSize;
  vec2 size = vHalfSize * 2.0;
  vec2 focus = vec2(0.5 * size.x, -0.3 * size.y);
  vec2 radii = vec2(1.2 * size.x, 0.9 * size.y);
  float ed = length((p - focus) / radii);
  float t = clamp((ed - 0.5) / 0.5, 0.0, 1.0);
  vec3 rgb = mix(vFelt, vFeltDeep, t);

  // Gentle vignette so the wash keeps depth at the side edges.
  rgb *= 1.0 - 0.22 * (1.0 - smoothstep(0.0, 70.0, -d));

  // Ease both ends of the ramp so the felt's emergence is gradual.
  float fade = clamp((vWorldY - uFade.x) / max(uFade.y - uFade.x, 0.001), 0.0, 1.0);
  float alpha = shape * (fade * fade * (3.0 - 2.0 * fade));
  frag = vec4(rgb * alpha, alpha);
}`;
