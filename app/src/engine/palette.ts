import { hexToLinear } from './util';

// Print palette: paper, ink, graphite, and one lipstick pink. Pink only ever means the narrator —
// the magazine itself never prints in it.
export const HEX = {
  paper: '#F2EDE4', // page stock
  paper2: '#E6DFD3', // shadowed paper: gutters, undersides of folds
  ink: '#141414', // print
  graphite: '#8A847A', // secondary print (the cover's cut line around her; the test card's unsung words)
  lipstick: '#FF2E88', // the narrator, and nothing else
  lipstickDeep: '#C8155F', // lipstick wax edge / shadow
} as const;

export type PaletteKey = keyof typeof HEX;

/** Linear RGB triplets for GL uniforms. */
export const LIN: Record<PaletteKey, [number, number, number]> = Object.fromEntries(
  Object.entries(HEX).map(([k, v]) => [k, hexToLinear(v)]),
) as Record<PaletteKey, [number, number, number]>;

/** CSS rgba() for Canvas2D. */
export function rgba(key: PaletteKey | string, a = 1): string {
  const hex = (HEX as Record<string, string>)[key] ?? key;
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
