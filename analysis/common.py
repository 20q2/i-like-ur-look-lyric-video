"""Shared paths / model-cache setup for the analysis scripts.

Import this module FIRST (before torch / huggingface imports) so model downloads land in
analysis/.cache/.

Time reference: audio/song.wav, one ffmpeg decode of audio/song.mp3. Demucs separates that
same file, so the mix, the stems, the alignment and the browser playback share one timeline
with zero offset (pdoom needed a measured encoder-delay shift here; we don't).
"""
import glob
import os
import site
from pathlib import Path

ROOT = Path(__file__).resolve().parent            # analysis/
PROJECT = ROOT.parent
CACHE = ROOT / ".cache"
for var, sub in [("TORCH_HOME", "torch"), ("HF_HOME", "hf"), ("HF_HUB_CACHE", "hf/hub"),
                 ("XDG_CACHE_HOME", "xdg"), ("MPLCONFIGDIR", "mpl"), ("NUMBA_CACHE_DIR", "numba")]:
    os.environ.setdefault(var, str(CACHE / sub))
    (CACHE / sub).mkdir(parents=True, exist_ok=True)
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

# CTranslate2 (faster-whisper) on Windows loads cuBLAS / cuDNN from the pip nvidia-* wheels.
if hasattr(os, "add_dll_directory"):
    _found_nvidia_dll_dir = False
    for sp in site.getsitepackages():
        for d in glob.glob(os.path.join(sp, "nvidia", "*", "bin")):
            os.add_dll_directory(d)
            os.environ["PATH"] = d + os.pathsep + os.environ["PATH"]
            _found_nvidia_dll_dir = True
    if not _found_nvidia_dll_dir:
        import warnings
        warnings.warn(
            "no nvidia/*/bin DLL dirs found in site-packages; faster-whisper on CUDA will "
            "fail to load cuBLAS/cuDNN"
        )

AUDIO = PROJECT / "audio" / "song.wav"
STEMS = ROOT / "stems"
DATA = PROJECT / "data"
QA = ROOT / "qa"
WORK = ROOT / "work"          # intermediate results (emissions, whisper json, features)
for _d in (QA, WORK, DATA):
    _d.mkdir(exist_ok=True)


def duration():
    import soundfile as sf
    return sf.info(str(AUDIO)).duration


def load_lyrics():
    """(lead lines [{section, text}], adlibs [{section, text}]) from lyrics/lyrics.txt."""
    import lyrics_src
    return lyrics_src.load()


def _resample(y, s, sr, mono):
    if sr and sr != s:
        import numpy as np
        import soxr
        y = soxr.resample(y, s, sr) if mono else np.stack([soxr.resample(c, s, sr) for c in y])
        s = sr
    return y, s


def load_stem(name, sr=None, mono=True):
    """A Demucs stem (vocals / drums / bass / other); already on the song.wav timeline."""
    import soundfile as sf
    y, s = sf.read(str(STEMS / f"{name}.wav"), dtype="float32", always_2d=True)
    assert s == 44100, f"{name}.wav is {s} Hz; stems must match song.wav (44.1 kHz)"
    y = y.mean(axis=1) if mono else y.T
    return _resample(y, s, sr, mono)


def load_vocal_source(name, sr=None):
    """'vocals' = Demucs vocal stem (mono sum); 'vocL' / 'vocR' = its left / right channel
    (double-tracked parts panned L/R are closer to a single voice per channel)."""
    if name in ("vocL", "vocR"):
        y, s = load_stem("vocals", sr=sr, mono=False)
        return y[0 if name == "vocL" else 1], s
    return load_stem("vocals", sr=sr)


def load_mix(sr=44100, mono=True):
    import librosa
    return librosa.load(str(AUDIO), sr=sr, mono=mono)
