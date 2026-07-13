#!/usr/bin/env python3
"""
Anime face/head detection for smart-cropping.

Reads JSON from stdin:
  {"imagePaths": [...]}

Writes JSON lines to stdout:
  {"status": "..."}                          — progress text
  {"scanning": "path/to/img.png"}            — about to process
  {"done": "path", "box": [x, y, w, h]}      — largest head/face as 0..1 fractions
  {"done": "path", "box": null}              — nothing detected
  {"boxes": {"path": [x,y,w,h] | null, ...}} — final summary
  {"error": "message"}                       — on failure

Detection reuses the same imgutils models as ai_scan.py (detect_heads, falling
back to detect_faces). The largest detection is returned, padded ~8% like the
scan's crop step. This script never writes image files — the JS side does the
actual crop + save through the existing pipeline.
"""
import os
import sys
import json

# Keep the protocol channel (real stdout) clean: any stray prints / progress
# bars from imgutils, onnxruntime or huggingface must not corrupt our JSON lines.
_OUT = sys.stdout
sys.stdout = sys.stderr

# Extra padding added around the detected head/face, as a fraction of the box
# size, before it is normalised. Matches ai_scan.py's crop padding.
PAD_FRAC = float(os.environ.get('DETECT_PAD', '0.08'))


def emit(obj):
    _OUT.write(json.dumps(obj) + '\n')
    _OUT.flush()


class ModelUnavailable(Exception):
    """Detection models could not be loaded (not installed / no network on first run)."""


def run(image_paths):
    try:
        from PIL import Image
        from imgutils.detect import detect_faces
        try:
            from imgutils.detect import detect_heads
        except ImportError:
            detect_heads = None
        emit({'status': 'Loading models (first run may download)…'})
    except Exception as e:
        raise ModelUnavailable(str(e))

    def detect(img):
        dets = detect_heads(img) if detect_heads else []
        if not dets:
            dets = detect_faces(img)
        return dets

    def pad(box, w, h, frac=PAD_FRAC):
        x0, y0, x1, y1 = box
        pw, ph = int((x1 - x0) * frac), int((y1 - y0) * frac)
        return (max(0, x0 - pw), max(0, y0 - ph), min(w, x1 + pw), min(h, y1 + ph))

    def largest_box(img):
        """The biggest detected head/face as padded pixel box, or None."""
        dets = detect(img)
        if not dets:
            return None
        w, h = img.size
        box = max((d[0] for d in dets), key=lambda b: (b[2] - b[0]) * (b[3] - b[1]))
        return pad(box, w, h), w, h

    emit({'status': 'Detecting…'})
    boxes = {}
    for p in image_paths:
        emit({'scanning': str(p)})
        norm = None
        try:
            with Image.open(p) as im:
                img = im.convert('RGB')
                result = largest_box(img)
            if result is not None:
                (x0, y0, x1, y1), w, h = result
                # Normalise to 0..1 fractions of the natural image.
                norm = [x0 / w, y0 / h, (x1 - x0) / w, (y1 - y0) / h]
        except Exception:
            norm = None
        boxes[str(p)] = norm
        emit({'done': str(p), 'box': norm})

    emit({'boxes': boxes})


def main():
    try:
        args = json.loads(sys.stdin.read())
        image_paths = args['imagePaths']
    except Exception as e:
        emit({'error': f'bad input: {e}'})
        sys.exit(1)

    try:
        run(image_paths)
    except (ImportError, ModelUnavailable) as e:
        emit({'error': f'detection unavailable: {e}'})
        sys.exit(1)
    except Exception as e:
        emit({'error': str(e)})
        sys.exit(1)


if __name__ == '__main__':
    main()
