// Turn a detected head/face box into a crop rectangle for smart-cropping.
//
// The detector (ai_detect.py) returns the largest head/face as a box in
// normalised fractions of the natural image: [x, y, w, h]. Given a target
// aspect ratio we build the crop rect (also fractions) that contains the head
// plus some padding, matches the aspect, is centered on the head (biased
// slightly upward for portraits), and stays inside the image.

// Crop aspect presets. ratio = width / height in pixels; null = free-form.
// Shared by the crop modal, the batch auto-crop modal, and the detector wiring.
export const ASPECT_PRESETS = [
  { key: 'free', label: 'Free', ratio: null },
  { key: 'original', label: 'Original', ratio: 'original' },
  { key: '1:1', label: '1:1', ratio: 1 },
  { key: '9:16', label: '9:16', ratio: 9 / 16 },
  { key: '16:9', label: '16:9', ratio: 16 / 9 },
  { key: '4:5', label: '4:5', ratio: 4 / 5 },
  { key: '5:4', label: '5:4', ratio: 5 / 4 },
  { key: '3:4', label: '3:4', ratio: 3 / 4 },
  { key: '4:3', label: '4:3', ratio: 4 / 3 },
  { key: '2:3', label: '2:3', ratio: 2 / 3 },
  { key: '3:2', label: '3:2', ratio: 3 / 2 },
  { key: '5:7', label: '5:7', ratio: 5 / 7 },
  { key: '7:5', label: '7:5', ratio: 7 / 5 },
  { key: '1:2', label: '1:2', ratio: 1 / 2 },
  { key: '2:1', label: '2:1', ratio: 2 / 1 },
];

// How much of the frame the head fills: the padded head is PAD× the head box.
// Higher = more zoomed out (more body/background around the head).
export const DEFAULT_PAD = 1.8;
// Fraction the crop is shifted up so the head sits above dead-center. 0 = the
// head is vertically centered; 0.5 would push it to the very top.
export const DEFAULT_HEADROOM = 0.1;

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * @param {Object}  args
 * @param {number[]} args.box     - [x, y, w, h] fractions (0..1) of the head/face
 * @param {number|null} args.ratio - target aspect w/h in pixels; null = free
 * @param {number}  args.natW     - natural image width in px
 * @param {number}  args.natH     - natural image height in px
 * @param {number} [args.pad]     - padding factor around the head
 * @param {number} [args.headroom]- upward bias (0..0.5)
 * @returns {{x:number,y:number,w:number,h:number}} crop rect as 0..1 fractions
 */
export function boxToCropRect({ box, ratio, natW, natH, pad = DEFAULT_PAD, headroom = DEFAULT_HEADROOM }) {
  const [bx, by, bw, bh] = box;
  // Head center + size in pixels.
  const cx = (bx + bw / 2) * natW;
  const cy = (by + bh / 2) * natH;
  const hw = bw * natW;
  const hh = bh * natH;

  // Base crop = padded head box (in px).
  const baseW = hw * pad;
  const baseH = hh * pad;

  // Fit to aspect: grow the deficient side so the padded head always fits.
  let cropW;
  let cropH;
  let targetRatio = ratio === 'original' ? (natW / natH) : ratio;
  if (targetRatio) {
    cropH = Math.max(baseH, baseW / targetRatio);
    cropW = cropH * targetRatio;
  } else {
    cropW = baseW;
    cropH = baseH;
  }

  // Don't exceed the image; if we do, shrink to fit at the same aspect.
  if (cropW > natW) {
    cropW = natW;
    cropH = targetRatio ? cropW / targetRatio : cropH * (natW / (cropW || 1));
  }
  if (cropH > natH) {
    cropH = natH;
    cropW = targetRatio ? cropH * targetRatio : cropW * (natH / (cropH || 1));
    if (cropW > natW) cropW = natW; // free crop on a very wide image
  }

  // Center on the head, biased upward by `headroom`.
  let x = cx - cropW / 2;
  let y = cy - cropH * (0.5 - headroom);

  // Keep the crop inside the image.
  x = Math.max(0, Math.min(natW - cropW, x));
  y = Math.max(0, Math.min(natH - cropH, y));

  return {
    x: clamp01(x / natW),
    y: clamp01(y / natH),
    w: clamp01(cropW / natW),
    h: clamp01(cropH / natH),
  };
}
