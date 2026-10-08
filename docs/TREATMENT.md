# "I Like Ur Look" — Treatment

The working reference a spread author reads before building a spread. Compiled from the parent
spec and the milestone 3 and 3.5 specs — **no creative decisions are invented here**; where a spec
is silent, this document says **undecided**.

Sources: the project's design specs (cited below as *parent §n*, *cover §n* and *look §n*; working
documents, not published), `docs/ENGINE.md` (palette/font API names), `data/audio.json` (section
start times).

## 1. Concept

**The magazine is hers.** *EFFORTLESS* — *The Fall Issue* — belongs to the other woman: she is its
cover star, he is styled on her throughout as the season's must-have piece (parent §2). Made
literal from the lyric's own metaphor (a person as a garment: "She wears you well," "you look
better on me"): **he is an empty jacket on a hanger, with a price tag.** She is never drawn either
— a cut-out-shaped hole, dotted cut-lines, a small scissors mark (parent §1 Figures, §2). This is
still life: no bodies, only garments, objects and type.

**The narrator is only ever the lipstick.** She never appears as a figure and never narrates in
her own type — she is a hand holding a lipstick, reading the issue and defacing it, increasingly,
as the song goes on. The magazine itself stays immaculate and straight-faced throughout; all of the
feeling lives in the vandalism (parent §2).

**The crack in the gloss.** The lipstick's presence escalates across the video (parent §2):

| Stage | Spreads | Lipstick behaviour |
|---|---|---|
| Margins | 0–2 | A kiss on the barcode, small circles, a word in the margin |
| Markup | 3–8 | Circles, underlines, crossings-out, editor's grease-pencil marks |
| Takeover | 9 | Lipstick dominates the page; the bridge page is ripped out |
| Collage | 10–11 | The issue torn and re-taped; she is scissored out of everything |
| Smudge | 12 | A final note on the back cover, smudged away |

## 2. Style bible

**Palette** (`app/src/engine/palette.ts`, per `docs/ENGINE.md`):

| Token | Hex | Use |
|---|---|---|
| `paper` | `#F2EDE4` | page stock |
| `paper2` | `#E6DFD3` | shadowed paper — gutters, undersides of folds |
| `ink` | `#141414` | print |
| `graphite` | `#8A847A` | secondary print (e.g. the cover's dotted cut line around her) |
| `lipstick` | `#FF2E88` | the narrator — nothing else |
| `lipstickDeep` | `#C8155F` | the lipstick's wax edge/shadow |

`HEX` gives the CSS hex, `LIN` the linear-RGB triplet for GL uniforms, `rgba(key, a)` a CSS
`rgba()` string; GLSL gets the same six as `C_PAPER, C_PAPER2, C_INK, C_GRAPHITE, C_LIPSTICK,
C_LIPSTICK_DEEP`.

Rule: **pink only ever means her.** The magazine never prints in pink; every pink mark is the
narrator (parent §3). **Diagnostic scenes (`testcard`) are exempt** — their lipstick is a
measurement marker (sung progress), not the narrator (`docs/ENGINE.md`).

Objects and figures are drawn as **ink illustrations** — clean-line fashion technical flats with
hatching and stitch lines, drawn progressively; no halftone photographs, no cut-paper (cover §1,
Decisions). This is the decided house style and supersedes the parent spec's earlier "photo areas
are ink duotone / halftone" line (parent §3): there are no photographic areas: everything the
magazine prints is line art.

**Type:**

- Bodoni Moda — mastheads, headlines, printed lyrics (`F.bodoni(weight, { italic, text })`; the
  `text` optical size ships only at weight 400 and ignores `weight`)
  At the open-spread framing a page unit is ≈ 1 px on screen: below ~45 pu use the text optical size
  (`{ text: true }`), because the display cut's hairlines go sub-pixel ("b-better" reads "b better").
  Above that most of them hold, but not all: the display cuts draw their hyphen and dashes, and the
  italic t's crossbar, ~0.002 em thick (4 units of 2000: 0.1 pu at 50 pu, under a fifth of a pixel
  even at 4K), sub-pixel at any size we set, so no size threshold covers them. Display-cut type
  containing them gets a 0.5 pu ink outline, `HAIRLINE_PU` (`engine/layout.ts`): fill and stroke the
  same text, both in opaque `ink` (translucent, the two would double up where they overlap);
  `setLine`'s `hairline` option does this for a lyric's fully inked words. That brings the crossbars
  back ("Better" read "Beller"); dashes stay faint under it, so reprint them from the text cut with
  `textCutDashes` (38/2000 thick, same advance, length and height: "Pre-Chorus" read "Pre Chorus").
  Being in page units, both hold at every output scale.
