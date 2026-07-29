#!/usr/bin/env python3
"""
Match edited images back to their raw sources using DHash.

Given a folder of edited images (color/tone edits only from Photoshop,
which strips metadata) and a folder of raw source images, find which
raw corresponds to each edit by perceptual hash nearest-neighbour.

Reads JSON from stdin:
  {"editedPaths": [...], "rawPaths": [...], "threshold": 8}

Writes JSON lines to stdout:
  {"status": "..."}
  {"scanning": "path"}
  {"report": {
      "matches":        [{"edit": p, "raw": p, "distance": n, "ambiguous": bool, "runnerUp": {...}?}],
      "unmatchedEdits": [{"edit": p, "nearest": {"raw": p, "distance": n}}],
      "keepRaws":       [p, ...],
      "discardRaws":    [p, ...],
      "stats": {...}
   }}
  {"error": "..."}
"""
import sys
import json

_OUT = sys.stdout
sys.stdout = sys.stderr

def emit(obj):
    _OUT.write(json.dumps(obj) + '\n')
    _OUT.flush()

def dhash(image, hash_size=8):
    try:
        image = image.convert('L').resize((hash_size + 1, hash_size))
        pixels = list(image.getdata())
        diff = []
        for row in range(hash_size):
            for col in range(hash_size):
                left  = pixels[row * (hash_size + 1) + col]
                right = pixels[row * (hash_size + 1) + col + 1]
                diff.append(left > right)
        value = 0
        for i, v in enumerate(diff):
            if v:
                value += 1 << i
        return value
    except Exception:
        return None

def hamming(a, b):
    return bin(a ^ b).count('1')

def hash_paths(paths, label):
    from PIL import Image
    emit({'status': f'Hashing {len(paths)} {label}…'})
    hashes = []
    for p in paths:
        emit({'scanning': str(p)})
        try:
            with Image.open(p) as img:
                h = dhash(img)
        except Exception:
            h = None
        hashes.append((str(p), h))
    return hashes

def run(edited_paths, raw_paths, threshold):
    edits = hash_paths(edited_paths, 'edits')
    raws  = hash_paths(raw_paths,    'raws')

    valid_raws = [(p, h) for p, h in raws if h is not None]
    if not valid_raws:
        emit({'report': {
            'matches': [], 'unmatchedEdits': [], 'keepRaws': [],
            'discardRaws': [p for p, _ in raws],
            'stats': {'editCount': len(edits), 'rawCount': len(raws),
                      'matched': 0, 'unmatched': len(edits),
                      'keep': 0, 'discard': len(raws)},
        }})
        return

    emit({'status': 'Matching…'})
    matches = []
    unmatched = []
    keep_set = set()

    for edit_path, edit_hash in edits:
        if edit_hash is None:
            unmatched.append({'edit': edit_path, 'nearest': None})
            continue

        distances = [(p, hamming(edit_hash, h)) for p, h in valid_raws]
        distances.sort(key=lambda x: (x[1], x[0]))
        best_raw, best_dist = distances[0]

        if best_dist <= threshold:
            entry = {'edit': edit_path, 'raw': best_raw, 'distance': best_dist,
                     'ambiguous': False}
            if len(distances) > 1:
                runner_raw, runner_dist = distances[1]
                if runner_dist <= best_dist + 1:
                    entry['ambiguous'] = True
                    entry['runnerUp'] = {'raw': runner_raw, 'distance': runner_dist}
            matches.append(entry)
            keep_set.add(best_raw)
        else:
            unmatched.append({'edit': edit_path,
                              'nearest': {'raw': best_raw, 'distance': best_dist}})

    all_raw_paths = [p for p, _ in raws]
    discard_raws = [p for p in all_raw_paths if p not in keep_set]

    emit({'report': {
        'matches': matches,
        'unmatchedEdits': unmatched,
        'keepRaws': sorted(keep_set),
        'discardRaws': discard_raws,
        'stats': {
            'editCount': len(edits),
            'rawCount':  len(raws),
            'matched':   len(matches),
            'unmatched': len(unmatched),
            'keep':      len(keep_set),
            'discard':   len(discard_raws),
        },
    }})

def preflight():
    try:
        import PIL  # noqa: F401
    except ImportError:
        emit({'error': (
            "Python dependency 'Pillow' is not installed.\n"
            "Open Terminal and run:\n"
            "    python3 -m pip install --user Pillow\n"
            "Then try Find Source again."
        )})
        sys.exit(1)


def main():
    preflight()
    try:
        args = json.loads(sys.stdin.read())
        edited_paths = args.get('editedPaths', [])
        raw_paths    = args.get('rawPaths',    [])
        threshold    = args.get('threshold',   8)
        if not isinstance(threshold, int):
            threshold = 8
    except Exception as e:
        emit({'error': f'bad input: {e}'})
        sys.exit(1)

    try:
        run(edited_paths, raw_paths, threshold)
    except Exception as e:
        emit({'error': str(e)})
        sys.exit(1)

if __name__ == '__main__':
    main()
