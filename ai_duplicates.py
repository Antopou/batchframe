#!/usr/bin/env python3
"""
Find duplicate or near-duplicate images using DHash (Difference Hash).

Reads JSON from stdin:
  {"imagePaths": [...], "threshold": 5}

Writes JSON lines to stdout:
  {"status": "..."}                          — progress text
  {"scanning": "path/to/img.png"}            — about to process
  {"clusters": [["path1", "path2"], ...]}    — final summary of duplicates
  {"error": "message"}                       — on failure
"""
import os
import sys
import json

_OUT = sys.stdout
sys.stdout = sys.stderr

def emit(obj):
    _OUT.write(json.dumps(obj) + '\n')
    _OUT.flush()

def dhash(image, hash_size=8):
    """
    Calculate the difference hash (dhash) of an image.
    Resizes to (hash_size + 1) x hash_size, then compares adjacent pixels.
    """
    try:
        # Convert to grayscale and resize
        image = image.convert('L').resize((hash_size + 1, hash_size))
        pixels = list(image.getdata())
        
        # Compare adjacent pixels
        diff = []
        for row in range(hash_size):
            for col in range(hash_size):
                left_pixel = pixels[row * (hash_size + 1) + col]
                right_pixel = pixels[row * (hash_size + 1) + col + 1]
                diff.append(left_pixel > right_pixel)
        
        # Convert binary list to an integer
        decimal_value = 0
        for i, val in enumerate(diff):
            if val:
                decimal_value += 2**i
        return decimal_value
    except Exception as e:
        return None

def hamming_distance(hash1, hash2):
    """Calculate the Hamming distance between two integer hashes."""
    # XOR the two hashes and count the number of 1s (differences)
    return bin(hash1 ^ hash2).count('1')

def run(image_paths, threshold):
    from PIL import Image

    emit({'status': f'Scanning {len(image_paths)} images…'})
    
    hashes = []
    valid_paths = []

    for i, p in enumerate(image_paths):
        emit({'scanning': str(p)})
        try:
            with Image.open(p) as img:
                h = dhash(img)
                if h is not None:
                    hashes.append(h)
                    valid_paths.append(str(p))
        except Exception:
            pass # Skip invalid images

    if not hashes:
        emit({'clusters': []})
        return

    emit({'status': 'Finding duplicates…'})
    
    # Find clusters using connected components
    N = len(valid_paths)
    visited = set()
    clusters = []

    for i in range(N):
        if i in visited:
            continue
        
        # Find all images j that are similar to i (Hamming distance <= threshold)
        cluster = [i]
        visited.add(i)
        
        for j in range(i + 1, N):
            if j not in visited and hamming_distance(hashes[i], hashes[j]) <= threshold:
                cluster.append(j)
                visited.add(j)
                
        if len(cluster) > 1:
            clusters.append([valid_paths[idx] for idx in cluster])

    emit({'status': f'Found {len(clusters)} groups of duplicates'})
    emit({'clusters': clusters})

def main():
    try:
        args = json.loads(sys.stdin.read())
        image_paths = args.get('imagePaths', [])
        # Threshold is Hamming distance. Lower is more strict. 
        # 5 is a good default for identical/near-identical images (resized/recompressed).
        # We will map a high float threshold like 0.98 to a small hamming distance.
        # But if the input is meant for cosine similarity, we override it.
        threshold = args.get('threshold', 5)
        # In case the frontend still sends 0.98, we convert it to 5
        if isinstance(threshold, float) and threshold <= 1.0:
            threshold = 5 
    except Exception as e:
        emit({'error': f'bad input: {e}'})
        sys.exit(1)

    try:
        run(image_paths, threshold)
    except Exception as e:
        emit({'error': str(e)})
        sys.exit(1)

if __name__ == '__main__':
    main()
