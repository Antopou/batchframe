#!/usr/bin/env python3
"""
Anime character scan.

Reads JSON from stdin:
  {"imagePaths": [...], "characters": [{"name": "Nami", "folder": "/path/to/refs/Nami"}, ...]}

Writes JSON lines to stdout:
  {"status": "..."}                                          — progress text
  {"scanning": "path/to/img.png"}                           — about to process
  {"done": "path", "score": 0.82, "character": "Nami"}     — best match for this image
  {"scores": {"path": {"score": 0.82, "character": "Nami"}, ...}}  — final summary
  {"error": "message"}                                       — on failure

Two-stage engine:
  1. Fast CLIP whole-image pre-filter (~30 ms/img). Images whose max cosine to the
     reference set is below CLIP_GATE are skipped (score 0) without the expensive scan.
  2. For images that pass, CCIP (Contrastive Anime Character Identity Pretraining) from
     `dghs-imgutils` matches on cropped face/head regions so background/clothing colour
     no longer dominate. Face crops are batch-extracted for speed.
Falls back to whole-image CLIP if imgutils or its models are unavailable (offline first run).
"""
import os
import sys
import json
from pathlib import Path

# Keep the protocol channel (real stdout) clean: any stray prints / progress
# bars from imgutils, onnxruntime or huggingface must not corrupt our JSON lines.
_OUT = sys.stdout
sys.stdout = sys.stderr

IMAGE_GLOBS = ('*.png', '*.jpg', '*.jpeg', '*.webp')

# Stage-1 pre-filter: an image whose fast CLIP similarity to the references is below
# this gate is skipped without running the expensive CCIP scan. Higher = faster but
# risks skipping real matches that happen to look different from the refs. Tunable via
# the CLIP_GATE env var. Kept separate from the CCIP match threshold (the app's slider).
CLIP_GATE = float(os.environ.get('CLIP_GATE', '0.78'))


def emit(obj):
    _OUT.write(json.dumps(obj) + '\n')
    _OUT.flush()


class ModelUnavailable(Exception):
    """CCIP models could not be loaded (not installed / no network on first run)."""


def _load_clip():
    """Load CLIP for the fast pre-filter. Returns (torch, embed_pil) or raises."""
    import torch
    import open_clip
    model, _, preprocess = open_clip.create_model_and_transforms('ViT-B-32', pretrained='openai')
    model.eval()

    def embed_pil(pil):
        x = preprocess(pil).unsqueeze(0)
        with torch.no_grad():
            f = model.encode_image(x)
        return f / f.norm(dim=-1, keepdim=True)

    return torch, embed_pil