- Archivo — section heads, sans layouts, the "so extreme" width stretches (`F.archivo(width
  62–125, weight 300–900)`, `F.archivoItalic()`)
- IBM Plex Mono — captions, folios, small print, price tags (`F.mono(weight, italic)`)
- Lipstick handwriting — a single-stroke script font from `stroke.ts`, rendered with the lipstick
  brush (`lipstick.ts`): **`hscript`** (Hershey Script 1, `HersheyScript1.svg`), the narrator's one
  hand across the video. (Decided 2026-10-01, in M4: under the 6-wide brush the EMS Allure cursive,
  `script`, closes its e and leaves its o from the middle — "better on me" read "better an mc".)

**Lyrics as print.** Lyrics are set into each layout as headlines, pull-quotes, captions or
listings — never subtitles. Karaoke: unsung words sit as a faint ghost of the print, `ink` at `GHOST`
(0.16) opacity; sung words print to full `ink` word by word, via `Lyrics.wordProgress`
(`engine/layout.ts`'s line setter).
Key first-person lines ("better on me") are additionally written over in lipstick (parent §3).

**Motion:**

- Page turns (3D paper curl) land on the downbeat that opens each section
- Inside a spread the camera "reads": slow lateral drifts, push-ins onto details
- Small print elements snap in on kick hits; strong ease-outs (`outExpo`, `inOutCubic`), no floaty
  motion
- 134.0 BPM, constant; beat 0.448 s, bar 1.79 s; each lyric line ≈ 2 bars

(parent §3)

**Tone.** Deadpan luxury. No emoji, no cartoon faces, no clip-art hearts. The joke is in the small
print. No real brand logos or trade dress — the Acqua Di Gio line gets an invented fragrance ad
(parent §3).

## 3. The object

One continuous scene (`scenes/magazine.ts`) owns the whole song: a magazine lying on **charcoal
satin sheets** — dark graphite, soft folds, low anisotropic sheen, night, not pink (pink stays the
narrator's signal) — filmed from above, under one warm key lamp from the upper left and dim cool
ambient. The paper is the brightest thing in frame; the sheets fall off into dark at the frame
edges (cover §1–2).

**The look: a night photograph** (look §2–3). The magazine reads as a real one photographed at
night under a bedside lamp, not a render: a warm pool of lamplight from the upper left falling to
about half across the spread (lit paper, cream where the lamp is, never paper white), the far side
and the shadows going cool; paper with a visible tooth and a broad, soft sheen that glides as the
camera moves; pages that bow up out of a shaded gutter and settle when they land; soft focus where
the page isn't (the bed, a page swinging toward the lens); a photograph's grain, vignette and
contrast; and a subtle handheld camera. Design every spread under this light: what looks right on
a flat white canvas prints darker and warmer here, and dimmer toward the lower right.

Page aspect **0.77** (a US fashion-glossy page, ~8.4 × 10.9 in), so an open spread is ~1.54:1 and
sits inside 16:9 with a band of sheets visible either side. The magazine has slight thickness (a
visible page-edge stack) and a soft contact shadow on the sheets (cover §2).

**Leaves:** leaf *i* has a front (recto) and a back (verso). Closed, the top face is the cover
(leaf 0 front). After turning leaf *i*, the open spread *i*+1 shows leaf *i* back as its left page
and leaf *i*+1 front as its right page (cover §2) — this is the physical fact behind a spread's
`pages: [number, number]` (§6).

**Camera:** perspective, looking down with a slight tilt. Each spread supplies its pose over time
— a target point on the spread in page coordinates, distance, tilt, roll — and the scene eases
between spreads' poses around turns. The camera sits **close on spreads** (an open spread nearly
fills the frame) and **pulls back only for the cover, page turns, and the back cover** (cover
§1–2).

**Page turns:** a turn starts on the downbeat that opens a section (`data/audio.json` sections)
and lands in **~0.55 s with a strong ease-out** — the hit launches the page. The deformation is a
standard cylinder curl around a moving axis in the vertex shader; the curl radius shrinks as the
page lifts, and the turning leaf casts a soft shadow onto the page beneath it (cover §4.3).

## 4. Flatplan

Times are each section's actual `start` from `data/audio.json` (`python -c "import json;[print(s['name'],
s['start']) for s in json.load(open('data/audio.json'))['sections']]"`); content is the parent
spec's flatplan (parent §4) unchanged.

