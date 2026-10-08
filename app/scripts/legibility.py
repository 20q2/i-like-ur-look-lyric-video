# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "pillow"]
# ///
"""The legibility floor on magazine stills.

    uv run app/scripts/legibility.py out/stills/f_0016.00.png [...]      (or plain python, with numpy and pillow)
    options: --floor 4.5 (the floor); --box x0,y0,x1,y1 (px: look for the title's stems only there)

Every ratio is (L_paper + 0.05) / (L_ink + 0.05), L the WCAG relative luminance (sRGB decoded, Rec. 709 weights), and
must be at least the floor, 4.5:1 (WCAG AAA for large text: the lyrics are display type). Two measures per still:

- title: the lamp-lit ink of display type against the paper at the dimmest page corner, the pessimistic pairing the
  spec asks for. The ink is display type's stems: ink cores that survive a 2 px erosion (strokes >= 5 px thick, so body
  and small type drop out), one stem per connected core of >= 30 px, and the ratio is the brightest stem's, the one
  the lamp and its sheen lift most. The paper is the dimmest of the page's outer corners in frame (one the frame clips
  doesn't count): the mean of the paper 20-100 px in from the corner along both edges — inside the margin, clear of
  the page edge's rim — with any ink there (a folio, a barcode) masked out.
- gutter: the ink at the gutter-side edge of each text line within 150 px of a spread's spine (the right page's lyric
  column starts 58 pu from it), against the paper beside it on the gutter side, which the gutter's occlusion dims with
  it (paper.ts GUTTER). The ink is the edge glyph's core (its ink eroded 1 px; its 10 darkest pixels if nothing
  survives), the paper a 12 px wide box 4-16 px from the glyph toward the spine, over the line's middle rows. A still
  with no spine (the closed cover) has no gutter measure.

Ink is dark (under INK_OF_PAPER of the page's median paper) and near-neutral: the lipstick is the narrator's mark, not
type. Exempt: incidental small type (folios, the placeholders' "SPREAD IN PRODUCTION" label) — mono type that small
never reaches full ink coverage at these framings (TREATMENT §6), and neither measure sees it; and unsung lyric words,
a faint ghost by design (layout.ts GHOST). Measure settled frames: a word still inking in (layout.ts inkOf) reads low.
The sizes are for the standard framings (a page unit about a pixel at 1080p): render 1080p stills.

The two measures are independent: a still whose gutter (or title) can't be measured keeps the other's ratios, and is
reported INCOMPLETE rather than passed.

Exit status: 1 if any ratio is below the floor; otherwise 2 if any still, or either measure on it, couldn't be measured
(or the script failed on it: never a pass); 0 if every still was measured in full and every ratio is at least the floor.
"""
import argparse
import sys
import traceback
from collections import deque

import numpy as np
from PIL import Image

PAPER_MIN = 0.12  # luminance: paper above it (the dimmest page paper ~0.25), the sheets below (<= ~0.05)
INK_OF_PAPER = 0.3  # ink: under this share of the page's median paper (full ink ~2%, lifted by the sheen ~5%, a ghost ~70%)
INK_SAT = 0.5  # and under this sRGB saturation (ink's darkest pixels stay under 0.4 in the warm lamp, the kiss's are 0.8+)


class Unmeasurable(Exception):
    pass


def load(path):
    """Relative luminance per pixel, and the sRGB saturation (max - min) / max."""
    s = np.asarray(Image.open(path).convert('RGB'), dtype=np.float64) / 255.0
    mx = s.max(2)
    sat = np.where(mx > 0, (mx - s.min(2)) / np.maximum(mx, 1e-9), 0.0)
    return np.where(s <= 0.04045, s / 12.92, ((s + 0.055) / 1.055) ** 2.4) @ np.array([0.2126, 0.7152, 0.0722]), sat


def ratio(lp, li):
    return (lp + 0.05) / (li + 0.05)


