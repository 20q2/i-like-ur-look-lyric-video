"""faster-whisper large-v3 word timestamps on the 16 kHz vocal stem.

Writes work/whisper_<tag>.json (segments with words: word/start/end/probability), the shape
align.py reads. Cross-check only; the CTC alignment is primary. Audio is passed as an array:
faster-whisper's own decoder (PyAV) rejects its `metadata_errors` kwarg on current PyAV.
Run: uv run python whisper_run.py
"""
import common
import json

import soundfile as sf
from faster_whisper import WhisperModel


def run(model, tag, prompt=None):
    y, sr = sf.read(str(common.WORK / "vocals16k.wav"), dtype="float32")
    assert sr == 16000, sr
    segs, _ = model.transcribe(y, language="en", word_timestamps=True, condition_on_previous_text=False,
                               initial_prompt=prompt, temperature=0.0, vad_filter=False, beam_size=5)
    res = dict(segments=[dict(start=s.start, end=s.end, text=s.text,
                              words=[dict(word=w.word, start=w.start, end=w.end, probability=w.probability)
                                     for w in (s.words or [])])
                         for s in segs])
    (common.WORK / f"whisper_{tag}.json").write_text(json.dumps(res, indent=1), encoding="utf-8")
    for s in res["segments"]:
        print(f"{s['start']:7.2f} {s['end']:7.2f} {s['text']}")
    return res


if __name__ == "__main__":
    lines, _ = common.load_lyrics()
    m = WhisperModel("large-v3", device="cuda", compute_type="float16", download_root=str(common.CACHE / "whisper"))
    run(m, "large")
    p = " ".join(l["text"] for l in lines)
    p = p if len(p) <= 800 else p[:800].rsplit(" ", 1)[0]  # cut on a word boundary
    run(m, "large_prompt", p)
