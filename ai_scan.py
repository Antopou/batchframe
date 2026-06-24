#!/usr/bin/env python3
"""
Reads JSON from stdin:
  {"imagePaths": [...], "characters": [{"name": "Nami", "folder": "/path/to/refs/Nami"}, ...]}

Writes JSON lines to stdout:
  {"status": "..."}                                          — progress text
  {"scanning": "path/to/img.png"}                           — about to process
  {"done": "path", "score": 0.82, "character": "Nami"}     — best match for this image
  {"scores": {"path": {"score": 0.82, "character": "Nami"}, ...}}  — final summary
  {"error": "message"}                                       — on failure
"""
import sys
import json
from pathlib import Path


def main():
    try:
        args = json.loads(sys.stdin.read())
        image_paths = args['imagePaths']
        characters  = args['characters']  # [{'name': ..., 'folder': ...}]

        import torch
        import open_clip
        from PIL import Image

        print(json.dumps({'status': 'Loading CLIP model…'}), flush=True)
        model, _, preprocess = open_clip.create_model_and_transforms('ViT-B-32', pretrained='openai')
        model.eval()

        def embed(p):
            img = preprocess(Image.open(p).convert('RGB')).unsqueeze(0)
            with torch.no_grad():
                f = model.encode_image(img)
            return f / f.norm(dim=-1, keepdim=True)

        # Load and embed refs per character
        char_refs = {}
        for ch in characters:
            folder = Path(ch['folder'])
            paths  = [p for ext in ('*.png', '*.jpg', '*.jpeg', '*.webp') for p in folder.glob(ext)]
            if not paths:
                continue
            print(json.dumps({'status': f'Embedding {ch["name"]} ({len(paths)} refs)…'}), flush=True)
            char_refs[ch['name']] = [embed(p) for p in paths]

        if not char_refs:
            print(json.dumps({'error': 'No reference images found for any character'}), flush=True)
            return

        print(json.dumps({'status': 'Scanning…'}), flush=True)

        results = {}
        for p in image_paths:
            print(json.dumps({'scanning': str(p)}), flush=True)
            try:
                emb = embed(p)
                best_score = -1.0
                best_char  = next(iter(char_refs))
                for char_name, refs in char_refs.items():
                    score = max(float((emb * r).sum()) for r in refs)
                    if score > best_score:
                        best_score = score
                        best_char  = char_name
                entry = {'score': round(best_score, 4), 'character': best_char}
                results[str(p)] = entry
            except Exception:
                entry = None
                results[str(p)] = None
            score_val = entry['score'] if entry else None
            char_val  = entry['character'] if entry else None
            print(json.dumps({'done': str(p), 'score': score_val, 'character': char_val}), flush=True)

        print(json.dumps({'scores': results}), flush=True)

    except Exception as e:
        print(json.dumps({'error': str(e)}), flush=True)
        sys.exit(1)


if __name__ == '__main__':
    main()
