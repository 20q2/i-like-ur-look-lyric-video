"""Word-level lyric alignment -> data/lyrics.json

Pipeline
  1. ctc_emissions.py  : frame-wise CTC log-probs of the vocal stem from two
                         acoustic models (MMS_FA, wav2vec2 LV60K).
  2. whisper_run.py    : faster-whisper large-v3 word timestamps (cross-check).
  3. vocal_feats.py    : vocal-stem RMS / pitch / onset features (5 ms hop).
  4. this script       : one global constrained CTC Viterbi pass over the whole
                         song on the fused emissions (garbage "star" token
                         between lines), with manually verified anchors for hard
                         spots, then signal-based refinement of word starts/ends,
                         confidence scoring, QA plots.

Run:  uv run python align.py [--plots]
"""
import common
import json
import re
import sys
from difflib import SequenceMatcher

import numpy as np

from ctcalign import FRAME, align, emissions, word_table
from pron import pron

# Primary emission set: mixture of both CTC models on the demucs vocal stem's
# mono sum, left and right channel (choruses are double-tracked L/R).
PRIMARY = "fused6"
# Independent-ish alternatives, used for agreement-based confidence.
ALTS = ("mms", "lv60k", "fused_vocL", "fused_vocR")

# Per-line time windows (seconds) where the automatic path is ambiguous.
LINE_WINDOWS = {}

# ---------------------------------------------------------------------------
# Manual anchors (seconds) for the CTC path, established by inspecting the QA
# plots (spectrogram / pitch / envelopes).  Key: (line, token, subword) ->
# (earliest allowed start, latest allowed end) of that subword's chars.
ANCHORS = {
    # L36 postchorus-2 "So extreme".  Unconstrained, every path folds it into the
    # held chorus-3 "yeah" (fused 149.46-149.96, which FIX (35, 7) puts at
    # 149.32-150.12), and a bare "after the yeah" bound instead stretches "So"
    # over the whole 150.5-156.2 gap.  Evidence: postchorus 2 repeats postchorus
    # 1's bar layout exactly one bar-grid shift later (53.73 s: the chop phrase at
    # 97.6-99.4 recurs at 151.2-152.9).  Postchorus 1 sings "So" as a re-entry on
    # beat 2 (96.50 = downbeat 96.06 + 0.44), a dip (96.74), then "extreme" on a
    # 444 Hz note 96.76-97.32.  Here: yeah decays to -50 dB at 150.24, re-entry
    # bump 150.26-150.46 (-50 -> -42 dB, 378 Hz; downbeat 149.79 + 0.47), dip to
    # the floor at 150.48-150.50, then a faint 389 -> 347 Hz / 295 Hz note run
    # from 150.52 to ~151.08 (~10 dB fainter than postchorus 1), ending before
    # the loud "Woo" glide (RMS -55 -> -20 dB at 151.22).
    (36, 0, 0): (150.14, None),
    (36, 1, 0): (150.48, 151.20),
}

