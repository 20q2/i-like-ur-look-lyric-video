// A magazine page's size in page units (pu), the units spreads draw in: 770 x 1000, origin top-left, y down. In a
// module of its own with no imports, so the page geometry (curl.ts) and the paper shader have it without pulling the
// typesetting's fonts and lyrics into their import graph; layout.ts re-exports it.
export const PAGE = { w: 770, h: 1000 } as const;