def erode(m, r, outside=False):
    """True where the whole (2r+1)^2 neighbourhood is; beyond the image counts as `outside`."""
    h, w = m.shape
    p = np.pad(m, r, constant_values=outside)
    out = np.ones_like(m)
    for dy in range(2 * r + 1):
        for dx in range(2 * r + 1):
            out &= p[dy:dy + h, dx:dx + w]
    return out


def dilate(m, r):
    """True where any of the (2r+1)^2 neighbourhood is (nothing beyond the image)."""
    return ~erode(~m, r, outside=True)


def components(mask, min_px):
    """8-connected components of a mask, as (ys, xs) index arrays, those of >= min_px pixels."""
    seen = np.zeros_like(mask)
    h, w = mask.shape
    out = []
    for y0, x0 in zip(*np.nonzero(mask)):
        if seen[y0, x0]:
            continue
        seen[y0, x0] = True
        q, ys, xs = deque([(y0, x0)]), [], []
        while q:
            y, x = q.popleft()
            ys.append(y); xs.append(x)
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    v, u = y + dy, x + dx
                    if 0 <= v < h and 0 <= u < w and mask[v, u] and not seen[v, u]:
                        seen[v, u] = True
                        q.append((v, u))
        if len(ys) >= min_px:
            out.append((np.array(ys), np.array(xs)))
    return out


def page(L, sat):
    """The paper in frame: its mask (opened, so neither a speck of sheen nor a thin rim counts); its outer corners, the
    extremes along the diagonals (a spread's four outer corners, perspective and all), each with the direction into the
    page; and the ink on it."""
    paper = dilate(erode(L > PAPER_MIN, 3), 3)
    ys, xs = np.nonzero(paper)
    if xs.size < 0.05 * L.size:
        raise Unmeasurable('no page in frame')
    corners = {}
    for name, key, sx, sy in (('upper left', -(xs + ys), 1, 1), ('upper right', xs - ys, -1, 1),
                              ('lower left', ys - xs, 1, -1), ('lower right', xs + ys, -1, -1)):
        i = int(np.argmax(key))
        corners[name] = (int(xs[i]), int(ys[i]), sx, sy)
    # the page's area, ink included: each row filled between its first and last paper pixel (the holes ink punches in
    # the paper mask closed; fine for the convex page outline at these framings)
    area = np.zeros_like(paper)
    for y in np.nonzero(paper.any(1))[0]:
        row = np.nonzero(paper[y])[0]
        area[y, row.min():row.max() + 1] = True
    ink = area & (L < INK_OF_PAPER * np.median(L[paper])) & (sat < INK_SAT)
    return paper, corners, ink


