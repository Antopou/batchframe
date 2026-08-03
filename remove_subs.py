#!/usr/bin/env python3
"""
Hardcoded subtitle removal.

Reads JSON from stdin:
  {"jobs": [{"in": "src.jpg", "out": "dst.jpg"}, ...],
   "area": "bottom" | "all"}

Writes JSON lines to stdout:
  {"status": "..."}                                  — progress text
  {"scanning": "path/to/img.png"}                    — about to process
  {"done": "src", "out": "dst", "ok": true}          — subtitles removed
  {"done": "src", "ok": true, "changed": false}      — no text found, nothing written
  {"done": "src", "ok": false, "reason": "…"}        — failed, batch continues
  {"summary": {"written": n, "skipped": n, "failed": n}}
  {"error": "message"}                               — fatal failure

Text is located with imgutils' PP-OCR detector (the same ONNX/HuggingFace stack
as the other helpers) and painted out with LaMa fine-tuned on manga — the model
manga-translation tools use for exactly this job. A classical cv2.inpaint was
tried first and leaves obvious smears on drawn backgrounds; LaMa reconstructs
belts, folds and foliage convincingly.

Only a band around the detected text is sent through LaMa, not the whole frame:
it is several times faster and guarantees every pixel away from the subtitle is
returned byte-identical.
"""
import os
import sys
import json

# Keep the protocol channel (real stdout) clean: any stray prints / progress
# bars from onnxruntime or huggingface must not corrupt our JSON lines.
_OUT = sys.stdout
sys.stdout = sys.stderr

LAMA_REPO = 'ogkalu/lama-manga-onnx-dynamic'
LAMA_FILE = 'lama-manga-dynamic.onnx'

# Subtitles sit in the lower part of the frame. Restricting to it keeps signs,
# titles and other in-scene lettering from being painted out too.
BOTTOM_FROM = float(os.environ.get('SUB_BOTTOM_FROM', '0.62'))

# The detector will happily call a face or a head of hair "text". Measured on
# real frames: a genuine subtitle line scored 0.90 and was 3.3x wider than tall
# at 7% of the frame height, while false positives scored 0.72-0.74 and were
# near-square at ~32%. Each of these three tests rejects them on its own.
MIN_SCORE = float(os.environ.get('SUB_MIN_SCORE', '0.80'))
MIN_ASPECT = float(os.environ.get('SUB_MIN_ASPECT', '1.6'))
MAX_HEIGHT_FRAC = float(os.environ.get('SUB_MAX_HEIGHT', '0.25'))

# A subtitle line spans a real share of the frame; a stray two-character hit
# does not.
MIN_WIDTH_FRAC = float(os.environ.get('SUB_MIN_WIDTH', '0.06'))

# Padding around a detected box, as a share of its own size, so the text's
# outline and antialiasing fall inside the area handed to the inpainter.
PAD_X = float(os.environ.get('SUB_PAD_X', '0.03'))
PAD_Y = float(os.environ.get('SUB_PAD_Y', '0.18'))
PAD_MIN = int(os.environ.get('SUB_PAD_MIN', '8'))

# Context handed to LaMa around the text so it has something to continue from.
CONTEXT_PX = int(os.environ.get('SUB_CONTEXT', '192'))

# ── Patching from a neighbouring frame ────────────────────────────────────
# Frames from the same shot hold the real pixels the subtitle is covering, so
# borrowing them beats asking a model to imagine them. The donor does not have
# to match exactly — the character may have moved — it only has to be the same
# shot, which is what the ring test measures.
#
# Ring MAE, measured on real frames: a genuinely similar frame scored 17.9,
# while unrelated scenes scored 46.5, 74.6 and 77.6.
REF_RING_MAX = float(os.environ.get('SUB_REF_RING_MAX', '30.0'))
REF_RING_PX = int(os.environ.get('SUB_REF_RING', '40'))
MAX_REFS = int(os.environ.get('SUB_MAX_REFS', '6'))


def emit(obj):
    _OUT.write(json.dumps(obj) + '\n')
    _OUT.flush()


class ModelUnavailable(Exception):
    """Detector or inpainter could not be loaded (not installed / no network on first run)."""


def save_as(img, path, ext):
    """Write in the format the caller asked for by naming the file that way."""
    ext = (ext or '').lower()
    if ext in ('.jpg', '.jpeg'):
        img.convert('RGB').save(path, 'JPEG', quality=95, subsampling=0)
    elif ext == '.webp':
        img.save(path, 'WEBP', quality=95)
    else:
        img.save(path, 'PNG')


