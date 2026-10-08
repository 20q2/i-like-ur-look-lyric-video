"""Parse lyrics/lyrics.txt -> lead-vocal lines tagged with their song section.

Format: '[Section]' header lines, blank lines, lyric lines. Parenthesised text is backing
vocals / ad-libs: it is cut from the lead line (the aligner's garbage token absorbs it) and
returned separately. A line that is entirely parenthesised yields no lead line.
Section keys are the header lower-cased, letters only (digits in the header itself are
dropped), numbered per kind in order of appearance: [Pre-Chorus] twice -> prechorus1,
prechorus2; [Verse 1] / [Verse 2] -> verse1, verse2 (the counter supplies the number, not
the header's own digit).
Bad input fails loudly: nested / unbalanced parens and letterless headers raise ValueError.
"""
import re
from pathlib import Path

LYRICS_TXT = Path(__file__).resolve().parent.parent / "lyrics" / "lyrics.txt"
_PAREN = re.compile(r"\s*\([^)]*\)")


def _section_key(name, counts):
    base = re.sub(r"[^a-z]", "", name.lower())
    if not base:
        raise ValueError(f"section header has no letters: [{name}]")
    counts[base] = counts.get(base, 0) + 1
    return f"{base}{counts[base]}"


def _check_parens(s):
    depth = 0
    for c in s:
        depth += (c == "(") - (c == ")")
        if depth < 0:
            raise ValueError(f"stray ')' with no matching '(' in lyric line: {s!r}")
        if depth > 1:
            raise ValueError(f"nested parenthesis in lyric line: {s!r}")
    if depth:
        raise ValueError(f"unclosed parenthesis in lyric line: {s!r}")


def parse(text):
    lines, adlibs, counts, sec = [], [], {}, None
    for raw in text.splitlines():
        s = raw.strip()
        if not s:
            continue
        m = re.fullmatch(r"\[(.+)\]", s)
        if m:
            sec = _section_key(m.group(1), counts)
            continue
        if sec is None:
            raise ValueError(f"lyric before any [Section] header: {s!r}")
        _check_parens(s)
        for a in re.findall(r"\(([^)]*)\)", s):
            adlibs.append({"section": sec, "text": a.strip()})
        lead = " ".join(_PAREN.sub("", s).split())
        if lead:
            lines.append({"section": sec, "text": lead})
    return lines, adlibs


def load(path=LYRICS_TXT):
    return parse(Path(path).read_text(encoding="utf-8"))