| # | Time (s) | Section | Spread (scene file) | Content |
|---|---|---|---|---|
| 0 | 0.0 (`intro1`) | Intro "Better" | Cover (`cover`) | EFFORTLESS, The Fall Issue. Him on a hanger beside her silhouette; cover line "The Look of the Season". On "Better": one kiss on the barcode |
| 1 | 8.291 (`verse1`) | Verse 1 | Get the Look (`getthelook`) | Shopping page: patent boots, blush compact, teasing comb drop in on their words with price + page no.; lipstick circles each. "I know that I'll run into you" as a where-to-be-seen column |
| 2 | 22.62 (`prechorus1`) | Pre-chorus 1 | In Memoriam (`memoriam`) | Dignified obituary column for her, photo neatly cut out; "Survived by: one jacket". "Tell me y'all are done" as a small SPLIT notice. Lipstick writes *fun* |
| 3 | 35.158 (`chorus1`) | Chorus 1 | The Cover Story (`coverstory`) | Huge Bodoni "I LIKE YOUR LOOK"; "extreme" stretches to max width; street-style strip with the jacket gliding across frames on "walk the street"; "She wears you well" = her silhouette wearing it; lipstick scrawls "better on me" |
| 4 | 53.069 (`verse2`) | Verse 2a | Perfume ad (`perfume`) | Invented fragrance ad: refractive bottle, scent strip peels back on "sheets"; "dress just for me" as the ad's tagline |
| 5 | 60.233† | Verse 2b | Accessories (`accessories`) | The leash as a product listing, tag "SOLD"; "unfortunate for me" in the small print |
| 6 | 67.398 (`prechorus2`) | Pre-chorus 2 | Corrections (`corrections`) | "In our last issue we reported she was dead and gone. She is not. We regret the error." Lipstick strikes the correction |
| 7 | 79.936 (`chorus2`) | Chorus 2 | Contact sheet (`contactsheet`) | 35mm contact sheet of the shoot; lipstick as grease pencil — X through every frame with her, circles the ones of him alone |
| 8 | 96.056 (`postchorus1`) | Post-chorus 1 | Specimen fold-out (`specimen`) | "So extreme / So effortlessly" as a centrefold that unfolds panel by panel on the beat, type pushed to extreme width/weight |
| 9 | 110.385‡ (`bridge1`) | Bridge | Who Wore It Better? (`whoworeit`) | Tabloid side-by-side HER vs ME; lipstick tallies her own column, frantic on the "b-b-better" stutters; the page is ripped out |
| 10 | 133.669 (`chorus3`) | Chorus 3 | Ransom note (`ransom`) | The issue torn and re-taped; chorus spelled in cut-out magazine letters; she is scissored out of every photo |
| 11 | 149.789 (`postchorus2`) | Post-chorus 2 | Classifieds (`classifieds`) | Back-page small ads ("WANTED: one jacket, gently worn"); ad-libs pop in as new listings; the last line written across all of them |
| 12 | 164.118 (`outro1`) | Outro | Back cover (`backcover`) | Lipstick writes "better on me" + a kiss; a thumb smudges it; the magazine closes |

Verse 2 is split across spreads 4 and 5 at the line "But you're already on a leash" (parent §4).

† Not a section boundary: `data/audio.json` has one `verse2` section (53.069). Spread 5 starts on
the downbeat after "But you're" (59.98 s), which is a pickup 0.57 beats before it — the same rule
`analyze.py` uses for section starts. The flatplan (`app/src/spreads/flatplan.ts`) turns the page there,
at 60.233 s.
‡ A bar before `bridge1`'s start (112.176 s), on the instrumental drop — see §7.

## 5. The cover