def corner_paper(L, paper, corners):
    """The paper at each outer corner in frame: the mean over 20-100 px in from it along both edges, ink masked out."""
    h, w = L.shape
    out = {}
    for name, (cx, cy, sx, sy) in corners.items():
        if cx < 3 or cy < 3 or cx > w - 4 or cy > h - 4:
            continue  # the frame clips it: not the page's corner
        x0, x1 = sorted((cx + sx * 20, cx + sx * 100)); y0, y1 = sorted((cy + sy * 20, cy + sy * 100))
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, w), min(y1, h)
        win, inpage = L[y0:y1, x0:x1], paper[y0:y1, x0:x1]
        if inpage.mean() < 0.5:
            continue
        clean = inpage & erode(win > 0.8 * np.median(win[inpage]), 2)  # no ink, nor the 2 px around it
        if clean.sum() < 400:
            continue
        out[name] = (float(win[clean].mean()), ((x0 + x1) // 2, (y0 + y1) // 2))
    if not out:
        raise Unmeasurable('no page corner in frame')
    return out


def title_stems(L, ink, box):
    """Display type's stems: the ink's cores after a 2 px erosion, >= 30 px each; (mean luminance, centre) per stem."""
    core = erode(ink, 2)
    if box:
        x0, y0, x1, y1 = box
        keep = np.zeros_like(core); keep[y0:y1, x0:x1] = True; core &= keep
    return [(float(L[ys, xs].mean()), (int(xs.mean()), int(ys.mean()))) for ys, xs in components(core, 30)]


def spine(L, paper):
    """A spread's spine: the dark valley of the gutter's occlusion near the middle of the paper, or None (a single page)."""
    ys, xs = np.nonzero(paper)
    top, bottom, left, right = ys.min(), ys.max(), xs.min(), xs.max()
    rows = slice(top + (bottom - top) // 4, bottom - (bottom - top) // 4)
    band, inb = L[rows, left:right + 1], paper[rows, left:right + 1]
    prof = np.array([np.median(band[inb[:, i], i]) if inb[:, i].mean() > 0.9 else np.nan for i in range(band.shape[1])])
    if np.isnan(prof).all():
        return None
    prof = np.convolve(np.nan_to_num(prof, nan=np.nanmax(prof)), np.ones(5) / 5, mode='same')
    lo, hi = int(0.3 * prof.size), int(0.7 * prof.size)
    i = lo + int(np.argmin(prof[lo:hi]))
    beside = np.concatenate([prof[max(i - 150, 0):max(i - 60, 0)], prof[i + 60:i + 150]])
    if beside.size == 0 or prof[i] > 0.85 * np.median(beside):
        return None
    return left + i


def gutter_lines(L, ink, paper, sx):
    """Text lines whose edge lies within 150 px of the spine at x sx: per line its rows, its edge glyph's ink and the
    paper beside it toward the spine. Yields (side, (y0, y1), edge x, ink, how, paper, paper box centre)."""
    ys, _ = np.nonzero(paper)
    top, bottom = ys.min(), ys.max()
    w = L.shape[1]
    for side in (1, -1):  # the right page (its lines start at the spine side), the left page (its lines end there)
        a, b = sorted((sx + side * 12, sx + side * 150))
        a, b = max(a, 0), min(b, w)  # (a negative bound would wrap)
        rows = np.nonzero(ink[top:bottom, a:b].sum(1) >= 2)[0]
        # rows with ink make lines: a gap of 3 empty rows or more ends one; a line is 10 rows or more (the page's
        # anti-aliased top and bottom edges, which pass for ink, are a few)
        for grp in np.split(rows, np.nonzero(np.diff(rows) > 3)[0] + 1) if rows.size else []:
            if grp[-1] - grp[0] + 1 < 10:
                continue
            y0, y1 = top + grp[0], top + grp[-1] + 1
            cols = np.nonzero(ink[y0:y1, a:b].sum(0) >= 2)[0]
            if cols.size == 0:
                continue  # ink in every row but no column with 2 px of it: a shallow 1-px hatch, not a text line
            edge = a + (cols.min() if side > 0 else cols.max())
            gw = max(4, (y1 - y0) // 2)  # the edge glyph: half a line height from the edge
            g0, g1 = (edge, edge + gw) if side > 0 else (max(edge - gw + 1, 0), edge + 1)
            gl, core = L[y0:y1, g0:g1], erode(ink[y0:y1, g0:g1], 1)
            if core.sum() >= 5:
                li, how = float(gl[core].mean()), 'core'
            else:
                li, how = float(np.sort(gl.ravel())[:10].mean()), 'darkest 10'
            m0, m1 = y0 + (y1 - y0) // 5, y1 - (y1 - y0) // 5
            p0, p1 = (max(edge - 16, 0), max(edge - 4, 0)) if side > 0 else (edge + 5, edge + 17)
            pb = L[m0:m1, p0:p1]
            if pb.size == 0 or not paper[m0:m1, p0:p1].all() or pb.min() < 0.6 * np.median(pb):
                raise Unmeasurable(f'no clean paper beside the line at rows {y0}-{y1} (edge x {edge})')
            yield side, (y0, y1), edge, li, how, float(pb.mean()), ((p0 + p1) // 2, (m0 + m1) // 2)


def title_measure(L, paper, corners, ink, box, below):
    """The title measure (see the module's docstring); prints it and returns its ratio."""
    papers = corner_paper(L, paper, corners)
    cname, (lp, at) = min(papers.items(), key=lambda kv: kv[1][0])
    print(f'  paper: dimmest corner {cname}, {lp:.4f} (window centre {at[0]},{at[1]}; '
          + ', '.join(f'{k} {v[0]:.4f}' for k, v in papers.items() if k != cname) + ')')
    stems = title_stems(L, ink, box)
    if not stems:
        raise Unmeasurable('no display type (no ink stroke 5 px thick)')
    li, (x, y) = max(stems)
    r = ratio(lp, li)
    mean, median = float(np.mean([s[0] for s in stems])), float(np.median([s[0] for s in stems]))
    print(f'  title: brightest of {len(stems)} stems {li:.4f} at {x},{y} -> {r:.2f}{below(r)}  '
          f'(the stems\' mean {mean:.4f} -> {ratio(lp, mean):.2f})')
    if li > 3 * median and li > 0.03:
        print(f'  note: that stem is {li / median:.1f}x the median stem: check that it is ink (off the standard framings, '
              'a shadow or a leaf\'s edge can pass for it)')
    return r


def gutter_measure(L, paper, ink, below):
    """The gutter measure (see the module's docstring); prints it and returns its ratios (none without a spine or a line
    near it)."""
    sx = spine(L, paper)
    if sx is None:
        print('  gutter: no spine in frame (a single page), no gutter measure')
        return []
    lines = list(gutter_lines(L, ink, paper, sx))
    if not lines:
        print(f'  gutter: spine at x {sx}, no text line within 150 px of it')
    ratios = []
    for side, (y0, y1), edge, li, how, lpg, (px, py) in lines:
        ratios.append(ratio(lpg, li))
        print(f'  gutter: {"right" if side > 0 else "left"} page, line rows {y0}-{y1}, edge x {edge} ({abs(edge - sx)} px '
              f'from the spine at {sx}): ink {li:.4f} ({how}), paper beside {lpg:.4f} at {px},{py} -> {ratios[-1]:.2f}'
              f'{below(ratios[-1])}')
    return ratios


def measure(path, floor, box):
    """Print the still's measures; returns its ratios and the measures that couldn't be taken. Each measure stands alone:
    one that can't be taken never drops the other's ratios."""
    L, sat = load(path)
    paper, corners, ink = page(L, sat)  # (no page: nothing to measure, Unmeasurable for the whole still)
    below = lambda r: f'  BELOW {floor}' if r < floor else ''
    ratios, missing = [], []
    for name, take in (('title', lambda: [title_measure(L, paper, corners, ink, box, below)]),
                       ('gutter', lambda: gutter_measure(L, paper, ink, below))):
        try:
            ratios += take()
        except Unmeasurable as e:
            print(f'  {name}: UNMEASURABLE: {e}')
            missing.append(name)
    return ratios, missing


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('stills', nargs='+')
    ap.add_argument('--floor', type=float, default=4.5)
    ap.add_argument('--box', type=lambda s: tuple(int(v) for v in s.split(',')), default=None,
                    help='x0,y0,x1,y1 (px): look for the title\'s stems only in this box')
    a = ap.parse_args()
    measured, incomplete = [], []  # (the still's lowest ratio, the still); the stills not measured in full
    for p in a.stills:
        print(p)
        try:
            ratios, missing = measure(p, a.floor, a.box)
        except Unmeasurable as e:
            print(f'  UNMEASURABLE: {e}')
            ratios, missing = [], ['the still']
        except Exception as e:  # a still it can't read, or a bug in the measurement: never a pass
            print(f'  ERROR: {type(e).__name__}: {e}')
            traceback.print_exc()
            ratios, missing = [], ['the still']
        if ratios:
            measured.append((min(ratios), p))
        if missing:
            incomplete.append(p)
    failing = [m for m in measured if m[0] < a.floor]
    if measured:
        r, p = min(measured)
        print(f'worst ratio {r:.2f} ({p}); floor {a.floor}')
    verdict = 'FAIL' if failing else 'INCOMPLETE' if incomplete else 'PASS'
    print(verdict + (f' ({len(incomplete)} of {len(a.stills)} stills not measured in full)' if incomplete else ''))
    sys.exit(1 if failing else 2 if incomplete else 0)


if __name__ == '__main__':
    main()