def align_to(src_rgb, ref_rgb, mask):
    """Shift the reference so it lines up with the source.

    The offset is measured with everything but the subtitle contributing, so
    the text itself cannot drag the alignment around.
    """
    import numpy as np
    import cv2

    grey_src = cv2.cvtColor(src_rgb, cv2.COLOR_RGB2GRAY).astype(np.float32)
    grey_ref = cv2.cvtColor(ref_rgb, cv2.COLOR_RGB2GRAY).astype(np.float32)
    keep = (~mask).astype(np.float32)
    (dx, dy), _response = cv2.phaseCorrelate(grey_src * keep, grey_ref * keep)
    if abs(dx) < 0.25 and abs(dy) < 0.25:
        return ref_rgb
    shift = np.float32([[1, 0, -dx], [0, 1, -dy]])
    return cv2.warpAffine(ref_rgb, shift, (src_rgb.shape[1], src_rgb.shape[0]),
                          flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


def patch_from(src_rgb, donor_rgb, mask):
    """Drop the donor's pixels into the masked area and hide the seam.

    Poisson blending carries the donor's texture while taking its levels from
    the surrounding destination, so a donor that is merely similar still lands
    convincingly. It needs room around the mask, so a subtitle sitting hard
    against the frame edge falls back to a level-matched feather.
    """
    import numpy as np
    import cv2
    from scipy import ndimage

    h, w = src_rgb.shape[:2]
    solid = (ndimage.binary_dilation(mask, iterations=2) * 255).astype(np.uint8)
    ys, xs = np.where(solid > 0)
    pad = 4
    if ys.min() >= pad and xs.min() >= pad and ys.max() < h - pad and xs.max() < w - pad:
        centre = (int((xs.min() + xs.max()) / 2), int((ys.min() + ys.max()) / 2))
        try:
            return cv2.seamlessClone(donor_rgb, src_rgb, solid, centre, cv2.NORMAL_CLONE)
        except cv2.error:
            pass

    ring = ndimage.binary_dilation(mask, iterations=25) & ~mask
    offset = src_rgb[ring].astype(np.float32).mean(0) - donor_rgb[ring].astype(np.float32).mean(0)
    levelled = np.clip(donor_rgb.astype(np.float32) + offset, 0, 255)
    soft = ndimage.gaussian_filter(mask.astype(np.float32), 3.0)[..., None]
    return (levelled * soft + src_rgb.astype(np.float32) * (1.0 - soft) + 0.5).astype(np.uint8)


def load_inpainter():
    """Return inpaint(rgb_uint8, mask_bool) -> rgb_uint8, or raise."""
    import numpy as np
    import onnxruntime as ort
    from huggingface_hub import hf_hub_download

    path = hf_hub_download(LAMA_REPO, LAMA_FILE)
    options = ort.SessionOptions()
    options.log_severity_level = 3
    session = ort.InferenceSession(path, options, providers=['CPUExecutionProvider'])
    img_in, mask_in = (i.name for i in session.get_inputs())

    def pad8(a):
        ph = (8 - a.shape[0] % 8) % 8
        pw = (8 - a.shape[1] % 8) % 8
        pad = ((0, ph), (0, pw)) + ((0, 0),) * (a.ndim - 2)
        return np.pad(a, pad, mode='reflect')

    def inpaint(rgb, mask):
        h, w = rgb.shape[:2]
        x = pad8(rgb.astype(np.float32) / 255.0).transpose(2, 0, 1)[None]
        m = pad8(mask.astype(np.float32))[None, None]
        out = session.run(None, {img_in: x, mask_in: (m > 0).astype(np.float32)})[0]
        res = out[0].transpose(1, 2, 0)
        if res.max() > 1.5:
            res = res / 255.0
        return (np.clip(res, 0.0, 1.0)[:h, :w] * 255.0 + 0.5).astype(np.uint8)

    return inpaint


def run(jobs, area, fill):
    try:
        import numpy as np
        from PIL import Image
        from scipy import ndimage
        from imgutils.ocr import detect_text_with_ocr
    except Exception as e:
        raise ModelUnavailable(str(e))

    bottom_only = area != 'all'
    use_refs = fill != 'ai'

    emit({'status': 'Loading models (first run may download)…'})
    # The inpainter is only needed for frames with no usable neighbour, but the
    # batch is loaded once up front rather than stalling mid-run.
    inpaint = load_inpainter()
    emit({'status': 'Removing subtitles…'})

    def text_mask(img):
        """Bool mask covering the subtitle boxes, or None when there is no text.

        The whole detected box is masked rather than the glyphs inside it. An
        earlier version tried to isolate glyphs by luminance — bright core, dark
        stroke — and it broke on the first real fansub: yellow lettering sits at
        grey ~167 so it missed the text entirely, while the dark shelf behind it
        matched the stroke rule and swamped the mask. Box masking does not care
        what colour the text is or what is behind it, and filling a solid band
        is what the manga LaMa was trained for.
        """
        w, h = img.size

        def looks_like_a_subtitle(box, score):
            x0, y0, x1, y1 = box
            bw, bh = x1 - x0, y1 - y0
            if bw <= 0 or bh <= 0:
                return False
            if score < MIN_SCORE:
                return False
            if bw / bh < MIN_ASPECT:
                return False
            if bh > MAX_HEIGHT_FRAC * h:
                return False
            if bw < MIN_WIDTH_FRAC * w:
                return False
            if bottom_only and (y0 + y1) / 2 < BOTTOM_FROM * h:
                return False
            return True

        boxes = [b for b in detect_text_with_ocr(img) if looks_like_a_subtitle(b[0], b[2])]
        if not boxes:
            return None, None

        mask = np.zeros((h, w), bool)
        x0s, y0s, x1s, y1s = [], [], [], []
        for (x0, y0, x1, y1), _label, _score in boxes:
            px = int(PAD_X * (x1 - x0)) + PAD_MIN
            py = int(PAD_Y * (y1 - y0)) + PAD_MIN
            a0, b0 = max(0, x0 - px), max(0, y0 - py)
            a1, b1 = min(w, x1 + px), min(h, y1 + py)
            mask[b0:b1, a0:a1] = True
            x0s.append(a0); y0s.append(b0); x1s.append(a1); y1s.append(b1)

        region = (min(x0s), min(y0s), max(x1s), max(y1s))
        return mask, region

    def find_donor(rgb, mask, region, ref_paths):
        """Best neighbouring frame to lift the covered pixels from, or None.

        Candidates are ranked by how well the area *around* the subtitle
        matches once aligned — that is what says "same shot". The winner is
        then checked for text of its own, so one subtitle never gets patched
        in over another.
        """
        ring = ndimage.binary_dilation(mask, iterations=REF_RING_PX) & ~mask
        src = rgb.astype(np.float32)
        scored = []
        for ref_path in ref_paths[:MAX_REFS]:
            try:
                with Image.open(ref_path) as rim:
                    ref = np.asarray(rim.convert('RGB'))
            except Exception:
                continue
            if ref.shape != rgb.shape:
                continue
            aligned = align_to(rgb, ref, mask)
            score = float(np.abs(src[ring] - aligned[ring].astype(np.float32)).mean())
            if score <= REF_RING_MAX:
                scored.append((score, ref_path, aligned))

        for score, ref_path, aligned in sorted(scored, key=lambda s: s[0]):
            x0, y0, x1, y1 = region
            patch_img = Image.fromarray(aligned[y0:y1, x0:x1])
            try:
                if any(d[2] >= MIN_SCORE for d in detect_text_with_ocr(patch_img)):
                    continue          # this neighbour has lettering there too
            except Exception:
                continue
            return aligned, ref_path, score
        return None, None, None

    def strip(src_path, out_path, ref_paths):
        with Image.open(src_path) as im:
            img = im.convert('RGB')
            mask, region = text_mask(img)
            if mask is None:
                return None

            rgb = np.asarray(img)
            h, w = rgb.shape[:2]

            if use_refs and ref_paths:
                donor, _ref_path, _score = find_donor(rgb, mask, region, ref_paths)
                if donor is not None:
                    out = patch_from(rgb, donor, mask)
                    tmp_path = out_path + '.part'
                    save_as(Image.fromarray(out), tmp_path, os.path.splitext(out_path)[1])
                    os.replace(tmp_path, out_path)
                    return 'reference'
            # Only the band around the text goes through the model; everything
            # outside it is returned exactly as it came in.
            x0 = max(0, region[0] - CONTEXT_PX)
            y0 = max(0, region[1] - CONTEXT_PX)
            x1 = min(w, region[2] + CONTEXT_PX)
            y1 = min(h, region[3] + CONTEXT_PX)

            filled = inpaint(rgb[y0:y1, x0:x1], mask[y0:y1, x0:x1])

            # Feather the seam so the repaired area does not show an edge.
            soft = ndimage.gaussian_filter(mask[y0:y1, x0:x1].astype(np.float32), 1.5)[..., None]
            out = rgb.copy()
            out[y0:y1, x0:x1] = (filled * soft + rgb[y0:y1, x0:x1] * (1.0 - soft) + 0.5).astype(np.uint8)

            tmp_path = out_path + '.part'
            save_as(Image.fromarray(out), tmp_path, os.path.splitext(out_path)[1])
        os.replace(tmp_path, out_path)
        return 'ai'

    written = from_ref = skipped = failed = 0
    for job in jobs:
        src = str(job['in'])
        out = str(job['out'])
        refs = [str(r) for r in job.get('refs', [])]
        emit({'scanning': src})
        try:
            via = strip(src, out, refs)
        except Exception as e:
            failed += 1
            try:
                os.unlink(out + '.part')
            except OSError:
                pass
            emit({'done': src, 'ok': False, 'reason': str(e)})
            continue
        if via:
            written += 1
            if via == 'reference':
                from_ref += 1
            emit({'done': src, 'out': out, 'ok': True, 'changed': True, 'via': via})
        else:
            skipped += 1
            emit({'done': src, 'ok': True, 'changed': False})

    emit({'summary': {'written': written, 'fromRef': from_ref, 'skipped': skipped, 'failed': failed}})


def main():
    try:
        args = json.loads(sys.stdin.read())
        jobs = args['jobs']
        area = args.get('area', 'bottom')
        fill = args.get('fill', 'reference')
    except Exception as e:
        emit({'error': f'bad input: {e}'})
        sys.exit(1)

    try:
        run(jobs, area, fill)
    except (ImportError, ModelUnavailable) as e:
        emit({'error': f'subtitle removal unavailable: {e}'})
        sys.exit(1)
    except Exception as e:
        emit({'error': str(e)})
        sys.exit(1)


if __name__ == '__main__':
    main()
