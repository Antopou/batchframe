import json
import subprocess

p = subprocess.Popen(["python3", "ai_duplicates.py"], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
out, _ = p.communicate(json.dumps({"imagePaths": ["test1.jpg", "test2.jpg"]}).encode())
print(out.decode())