# Final manual corrections of word boundaries after refinement, only where the
# plots clearly show the automatic result is wrong.  (line, token) ->
# dict(start=..., end=..., conf=...).  A manual end is authoritative: main()
# pushes the following word later instead of cutting the fixed word short.
# entries are added only after inspecting the QA plots for this song
FIX = {
    # L7 / L19 "are done": "done" is a long held note after a /d/ closure (voice
    # drops out 31.96-32.06 / 76.74-76.84, voicing re-enters at 32.06 / 76.84).
    # The fused path puts "done" mid-note (32.74 / 77.70).  L7: mms 32.02 and
    # lv60k 32.06 agree.  L19: models disagree (mms 77.07, lv60k 77.50), but the
    # closure gap and the rhythm are the same as L7 ("are" -> "done" +0.16 / +0.18 s).
    (7, 4): dict(start=32.06, conf=0.75),
    # L3 "'cause": the voice re-enters at 17.00 after "blush" (-47 dB 16.86-16.98, the /k/ closure). Started there,
    # the user saw it highlight late: it's long (0.54 s), so its ink fills over 0.19 s after a 0.14 s silence. Started
    # in the closure, at 16.90, it reads with the /k/.
    (3, 4): dict(start=16.90, end=17.25, conf=0.8),
    # L3 "I'm": the user saw it highlight late at 17.52, inside the note. "'cause" is 17.00-17.25 (a dip to -29 dB at
    # 17.25), "I'm" 17.27-17.70 (then the floor to 17.90), "a" 17.90-17.97, "doll" from 18.12.
    (3, 5): dict(start=17.27, end=17.72, conf=0.8),
    # L26 post-chorus-1 "So effortlessly": CTC put "So" on the sound at 101.22-102.30, then a 2.5 s silence before
    # "effortlessly" (104.77), which it stretched over "So" too (the user saw "So" ink 3 s early). Placed on the bar as
    # L37 sings it (downbeat 155.162: a pickup 0.19 s after it, 155.35-155.55; "So" on beat 2, 155.70-156.06;
    # "effortlessly" on beat 3, from 156.10): from downbeat 105.011, the pickup is 105.22-105.44, "So" 105.54-105.66
    # (beat 2, 105.459, +0.08 as L37's), "effortlessly" from 105.70. (Set first at 104.78, then 105.22 — the pickups —
    # the user still saw "So" ink early, and the camera's move on "effortlessly" with it.)
    (26, 0): dict(start=105.54, end=105.68, conf=0.7),
    (26, 1): dict(start=105.70, conf=0.7),
    # L37 post-chorus-2 "So effortlessly", the same shape (the user saw its "So" light early at CTC's 155.62): "So" on
    # beat 2 + 0.09, 155.70-156.06 (-38 -> -20 dB), "effortlessly" from 156.10.
    (37, 0): dict(start=155.70, end=156.06, conf=0.7),
    (37, 1): dict(start=156.10, conf=0.7),
    (19, 4): dict(start=76.84, conf=0.6),
    # L17 prechorus-2 "Tonight": the /t/ burst at 68.00 (RMS -50 -> -26 dB, onset
    # peak 68.04, voicing from 68.08) is where mms puts it (68.06); fused / lv60k
    # start it mid-note at 68.54.  Same shape as prechorus 1 (burst 23.22, voicing
    # 23.30): "Tonight" -> "just" 0.89 s there, 0.88 s here (0.34 s before the fix).
    (17, 0): dict(start=68.00, conf=0.75),
    # L17-18 "...pretend / That she's": the user saw "That" light early at 70.40 (inside "pretend", which the voice holds
    # to 70.95). The stem is at its floor 71.00-71.53; "That" is 71.56-72.00, "she's" from ~72.0 (as aligned).
    (17, 2): dict(end=70.95, conf=0.75),
    (18, 0): dict(start=71.56, end=72.00, conf=0.75),
    # L16 "baby" before it: the voice falls from -22 to -40 dB at 67.30-67.40;
    # what follows until the /t/ is a faint tail (-40..-53 dB).  Start stays CTC.
    (16, 5): dict(end=67.40, conf=0.67),
    # Chorus-ending "me, yeah": every chorus sings "me" on a 470 -> 529 Hz note and
    # "yeah" on the step down to 394 Hz (333 Hz in L38, postchorus2) ~0.68 s later
    # (chorus 1, where CTC is confident: me 50.16, yeah 50.84 at the pitch step).
    # In choruses 2 / 3 the post-chorus "So" took the "yeah" onset and "yeah"
    # landed inside the held "me".  Starts = the pitch step (mms agrees in L24 /
    # L35); ends = where the voice stops before the post-chorus fragments
    # (unvoiced breath / frication after 96.18; RMS < -30 dB at 150.12).
    (24, 7): dict(start=95.62, end=96.18, conf=0.7),
    (35, 7): dict(start=149.32, end=150.12, conf=0.7),
    # L38 / L39: same melody.  "me" glides 522 -> 330 Hz at 163.58-163.64, then an
    # RMS dip (/j/) and the word onset at 163.68 that all three models see (lv60k
    # calls it "yeah"; fused / mms call it the outro "Yeah" and put "yeah" inside
    # the held "me" at 163.28).  Outro "Yeah" = the 331 -> 297 Hz step with an
    # onset peak at 164.18 (lv60k 164.26).
    (38, 7): dict(start=163.68, conf=0.7),
    (39, 0): dict(start=164.18, conf=0.65),
    # L25 postchorus-1 "So extreme": after "yeah" ends (96.18) the first vocal
    # events are a re-entry from a rest at 96.50 (RMS -46 -> -31 dB) and a quiet
    # 444 Hz note from 96.74; mms puts "So" / "extreme" there (96.52 / 96.78).  The
    # other alignments put them on the "yeah" (95.5-95.9), which is known wrong.
    # One model and a faint (processed, ~20 dB below the lead) vocal: low conf.
    (25, 0): dict(start=96.52, conf=0.45),
    # "extreme" end: the 444 Hz note falls below -50 dB at 97.16 and reaches the
    # stem's floor (-55 dB) at 97.24; its pitch is last tracked at 97.32.  After
    # that the stem is at the floor until the chop phrase from 97.58 (the one that
    # recurs in postchorus 2 around the "Woo"); the automatic end (101.44) held
    # "extreme" over that phrase and the silence up to the next "So".
    (25, 1): dict(start=96.78, end=97.32, conf=0.45),
    # L36 postchorus-2 "extreme" (placed by ANCHORS): its faint note run ends with
    # the 573-586 Hz note at 151.08 (unvoiced from 151.10; postchorus 1's
    # "extreme" end, 97.32, maps to 151.05 on the bar grid).  The stem stays at
    # its floor (-55 dB), so the automatic end ran on to the next "So" (155.62).
    # Same faint processed vocal as L25 and one weak bar-grid argument: low conf.
    (36, 1): dict(start=151.60, end=152.25, conf=0.5),
    # ...overridden by the user's ear (2026-10-03: "lights up far too soon compared to when they say it"): the audible
    # "So extreme" is the loud vocal burst at 151.25-151.55 (RMS -55 -> -20 dB; read above as the "Woo") and its tail
    # at 152.10-152.20, not the faint run at 150.26-151.08. "So" 151.25-151.58, "extreme" 151.60-152.25.
    (36, 0): dict(start=151.25, end=151.58, conf=0.5),
    # L27 bridge "He": the rest-onset rule fired on a broadband swell at 112.16;
    # the harmonic lead enters at 113.02 (fused and lv60k 113.02, mms 113.10) and
    # the bridge lines repeat every ~3.6 s (next "He" 116.64).
    (27, 0): dict(start=113.02, conf=0.8),
    # L31 bridge "Yeah": the lead's falling 263 -> 233 Hz note stops at 126.97
    # (RMS -30 dB); from 127.09 the "B-better" ad-libs enter in another register
    # (526-720 Hz; Whisper hears "Better" at 127.84).  Start stays on the CTC path
    # (fused / lv60k 126.82), though the pitch step at 126.67 and Whisper (126.57)
    # suggest it may be earlier.
    (31, 0): dict(end=126.97, conf=0.55),
}

