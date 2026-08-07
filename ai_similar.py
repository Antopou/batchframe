#!/usr/bin/env python3
"""
Score how similar each image looks to one reference image.

Unlike ai_duplicates.py (near-identical copies) this answers "how close is the
look of this picture to that one" — mostly palette, nudged by composition:

    score = 0.75 * colour-histogram match + 0.25 * structural (dhash) match

Colour is an HSV histogram intersection, so tone/mood dominates the number.
Structure is a dhash Hamming match rescaled so an unrelated pair (which lands
near 50% by chance) reads as 0 rather than "half similar".

Reads JSON from stdin:
  {"referencePath": "...", "imagePaths": [...]}

Writes JSON lines to stdout:
  {"status": "..."}                        — progress text
  {"scanning": "path/to/img.png"}          — about to process
  {"scores": {"path": 0.0-1.0, ...}}       — final per-image similarity
  {"error": "message"}                     — on failure
"""
import sys
import json

_OUT = sys.stdout
sys.stdout = sys.stderr

# HSV histogram shape. Hue gets the most bins — it carries "what colour is it".
H_BINS, S_BINS, V_BINS = 12, 4, 4
THUMB = 128          # analysis resolution; detail beyond this doesn't help
HASH_SIZE = 8        # dhash grid → 64 bits
COLOR_WEIGHT = 0.75
STRUCT_WEIGHT = 0.25


def emit(obj):
    _OUT.write(json.dumps(obj) + '\n')
    _OUT.flush()


def smooth_histogram(hist):
    """
    Bleed each bin into its neighbours with a [0.25, 0.5, 0.25] kernel along all
    three axes. Without this the intersection is brutally literal — two shots of
    the same scene one shade apart land in different bins and score as unrelated.
    Hue wraps (red 359° neighbours red 0°); saturation and value clamp.
    """
    out = hist
    for axis, size in (('h', H_BINS), ('s', S_BINS), ('v', V_BINS)):
        src = out
        out = [0.0] * len(src)
        for h in range(H_BINS):
            for s in range(S_BINS):
                for v in range(V_BINS):
                    i = (h * S_BINS + s) * V_BINS + v
                    if axis == 'h':
                        lo, hi = (h - 1) % H_BINS, (h + 1) % H_BINS
                        prev = (lo * S_BINS + s) * V_BINS + v
                        nxt = (hi * S_BINS + s) * V_BINS + v
                    elif axis == 's':
                        prev = (h * S_BINS + max(0, s - 1)) * V_BINS + v
                        nxt = (h * S_BINS + min(size - 1, s + 1)) * V_BINS + v
                    else:
                        prev = (h * S_BINS + s) * V_BINS + max(0, v - 1)
                        nxt = (h * S_BINS + s) * V_BINS + min(size - 1, v + 1)
                    out[i] = 0.25 * src[prev] + 0.5 * src[i] + 0.25 * src[nxt]
    total = sum(out)
    return [c / total for c in out] if total else out


def color_histogram(image):
    """Smoothed, normalized HSV histogram (H_BINS*S_BINS*V_BINS buckets)."""
    hsv = image.convert('HSV').resize((THUMB, THUMB))
    bins = H_BINS * S_BINS * V_BINS
    try:
        import numpy as np
        arr = np.asarray(hsv, dtype=np.uint16)
        h = (arr[:, :, 0].astype(np.uint32) * H_BINS) // 256
        s = (arr[:, :, 1].astype(np.uint32) * S_BINS) // 256
        v = (arr[:, :, 2].astype(np.uint32) * V_BINS) // 256
        idx = (h * S_BINS + s) * V_BINS + v
        hist = np.bincount(idx.ravel(), minlength=bins).astype(np.float64).tolist()
    except ImportError:
        hist = [0.0] * bins
        for (h, s, v) in hsv.getdata():
            idx = ((h * H_BINS // 256) * S_BINS + (s * S_BINS // 256)) * V_BINS + (v * V_BINS // 256)
            hist[idx] += 1.0

    total = sum(hist)
    if not total:
        return hist
    return smooth_histogram([c / total for c in hist])


def dhash(image):
    """Difference hash — same construction as ai_duplicates.py."""
    img = image.convert('L').resize((HASH_SIZE + 1, HASH_SIZE))
    px = list(img.getdata())
    value = 0
    bit = 0
    for row in range(HASH_SIZE):
        base = row * (HASH_SIZE + 1)
        for col in range(HASH_SIZE):
            if px[base + col] > px[base + col + 1]:
                value |= 1 << bit
            bit += 1
    return value


def describe(path):
    """(histogram, dhash) for one image, or None if it can't be read."""
    from PIL import Image
    try:
        with Image.open(path) as img:
            img.load()
            return color_histogram(img), dhash(img)
    except Exception:
        return None


def similarity(ref, other):
    ref_hist, ref_hash = ref
    hist, hash_ = other

    # Histogram intersection: sum of per-bin minimums. Both sum to 1, so this
    # is already 0..1 — identical palettes give 1.0, disjoint ones 0.0.
    color = sum(min(a, b) for a, b in zip(ref_hist, hist))

    # Hamming match, rescaled: unrelated hashes differ in ~half the bits, so
    # fold that 0.5 baseline down to 0 and keep the top half of the range.
    match = 1.0 - (bin(ref_hash ^ hash_).count('1') / (HASH_SIZE * HASH_SIZE))
    struct = max(0.0, (match - 0.5) * 2.0)

    return COLOR_WEIGHT * color + STRUCT_WEIGHT * struct


def run(reference_path, image_paths):
    emit({'status': 'Reading reference…'})
    emit({'scanning': str(reference_path)})
    ref = describe(reference_path)
    if ref is None:
        emit({'error': 'Could not read the reference image.'})
        return

    targets = [p for p in image_paths if str(p) != str(reference_path)]
    emit({'status': f'Comparing {len(targets)} images…'})

    scores = {str(reference_path): 1.0}
    for p in targets:
        emit({'scanning': str(p)})
        other = describe(p)
        if other is None:
            continue
        scores[str(p)] = round(similarity(ref, other), 4)

    close = sum(1 for v in scores.values() if v >= 0.7)
    emit({'status': f'{close} images are 70%+ similar'})
    emit({'scores': scores})


def main():
    try:
        args = json.loads(sys.stdin.read())
        reference_path = args['referencePath']
        image_paths = args.get('imagePaths', [])
    except Exception as e:
        emit({'error': f'bad input: {e}'})
        sys.exit(1)

    try:
        run(reference_path, image_paths)
    except Exception as e:
        emit({'error': str(e)})
        sys.exit(1)


if __name__ == '__main__':
    main()
