# Generate static font instances for the renderer (Canvas2D + opentype.js need static outlines).
# Run from analysis/: uv run --no-project --with fonttools python make_fonts.py
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

src = Path('../app/public/fonts/src')
out = Path('../app/public/fonts')
jobs = []
for wd in [62, 75, 87.5, 100, 112.5, 125]:
    for wt in [300, 500, 700, 900]:
        jobs.append(('Archivo[wdth,wght].ttf', {'wdth': wd, 'wght': wt}, f'Archivo-w{int(wd*10)}-{wt}.ttf'))
for wd in [75, 100]:
    for wt in [400, 800]:
        jobs.append(('Archivo-Italic[wdth,wght].ttf', {'wdth': wd, 'wght': wt}, f'ArchivoItalic-w{int(wd*10)}-{wt}.ttf'))
# Bodoni Moda: display optical size (96) for headlines and lyrics, text size (11) for body copy.
for wt in [400, 500, 700, 900]:
    jobs.append(('BodoniModa[opsz,wght].ttf', {'opsz': 96, 'wght': wt}, f'BodoniModa-o96-{wt}.ttf'))
for wt in [400, 700]:
    jobs.append(('BodoniModa-Italic[opsz,wght].ttf', {'opsz': 96, 'wght': wt}, f'BodoniModaItalic-o96-{wt}.ttf'))
jobs.append(('BodoniModa[opsz,wght].ttf', {'opsz': 11, 'wght': 400}, 'BodoniModa-o11-400.ttf'))
jobs.append(('BodoniModa-Italic[opsz,wght].ttf', {'opsz': 11, 'wght': 400}, 'BodoniModaItalic-o11-400.ttf'))
for s, loc, name in jobs:
    # recalcTimestamp=False keeps 'head'.modified from the source font so reruns are byte-stable
    inst = instancer.instantiateVariableFont(TTFont(src / s, recalcTimestamp=False), loc, updateFontNames=False)
    inst.save(out / name)
print(len(jobs), 'instances')
