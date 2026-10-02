"""Encode capture-demo.mjs frames at 800px wide; requires Pillow."""
import json
from pathlib import Path
from PIL import Image
capture = json.loads(Path('output/readme-polish/capture.json').read_text())
frames = []
for frame in capture['frames']:
    with Image.open(frame['path']) as image:
        image = image.convert('RGB')
        image.thumbnail((800, 610), Image.Resampling.LANCZOS)
        frames.append(image.quantize(colors=128))
target = Path('docs/screenshots/demo.gif')
frames[0].save(target, save_all=True, append_images=frames[1:],
               duration=[f['duration'] for f in capture['frames']], loop=0, optimize=True)
assert target.stat().st_size < 10_000_000
print(f'{target}: {target.stat().st_size:,} bytes, {len(frames)} frames')