Cover spec §3, timeline:

| Time (s) | Music | On screen |
|---|---|---|
| 0 – 1.127 | drum fill | Dim charcoal sheets under the lamp. The closed magazine drops into frame from above the camera and lands on the fill's last hit (1.127) with a small settle; its contact shadow tightens on landing. The cover is blank paper |
| 1.127 | bar 1 downbeat | Masthead **EFFORTLESS** (Bodoni Moda 900, full cover width) inks in. On the following kicks the small print snaps in: `THE FALL ISSUE · NO. 47`, price, date line |
| 2.918 | bar 2 | The hanger, then the jacket (a single-breasted blazer as a technical flat: outline, lapels, pockets, buttons, stitch lines, hatching) draw themselves stroke by stroke, stroke groups starting on kicks |
| 4.709 | bar 3 | Cover lines typeset in: *The Look of the Season* (large Bodoni italic) and `HIM, WORN WELL — P. 6` (mono; the Cover Story's page). Beside the jacket, **her**: a dotted cut-line silhouette with a small scissors mark traces around an empty space |
| 6.500 | bar 4 | Push-in toward the lower corner of the cover (the barcode, and the cover line beside it), arriving as **Better.** finishes printing |
| 7.38 – 8.09 | band stops; "Better" | A cover line **Better.** prints in ink, karaoke with the word. The moment it has printed in full (~7.62), **the first pink of the video**: a lipstick kiss presses onto the barcode (press, then lift, over ~0.3 s) and holds in the close-up. From ~7.99 the camera eases back out to the whole kissed cover, arriving on the downbeat |
| 8.291 | verse 1 downbeat | The cover flips open (page turn, §4.3) with the whole kissed cover in frame, and the camera moves across to the open spread 1 (a placeholder in this milestone) — not up it: once the verse has started, the camera doesn't travel up the page |

Ink vs pink: everything the magazine prints is ink/graphite on paper; the kiss is the only pink on
the cover.

## 6. Authoring a spread

A spread module exports an object implementing (cover §4.2, verbatim):

```ts
interface Spread {
  id: string;
  section: string;                                          // audio section name it belongs to
  drawPrint(side: 'L' | 'R', c: CanvasRenderingContext2D, t: number): void; // what's printed
  drawMarks(side: 'L' | 'R', c: CanvasRenderingContext2D, t: number): void; // lipstick layer
  key(side: 'L' | 'R', layer: 'print' | 'marks', t: number): string;        // changes iff the face would look different
  camera(t: number): CameraPose;                            // target on the spread, distance, tilt, roll
}
```

(`app/src/spreads/spread.ts`, built in task 3, also carries `pages: [number, number]` — the
spread's left/right page numbers, the cover: 0 and 1 — and an optional `lift(t)`, used only by the
cover, for its drop. `CameraPose` is `{ x, y, dist, tilt, roll }`.)

- Canvas coordinates are **page units**, not pixels: a page is a fixed logical **770 × 1000 pu**,
  origin top-left, y down (Canvas2D convention) — the canvas is scaled for output resolution
  underneath you.
- **Face canvas pool:** at most four faces are visible at once (current left, turning leaf front
  and back, next right), so the scene keeps a pool of four print + four marks canvases and assigns
  them to whichever faces are visible. The cover uses only the right-hand face while closed
  (`side: 'R'`) (cover §4.2).
- **Page ↔ world mapping** (plan, "World / page coordinates"): world units place the spine at
  x = 0, the right page at x ∈ [0, 0.77], the left page at x ∈ [−0.77, 0], page bottom y = 0, top
  y = 1, table/sheets at z ≈ 0, camera above (+z). A page-unit point `(u, v)` on side `S` maps to
  spread-space world coordinates as:
  ```
  x = (S === 'L' ? u - 770 : u) / 1000
  y = 1 - v / 1000
  ```
  So a right page's top-left corner `(0, 0)` is world `(0, 1)` (the spine top) and its
  bottom-right `(770, 1000)` is `(0.77, 0)`; a left page's `(0, 1000)` is `(−0.77, 0)`.
- **The lamp's sheen.** The paper shader (`engine/paper.ts`) shows the lamp's reflection in the
  coating as a broad, soft sheen that glides over the page as the camera moves. It centres where
  the line from the camera to the lamp's mirror image below the page (z → −z) crosses the page:
  at `FRAME_SPREAD`, world ≈ (−0.31, 0.87), the upper middle of the left page around pu
  (455, 130), and it is still at half strength ~200 pu out. On paper it is subtle (+0.06 linear,
  ~9 levels at its centre). Ink takes a quarter of it (`INK_SHEEN`), so type under it lifts by at
  most ~20 levels: solid black (~25/255) stays ≤ 45/255 even at its centre. There is no keep-out
  zone; keep large solid blacks away from the brightest part of the lamp pool (upper left) only
  if they must read pure black. Stock is per face (`leafStock`, `engine/page.ts`): the front
  cover's outside is varnished (`COVER_STOCK`: a tighter, brighter lobe, +0.25 at its centre and
  at half strength within ~45 px, which greys solid black under it to ~80/255), every other face
  is coated stock (`PAPER_STOCK`). For the cover's home pose the lobe centres just off the
  cover's top-left corner (world ≈ (−0.16, 0.92)), and through the close-up it stays just above
  the frame: the varnish shows at full strength only as the flip sweeps it across the cover, in
  the turn's first frames.
