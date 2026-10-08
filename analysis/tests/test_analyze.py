import numpy as np
from analyze import choose_bar_phase, sections_from_lyrics


def test_bar_phase_from_snares_and_chord_changes():
    n = 64
    sn = np.zeros(n)
    sn[3::2] = 1          # snares on odd beats from beat 3 -> downbeats have even parity
    nov = np.full(n, 0.1)
    nov[2::4] = 0.9       # chord changes on beats 2, 6, 10 ...
    p, _, _ = choose_bar_phase(nov, sn)
    assert p == 2


def test_bar_phase_without_drums_uses_harmony_only():
    nov = np.full(64, 0.1)
    nov[1::4] = 0.8
    p, _, _ = choose_bar_phase(nov, np.zeros(64))
    assert p == 1


def _line(section, start):
    return {"section": section, "words": [{"start": start}]}


def test_sections_start_on_downbeats_with_pickup_rule():
    P = 0.5
    db = np.arange(0, 40, 4 * P)                      # a downbeat every 2 s
    lines = [_line("intro1", 0.3), _line("verse1", 4.2), _line("verse1", 6.0),
             _line("chorus1", 9.4),                    # 0.6 s (< 2 beats) before the 10 s downbeat: pickup
             _line("outro1", 13.0)]
    secs = sections_from_lyrics(lines, db, P, 20.0)
    assert [(s["name"], s["start"], s["end"]) for s in secs] == [
        ("intro1", 0.0, 4.0), ("verse1", 4.0, 10.0), ("chorus1", 10.0, 12.0), ("outro1", 12.0, 20.0)]
