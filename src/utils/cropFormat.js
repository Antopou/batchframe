// Node-side counterpart to utils/imageFormat.js, shared by the local and Drive
// save paths so they can never disagree about what a crop should be called.
//
// The extension follows the mime the renderer actually produced, not the
// original's — a canvas that could not encode webp/bmp/gif hands back PNG, and
// the file has to be named for what it really is. When the format did survive
// the round trip the original spelling is kept, so a `.jpeg` stays `.jpeg`.

const PATTERNS = {
  jpeg: [/^\.jpe?g$/i, '.jpg'],
  webp: [/^\.webp$/i, '.webp'],
  png: [/^\.png$/i, '.png'],
};

// mime: the bare subtype from a data: URL ("png", "jpeg", "webp").
function extForMime(mime, origExt) {
  const [matches, fallback] = PATTERNS[String(mime).toLowerCase()] || PATTERNS.png;
  return matches.test(origExt || '') ? origExt : fallback;
}

module.exports = { extForMime };