- **Lamp-lit legibility** (look §4). Type must hold 4.5:1 against its paper — WCAG AAA for large
  text, measured pessimistically: lamp-lit ink against the dimmest page corner's paper. The lamp
  is upper left, and the far corner (the right page's lower right) gets about half its light, with
  the vignette darkening the frame's corners on top; the placeholders' worst title is 5.67:1
  (142 s). So set lyric-heavy layouts toward the lamp — the left page, the top — and keep thin or
  grey type out of the lower right. Near the spine, the gutter's shade costs type ~8 % of its
  light at 60 pu, ~4 % at 120 pu. Check a spread's stills with `app/scripts/legibility.py`
  (`docs/ENGINE.md`, "Running things"). Incidental small type (folios, the placeholders'
  "SPREAD IN PRODUCTION") is exempt, but small mono type meant to be read (prices, captions,
  small-print jokes) must be full ink — no graphite, no translucent ink — and set large enough to
  reach full ink coverage: IBM Plex Mono at 9–11 pu has strokes about a pixel wide at the
  open-spread framing, which print grey (the cover's `HIM, WORN WELL — P. 6` at 9 pu reaches only
  ~4:1 against the paper beside it). The rule for the spreads (M4, 2026-10-01): small mono meant to
  be read is Plex Mono **600 at ≥ 10.5 pu** — the weight thickens the strokes enough for the close
  framings that read it, while the open spread lets it go grey as a magazine's small print does.
- **Depth of field** (look §3.4). The lens focuses on the page at the camera's target, and type
  stays exactly as printed only where its circle of confusion is under 0.35 px; the blur fades in
  from there to 0.7 px. Every standard framing keeps the whole page under 0.35 px, but a close,
  tilted hold doesn't: the page recedes from the target, and type away from it softens, most up
  the page. At `dist` 1.2 and `tilt` 0.3, type 0.2 page heights above the target has a circle of
  0.33–0.50 px, and 0.3 page heights above it 0.50–0.67 px (the page's height on its pile and bow
  moves it). So keep lyric holds shallow — little tilt, and the type near the target — and add every new
  hold pose to the cases in `app/tests/focus.test.ts`, which checks that the page stays under
  0.35 px.
- **Keys are load-bearing.** `key(side, layer, t)` must be a pure function of `t` — same input,
  same output, always — and must change **iff** that layer would actually draw differently at `t`.
  The scene redraws and re-uploads a face's canvas only when its key changes, so a static page
  costs nothing per frame; get this wrong and a page either never updates or redraws every frame
  for nothing. `layout.ts`'s `karaokeKey` is the reference implementation: it changes only while a
  word is mid-print, quantised so a settled line is cheap.
- **Draw exactly what the key encodes.** Quantise an animated value once and use that quantised
  value both in the key and in `drawPrint`/`drawMarks` (e.g. `layout.ts`'s `inkAt` for lyric ink).
  If the key is quantised but the drawing uses the exact value, a frame's pixels depend on *when*
  the face was last redrawn, and renders stop being reproducible. Check it: render `t − δ, t` in one
  run and `t` alone — the two `t` frames must match up to Chrome's GPU canvas raster noise, every
  pixel within 2 levels (however many glyph-edge pixels differ by that much; the same noise can
  appear between two runs of the same command). A pixel more than 2 levels off is a keyed-state bug:
  a stale ink key shifts whole glyphs by an ink step, ~12 levels.
- **Reversed type is cut, not painted.** Face canvases are transparent and composited in the paper
  shader, so paper-coloured type on solid ink must be *cut out* of the ink
  (`globalCompositeOperation = 'destination-out'`), not filled in paper colour — painted light-on-dark
  detail nearly vanishes when the page is minified (mipmaps average premultiplied sRGB).

**Toolkit modules a spread author reaches for** (see each module's own header for details):

- **`engine/drawing.ts`** — ink illustrations that draw themselves. SVG path data (`M L H V C Q
  Z`, absolute/relative, implicit line-tos) or raw polylines are flattened into polylines carrying
  cumulative arc length — the same shape the stroke fonts already use — so a drawing can be inked
  progressively, timed to the music (a technical flat's stroke groups landing on kicks). Hatch
  fills are parallel lines clipped to a polygon, for the stitch/shading passes fashion flats use. A
  small deterministic wobble gives lines a hand-inked look. Pure geometry except the actual stroke
  call, which paints into a Canvas2D context with its current style.
- **`engine/lipstick.ts`** (with the kiss in `engine/kiss.ts`, re-exported from `lipstick.ts`) —
  the narrator's waxy brush: soft overlapping dabs with pressure along the stroke, drag streaks,
  and flecks where the wax misses the paper, stamped along a path (`lipstickStroke`) or written as
  a stroke-font text or drawing (`lipstickWrite`, which joins strokes that continue one another
  into pen-down runs — smoothed, and tapered only where the lipstick meets or leaves the paper,
  never at a join between letters); and a kiss print (`kiss`) that presses in from the fullest part
  of each lip (and settles) over a `press` progress and opens into specks on `lift`. **Each call
  is one mark**, inked on a scratch canvas (where its own flecks and creases open gaps) and laid
  over the target source-over, so an earlier mark shows through a later one's gaps: the target's
  alpha and clip apply to the mark, its composite mode doesn't. Every random choice is hashed from
  `(seed, index)`, so a stroke being written progressively never re-rolls its already-drawn
  texture. Draw into the spread's transparent marks layer — the paper shader composites it over
  the print layer with gloss.
- **`engine/layout.ts`** — the magazine grid in page units: page size, margins, a 12-column grid
  with gutter, and a baseline grid, plus folios/running heads. Its karaoke line setter prints a
  lyric line word by word — unsung words as a faint `ink` ghost (`GHOST`, 0.16), sung words inking
  to full `ink` over the first part of the word, via `Lyrics.wordProgress` — which is how a spread
  prints lyrics as a headline/caption/listing instead of a subtitle. `karaokeKey` is the
  key-of-record for a set of printed lines (see above).

**Determinism.** No `Math.random`, `Date.now`, or `performance.now` anywhere in a scene or spread.
All randomness — `drawing.ts`'s wobble, `lipstick.ts`'s dab jitter and flecks — is hashed from a
seed via `hash`/`mulberry32` (`app/src/engine/util.ts`), never rolled fresh per frame. This is what
makes `stills`/`sheet` renders and the adaptive multi-sample export reproducible — identical up to
Chrome's GPU canvas raster noise: every pixel within 2 levels (see "Draw exactly what the key
encodes" above).

## 7. Open decisions

- **The bridge's page-turn timing** (cover §8; decided in the M4 batch-2 spec, §2): it lands on the
  instrumental drop, 110.385 s, a bar before the first sung word (112.176 s — `data/audio.json`'s
  `bridge1.start`, `SECTION_START` in `analysis/analyze.py`). The flatplan's rule is `barBefore`.
- Every real interior spread and the back cover are placeholders in this milestone (section title +
  karaoke lyrics only); their designs in §4 above are the target, not yet built (cover §8).
- **The back cover's varnish** (decided, M4 batch 2): `leafStock` in `engine/page.ts` gives `COVER_STOCK`
  to the back cover's outside, the last leaf's back, as to the front cover's (leaf 0's front).
