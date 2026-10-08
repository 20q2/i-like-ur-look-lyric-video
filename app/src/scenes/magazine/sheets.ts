// Charcoal satin under the magazine: a warped fold height field, lit by the lamp (lamp.ts: lambert, falling off
// into night) with an anisotropic satin sheen along the weave, plus the magazine's contact shadow — sharper and
// darker as it lands.
import * as THREE from 'three';
import { GLSL_COMMON } from '../../engine/glsl/common';
import { PAGE_W } from '../../engine/curl';
import { LAMP_GLSL, LAMP_ON } from '../../engine/lamp';

const VERT = /* glsl */ `
precision highp float;
in vec3 position;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
out vec3 vPos;
void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vPos = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`;

const FRAG = /* glsl */ `
in vec3 vPos;
uniform vec3 cameraPosition; // three's own (paper.ts)
uniform vec4 uBox; uniform float uLift;
out vec4 fragColor;
const float SHEETS_ALBEDO = 0.6; // the satin's reflectance under the lamp's key: about M3's brightness; retune by eye
// The satin's sheen, the lamp's reflection along the weave, relative to the lamp's exposed key (LAMP_KEY, lamp.ts) as
// every reflection of the lamp is: M3's value (0.14, under its own steeper falloff) in exposed-key units; retune by eye
const float SHEETS_SHEEN = 0.043587;
float folds(vec2 p) {
  vec2 q = p + 0.3 * vec2(snoise(p * 0.6 + 2.0), snoise(p * 0.6 + 9.0));
  return 0.020 * snoise(q * vec2(0.8, 2.2)) + 0.008 * snoise(q * vec2(2.0, 4.6) + 7.0) + 0.0025 * snoise(q * 7.0 + 3.0);
}
void main() {
  vec2 p = vPos.xy;
  const float e = 0.003;
  float hx = (folds(p + vec2(e, 0.0)) - folds(p - vec2(e, 0.0))) / (2.0 * e);
  float hy = (folds(p + vec2(0.0, e)) - folds(p - vec2(0.0, e))) / (2.0 * e);
  vec3 n = normalize(vec3(-hx, -hy, 1.0));
  vec3 P = vec3(p, vPos.z);
  vec3 L; float fall;
  vec3 light = lampLight(P, n, L, fall);
  vec3 V = normalize(cameraPosition - P); vec3 Hh = normalize(L + V);
  vec3 T = normalize(vec3(1.0, 0.3 * snoise(p * 1.1 + 4.0), 0.0));
  T = normalize(T - n * dot(T, n));
  float th = dot(T, Hh);
  float sheen = pow(sqrt(max(0.0, 1.0 - th * th)), 70.0);
  vec3 base = mix(C_INK, C_GRAPHITE, 0.18) * SHEETS_ALBEDO;
  vec3 col = base * light + LAMP_KEY * SHEETS_SHEEN * sheen * fall;
  vec2 c = 0.5 * (uBox.xy + uBox.zw), hs = 0.5 * (uBox.zw - uBox.xy);
  vec2 q = abs(p - c) - hs;
  float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  float r = 0.012 + 0.2 * uLift;
  float amt = 0.8 * pow(1.0 - clamp(uLift / 1.2, 0.0, 1.0), 2.0);
  col *= 1.0 - amt * (1.0 - smoothstep(-0.3 * r, r, sd));
  fragColor = vec4(col, 0.0); // alpha 0: the backdrop (focus.ts blurs it a little more)
}`;

export class Sheets {
  mat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: VERT,
    fragmentShader: `precision highp float;\n${GLSL_COMMON}\n${LAMP_GLSL}\n${FRAG}`,
    uniforms: {
      uLampOn: LAMP_ON, uBox: { value: new THREE.Vector4(0, 0, PAGE_W, 1) }, uLift: { value: 0 },
    },
  });
  mesh = new THREE.Mesh(new THREE.PlaneGeometry(12, 8), this.mat);
  constructor() {
    this.mesh.position.set(0, 0.5, -0.002);
    this.mesh.frustumCulled = false;
  }
  update(box: [number, number, number, number], lift: number) {
    const u = this.mat.uniforms;
    (u.uBox!.value as THREE.Vector4).set(...box);
    u.uLift!.value = lift;
  }
  dispose() {
    this.mat.dispose();
    this.mesh.geometry.dispose();
  }
}
