# I Like Ur Look — a code-rendered lyric video

An unofficial, fan-made lyric video for Kim Petras' "I Like Ur Look", where every frame is rendered by code.

**Watch it:** _link coming soon_

A fashion magazine, *EFFORTLESS*, lies on a bed under a bedside lamp. The camera moves over it with the beat, and the
pages turn as the song goes. Every spread sets the lyrics into its own layout: a shopping page, an obituary, a perfume
ad, a contact sheet, a fold-out, a ransom note and the classifieds. A narrator who covets someone else's boyfriend
gradually takes the magazine over in pink lipstick. There's no footage and there are no images. Type, line drawings,
paper, light and camera are all generated, and every frame is a deterministic function of song time.

## How it works

**1. Timing data (`analysis/`, Python).** The song is analysed once into two committed files, so you can run the app
without repeating this step:

- `data/lyrics.json`: every word's start and end.
  - The vocals are separated with Demucs, then the lyrics are force-aligned with a CTC acoustic model and
    cross-checked with Whisper.
  - Hand fixes are recorded with their evidence in `align.py`'s `FIX` table.
- `data/audio.json`: the beat grid, downbeats, sections and per-stem energy.

**2. The engine (`app/`, TypeScript, three.js).** Forked from [mexicat/pdoom-video](https://github.com/mexicat/pdoom-video).

- **Pages:** each page face is drawn on a canvas, then mapped onto a 3D page mesh that bows, turns, folds out and tears.
- **The room:** one warm lamp, paper stock and sheen, depth of field, grain and a hand-held camera.
- **Re-drawing:** a page face is re-drawn only when its *key* changes. A keys check proves that skipping a re-draw
  never changes a pixel.

**3. Spreads (`app/src/spreads/`).** Each spread is a module that draws its pages and lists its camera *shots*:

- what to frame;
- on which word or beat;
- with which move: `snap`, `land` or `glide`.

A shot director turns those into camera motion, and a beat-driven groove adds bounce in the instrumental gaps. Tests
(`app/tests/sung.test.ts`) fail if a lyric is ever out of frame or out of focus while it's sung.

`docs/ENGINE.md` documents the engine; `docs/TREATMENT.md` is the style guide the spreads were authored against.

## Running it

Built and tested on Windows with an NVIDIA GPU. You need [bun](https://bun.sh), [ffmpeg](https://ffmpeg.org) and
Microsoft Edge (the offline renderer drives headless Edge). To re-run the analysis you also need
[uv](https://docs.astral.sh/uv/) and a CUDA GPU.

The song isn't in the repo. Buy or stream it legally, put it at `audio/song.mp3`, then convert it:

    ffmpeg -y -i audio/song.mp3 -c:a pcm_s16le -ar 44100 audio/song.wav

### Preview and render

    cd app
    bun install
    bun test                                     # unit tests and guards
    bun x vite                                   # http://localhost:5391/?t=40 — space: play/pause, ←/→: ±1 s
    bun scripts/render.ts stills --t 40.5        # -> out/stills
    bun scripts/render.ts video --samples auto --max-samples 36 --shutter 0.2 --out ../out/lyricvideo.mp4

The full 1080p60 render takes about 25 minutes on an RTX-class GPU. `--scale 2` renders 4K. `?card=testcard` in the
preview URL shows a karaoke test card for checking the timing data against the song.

### Timing data (optional)

    cd analysis
    uv sync
    uv run python separate.py        # Demucs stems
    uv run python ctc_emissions.py   # acoustic-model emissions
    uv run python whisper_run.py     # cross-check transcripts
    uv run python vocal_feats.py
    uv run python align.py --plots   # -> data/lyrics.json
    uv run python analyze.py --plots # -> data/audio.json
    uv run pytest tests -q

## Credits

- **Song:** "I Like Ur Look" by Kim Petras. The song and its lyrics belong to their rights holders. This is an
  unofficial fan project, not affiliated with or endorsed by the artist or her label. The audio isn't included.
- **Engine:** forked from [mexicat/pdoom-video](https://github.com/mexicat/pdoom-video) by Giacomo Magnanini (MIT;
  see `app/LICENSE`).
- **Fonts:** Bodoni Moda, Archivo and IBM Plex Mono, under the SIL Open Font License (`app/public/fonts/src/`).
- **Single-stroke fonts:** the Hershey fonts and Evil Mad Scientist's EMS fonts. Credits are in
  `app/public/fonts/stroke/NOTICE.md`.
- Made with [Claude Code](https://claude.com/claude-code).

## License

The code is MIT-licensed; see `LICENSE`. The licence covers this project's code only, not the song, its lyrics or
the bundled fonts, which keep their own licences.
