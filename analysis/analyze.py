"""Music analysis -> data/audio.json

  * constant-tempo beat grid (tempo + phase fitted to drum / mix onsets, phase
    refined on kick attacks), downbeats (bar phase from snare-on-2&4 and the
    chord changes), sections from the lyric section tags (data/lyrics.json),
    snapped to downbeats,
  * 100 fps normalized envelopes (mix rms / low / mid / high, stem rms),
  * kick / snare / hat onsets from the drums stem, vocal note onsets.

All times are on the audio/song.wav timeline (stems share it, zero offset).

Run:  uv run python analyze.py [--plots]
"""
import common
import json
import math
import sys

import numpy as np
import librosa
from scipy.ndimage import maximum_filter1d, median_filter, uniform_filter1d
from scipy.signal import butter, find_peaks, sosfiltfilt

SR = 44100
FPS = 100

BPM_RANGE = (100.0, 150.0)  # tempo search window: spans less than a 2:1 tempo octave, contains ~134
BAR_PHASE = None            # 0..3 to override the detected bar phase after checking qa/audio_*.png
# name -> start seconds, overrides the lyric-derived start (e.g. an instrumental drop before
# the first lead word); set after checking qa/audio_*.png
SECTION_START = {}


# ---------------------------------------------------------------------------
def band_sos(lo, hi, sr):
    if lo and hi:
        return butter(4, [lo, hi], btype="band", fs=sr, output="sos")
    if hi:
        return butter(4, hi, btype="low", fs=sr, output="sos")
    return butter(4, lo, btype="high", fs=sr, output="sos")


