#!/usr/bin/env python3
"""
Character background removal (cut-out).

Reads JSON from stdin:
  {"jobs": [{"in": "src.png", "out": "dst.png"}, ...],
   "background": "white" | "transparent",
   "alphaLo": 0.05, "alphaHi": 0.95}

Writes JSON lines to stdout:
  {"status": "..."}                            — progress text
  {"scanning": "path/to/img.png"}              — about to process
  {"done": "src", "out": "dst", "ok": true}    — one job finished
  {"done": "src", "ok": false, "reason": "…"}  — one job failed, batch continues
  {"summary": {"written": n, "failed": n}}     — final
  {"error": "message"}                         — fatal failure

Primary engine: imgutils' isnetis (SkyTNT anime-seg), which is trained on anime
characters and is by far the best fit for this app's material — on ordinary
framing it separates the character from painted backgrounds cleanly, where a
generic saliency model will happily keep the pillow and drop the face.

isnetis has one known failure mode: on an extreme close-up, where the character
fills the frame and the background is a soft flat colour, it returns a mask that
is ~1.0 almost everywhere and keeps everything. That is detectable (see
DEGENERATE_COVERAGE), and those images are re-run through RMBG-1.4, a generic
saliency model that handles exactly that case well. Both are ONNX and cached
from HuggingFace on first use, so this script adds no pip dependency —
onnxruntime, huggingface_hub, numpy, scipy and PIL all arrive with
dghs-imgutils.

Unlike ai_detect.py this script does write image files: it already holds the
RGBA pixels, so sending them back through IPC for the renderer to re-encode
would be pure waste. The JS side still owns path choice and manifest
bookkeeping — every output path is handed to us ready-made.
"""
import os
import sys
import json

# Keep the protocol channel (real stdout) clean: any stray prints / progress
# bars from onnxruntime or huggingface must not corrupt our JSON lines.
_OUT = sys.stdout
sys.stdout = sys.stderr

RMBG_REPO = 'briaai/RMBG-1.4'
RMBG_FILE = 'onnx/model.onnx'
RMBG_SIZE = 1024

BIREFNET_REPO = 'onnx-community/BiRefNet-ONNX'
BIREFNET_FILE = 'onnx/model_fp16.onnx'
BIREFNET_SIZE = 1024

# Masks come back with a soft ramp and, for isnetis, never quite reach 1.0 —
# measured peak alpha is 253/255 even deep inside the character, so a raw
# cut-out is faintly translucent. Remapping [lo, hi] onto [0, 1] makes the
# interior fully opaque and the background fully clear while keeping the soft
# ramp at the edges (hair, antialiasing).
ALPHA_LO = float(os.environ.get('BG_ALPHA_LO', '0.05'))
ALPHA_HI = float(os.environ.get('BG_ALPHA_HI', '0.95'))

# A mask that claims this much of the frame has not found a character, it has
# given up and kept the picture. Measured: a good cut-out covers 30-55% of the
# frame, while isnetis' close-up failure covers 97.6%.
DEGENERATE_COVERAGE = float(os.environ.get('BG_DEGENERATE', '0.90'))

# Islands smaller than this share of the biggest one are scenery that happens to
# be salient (a stray highlight, a sliver of pillow), not part of the character.
MIN_ISLAND_FRAC = float(os.environ.get('BG_MIN_ISLAND', '0.10'))

# Enclosed gaps up to this share of the character are model slips worth filling
# (a face coming out see-through). Anything larger is real background seen
# through the subject — between crossed arms, between twintails — and filling it
# would paste scenery back into the cut-out.
MAX_HOLE_FRAC = float(os.environ.get('BG_MAX_HOLE', '0.05'))

# How far outside the solid subject the soft edge is allowed to live. Wide
# enough to keep antialiasing and stray hair, tight enough to clear haze.
EDGE_KEEP_PX = int(os.environ.get('BG_EDGE_KEEP', '8'))

# Below this the second model has found nothing, so it gets no vote.
EMPTY_GATE_FRAC = float(os.environ.get('BG_EMPTY_GATE', '0.01'))


def emit(obj):
    _OUT.write(json.dumps(obj) + '\n')
    _OUT.flush()


class ModelUnavailable(Exception):
    """No segmentation engine could be loaded (not installed / no network on first run)."""


