"""Demucs htdemucs_ft stem separation of audio/song.wav.

Writes analysis/stems/{drums,bass,other,vocals}.wav (44.1 kHz stereo float, same length and
timeline as song.wav) and analysis/work/vocals16k.wav (mono 16 kHz PCM, for Whisper).
Run: uv run python separate.py
"""
import common
import numpy as np
import soundfile as sf
import soxr
import torch
from demucs.apply import apply_model
from demucs.pretrained import get_model


def main():
    y, sr = sf.read(str(common.AUDIO), dtype="float32", always_2d=True)  # (n, 2)
    assert sr == 44100, sr
    assert y.shape[1] == 2, f"song.wav must be stereo, got {y.shape}"
    model = get_model("htdemucs_ft")
    model.eval()
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    print("device:", dev)
    wav = torch.from_numpy(np.ascontiguousarray(y.T))  # (2, n)
    ref = wav.mean(0)
    mu, sd = ref.mean(), ref.std() + 1e-8  # same normalisation as the demucs CLI
    with torch.inference_mode():
        out = apply_model(model, ((wav - mu) / sd)[None], device=dev, shifts=1, split=True,
                          overlap=0.25, progress=True)[0]
    out = out * sd + mu
    common.STEMS.mkdir(parents=True, exist_ok=True)
    for name, src in zip(model.sources, out):
        x = src.cpu().numpy().T
        assert x.shape[0] == y.shape[0], (name, x.shape, y.shape)
        sf.write(str(common.STEMS / f"{name}.wav"), x, sr, subtype="FLOAT")
        print("wrote", name, x.shape)
    v = out[model.sources.index("vocals")].mean(0).cpu().numpy()
    v16 = soxr.resample(v, sr, 16000)
    print("vocals16k pre-scale peak", float(np.abs(v16).max()))
    v16 = v16 / max(1.01 * np.abs(v16).max(), 1.0)
    sf.write(str(common.WORK / "vocals16k.wav"), v16, 16000, subtype="PCM_16")
    print("wrote vocals16k.wav", v16.shape)


if __name__ == "__main__":
    main()