def frame_rms(x, sr, fps=FPS, win=2048):
    hop = sr / fps
    n = int(math.ceil(len(x) / sr * fps))
    pad = np.pad(x, (win // 2, win // 2 + int(hop) + 2))
    idx = (np.arange(n) * hop).astype(int)
    c = np.concatenate([[0.0], np.cumsum(pad.astype(np.float64) ** 2)])
    e = (c[idx + win] - c[idx]) / win
    return np.sqrt(np.maximum(e, 0))


def smooth_env(x, fps=FPS, attack=0.010, release=0.090):
    """One-pole follower: fast attack, slower release (visual friendly)."""
    aa = math.exp(-1 / (attack * fps))
    ar = math.exp(-1 / (release * fps))
    y = np.empty_like(x)
    s = 0.0
    for i, v in enumerate(x):
        a = aa if v > s else ar
        s = a * s + (1 - a) * v
        y[i] = s
    return y


def norm01(x, pct=99.0):
    ref = np.percentile(x, pct)
    return np.clip(x / (ref + 1e-12), 0, 1)


# ---------------------------------------------------------------------------
def fit_grid(drums, mix, sr, duration):
    """Constant-tempo grid: coarse tempo/phase search on spectral-flux onset
    envelopes, then phase refinement on kick attack times."""
    hop = 64
    od = librosa.onset.onset_strength(y=librosa.resample(drums, orig_sr=sr, target_sr=22050),
                                      sr=22050, hop_length=hop // 2, lag=1, max_size=1)
    om = librosa.onset.onset_strength(y=librosa.resample(mix, orig_sr=sr, target_sr=22050),
                                      sr=22050, hop_length=hop // 2, lag=1, max_size=1)
    o = od / (np.percentile(od, 99) + 1e-9) + om / (np.percentile(om, 99) + 1e-9)
    ofps = 22050 / (hop // 2)

    def score(P, off):
        ts = off + P * np.arange(int(duration / P) + 1)
        idx = np.round(ts * ofps).astype(int)
        idx = idx[(idx > 2) & (idx < len(o) - 2)]
        return np.maximum.reduce([o[idx - 1], o[idx], o[idx + 1]]).mean()

    best = (0, None, None)
    for bpm in np.arange(BPM_RANGE[0], BPM_RANGE[1], 0.02):
        P = 60 / bpm
        for off in np.arange(0, P, 0.004):
            s = score(P, off)
            if s > best[0]:
                best = (s, bpm, off)
    _, bpm, off = best
    for b2 in np.arange(bpm - 0.02, bpm + 0.02, 0.001):  # fine
        P = 60 / b2
        for o2 in np.arange(off - 0.01, off + 0.01, 0.001):
            s = score(P, o2)
            if s > best[0]:
                best = (s, b2, o2)
    _, bpm, off = best
    P = 60 / bpm
    # refine phase on kick attacks (steepest rise of low-band log energy)
    kick_t, _ = band_onsets(drums, sr, None, 120, win=0.012, min_gap=0.2, rel_db=12)
    n = np.round((kick_t - off) / P)
    res = kick_t - (off + n * P)
    res = res[np.abs(res) < 0.06]
    off = off + float(np.median(res))
    # first beat >= 0
    off = off - P * math.floor(off / P)
    return bpm, P, off, res


def band_onsets(x, sr, lo, hi, win=0.010, hop_s=0.002, min_gap=0.08, rel_db=10.0):
    """Onsets in a frequency band: steepest rise of the band's log-energy
    envelope (rise > rel_db over ~20 ms).  Returns (times, peak band level in dB)."""
    xb = sosfiltfilt(band_sos(lo, hi, sr), x)
    h = int(hop_s * sr)
    w = int(win * sr)
    e = np.convolve(xb.astype(np.float64) ** 2, np.ones(w) / w, mode="same")[::h]
    db = 10 * np.log10(e + 1e-10)
    fps = sr / h  # exact frame rate (h is an integer number of samples)
    d = np.diff(db, prepend=db[0])
    d = uniform_filter1d(d, 3)
    # rise over ~20 ms
    lag = int(0.02 * fps)
    rise = db - np.concatenate([np.full(lag, db[0]), db[:-lag]])
    floor = median_filter(db, int(1.0 * fps) | 1)
    pk, _ = find_peaks(rise, height=rel_db, distance=int(min_gap * fps))
    times, strength = [], []
    for p in pk:
        a = max(0, p - lag)
        # attack time: steepest slope within the rise window
        q = a + int(np.argmax(d[a:p + 1]))
        peak_db = db[p:p + int(0.03 * fps)].max()
        if peak_db < floor[p] + 3:
            continue
        times.append(q / fps)
        strength.append(peak_db)
    return np.array(times), np.array(strength)


def drum_onsets(d, sr):
    """Kick / snare / hat onsets from the drums stem."""
    # KICK: <120 Hz
    kt, kdb = band_onsets(d, sr, None, 120, win=0.012, min_gap=0.15, rel_db=12)
    # SNARE (and the clap-like snare of the quiet chorus): candidates are
    # 1.5-5 kHz attacks; a snare has a long noisy 0.5-5 kHz tail 40-120 ms after
    # the attack.  Keep candidates whose tail is within 8 dB of the loudest tail
    # in +-2.5 s and within 25 dB of the song-wide level (rejects stem bleed).
    # Kick-only beats / hats have tails 12-30 dB lower.
    st, _ = band_onsets(d, sr, 1500, 5000, win=0.010, min_gap=0.15, rel_db=10)
    xb = sosfiltfilt(band_sos(500, 5000, sr), d)
    e = np.sqrt(np.convolve(xb.astype(np.float64) ** 2, np.ones(441) / 441, mode="same"))
    tail = np.array([20 * np.log10(e[int((t + 0.04) * sr):int((t + 0.12) * sr)].mean() + 1e-9) for t in st])
    rel = np.array([tail[i] - tail[np.abs(st - st[i]) < 2.5].max() for i in range(len(st))])
    thr = np.percentile(tail, 95) - 25
    keep = (rel > -8) & (tail > thr)
    st, stail = st[keep], tail[keep]
    # HAT: >7 kHz, short; drop those coinciding with snares (snare noise also
    # reaches 7k+)
    ht, hdb = band_onsets(d, sr, 7000, None, win=0.006, min_gap=0.06, rel_db=9)
    # (and those within 30 ms of a kick: the kick's beater click reaches 10 kHz)
    for other, gap in ((st, 0.04), (kt, 0.03)):
        if len(other) and len(ht):
            dist = np.min(np.abs(ht[:, None] - other[None, :]), axis=1)
            keep = dist > gap
            ht, hdb = ht[keep], hdb[keep]
    return (kt, kdb), (st, stail), (ht, hdb)


def strength01(db_vals, lo_pct=5, hi_pct=95):
    if len(db_vals) == 0:
        return db_vals
    lo, hi = np.percentile(db_vals, lo_pct), np.percentile(db_vals, hi_pct)
    return np.clip((db_vals - lo) / (hi - lo + 1e-9) * 0.8 + 0.2, 0, 1)


def choose_bar_phase(nov, sn):
    """Beat index mod 4 that is beat 1 of the bar.

    nov[i]: harmonic novelty entering beat i (chord changes land on downbeats).
    sn[i]:  snare hits at beat i (backbeat on 2 and 4 -> downbeats have the other parity).
    Snares fix the phase up to half a bar when there are enough of them; harmony picks
    between the remaining candidates (or all four when there are no drums).
    Returns (phase, novelty score per candidate, snare count per parity).
    """
    idx = np.arange(len(nov))
    s = [float(sn[idx % 2 == q].sum()) for q in (0, 1)]
    cands = [0, 1, 2, 3]
    if max(s) > 8 and max(s) > 2 * min(s):
        q = int(np.argmin(s))
        cands = [q, q + 2]
    scores = {p: float(np.mean(nov[p::4])) for p in cands}
    return max(scores, key=scores.get), scores, s


def beat_novelty(harm, sr, beats):
    """1 - cosine similarity of mean chroma between consecutive beat intervals."""
    chroma = librosa.feature.chroma_cqt(y=harm, sr=sr, hop_length=512)
    ct = librosa.times_like(chroma, sr=sr, hop_length=512)
    edges = np.searchsorted(ct, np.append(beats, beats[-1] + (beats[-1] - beats[-2])))
    edges = np.minimum(edges, chroma.shape[1] - 1)  # a beat past the last frame reuses it: no empty slice
    c = np.stack([chroma[:, a:max(b, a + 1)].mean(1) for a, b in zip(edges[:-1], edges[1:])])
    c /= np.linalg.norm(c, axis=1, keepdims=True) + 1e-9
    nov = np.zeros(len(beats))
    nov[1:] = 1 - (c[1:] * c[:-1]).sum(1)
    return nov


def snares_per_beat(snare_t, beats, tol=0.07):
    sn = np.zeros(len(beats))
    for t in snare_t:
        k = int(np.argmin(np.abs(beats - t)))
        if abs(beats[k] - t) <= tol:
            sn[k] += 1
    return sn


def sections_from_lyrics(lines, downbeats, period, duration):
    """A new section at each change of the contiguous lead-line tag. It starts on the downbeat
    of the bar holding its first lead word, except when that word is a pickup less than two
    beats before the next downbeat: then it starts on that next downbeat. The first section
    starts at 0; each ends where the next starts; the last ends at `duration`."""
    firsts = []
    for l in lines:
        if not firsts or firsts[-1][0] != l["section"]:
            firsts.append((l["section"], l["words"][0]["start"]))
    db = np.asarray(downbeats, dtype=float)
    out = []
    for k, (name, t) in enumerate(firsts):
        if k == 0:
            s = 0.0
        else:
            i = int(np.searchsorted(db, t + 1e-6)) - 1
            nxt = db[i + 1] if i + 1 < len(db) else None
            s = float(nxt) if nxt is not None and nxt - t < 2 * period else float(db[max(i, 0)])
        assert not out or s > out[-1]["start"], f"section {name} does not start after {out[-1]['name']}"
        out.append(dict(name=name, start=round(s, 3)))
    for k, sec in enumerate(out):
        sec["end"] = out[k + 1]["start"] if k + 1 < len(out) else round(duration, 3)
    return out


def vocal_onsets(v, sr):
    """Vocal note onsets: log-mel spectral flux peaks (5 ms hop) plus pitch
    jumps > 0.8 semitone while voiced, restricted to active vocal frames."""
    f = dict(np.load(common.WORK / "vocal_feats.npz"))
    hop = float(f["hop_s"])
    on = f["onset"]
    rms = f["rms_db"]
    loc = maximum_filter1d(rms, int(2.0 / hop))
    active = (rms > -45) & (rms > loc - 25)
    thr = uniform_filter1d(on, int(0.4 / hop)) * 1.5 + 0.15 * np.percentile(on, 99)
    pk, _ = find_peaks(on, height=0, distance=int(0.09 / hop))
    pk = [p for p in pk if on[p] > thr[p] and active[min(len(active) - 1, p + int(0.03 / hop))]]
    t_flux = np.array(pk) * hop
    s_flux = np.array([on[p] for p in pk])
    # pitch jumps (legato note changes that have little spectral flux)
    f0 = f["f0"]
    midi = librosa.hz_to_midi(np.where(f["voiced"] > 0, f0, np.nan))
    med = median_filter(np.nan_to_num(midi, nan=0), 9)
    jumps = []
    w = int(0.04 / hop)
    for i in range(w, len(med) - w):
        a, b = med[i - w], med[i + w]
        if a > 0 and b > 0 and abs(b - a) > 0.8 and active[i]:
            jumps.append(i)
    # collapse runs
    t_pitch, last = [], -1e9
    for i in jumps:
        if i - last > int(0.1 / hop):
            t_pitch.append(i * hop)
        last = i
    t_pitch = np.array(t_pitch)
    ts = list(zip(t_flux, s_flux / (np.percentile(s_flux, 95) + 1e-9)))
    for t in t_pitch:
        if len(t_flux) == 0 or np.min(np.abs(t_flux - t)) > 0.08:
            ts.append((t, 0.35))
    ts.sort()
    return [(float(t), float(min(1.0, max(0.1, s)))) for t, s in ts]


# ---------------------------------------------------------------------------
def main(plots=False):
    mix, _ = common.load_mix(SR)
    duration = len(mix) / SR
    stems = {n: common.load_stem(n, sr=SR)[0][: len(mix)] for n in ("vocals", "drums", "bass", "other")}
    for n in stems:
        if len(stems[n]) < len(mix):
            stems[n] = np.pad(stems[n], (0, len(mix) - len(stems[n])))

    bpm, P, off, kick_res = fit_grid(stems["drums"], mix, SR, duration)
    print(f"tempo {bpm:.3f} BPM  period {P:.5f}s  first beat {off:.4f}s  kick residual sd {kick_res.std()*1000:.1f} ms")
    beats = off + P * np.arange(int((duration - off) / P) + 1)
    (kt, kdb), (st, stail), (ht, hdb) = drum_onsets(stems["drums"], SR)
    nov = beat_novelty(stems["bass"] + stems["other"], SR, beats)
    phase, ph_scores, sn_par = choose_bar_phase(nov, snares_per_beat(st, beats))
    if BAR_PHASE is not None:
        phase = BAR_PHASE
    print(f"bar phase {phase}  novelty by candidate {ph_scores}  snares by parity {sn_par}")
    downbeats = beats[(np.arange(len(beats)) - phase) % 4 == 0]

    # envelopes -------------------------------------------------------------
    n = int(math.ceil(duration * FPS))
    env = {}
    env["rms"] = frame_rms(mix, SR)[:n]
    for name, (lo, hi) in {"low": (None, 150), "mid": (150, 2000), "high": (4000, None)}.items():
        env[name] = frame_rms(sosfiltfilt(band_sos(lo, hi, SR), mix), SR)[:n]
    for s in ("vocal", "drums", "bass", "other"):
        env[s] = frame_rms(stems["vocals" if s == "vocal" else s], SR)[:n]
    for k in env:
        e = smooth_env(env[k])
        env[k] = [round(float(x), 3) for x in norm01(e)]
        assert len(env[k]) == n

    # onsets -------------------------------------------------------------------
    onsets = {
        "kick": [[round(float(t), 3), round(float(s), 3)] for t, s in zip(kt, strength01(kdb))],
        "snare": [[round(float(t), 3), round(float(s), 3)] for t, s in zip(st, strength01(stail))],
        "hat": [[round(float(t), 3), round(float(s), 3)] for t, s in zip(ht, strength01(hdb))],
        "vocal": [[round(t, 3), round(s, 3)] for t, s in vocal_onsets(stems["vocals"], SR)],
    }
    # snare / kick position statistics -> bar phase evidence
    def pos_hist(ts):
        ph = np.round((np.asarray(ts) - downbeats[0]) / (P / 2)).astype(int) % 8
        return np.bincount(ph, minlength=8).tolist()
    print("kick   8th-positions in bar:", pos_hist(kt))
    print("snare  8th-positions in bar:", pos_hist(st))
    print("hat    8th-positions in bar:", pos_hist(ht))

    # sections -------------------------------------------------------------------
    lyr = json.loads((common.DATA / "lyrics.json").read_text(encoding="utf-8"))
    sections = sections_from_lyrics(lyr["lines"], downbeats, P, duration)
    names = [s["name"] for s in sections]
    for name, t in SECTION_START.items():
        k = names.index(name)
        sections[k]["start"] = round(float(t), 3)
        if k:
            sections[k - 1]["end"] = sections[k]["start"]
    assert all(a["start"] < b["start"] for a, b in zip(sections, sections[1:])), "SECTION_START breaks order"

    doc = dict(
        duration=round(duration, 3),
        bpm=round(bpm, 3),
        beat_period=round(P, 5),
        time_signature=4,
        beats=[round(float(t), 3) for t in beats],
        downbeats=[round(float(t), 3) for t in downbeats],
        sections=sections,
        fps=FPS,
        **env,
        onsets=onsets,
        notes=NOTES.format(bpm=bpm, P=P, off=off, first_db=float(downbeats[0]), phase=phase,
                           sn=len(st), kk=len(kt), hh=len(ht)),
    )
    (common.DATA / "audio.json").write_text(json.dumps(doc, separators=(",", ":")))
    print("wrote", common.DATA / "audio.json", f"{len(beats)} beats, {len(downbeats)} downbeats, "
          f"{len(kt)} kicks, {len(st)} snares, {len(ht)} hats, {len(onsets['vocal'])} vocal onsets")
    if plots:
        make_plots(doc, stems)
    return doc


NOTES = (
    "Timeline = audio/song.wav; stems share it (zero offset). Tempo constant {bpm:.3f} BPM "
    "(period {P:.5f} s) fitted over the whole song on drum+mix onset envelopes, phase refined on "
    "kick attacks; first beat {off:.3f} s. Bar phase {phase} (beat index mod 4 of beat 1): snares "
    "on 2 & 4 fix it to half a bar, chord-change novelty (bass+other chroma) picks the rest; first "
    "downbeat {first_db:.3f} s. Sections from the lyric section tags, starting on the downbeat of "
    "the bar holding their first lead word (pickups < 2 beats stay in the previous section). "
    "Envelopes: 100 fps, 46 ms RMS window, 10 ms attack / 90 ms release, each / its 99th "
    "percentile, clipped 0..1. Onsets [time, strength]: kick ({kk}), snare ({sn}), hat ({hh}) from "
    "the drums stem; vocal = note onsets from the vocal stem."
)


def make_plots(doc, stems):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    wins = [(float(a), float(min(a + 12, doc["duration"]))) for a in np.arange(0, doc["duration"], 20)]
    t = np.arange(len(doc["rms"])) / FPS
    for (t0, t1) in wins:
        fig, ax = plt.subplots(3, 1, figsize=(22, 11), sharex=True,
                               gridspec_kw=dict(height_ratios=[2, 1.6, 1.4]))
        d = stems["drums"][int(t0 * SR):int(t1 * SR)]
        S = librosa.amplitude_to_db(np.abs(librosa.stft(d, n_fft=1024, hop_length=128)), ref=np.max)
        ax[0].imshow(S, origin="lower", aspect="auto", cmap="magma", vmin=-60, vmax=0,
                     extent=[t0, t0 + S.shape[1] * 128 / SR, 0, SR / 2])
        ax[0].set_ylim(0, 12000)
        ax[0].set_ylabel("drums stem")
        m = (t >= t0) & (t <= t1)
        for k, c in [("rms", "k"), ("low", "tab:red"), ("mid", "tab:green"), ("high", "tab:blue")]:
            ax[1].plot(t[m], np.array(doc[k])[m], color=c, lw=1, label=k)
        ax[1].legend(loc="upper left", fontsize=8)
        for k, c in [("vocal", "tab:purple"), ("drums", "tab:orange"), ("bass", "tab:brown"), ("other", "tab:olive")]:
            ax[2].plot(t[m], np.array(doc[k])[m], color=c, lw=1, label=k)
        ax[2].legend(loc="upper left", fontsize=8)
        for b in doc["beats"]:
            if t0 <= b <= t1:
                for a_ in ax:
                    a_.axvline(b, color="gray", lw=0.6, alpha=0.6)
        for b in doc["downbeats"]:
            if t0 <= b <= t1:
                for a_ in ax:
                    a_.axvline(b, color="c" if a_ is ax[0] else "k", lw=1.8)
        for name, y, c in [("kick", 1500, "tab:red"), ("snare", 5000, "w"), ("hat", 9500, "yellow")]:
            for (ot, s) in doc["onsets"][name]:
                if t0 <= ot <= t1:
                    ax[0].plot([ot], [y], marker="v", color=c, ms=4 + 8 * s)
        for (ot, s) in doc["onsets"]["vocal"]:
            if t0 <= ot <= t1:
                ax[2].plot([ot], [1.02], marker="v", color="tab:purple", ms=3 + 6 * s)
        for s in doc["sections"]:
            if t0 <= s["start"] <= t1:
                ax[1].text(s["start"], 1.02, s["name"], fontsize=14, color="tab:red")
                for a_ in ax:
                    a_.axvline(s["start"], color="tab:red", lw=2.5)
        ax[2].set_xlim(t0, t1)
        ax[2].set_xticks(np.arange(np.ceil(t0), t1, 0.5))
        fig.tight_layout()
        fig.savefig(common.QA / f"audio_{int(t0):03d}.png", dpi=65)
        plt.close(fig)
    # overview
    fig, ax = plt.subplots(2, 1, figsize=(24, 7), sharex=True)
    for k, c in [("rms", "k"), ("low", "tab:red"), ("high", "tab:blue")]:
        ax[0].plot(t, doc[k], color=c, lw=0.6, label=k)
    for k, c in [("vocal", "tab:purple"), ("drums", "tab:orange"), ("bass", "tab:brown"), ("other", "tab:olive")]:
        ax[1].plot(t, doc[k], color=c, lw=0.6, label=k)
    for s in doc["sections"]:
        for a_ in ax:
            a_.axvline(s["start"], color="tab:red", lw=1.5)
        ax[0].text(s["start"] + 0.2, 1.03, s["name"], fontsize=10, color="tab:red")
    for a_ in ax:
        a_.legend(loc="upper right", fontsize=8)
    ax[1].set_xticks(np.arange(0, doc["duration"] + 1, 5))
    fig.tight_layout()
    fig.savefig(common.QA / "audio_overview.png", dpi=65)
    plt.close(fig)


if __name__ == "__main__":
    main(plots="--plots" in sys.argv)