def load_rmbg():
    """Return a mask function backed by RMBG-1.4, or raise."""
    import numpy as np
    import onnxruntime as ort
    from PIL import Image
    from huggingface_hub import hf_hub_download

    path = hf_hub_download(RMBG_REPO, RMBG_FILE)
    session = ort.InferenceSession(path, providers=['CPUExecutionProvider'])
    input_name = session.get_inputs()[0].name

    def mask_of(img):
        """img: RGB PIL image → float32 mask in 0..1 at the image's own size."""
        x = np.asarray(img.resize((RMBG_SIZE, RMBG_SIZE), Image.BILINEAR), dtype=np.float32) / 255.0
        x = ((x - 0.5) / 1.0).transpose(2, 0, 1)[None]
        m = session.run(None, {input_name: x})[0][0, 0]
        # RMBG's head is unbounded; the reference implementation rescales each
        # result to full range. Skip it when the spread is degenerate (nothing
        # found), otherwise pure noise would be stretched into a fake subject.
        lo, hi = float(m.min()), float(m.max())
        m = (m - lo) / (hi - lo) if hi - lo > 0.05 else np.clip(m, 0.0, 1.0)
        full = Image.fromarray((m * 255.0 + 0.5).astype(np.uint8)).resize(img.size, Image.BILINEAR)
        return np.asarray(full, dtype=np.float32) / 255.0

    return mask_of


def load_isnetis():
    """Return a mask function backed by imgutils' isnetis, or raise."""
    import numpy as np
    from imgutils.segment import get_isnetis_mask

    def mask_of(img):
        m = np.asarray(get_isnetis_mask(img), dtype=np.float32)
        if m.max() > 1.5:
            m = m / 255.0
        return m

    return mask_of


def load_birefnet():
    """Return a mask function backed by BiRefNet, or raise. Accurate and slow."""
    import numpy as np
    import onnxruntime as ort
    from PIL import Image
    from huggingface_hub import hf_hub_download

    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)

    path = hf_hub_download(BIREFNET_REPO, BIREFNET_FILE)
    options = ort.SessionOptions()
    options.log_severity_level = 3
    session = ort.InferenceSession(path, options, providers=['CPUExecutionProvider'])
    input_name = session.get_inputs()[0].name

    def mask_of(img):
        x = np.asarray(img.resize((BIREFNET_SIZE, BIREFNET_SIZE), Image.BILINEAR), dtype=np.float32) / 255.0
        x = ((x - mean) / std).transpose(2, 0, 1)[None].astype(np.float32)
        m = np.asarray(session.run(None, {input_name: x})[-1], dtype=np.float32)
        while m.ndim > 2:
            m = m[0]
        m = 1.0 / (1.0 + np.exp(-m))          # logits → probability
        lo, hi = float(m.min()), float(m.max())
        if hi - lo > 0.05:
            m = (m - lo) / (hi - lo)
        m = np.clip(m, 0.0, 1.0)
        full = Image.fromarray((m * 255.0 + 0.5).astype(np.uint8)).resize(img.size, Image.BILINEAR)
        return np.asarray(full, dtype=np.float32) / 255.0

    return mask_of


def cleanup(m):
    """Drop salient scenery that isn't attached to the character, and fill slips.

    Two distinct defects, both seen on real frames: islands of background the
    model happened to like (a bright sliver, a stray strand), and gaps punched
    inside the character (a face coming out see-through).

    What survives is kept soft: the mask is multiplied by a *dilated* form of
    itself rather than its raw binary form. Multiplying by the bare `> 0.5` mask
    would clip every value below that contour — exactly the antialiased ramp
    along hair and edges — while the dilation still clears distant haze and the
    fringe of anything rejected.
    """
    try:
        import numpy as np
        from scipy import ndimage
    except Exception:
        return m

    solid = m > 0.5
    if not solid.any():
        return m

    labels, count = ndimage.label(solid)
    if count > 1:
        areas = ndimage.sum(solid, labels, range(1, count + 1))
        big = [i + 1 for i, a in enumerate(areas) if a >= MIN_ISLAND_FRAC * areas.max()]
        solid = np.isin(labels, big)

    out = m * ndimage.binary_dilation(solid, iterations=EDGE_KEEP_PX)

    # Fill only the small enclosed gaps; a large one is background showing
    # through the character — between crossed arms, between twintails — and
    # filling it would paste scenery back into the cut-out.
    gaps = ndimage.binary_fill_holes(solid) & ~solid
    if gaps.any():
        gap_labels, gap_count = ndimage.label(gaps)
        limit = MAX_HOLE_FRAC * solid.sum()
        gap_areas = ndimage.sum(gaps, gap_labels, range(1, gap_count + 1))
        keep = [i + 1 for i, a in enumerate(gap_areas) if a <= limit]
        if keep:
            out[np.isin(gap_labels, keep)] = 1.0

    return out