# ---------------------------------------------------------------------------


def load_feats():
    f = dict(np.load(common.WORK / "vocal_feats.npz"))
    f["hop"] = float(f.pop("hop_s"))
    return f


def activity(f, rel_db=22.0, abs_db=-48.0, win_s=1.5):
    """Vocal activity mask: RMS above an absolute floor and within rel_db of the
    local (±win) maximum."""
    from scipy.ndimage import maximum_filter1d, median_filter
    r = median_filter(f["rms_db"], 5)
    loc = maximum_filter1d(r, int(win_s / f["hop"]))
    return (r > abs_db) & (r > loc - rel_db), r


def runs(mask):
    """Return list of (start_idx, end_idx_exclusive) runs where mask is True."""
    m = np.concatenate([[False], mask, [False]]).astype(np.int8)
    d = np.diff(m)
    return list(zip(np.where(d == 1)[0], np.where(d == -1)[0]))


FRIC_START = re.compile(r"(s|sh|ch|z|f|th|j|c[eiy]|x|h)")
VOICED_TH = {"the", "there", "there's", "that", "that's", "they", "this", "then"}
FRIC_END = re.compile(r"(s|z|f|x|ce|se|ze|sh|ch)$")


def refine(words, f, fix=None):
    """Signal-based refinement of CTC boundaries, per sub-word unit (a word, or
    one spelled letter / syllable of an acronym like "ay gee eye").

    1. rest-onset : a rest (>=50 ms silence) precedes the unit and the voice
                    re-enters >40 ms before the first CTC char -> start there
                    (CTC fires late on held vowels, e.g. the opening "I").
    2. onset-snap : otherwise snap to the strongest vocal onset (spectral flux)
                    in a window just before the CTC start (legato word starts
                    with glottal/vowel onsets that CTC places late).
    3. fricative  : for s/sh/ch/z/f/th/j/h-initial units, CTC emits the consonant
                    at the END of the frication; move start back to where the
                    4-10 kHz noise begins.
    end: next unit's start when the voice continues (legato), else the moment
         the voice stops (RMS >15 dB below the word's level for >=60 ms).
    """
    from scipy.ndimage import uniform_filter1d
    from scipy.signal import find_peaks
    hop = f["hop"]
    act, r = activity(f, rel_db=27.0)
    n = len(r)
    sil = ~act
    sib = uniform_filter1d(f["sib_ratio"], 3)
    on = f["onset"]
    on_thr = 0.3 * np.percentile(on, 99)
    pk_idx, _ = find_peaks(on, height=on_thr, distance=int(0.04 / hop))
    units = []
    for k, w in enumerate(words):
        w["ctc_start"], w["ctc_end"] = w["start"], w["end"]
        w["ctc_subs"] = [tuple(x) for x in w["subs"]]
        for j, (a, b) in enumerate(w["subs"]):
            units.append(dict(k=k, j=j, text=pron(w["w"])[j], cs=a, ce=b, s=a, rule="ctc"))
    fix = fix or {}
    for u_i, u in enumerate(units):
        w = words[u["k"]]
        fx = fix.get((w["li"], w["ti"]))
        if fx is not None:
            starts = [fx.get("start")] + list(fx.get("syl", []))
            if u["j"] < len(starts) and starts[u["j"]] is not None:
                u["s"], u["rule"] = starts[u["j"]], "manual"
                continue
        pu = units[u_i - 1] if u_i else None
        prev_ce = pu["ce"] if pu else 0.0
        prev_cs = pu["cs"] if pu else 0.0
        s = u["cs"]
        # 1. rest-onset
        i0, i1 = int(prev_ce / hop), int(s / hop)
        done = False
        if i1 - i0 > int(0.05 / hop):
            rs = [(a, b) for a, b in runs(sil[i0:i1]) if (b - a) * hop >= 0.05]
            if rs:
                onset = (i0 + rs[-1][1]) * hop
                if s - onset > 0.04:
                    u["s"], u["rule"] = onset, "rest-onset"
                done = True
        # 2. onset snap
        if not done:
            vowel_init = u["text"][0] in "aeiou"
            lo = max(prev_ce - 0.06, prev_cs + 0.08, s - (0.25 if vowel_init else 0.12))
            hi = s + 0.04
            # ignore onsets that are followed by frication (they are the final
            # consonant cluster of the previous word, e.g. the "ks" of "sparks")
            cand = [p for p in pk_idx if lo <= p * hop <= hi
                    and np.median(sib[p:p + int(0.06 / hop)]) < -5]
            best, bsc = None, 0.0
            for p in cand:
                dt = s - p * hop
                wgt = 1.0 if dt < 0.06 else max(0.4, 1 - (dt - 0.06) / 0.4)
                if on[p] * wgt > bsc:
                    best, bsc = p, on[p] * wgt
            if best is not None:
                t = best * hop - 0.01
                if abs(t - s) > 0.02:
                    u["s"], u["rule"] = t, "onset-snap"
        # 3. fricative
        if FRIC_START.match(u["text"]) and u["text"] not in VOICED_TH:
            prev_fric_end = pu is not None and FRIC_END.search(pu["text"]) is not None
            lo_t = prev_ce + 0.02 if prev_fric_end else prev_ce - 0.10
            if pu is not None:
                lo_t = max(lo_t, pu["s"] + 0.10)
            lo = int(max(lo_t, s - 0.30, 0) / hop)
            a, b = max(int((s - 0.15) / hop), lo), int((s + 0.06) / hop)
            if b > a:
                pk = a + int(np.argmax(sib[a:b]))
                base = np.percentile(sib[max(0, lo - int(0.4 / hop)):lo + 1], 25) if lo > 0 else -40
                if sib[pk] >= base + 8:
                    thr = 0.5 * (base + sib[pk])
                    j = pk
                    while j - 1 >= lo and sib[j - 1] > thr:
                        j -= 1
                    if j * hop < u["s"] - 0.02:
                        u["s"], u["rule"] = j * hop, "fricative"
    # monotonic unit starts
    for u_i in range(1, len(units)):
        units[u_i]["s"] = max(units[u_i]["s"], units[u_i - 1]["s"] + 0.03)
    for k, w in enumerate(words):
        us = [u for u in units if u["k"] == k]
        w["start"] = us[0]["s"]
        w["start_rule"] = us[0]["rule"]
        w["unit_starts"] = [u["s"] for u in us]
    for k, w in enumerate(words):
        nxt = words[k + 1]["start"] if k + 1 < len(words) else len(r) * hop
        e = max(w["ctc_end"], w["start"] + 0.08)
        j0 = int(w["start"] / hop)
        j1 = int(e / hop)
        level = np.percentile(r[j0:max(j1, j0 + 1)], 90)
        jn = int(nxt / hop)
        low = r < level - 15.0
        q = None
        j = j1
        need = int(0.06 / hop)
        while j < min(jn, n - need):
            if low[j] and low[j:j + need].all():
                q = j * hop
                break
            j += 1
        end = min(q, nxt) if q is not None else nxt
        end = max(end, w["start"] + 0.04)
        if nxt - end < 0.03:
            end = nxt
        fx = fix.get((w["li"], w["ti"]))
        if fx is not None:
            w["manual"] = True
            if "end" in fx:
                end = fx["end"]
        w["end"] = end
        us = w["unit_starts"]
        w["subs"] = [(us[i], us[i + 1] if i + 1 < len(us) else end) for i in range(len(us))]
    return words


