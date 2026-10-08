"""Contract of the committed data files the app reads (app/src/engine/lyrics.ts,
audio.ts): data/lyrics.json from align.py, data/audio.json from analyze.py."""
import json
import math

import pytest

import common

LYRICS = json.loads((common.DATA / "lyrics.json").read_text(encoding="utf-8"))
AUDIO = json.loads((common.DATA / "audio.json").read_text(encoding="utf-8"))

WORDS = [(ln["i"], w) for ln in LYRICS["lines"] for w in ln["words"]]
MIN_WORD = 0.06  # s: shorter than ~1.5 frames at 30 fps is not a readable highlight
# (line, word) pairs allowed below MIN_WORD.  Empty on purpose: the shortest word
# is L3 "a" (0.085 s, a real unstressed article); the 0.02 / 0.04 s L36 words that
# the FIX push loop used to produce were re-aligned from evidence.  Add an entry
# only with a comment saying why the short span is what was sung.
SHORT_OK: set[tuple[int, str]] = set()
ENVELOPES = ("rms", "low", "mid", "high", "vocal", "drums", "bass", "other")
EPS = 1e-9


def num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


# --- lyrics.json -----------------------------------------------------------

def test_line_fields_and_types():
    assert LYRICS["lines"]
    for k, ln in enumerate(LYRICS["lines"]):
        assert ln["i"] == k
        assert isinstance(ln["text"], str) and ln["text"]
        assert isinstance(ln["section"], str) and ln["section"]
        assert num(ln["start"]) and num(ln["end"])
        assert isinstance(ln["words"], list) and ln["words"]
        assert [w["w"] for w in ln["words"]] == ln["text"].split(" ")


def test_word_fields_and_types():
    for li, w in WORDS:
        assert isinstance(w["w"], str) and w["w"], li
        assert num(w["start"]) and num(w["end"]), (li, w)
        assert num(w["conf"]) and 0 <= w["conf"] <= 1, (li, w)
        assert set(w) <= {"w", "start", "end", "conf", "syl"}, (li, w)


def test_line_span_is_first_to_last_word():
    for ln in LYRICS["lines"]:
        assert ln["start"] == ln["words"][0]["start"], ln["i"]
        assert ln["end"] == ln["words"][-1]["end"], ln["i"]


def test_words_ordered_without_overlap():
    for (_, p), (li, w) in zip(WORDS, WORDS[1:]):
        assert w["start"] > p["start"], (li, w)
        assert w["start"] >= p["end"] - EPS, (li, p, w)
    for li, w in WORDS:
        assert w["end"] > w["start"], (li, w)


def test_minimum_word_duration():
    short = [(li, w["w"], round(w["end"] - w["start"], 3)) for li, w in WORDS
             if w["end"] - w["start"] < MIN_WORD and (li, w["w"]) not in SHORT_OK]
    assert not short


def test_syllables_inside_their_word():
    for li, w in WORDS:
        if "syl" not in w:
            continue
        syl = w["syl"]
        assert isinstance(syl, list) and len(syl) >= 2, (li, w)
        for a, b in syl:
            assert num(a) and num(b), (li, w)
            assert w["start"] - EPS <= a <= b <= w["end"] + EPS, (li, w)
        for (_, b0), (a1, _) in zip(syl, syl[1:]):
            assert a1 >= b0 - EPS, (li, w)


# --- audio.json ------------------------------------------------------------

def test_sections_tile_the_song_on_downbeats():
    secs, dur = AUDIO["sections"], AUDIO["duration"]
    assert secs[0]["start"] == 0.0
    assert secs[-1]["end"] == pytest.approx(dur, abs=1e-3)
    for a, b in zip(secs, secs[1:]):
        assert a["end"] == b["start"], (a, b)
    for s in secs:
        assert isinstance(s["name"], str) and s["name"]
        assert s["end"] > s["start"], s
    db = AUDIO["downbeats"]
    for s in secs[1:]:  # the intro starts at 0, before the first downbeat
        assert min(abs(s["start"] - d) for d in db) <= 1e-3, s


def test_downbeats_are_beats():
    beats = AUDIO["beats"]
    assert beats == sorted(beats)
    assert set(AUDIO["downbeats"]) <= set(beats)


def test_envelopes_cover_the_song_in_unit_range():
    n = math.ceil(AUDIO["duration"] * AUDIO["fps"])
    for k in ENVELOPES:
        env = AUDIO[k]
        assert len(env) == n, k
        assert all(num(v) and 0 <= v <= 1 for v in env), k


def test_onsets_sorted_time_strength_pairs():
    assert AUDIO["onsets"]
    for k, ons in AUDIO["onsets"].items():
        assert ons, k
        for o in ons:
            assert len(o) == 2 and num(o[0]) and num(o[1]), (k, o)
            assert 0 <= o[0] <= AUDIO["duration"], (k, o)
        ts = [o[0] for o in ons]
        assert ts == sorted(ts), k


def test_duration_matches_song_wav():
    if not common.AUDIO.exists():
        pytest.skip("audio/song.wav not present (git-ignored)")
    assert AUDIO["duration"] == pytest.approx(common.duration(), abs=0.01)
