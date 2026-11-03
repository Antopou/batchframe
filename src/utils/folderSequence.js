// Numbered folder runs — "[Group] Show - 01 [1080p]", "… - 02 …" and so on.
//
// The number that counts is the one that varies between sibling names, not
// whichever comes last — in "[Group] Show - 07 [1080p]" the siblings differ at
// 07 while 1080 stays put. That number drives the prev/next step (only folders
// that actually exist are offered) and the number shown on folder tiles.

// Per-release noise that differs between otherwise matching names: a version
// tag straight after the number ("07v2") and a bracketed CRC ("[A1B2C3D4]").
function tailKey(text) {
  return text
    .replace(/^v\d+/i, '')
    .replace(/\s*[[(][0-9a-f]{8}[\])]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Every number in a name, with the text either side of it.
function runsOf(name) {
  return [...name.matchAll(/\d+/g)].map((m) => ({
    digits: m[0],
    value: parseInt(m[0], 10),
    head: name.slice(0, m.index).toLowerCase(),
    tail: tailKey(name.slice(m.index + m[0].length)),
  }));
}

// Every number in every name, keyed by the text before it: names that share a
// key carry a number in the same spot.
function indexRuns(items) {
  const byHead = new Map();
  for (const item of items) {
    for (const run of runsOf(item.name)) {
      if (!byHead.has(run.head)) byHead.set(run.head, []);
      byHead.get(run.head).push({ ...run, item });
    }
  }
  return byHead;
}

// Each number in `name`, with the siblings that carry a different number in
// the same spot. A sibling whose text after the number differs as well (a
// format change mid-season, an episode title) still counts when the text
// before it names something — a bare leading number would tie "03" to
// "2024 trip".
function numberSlots(name, byHead) {
  return runsOf(name).map((run) => {
    const looseOk = /\p{L}/u.test(run.head);
    const matches = [];
    for (const other of byHead.get(run.head) || []) {
      if (other.item.name === name || other.value === run.value) continue;
      const exact = other.tail === run.tail;
      if (exact || looseOk) {
        matches.push({ ...other.item, value: other.value, width: other.digits.length, exact });
      }
    }
    return { ...run, matches };
  });
}

// The slot whose number takes the most values is the sequence (episode beats
// season), judged on exact matches first. A tie goes to the smaller step —
// episodes count by one, resolutions and years jump — then the rightmost.
function pickSlot(slots) {
  let best = null;
  for (const keep of [(e) => e.exact, () => true]) {
    for (const slot of slots) {
      const kept = slot.matches.filter(keep);
      if (!kept.length) continue;
      const count = new Set(kept.map((e) => e.value)).size;
      const step = Math.min(...kept.map((e) => Math.abs(e.value - slot.value)));
      if (!best || count > best.count || (count === best.count && step <= best.step)) {
        best = { slot, count, step };
      }
    }
    if (best) break;
  }
  return best ? best.slot : null;
}

// name: this folder's own name; siblings: [{ name, path }] from its parent
// (this folder included or not). → { prev, next }, each { name, path } or null.
export function findSequenceNeighbours(name, siblings) {
  if (!name || !siblings?.length) return { prev: null, next: null };
  const slot = pickSlot(numberSlots(name, indexRuns(siblings)));
  if (!slot) return { prev: null, next: null };

  // Nearest existing number either side; on equal numbers an exact match wins,
  // then the same zero-padding.
  const { value, digits, matches } = slot;
  const rank = (e) => (e.exact ? 0 : 2) + (e.width === digits.length ? 0 : 1);
  const sorted = [...matches].sort((a, b) => a.value - b.value || rank(a) - rank(b)
    || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const next = sorted.find((e) => e.value > value);
  const below = sorted.filter((e) => e.value < value);
  const prevValue = below.length ? below[below.length - 1].value : null;
  const prev = below.find((e) => e.value === prevValue);
  const pick = (e) => (e ? { name: e.name, path: e.path } : null);
  return { prev: pick(prev), next: pick(next) };
}

// A folder outside any run: its last number outside brackets, so a release tag
// like "[1080p]" or a year in "(2021)" doesn't count, and "07v2" reads 07.
function plainNumber(name) {
  const plain = name.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/(\d)v\d+/gi, '$1');
  const all = plain.match(/\d+/g);
  return all ? all[all.length - 1] : null;
}

// folders: the subfolders of one folder, [{ name, path }]. → Map(path → the
// number to show on its tile, as written: "07"); folders without one are left out.
export function sequenceNumbers(folders) {
  const numbers = new Map();
  if (!folders?.length) return numbers;
  const byHead = indexRuns(folders);
  for (const f of folders) {
    const slot = pickSlot(numberSlots(f.name, byHead));
    const digits = slot ? slot.digits : plainNumber(f.name);
    if (digits) numbers.set(f.path, digits);
  }
  return numbers;
}