# (t0, t1, description) -- known non-lyric vocal regions, identified from the QA plots.
EXTRA_DESC = []


def detect_extras(words, f):
    """Vocal activity (vocal stem) not covered by any lyric word."""
    hop = f["hop"]
    r = median_filter_1d(f["rms_db"], 9)
    act = r > -36
    cover = np.zeros_like(act)
    for w in words:
        cover[int((w["start"] - 0.1) / hop):int((w["end"] + 0.1) / hop)] = True
    m = act & ~cover
    out = []
    for a, b in runs(m):
        if out and a * hop - out[-1][1] < 0.4:
            out[-1][1] = b * hop
        else:
            out.append([a * hop, b * hop])
    out = [x for x in out if x[1] - x[0] >= 0.5]
    ext = []
    for a, b in out:
        desc = next((d for (t0, t1, d) in EXTRA_DESC if a < t1 and b > t0), None)
        ext.append(dict(start=round(a, 2), end=round(b, 2),
                        desc=desc or "unlisted vocal (backing vocal / ad-lib / breath)"))
    # also list known extras that overlap lyric words (e.g. backing pads)
    for (t0, t1, d) in EXTRA_DESC:
        if not any(e["desc"] == d for e in ext):
            ext.append(dict(start=t0, end=t1, desc=d))
    ext.sort(key=lambda e: e["start"])
    return ext


