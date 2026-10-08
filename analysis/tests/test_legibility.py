"""app/scripts/legibility.py on synthetic spreads: what it reports when a measure can't be taken, and lines it must skip."""
import importlib.util
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

SCRIPT = Path(__file__).resolve().parents[2] / 'app' / 'scripts' / 'legibility.py'
spec = importlib.util.spec_from_file_location('legibility', SCRIPT)
legibility = importlib.util.module_from_spec(spec)
spec.loader.exec_module(legibility)

SPINE = 960


def spread(tmp_path, name, title=20, marks=()):
    """A 1080p open spread: sheets at sRGB 20, two pages of paper at 200 (x 160-1760, y 40-1040) with the gutter's dip
    at the spine, and a display title's two 12 px stems at sRGB `title` on the left page; `marks`: (y0, y1, x0, x1)
    boxes of ink (sRGB 20) or single pixels ((y, x) pairs)."""
    img = np.full((1080, 1920), 20.0)
    x = np.arange(160, 1760)
    img[40:1040, 160:1760] = 200.0 * (1 - 0.45 * np.exp(-((x - SPINE) / 5.0) ** 2))
    img[200:260, 300:312] = img[200:260, 330:342] = title
    for m in marks:
        if len(m) == 4:
            img[m[0]:m[1], m[2]:m[3]] = 20
        else:
            img[m] = 20
    p = tmp_path / name
    Image.fromarray(np.repeat(img[..., None], 3, 2).astype(np.uint8)).save(p)
    return str(p)


def run(monkeypatch, capsys, *stills):
    monkeypatch.setattr(sys, 'argv', ['legibility.py', *stills])
    with pytest.raises(SystemExit) as e:
        legibility.main()
    return e.value.code, capsys.readouterr().out


def test_a_clean_spread_passes(tmp_path, monkeypatch, capsys):
    # a text line 60 px right of the spine (where the lyric column starts), clean paper beside it
    code, out = run(monkeypatch, capsys, spread(tmp_path, 'ok.png', marks=[(300, 330, 1020, 1140)]))
    assert code == 0, out
    assert 'gutter: right page' in out and out.rstrip().endswith('PASS')


def test_a_title_below_the_floor_is_kept_when_the_gutter_cant_be_measured(tmp_path, monkeypatch, capsys):
    # sRGB 90 stems (~4.1:1), and a 1 px hairline in the paper beside a text line's gutter-side edge (1 px a column, so
    # not the line's edge itself): the gutter measure can't be taken. The title's ratio used to go down with it, and a
    # passing still beside it made the run print PASS
    good = spread(tmp_path, 'good.png')
    bad = spread(tmp_path, 'bad.png', title=90, marks=[(300, 330, 1020, 1140), (313, 314, 1007, 1013)])
    code, out = run(monkeypatch, capsys, good, bad)
    assert 'BELOW 4.5' in out and 'gutter: UNMEASURABLE' in out
    assert code == 1, out
    assert 'FAIL' in out and 'PASS' not in out


def test_an_unmeasurable_still_is_incomplete_not_a_pass(tmp_path, monkeypatch, capsys):
    good = spread(tmp_path, 'good.png')
    code, out = run(monkeypatch, capsys, good, str(tmp_path / 'missing.png'))
    assert code == 2, out
    assert 'ERROR' in out and 'INCOMPLETE' in out and 'PASS' not in out


def test_a_shallow_hatch_near_the_spine_is_no_line(tmp_path, monkeypatch, capsys):
    # a 1 px hatch at 1 in 3: ink in each of its 31 rows (3 px a row), never 2 px in a column. It crashed the gutter
    # measure (no column to take the line's edge from)
    hatch = [(y, x) for y in range(400, 431) for x in range(980 + 3 * (y - 400), 983 + 3 * (y - 400))]
    code, out = run(monkeypatch, capsys, spread(tmp_path, 'hatch.png', marks=hatch))
    assert code == 0, out
    assert 'no text line within 150 px' in out
