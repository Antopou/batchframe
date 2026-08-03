// Encoding a crop back into the format it came from.
//
// A crop should not silently change a file's type: re-encoding a .webp as .png
// inflates it several times over and, because the save path takes the
// original's slot, the original is removed in the process.

// Formats a <canvas> can actually produce. Chromium quietly falls back to PNG
// for anything else (bmp, gif), which the save side detects from the data URL's
// own mime — so the written extension always matches the real bytes.
const CANVAS_MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  png: 'image/png',
};

const QUALITY = 0.95;

export function canvasMimeFor(fileName) {
  const ext = (fileName || '').toLowerCase().split('.').pop();
  return CANVAS_MIME[ext] || 'image/png';
}

// Encode a canvas as a data URL in the source file's format. PNG ignores the
// quality argument, so it is safe to always pass.
export function encodeCanvas(canvas, fileName) {
  return canvas.toDataURL(canvasMimeFor(fileName), QUALITY);
}