def median_filter_1d(x, n):
    from scipy.ndimage import median_filter
    return median_filter(x, n)


def whisper_words():
    W = json.loads((common.WORK / "whisper_large_prompt.json").read_text())
    return [(w["word"].strip(), w["start"], w["end"]) for s in W["segments"] for w in s.get("words", [])]


def norm(t):
    return re.sub(r"[^a-z]", "", t.lower())


def map_whisper(words, ww):
    """Fuzzy sequence alignment of whisper words to lyric tokens."""
    a = [norm("".join(pron(w["w"]))) for w in words]
    b = [norm(x[0]) for x in ww]
    sm = SequenceMatcher(a=a, b=b, autojunk=False)
    m = {}
    for blk in sm.get_opcodes():
        tag, i1, i2, j1, j2 = blk
        if tag == "equal":
            for d in range(i2 - i1):
                m[i1 + d] = ww[j1 + d]
        elif tag == "replace" and (i2 - i1) == (j2 - j1):
            for d in range(i2 - i1):
                m[i1 + d] = ww[j1 + d]
    # replace blocks of unequal length: map by time proximity later (skip)
    for i, w in enumerate(words):
        x = m.get(i)
        # reject mapping if wildly off in time (fuzzy false matches)
        if x is not None and abs(x[1] - w["start"]) > 1.5:
            x = None
        w["whisper"] = None if x is None else (round(x[1], 3), round(x[2], 3))
    return words


