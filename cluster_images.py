#!/usr/bin/env python3
"""
Cluster images by visual content using CLIP embeddings + KMeans.

Reads JSON from stdin:
  {"imagePaths": [...], "numClusters": null | int}
  (numClusters null → auto = max(3, min(round(N/12), 30)))

Writes JSON lines to stdout:
  {"status": "..."}
  {"scanning": "path"}
  {"result": {
      "clusters":     {"path": clusterId, ...},   # 0-indexed cluster IDs
      "clusterOrder": [clusterId, ...],           # cluster IDs sorted by size desc
      "stats": {"numImages": N, "numClusters": K,
                "sizes": {clusterId: count, ...}}
   }}
  {"error": "..."}
"""
import sys
import json
import random

_OUT = sys.stdout
sys.stdout = sys.stderr


def emit(obj):
    _OUT.write(json.dumps(obj) + '\n')
    _OUT.flush()


def auto_k(n):
    return max(3, min(round(n / 12), 30))


def kmeans_numpy(X, k, max_iter=50, seed=42):
    """
    Simple KMeans (k-means++ init) in NumPy. No sklearn dependency.
    X: (N, D) float32 (assumed already L2-normalized so Euclidean ≈ cosine).
    Returns labels: (N,) int32.
    """
    import numpy as np
    rng = np.random.default_rng(seed)
    n, d = X.shape
    if k >= n:
        return np.arange(n, dtype=np.int32)

    # k-means++ init
    centers = np.empty((k, d), dtype=X.dtype)
    idx0 = int(rng.integers(0, n))
    centers[0] = X[idx0]
    closest_sq = np.sum((X - centers[0]) ** 2, axis=1)
    for i in range(1, k):
        probs = closest_sq / (closest_sq.sum() + 1e-12)
        idx = int(rng.choice(n, p=probs))
        centers[i] = X[idx]
        new_sq = np.sum((X - centers[i]) ** 2, axis=1)
        closest_sq = np.minimum(closest_sq, new_sq)

    labels = np.zeros(n, dtype=np.int32)
    for it in range(max_iter):
        # assign
        d2 = ((X[:, None, :] - centers[None, :, :]) ** 2).sum(axis=2)
        new_labels = d2.argmin(axis=1).astype(np.int32)
        if it > 0 and np.array_equal(new_labels, labels):
            break
        labels = new_labels
        # update
        for c in range(k):
            mask = labels == c
            if mask.any():
                centers[c] = X[mask].mean(axis=0)
            else:
                # re-seed empty cluster to farthest point
                d_all = ((X - centers[c]) ** 2).sum(axis=1)
                centers[c] = X[d_all.argmax()]
    return labels


def run(image_paths, num_clusters):
    from PIL import Image
    import torch
    import open_clip
    import numpy as np

    n = len(image_paths)
    if n == 0:
        emit({'result': {'clusters': {}, 'clusterOrder': [],
                         'stats': {'numImages': 0, 'numClusters': 0, 'sizes': {}}}})
        return

    k = int(num_clusters) if isinstance(num_clusters, int) and num_clusters > 0 else auto_k(n)
    k = max(1, min(k, n))

    emit({'status': f'Loading CLIP model (first run may download ~150MB)…'})
    model, _, preprocess = open_clip.create_model_and_transforms('ViT-B-32', pretrained='openai')
    model.eval()

    emit({'status': f'Embedding {n} images…'})
    feats = np.zeros((n, 512), dtype=np.float32)
    valid_mask = np.zeros(n, dtype=bool)

    for i, p in enumerate(image_paths):
        emit({'scanning': str(p)})
        try:
            with Image.open(p) as pil:
                x = preprocess(pil.convert('RGB')).unsqueeze(0)
            with torch.no_grad():
                f = model.encode_image(x)
                f = f / (f.norm(dim=-1, keepdim=True) + 1e-9)
            feats[i] = f.squeeze(0).cpu().numpy().astype(np.float32)
            valid_mask[i] = True
        except Exception:
            pass  # keep zero feature; will still be clustered but arbitrarily

    emit({'status': f'Clustering into {k} groups…'})

    # Cluster only valid features to avoid junk influencing centroids.
    valid_idx = np.where(valid_mask)[0]
    if len(valid_idx) == 0:
        emit({'error': 'No images could be embedded (all failed to open).'})
        return

    valid_feats = feats[valid_idx]
    eff_k = max(1, min(k, len(valid_idx)))
    labels = kmeans_numpy(valid_feats, eff_k)

    # Renumber clusters by size desc → cluster 0 is largest.
    sizes = {}
    for c in labels:
        sizes[int(c)] = sizes.get(int(c), 0) + 1
    order = sorted(sizes.keys(), key=lambda c: -sizes[c])
    remap = {c: new for new, c in enumerate(order)}
    remapped = np.array([remap[int(c)] for c in labels], dtype=np.int32)

    clusters = {}
    for local_i, global_i in enumerate(valid_idx):
        clusters[str(image_paths[global_i])] = int(remapped[local_i])
    # Assign failed images to a special "unclustered" bucket = eff_k (last).
    unclustered_id = eff_k
    for i in range(n):
        if not valid_mask[i]:
            clusters[str(image_paths[i])] = unclustered_id

    final_sizes = {}
    for cid in clusters.values():
        final_sizes[cid] = final_sizes.get(cid, 0) + 1

    cluster_order = sorted(final_sizes.keys(), key=lambda c: (c == unclustered_id, -final_sizes[c]))

    emit({'result': {
        'clusters':     clusters,
        'clusterOrder': cluster_order,
        'stats': {
            'numImages':   n,
            'numClusters': eff_k + (1 if unclustered_id in final_sizes else 0),
            'sizes':       {str(k_): v for k_, v in final_sizes.items()},
        },
    }})


def preflight():
    missing = []
    for mod in ('PIL', 'numpy', 'torch', 'open_clip'):
        try:
            __import__(mod)
        except ImportError:
            missing.append(mod)
    if missing:
        pkg_names = {'PIL': 'Pillow', 'open_clip': 'open_clip_torch'}
        pip_names = [pkg_names.get(m, m) for m in missing]
        emit({'error': (
            f"Missing Python dependencies: {', '.join(missing)}.\n"
            "Open Terminal and run:\n"
            f"    python3 -m pip install --user {' '.join(pip_names)}\n"
            "Then try Cluster again. (torch is a large download, ~1GB.)"
        )})
        sys.exit(1)


def main():
    preflight()
    try:
        args = json.loads(sys.stdin.read())
        image_paths = args.get('imagePaths', [])
        num_clusters = args.get('numClusters', None)
    except Exception as e:
        emit({'error': f'bad input: {e}'})
        sys.exit(1)

    try:
        run(image_paths, num_clusters)
    except Exception as e:
        emit({'error': str(e)})
        sys.exit(1)


if __name__ == '__main__':
    main()
