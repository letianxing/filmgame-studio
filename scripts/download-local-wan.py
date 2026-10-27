"""Serial, resumable, bounded-memory Wan downloads from pinned registry URLs.

Uses urllib so macOS system proxy configuration is respected. No model code is run.
"""
import argparse, hashlib, json, os, shutil, time, urllib.request
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--model-root',required=True);p.add_argument('--registry',default='config/model-registry.json');p.add_argument('--all-registry',action='store_true');a=p.parse_args()
root=Path(a.model_root).resolve();root.mkdir(parents=True,exist_ok=True)
registry=json.loads(Path(a.registry).read_text())
selected=[m['id'] for m in registry['models']] if a.all_registry else ['wan2-2-ti2v-5b','wan2-2-vae','wan-umt5-xxl-fp16']
for model_id in selected:
 m=next(x for x in registry['models'] if x['id']==model_id)
 target=(root/m['relativeModelPath']).resolve();target.relative_to(root);target.parent.mkdir(parents=True,exist_ok=True)
 expected=m['expectedBytes'];partial=target.with_suffix(target.suffix+'.partial')
 if target.exists():
  with target.open('rb') as f:actual=hashlib.file_digest(f,'sha256').hexdigest()
  if actual!=m['sha256']:raise RuntimeError(f'{model_id}: existing weight hash mismatch; refusing overwrite')
  print(f'{model_id}: already verified',flush=True);continue
 if shutil.disk_usage(root).free < expected-(partial.stat().st_size if partial.exists() else 0)+20*1024**3:raise RuntimeError('Keep at least20GiB free after this download')
 for attempt in range(1,9):
  offset=partial.stat().st_size if partial.exists() else 0
  if offset==expected:break
  if offset>expected:raise RuntimeError('Partial file exceeds expected size')
  try:
   request=urllib.request.Request(m['downloadUrl'],headers={'Range':f'bytes={offset}-','User-Agent':'FilmGameStudio-weight-download/1.0'})
   with urllib.request.urlopen(request,timeout=30) as response:
    if offset and (response.status!=206 or not response.headers.get('Content-Range','').startswith(f'bytes {offset}-')):raise RuntimeError('Server did not honor resume range')
    print(f'{model_id}: attempt{attempt}, resume {offset}/{expected}',flush=True)
    last=time.monotonic()
    with partial.open('ab') as f:
     while block:=response.read(4*1024**2):
      if offset+len(block)>expected:raise RuntimeError('Server sent oversized file')
      if shutil.disk_usage(root).free<20*1024**3:raise RuntimeError('Disk reserve reached')
      f.write(block);offset+=len(block)
      if time.monotonic()-last>20:print(f'{model_id}: {offset}/{expected} ({offset/expected:.1%})',flush=True);last=time.monotonic()
   if offset==expected:break
  except (OSError,urllib.error.URLError) as e:
   print(f'{model_id}: retryable {type(e).__name__}',flush=True);time.sleep(3)
 else:raise RuntimeError(f'{model_id}: retry limit; partial preserved')
 with partial.open('rb') as f:actual=hashlib.file_digest(f,'sha256').hexdigest()
 if actual!=m['sha256']:raise RuntimeError(f'{model_id}: hash mismatch, partial preserved')
 partial.replace(target);print(f'{model_id}: SHA256 verified, {expected} bytes',flush=True)
print('All selected weights verified',flush=True)
