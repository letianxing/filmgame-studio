"""Repack verified HF-style UMT5 safetensors for mlx-video, streaming tensor bytes.
Only tensor names/container offsets change; no numerical weight conversion or model loading.
"""
import argparse, hashlib, json, re, shutil, struct
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--output',required=True);a=p.parse_args()
source=Path(a.input);target=Path(a.output);target.parent.mkdir(parents=True,exist_ok=True)
if target.exists():raise RuntimeError('Refusing to replace existing encoder')
if shutil.disk_usage(target.parent).free<source.stat().st_size+20*1024**3:raise RuntimeError('Insufficient disk reserve')
with source.open('rb') as f:
 n=struct.unpack('<Q',f.read(8))[0]
 if n>8*1024**2:raise ValueError('Oversized safetensors header')
 header=json.loads(f.read(n));base=8+n

def rename(key):
 if key=='shared.weight':return 'token_embedding.weight'
 if key=='encoder.final_layer_norm.weight':return 'norm.weight'
 match=re.fullmatch(r'encoder.block.(\d+).layer.([01]).(.+)',key)
 if not match:raise ValueError(f'Unknown encoder tensor: {key}')
 i,layer,tail=match.groups();prefix=f'blocks.{i}.'
 names={'SelfAttention.q.weight':'attn.q.weight','SelfAttention.k.weight':'attn.k.weight','SelfAttention.v.weight':'attn.v.weight','SelfAttention.o.weight':'attn.o.weight','SelfAttention.relative_attention_bias.weight':'pos_embedding.embedding.weight','DenseReluDense.wi_0.weight':'ffn.gate_proj.weight','DenseReluDense.wi_1.weight':'ffn.fc1.weight','DenseReluDense.wo.weight':'ffn.fc2.weight'}
 if tail=='layer_norm.weight':return prefix+('norm1.weight' if layer=='0' else 'norm2.weight')
 if tail not in names:raise ValueError(f'Unknown encoder sublayer: {key}')
 return prefix+names[tail]

rows=sorted(((k,v) for k,v in header.items() if k not in ['__metadata__','spiece_model']),key=lambda row:row[1]['data_offsets'][0])
converted={};offset=0
for key,value in rows:
 name=rename(key)
 if name in converted:raise ValueError('Duplicate mapped tensor')
 if value['dtype']!='F16':raise ValueError('Unexpected source dtype')
 begin,end=value['data_offsets'];converted[name]={**value,'data_offsets':[offset,offset+end-begin]};offset+=end-begin
assert len(converted)==242 and converted['token_embedding.weight']['shape']==[256384,4096]
encoded=json.dumps(converted,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%8)
partial=target.with_suffix('.partial')
with source.open('rb') as src,partial.open('wb') as out:
 out.write(struct.pack('<Q',len(encoded)));out.write(encoded)
 for _,value in rows:
  start,stop=value['data_offsets'];src.seek(base+start);remaining=stop-start
  while remaining:
   block=src.read(min(4*1024**2,remaining))
   if not block:raise EOFError('Truncated source tensor')
   out.write(block);remaining-=len(block)
partial.replace(target)
with target.open('rb') as f:digest=hashlib.file_digest(f,'sha256').hexdigest()
target.with_suffix('.conversion.json').write_text(json.dumps({'source':str(source),'sourceFormat':'Comfy-Org HF UMT5 FP16','targetFormat':'mlx-video T5Encoder','tensorCount':len(converted),'numericalWeightsChanged':False,'omitted':'spiece_model tokenizer payload (tokenizer is provisioned separately)','sha256':digest,'bytes':target.stat().st_size},indent=2))
print(json.dumps({'tensorCount':len(converted),'bytes':target.stat().st_size,'sha256':digest}))