def load_engine(quality):
    """Build the mask function for the requested quality.

    fast — isnetis alone (~1s/image), with RMBG-1.4 called in only for the
    close-ups isnetis gives up on. Right for culling a folder.

    best — isnetis gated by BiRefNet (~20s/image). isnetis draws the character
    and its edges; BiRefNet decides what is background. Each covers the other's
    mistakes: on a frame where isnetis kept a wedge of pillow fused to the hair
    the gate removes it, and where BiRefNet wrongly kept a couch isnetis had
    already excluded it, so the gate is a no-op.
    """
    import numpy as np
    from scipy import ndimage

    isnetis = None
    try:
        isnetis = load_isnetis()
    except Exception as e:
        emit({'status': f'Anime segmenter unavailable ({e})…'})

    def degenerate(m):
        return float(np.mean(m > 0.9)) > DEGENERATE_COVERAGE

    if quality == 'best':
        try:
            birefnet = load_birefnet()
        except Exception as e:
            emit({'status': f'High-quality model unavailable ({e}); using fast mode…'})
            return load_engine('fast')

        if isnetis is None:
            return birefnet

        def mask_of(img):
            fine = isnetis(img)
            coarse = birefnet(img)
            # Nothing usable from isnetis on this frame — take BiRefNet whole.
            if degenerate(fine):
                return coarse
            # If BiRefNet found nothing, gating would erase the character; a
            # veto with nothing behind it is not a veto.
            if float(np.mean(coarse > 0.5)) < EMPTY_GATE_FRAC:
                return fine
            # Dilate the gate so isnetis' soft edge is never cut by BiRefNet's
            # slightly different idea of where the boundary sits.
            return fine * ndimage.binary_dilation(coarse > 0.5, iterations=EDGE_KEEP_PX)

        return mask_of

    fallback = None

    def get_fallback():
        nonlocal fallback
        if fallback is None:
            fallback = load_rmbg()
        return fallback

    if isnetis is None:
        try:
            return get_fallback()
        except Exception as e:
            raise ModelUnavailable(str(e))

    def mask_of(img):
        m = isnetis(img)
        # isnetis keeps the whole frame on tight close-ups. RMBG is a generic
        # saliency model and handles precisely that case, so it is worth the
        # second pass — but only for the images that need it.
        if degenerate(m):
            try:
                alt = get_fallback()(img)
                if not degenerate(alt):
                    return alt
            except Exception:
                pass
        return m

    return mask_of


def save_as(img, path, ext):
    """Write in the format the caller asked for by naming the file that way.

    The JS side picks the extension — it keeps the source's format when the
    result can be represented in it, and only falls back to PNG when the cut-out
    needs an alpha channel the source format has no room for.
    """
    ext = (ext or '').lower()
    if ext in ('.jpg', '.jpeg'):
        # JPEG has no alpha; anything transparent has already been composited.
        img.convert('RGB').save(path, 'JPEG', quality=95, subsampling=0)
    elif ext == '.webp':
        img.save(path, 'WEBP', quality=95)
    else:
        img.save(path, 'PNG')


def run(jobs, background, quality, alpha_lo, alpha_hi):
    try:
        import numpy as np
        from PIL import Image
    except Exception as e:
        raise ModelUnavailable(str(e))

    emit({'status': 'Loading model (first run may download)…'})
    mask_of = load_engine(quality)
    emit({'status': 'Removing backgrounds…'})
    span = max(1e-6, alpha_hi - alpha_lo)
    on_white = background == 'white'

    def cut_out(src_path, out_path):
        with Image.open(src_path) as im:
            img = im.convert('RGB')
            a = cleanup(mask_of(img))
            a = np.clip((a - alpha_lo) / span, 0.0, 1.0)
            alpha = Image.fromarray((a * 255.0 + 0.5).astype(np.uint8))
            if on_white:
                # Composite over white rather than leaving a hole. The soft
                # edge still blends, it just blends into white instead of into
                # whatever the image is later shown against.
                out = Image.new('RGB', img.size, (255, 255, 255))
                out.paste(img, mask=alpha)
            else:
                out = img.convert('RGBA')
                out.putalpha(alpha)
            # Write beside the destination then replace, so an interrupted run
            # can never leave a half-written file where a real image used to be.
            tmp_path = out_path + '.part'
            save_as(out, tmp_path, os.path.splitext(out_path)[1])
        os.replace(tmp_path, out_path)

    written = failed = 0
    for job in jobs:
        src = str(job['in'])
        out = str(job['out'])
        emit({'scanning': src})
        try:
            cut_out(src, out)
        except Exception as e:
            failed += 1
            try:
                os.unlink(out + '.part')
            except OSError:
                pass
            emit({'done': src, 'ok': False, 'reason': str(e)})
            continue
        written += 1
        emit({'done': src, 'out': out, 'ok': True})

    emit({'summary': {'written': written, 'failed': failed}})


def main():
    try:
        args = json.loads(sys.stdin.read())
        jobs = args['jobs']
        background = args.get('background', 'white')
        quality = args.get('quality', 'fast')
        alpha_lo = float(args.get('alphaLo', ALPHA_LO))
        alpha_hi = float(args.get('alphaHi', ALPHA_HI))
    except Exception as e:
        emit({'error': f'bad input: {e}'})
        sys.exit(1)

    try:
        run(jobs, background, quality, alpha_lo, alpha_hi)
    except (ImportError, ModelUnavailable) as e:
        emit({'error': f'background removal unavailable: {e}'})
        sys.exit(1)
    except Exception as e:
        emit({'error': str(e)})
        sys.exit(1)


if __name__ == '__main__':
    main()