def confidence(words, alt):
    for i, w in enumerate(words):
        ds = [abs(a[i]["start"] - w["ctc_start"]) for a in alt.values()]
        agree = np.mean([d <= 0.06 for d in ds])
        p = min(1.0, w["conf"] / 0.5)
        wh = w.get("whisper")
        wagree = 0.5 if wh is None else float(abs(wh[0] - w["start"]) <= 0.15)
        c = 0.35 + 0.3 * agree + 0.2 * p + 0.15 * wagree
        if w.get("manual"):
            fx = FIX.get((w["li"], w["ti"]), {})
            c = fx.get("conf", max(c, 0.8))
        if w.get("pushed"):
            c = min(c, 0.3)
        w["conf_final"] = round(float(np.clip(c, 0, 1)), 2)
    return words


def main(plots=False):
    lines_src, adlibs = common.load_lyrics()
    toks = [l["text"].split(" ") for l in lines_src]
    E = emissions(PRIMARY)
    sp, score, _, _ = align(E, toks, anchors=ANCHORS, line_windows=LINE_WINDOWS)
    words = word_table(sp, toks)
    alt = {}
    for k in ALTS:
        s2, _, _, _ = align(emissions(k), toks, anchors=ANCHORS, line_windows=LINE_WINDOWS)
        alt[k] = word_table(s2, toks)
    f = load_feats()
    words = refine(words, f, FIX)
    # enforce monotonic / non-overlap; a manual FIX end pushes the next word later.
    # Words pushed that way (and any they push in turn) no longer sit where the
    # acoustic evidence put them: flagged "pushed", confidence() caps them.
    for k in range(1, len(words)):
        p, w = words[k - 1], words[k]
        floor = p["start"] + 0.02
        by_fix = "end" in FIX.get((p["li"], p["ti"]), {})
        if by_fix:
            floor = max(floor, p["end"])
        if w["start"] < floor:
            if by_fix or p.get("pushed"):
                assert "start" not in FIX.get((w["li"], w["ti"]), {}), (w["li"], w["ti"])
                w["pushed"] = True
            w["start"] = floor
            w["end"] = max(w["end"], w["start"] + 0.04)
        if p["end"] > w["start"]:
            p["end"] = w["start"]
    for w in words:  # keep sub-word spans inside the (possibly moved) word bounds
        s = w["subs"]
        cl = lambda t: min(max(t, w["start"]), w["end"])
        w["subs"] = [(w["start"] if i == 0 else cl(a), w["end"] if i == len(s) - 1 else cl(b))
                     for i, (a, b) in enumerate(s)]
    words = map_whisper(words, whisper_words())
    words = confidence(words, alt)
    (common.WORK / "align_debug.json").write_text(json.dumps(dict(words=words, alt=alt), indent=1, default=float))

    lines = []
    for li, src in enumerate(lines_src):
        ws = [w for w in words if w["li"] == li]
        assert [w["w"] for w in ws] == src["text"].split(" ")
        out = []
        for w in ws:
            d = dict(w=w["w"], start=round(w["start"], 3), end=round(w["end"], 3), conf=w["conf_final"])
            if len(w["subs"]) > 1:
                d["syl"] = [[round(a, 3), round(b, 3)] for a, b in w["subs"]]
            out.append(d)
        lines.append(dict(i=li, text=src["text"], section=src["section"],
                          start=out[0]["start"], end=out[-1]["end"], words=out))
    doc = dict(lines=lines, adlibs=adlibs, extras=detect_extras(words, f), notes=NOTES)
    (common.DATA / "lyrics.json").write_text(json.dumps(doc, indent=2, ensure_ascii=False), encoding="utf-8")
    print("wrote", common.DATA / "lyrics.json", "score", score)
    low = [(l["i"], w["w"], float(w["start"]), float(w["conf"])) for l in lines for w in l["words"] if w["conf"] < 0.5]
    print(f"{len(low)} low-confidence words (conf < 0.5):", low)
    if plots:
        make_plots(words, alt, lines_src)
    return words, alt


