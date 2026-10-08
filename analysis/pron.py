"""Display token -> pronunciation spelling used for CTC alignment.

Each display token (lyric line split on spaces) maps to one or more pronunciation
sub-words of plain letters (and internal apostrophes). Hyphenated stutters split into
sub-words ("b-better," -> b | better) and get per-part timings ('syl') in lyrics.json.
"""
import re

# Spelled as sung, where the letters mislead a character-level acoustic model.
PRON = {
    "Acqua": "akwa",
    "Di": "dee",
    "Gio": "jo",
}


def pron(token: str) -> list[str]:
    if token in PRON:
        return PRON[token].split()
    w = token.lower().replace("’", "'")
    w = re.sub(r"[^a-z' ]", " ", w)
    w = w.strip("' ")
    return [p.strip("'") for p in w.split() if p.strip("'")]


if __name__ == "__main__":
    import common
    for l in common.load_lyrics()[0]:
        print(l["text"], "->", " | ".join(" ".join(pron(w)) for w in l["text"].split(" ")))