# ── Primary engine: CLIP pre-filter → CCIP identity scan ────────────────────
def run_two_stage(image_paths, characters, gate=None):
    gate_val = CLIP_GATE if gate is None else max(0.0, min(1.0, float(gate)))
    # Stage-2 engine (required): imgutils detection + CCIP.
    try:
        from PIL import Image
        from imgutils.detect import detect_faces
        try:
            from imgutils.detect import detect_heads
        except ImportError:
            detect_heads = None
        try:
            from imgutils.metrics import (
                ccip_extract_feature, ccip_batch_extract_features,
                ccip_batch_differences, ccip_default_threshold,
            )
        except ImportError:
            from imgutils.metrics.ccip import (
                ccip_extract_feature, ccip_batch_extract_features,
                ccip_batch_differences, ccip_default_threshold,
            )
        emit({'status': 'Loading models (first run may download)…'})
        threshold = ccip_default_threshold()
    except Exception as e:
        raise ModelUnavailable(str(e))

    def detect(img):
        dets = detect_heads(img) if detect_heads else []
        if not dets:
            dets = detect_faces(img)
        return dets

    def pad(box, w, h, frac=0.08):
        x0, y0, x1, y1 = box
        pw, ph = int((x1 - x0) * frac), int((y1 - y0) * frac)
        return (max(0, x0 - pw), max(0, y0 - ph), min(w, x1 + pw), min(h, y1 + ph))

    def load_rgb(p):
        with Image.open(p) as im:
            return im.convert('RGB')

    def largest_crop(img):
        """The biggest detected head/face (or the whole image if none)."""
        dets = detect(img)
        if not dets:
            return img
        w, h = img.size
        box = max((d[0] for d in dets), key=lambda b: (b[2] - b[0]) * (b[3] - b[1]))
        return img.crop(pad(box, w, h))

    def candidate_crops(img):
        """A crop per detected head/face (whole image if none)."""
        dets = detect(img)
        if not dets:
            return [img]
        w, h = img.size
        return [img.crop(pad(d[0], w, h)) for d in dets]

    def ccip_features(crops):
        """Batch-extract CCIP features for a list of crops → list of 1-D features."""
        if len(crops) == 1:
            return [ccip_extract_feature(crops[0])]
        return list(ccip_batch_extract_features(crops))

    # Stage-1 engine (optional): CLIP. If it fails to load, the gate is disabled and
    # every image goes to the CCIP scan (slower but never wrongly skipped).
    clip = None
    try:
        clip = _load_clip()
    except Exception:
        emit({'status': 'CLIP pre-filter unavailable — scanning every image'})

    # Embed references once; the loaded image feeds both engines.
    ref_feats, ref_names, clip_ref_vecs = [], [], []
    for ch in characters:
        folder = Path(ch['folder'])
        paths = [p for g in IMAGE_GLOBS for p in folder.glob(g)]
        if not paths:
            continue
        emit({'status': f'Embedding {ch["name"]} ({len(paths)} refs)…'})
        for p in paths:
            try:
                img = load_rgb(p)
            except Exception:
                continue
            try:
                ref_feats.append(ccip_extract_feature(largest_crop(img)))
                ref_names.append(ch['name'])
            except Exception:
                continue
            if clip is not None:
                try:
                    clip_ref_vecs.append(clip[1](img))
                except Exception:
                    pass

    if not ref_feats:
        emit({'error': 'No reference images found for any character'})
        return

    n_refs = len(ref_feats)
    default_char = ref_names[0]
    clip_refs = clip[0].cat(clip_ref_vecs) if (clip is not None and clip_ref_vecs) else None

    # Convert a CCIP difference into a 0..1 confidence around the model's own
    # same/different boundary: diff 0 → 1.0, diff == threshold → 0.5, diff ≥ 2T → 0.
    def to_score(diff):
        return max(0.0, min(1.0, 1.0 - diff / (2.0 * threshold)))

    emit({'status': 'Scanning' + (' (fast pre-filter on)…' if clip_refs is not None else '…')})
    results = {}
    skipped = 0
    for p in image_paths:
        emit({'scanning': str(p)})
        entry = None
        try:
            img = load_rgb(p)

            # ── Stage 1: cheap CLIP gate ──
            if clip_refs is not None:
                e = clip[1](img)
                clip_score = float((e @ clip_refs.T).max())
                if clip_score < gate_val:
                    skipped += 1
                    results[str(p)] = {'score': 0.0, 'character': None}
                    emit({'done': str(p), 'score': 0.0, 'character': None})
                    continue

            # ── Stage 2: accurate CCIP on face/head crops (batched) ──
            feats = ccip_features(candidate_crops(img))
            n_c = len(feats)
            M = ccip_batch_differences(feats + ref_feats)
            best_diff, best_char = None, default_char
            for ci in range(n_c):
                for ri in range(n_refs):
                    d = float(M[ci, n_c + ri])
                    if best_diff is None or d < best_diff:
                        best_diff, best_char = d, ref_names[ri]
            if best_diff is not None:
                entry = {'score': round(to_score(best_diff), 4), 'character': best_char}
        except Exception:
            entry = None
        results[str(p)] = entry
        emit({'done': str(p),
              'score':     entry['score']     if entry else None,
              'character': entry['character'] if entry else None})

    if clip_refs is not None:
        emit({'status': f'Done — pre-filter skipped {skipped}/{len(image_paths)}'})
    emit({'scores': results})


# ── Fallback engine: whole-image CLIP (used only if CCIP is unavailable) ────
def run_clip(image_paths, characters):
    import torch
    import open_clip
    from PIL import Image

    emit({'status': 'Loading CLIP model…'})
    model, _, preprocess = open_clip.create_model_and_transforms('ViT-B-32', pretrained='openai')
    model.eval()

    def embed(p):
        img = preprocess(Image.open(p).convert('RGB')).unsqueeze(0)
        with torch.no_grad():
            f = model.encode_image(img)
        return f / f.norm(dim=-1, keepdim=True)

    char_refs = {}
    for ch in characters:
        folder = Path(ch['folder'])
        paths = [p for g in IMAGE_GLOBS for p in folder.glob(g)]
        if not paths:
            continue
        emit({'status': f'Embedding {ch["name"]} ({len(paths)} refs)…'})
        char_refs[ch['name']] = [embed(p) for p in paths]

    if not char_refs:
        emit({'error': 'No reference images found for any character'})
        return

    emit({'status': 'Scanning…'})
    results = {}
    for p in image_paths:
        emit({'scanning': str(p)})
        try:
            emb = embed(p)
            best_score, best_char = -1.0, next(iter(char_refs))
            for char_name, refs in char_refs.items():
                score = max(float((emb * r).sum()) for r in refs)
                if score > best_score:
                    best_score, best_char = score, char_name
            entry = {'score': round(best_score, 4), 'character': best_char}
        except Exception:
            entry = None
        results[str(p)] = entry
        emit({'done': str(p),
              'score':     entry['score']     if entry else None,
              'character': entry['character'] if entry else None})

    emit({'scores': results})


def main():
    try:
        args = json.loads(sys.stdin.read())
        image_paths = args['imagePaths']
        characters  = args['characters']  # [{'name': ..., 'folder': ...}]
        gate        = args.get('clipGate')  # Stage-1 pre-filter %, chosen in the UI (optional)
    except Exception as e:
        emit({'error': f'bad input: {e}'})
        sys.exit(1)

    try:
        run_two_stage(image_paths, characters, gate)
    except (ImportError, ModelUnavailable):
        emit({'status': 'CCIP unavailable — using CLIP fallback'})
        try:
            run_clip(image_paths, characters)
        except Exception as e:
            emit({'error': str(e)})
            sys.exit(1)
    except Exception as e:
        emit({'error': str(e)})
        sys.exit(1)


if __name__ == '__main__':
    main()