def make_plots(words, alt, L):
    from qa_plot import plot
    ww = whisper_words()
    for li, src in enumerate(L):
        ws = [w for w in words if w["li"] == li]
        t0 = min(ws[0]["start"], ws[0]["ctc_start"]) - 0.8
        t1 = max(ws[-1]["end"], ws[-1]["ctc_end"]) + 0.6
        t1 = min(t1, t0 + 7)
        tracks = [
            ("final", [(w["w"], w["start"], w["end"]) for w in words]),
            ("fused-ctc", [(w["w"], w["ctc_start"], w["ctc_end"]) for w in words]),
            ("subwords", [(" ".join(pron(w["w"])).split()[i] if len(w["subs"]) > 1 else "", a, b)
                          for w in words for i, (a, b) in enumerate(w["subs"])]),
            ("mms", [(w["w"], w["start"], w["end"]) for w in alt["mms"]]),
            ("lv60k", [(w["w"], w["start"], w["end"]) for w in alt["lv60k"]]),
            ("whisper", ww),
        ]
        plot(t0, t1, tracks, common.QA / f"line_{li:02d}.png", title=f"L{li} [{src['section']}]: {src['text']}")


NOTES = (
    "Timeline = audio/song.wav (ffmpeg decode of the mp3); stems separated from the same file, "
    "zero offset. Method: CTC emissions (20 ms) of the Demucs vocal stem from torchaudio MMS_FA "
    "and wav2vec2-large-lv60k-960h on the mono sum and L/R channels, fused as a probability "
    "mixture; one global constrained Viterbi alignment of all lead lines with a garbage token "
    "between lines to absorb ad-libs (parenthesised lyrics, listed under 'adlibs'); signal "
    "refinement of word starts/ends on the vocal stem; cross-check against faster-whisper "
    "large-v3 word timestamps. conf: 0.35 + agreement of independent alignments + CTC posterior "
    "+ Whisper agreement. 'syl' = per-part timings of hyphenated tokens (b-better)."
)

if __name__ == "__main__":
    main(plots="--plots" in sys.argv)
