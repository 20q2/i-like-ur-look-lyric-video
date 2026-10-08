import lyrics_src

SAMPLE = """[Intro]
Better

[Verse 1]
Your Acqua Di Gio on my sheets (-ah)

[Pre-Chorus]
Tonight, just pretend

[Post-Chorus]
(Woo)
So extreme (Looks better, looks b-b-better)

[Pre-Chorus]
Tonight, just pretend
"""


def test_sections_are_numbered_per_kind():
    lines, _ = lyrics_src.parse(SAMPLE)
    assert [l["section"] for l in lines] == ["intro1", "verse1", "prechorus1", "postchorus1", "prechorus2"]


def test_parentheticals_become_adlibs_and_leave_the_lead_line():
    lines, adlibs = lyrics_src.parse(SAMPLE)
    assert lines[1]["text"] == "Your Acqua Di Gio on my sheets"
    assert lines[3]["text"] == "So extreme"
    assert adlibs == [
        {"section": "verse1", "text": "-ah"},
        {"section": "postchorus1", "text": "Woo"},
        {"section": "postchorus1", "text": "Looks better, looks b-b-better"},
    ]


def test_fully_parenthesised_line_yields_no_lead_line():
    lines, _ = lyrics_src.parse(SAMPLE)
    assert all(l["text"] != "" for l in lines)
    assert len(lines) == 5


def test_lyric_before_header_is_an_error():
    import pytest
    with pytest.raises(ValueError):
        lyrics_src.parse("Better\n[Intro]\n")


def test_real_lyrics_file():
    lines, adlibs = lyrics_src.load()
    assert len(lines) == 40
    assert lines[0] == {"section": "intro1", "text": "Better"}
    assert lines[-1] == {"section": "outro1", "text": "Yeah"}
    assert all(l["text"].isascii() for l in lines)  # catches pasted homoglyphs (Cyrillic е etc.)
    sections = []
    for l in lines:
        if not sections or sections[-1] != l["section"]:
            sections.append(l["section"])
    assert sections == ["intro1", "verse1", "prechorus1", "chorus1", "verse2", "prechorus2", "chorus2",
                        "postchorus1", "bridge1", "chorus3", "postchorus2", "outro1"]


def test_nested_parens_are_an_error():
    import pytest
    with pytest.raises(ValueError):
        lyrics_src.parse("[Intro]\nfoo (bar (baz) qux) end\n")


def test_unclosed_paren_is_an_error():
    import pytest
    with pytest.raises(ValueError):
        lyrics_src.parse("[Intro]\nfoo (bar\n")


def test_stray_close_paren_is_an_error():
    import pytest
    with pytest.raises(ValueError):
        lyrics_src.parse("[Intro]\nfoo) bar\n")


def test_digit_only_header_is_an_error():
    import pytest
    with pytest.raises(ValueError):
        lyrics_src.parse("[2]\nhello\n")
