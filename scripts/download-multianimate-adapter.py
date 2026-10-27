"""Stream only audited adapter tensor ranges into a safetensors file."""
import argparse,hashlib,json,math,shutil,struct,time,urllib.request,urllib.parse
from pathlib import Path


def plan(document):
    if document.get('status')!='ALL_HEADERS_INSPECTED':raise ValueError('Complete header audit required')
    revision=document['revision']
    if len(revision)!=40 or any(c not in '0123456789abcdef' for c in revision):raise ValueError('Pinned revision required')
    metadata={'__metadata__':{'source_repository':'N00B0DY/MultiAnimate','source_revision':revision}}
    segments=[];cursor=0
    for shard in document['shards']:
        for tensor in sorted(shard['selected'],key=lambda x:x['data_offsets'][0]):
            name=tensor['name'];start,end=tensor['data_offsets']
            if name in metadata or tensor['dtype']!='F32' or not tensor['shape'] or any(type(n)!=int or n<=0 for n in tensor['shape']):raise ValueError('Invalid or duplicate tensor')
            size=4*math.prod(tensor['shape'])
            if start<0 or end-start!=size:raise ValueError('Shape/byte range mismatch')
            metadata[name]={'dtype':'F32','shape':tensor['shape'],'data_offsets':[cursor,cursor+size]}
            remote_start=8+shard['headerBytes']+start
            if segments and segments[-1]['path']==shard['path'] and segments[-1]['sourceEnd']==remote_start:
                segments[-1]['sourceEnd']+=size;segments[-1]['outputEnd']+=size
            else:segments.append({'path':shard['path'],'sourceStart':remote_start,'sourceEnd':remote_start+size,'outputStart':cursor,'outputEnd':cursor+size})
            cursor+=size
    if cursor!=document['selectedBytes'] or not 0<cursor<3*1024**3:raise ValueError('Unexpected adapter size')
    header=json.dumps(metadata,separators=(',',':')).encode();header+=b' '*((-len(header))%8)
    return struct.pack('<Q',len(header))+header,segments,cursor


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('audit',type=Path);parser.add_argument('output',type=Path)
    parser.add_argument('--reserve-bytes',type=int,default=0,help='Additional pending downloads to reserve space for')
    parser.add_argument('--resume',action='store_true');a=parser.parse_args()
    d=json.loads(a.audit.read_text());prefix,segments,payload=plan(d);total=len(prefix)+payload
    out=a.output;out.parent.mkdir(parents=True,exist_ok=True);partial=out.with_suffix(out.suffix+'.partial')
    if out.exists():raise ValueError('Completed output already exists')
    if partial.exists() and not a.resume:raise ValueError('Explicit --resume required for partial')
    offset=partial.stat().st_size if partial.exists() else 0
    if offset:
        with partial.open('rb') as f:
            if f.read(len(prefix))!=prefix or offset>total:raise ValueError('Partial belongs to different audit')
    if shutil.disk_usage(out.parent).free<total-offset+max(0,a.reserve_bytes)+20*1024**3:raise RuntimeError('Insufficient reserved disk space')
    receipt={'status':'DOWNLOADING','sourceRevision':d['revision'],'expectedBytes':total,'tensorPayloadBytes':payload,'rangeSegments':len(segments),'productionApproved':False}
    report=out.with_suffix('.download.json')
    try:
        with partial.open('ab') as f:
            if not offset:f.write(prefix)
            for segment in segments:
                skip=max(0,f.tell()-len(prefix)-segment['outputStart'])
                if skip>=segment['outputEnd']-segment['outputStart']:continue
                start=segment['sourceStart']+skip;end=segment['sourceEnd']-1
                url='https://huggingface.co/N00B0DY/MultiAnimate/resolve/'+d['revision']+'/'+urllib.parse.quote(segment['path'],safe='/')+f'?adapter_range={start}-{end}'
                request=urllib.request.Request(url,headers={'Range':f'bytes={start}-{end}'})
                with urllib.request.urlopen(request,timeout=30) as response:
                    if response.status!=206 or not response.headers.get('Content-Range','').startswith(f'bytes {start}-{end}/'):raise RuntimeError('Server ignored bounded range')
                    remaining=end-start+1;last=time.monotonic()
                    while remaining:
                        if shutil.disk_usage(out.parent).free<20*1024**3:raise RuntimeError('Disk reserve reached')
                        block=response.read(min(4*1024**2,remaining))
                        if not block:raise RuntimeError('Truncated range; partial retained')
                        f.write(block);remaining-=len(block)
                        if time.monotonic()-last>20:
                            print(f'Adapter {f.tell()}/{total}',flush=True);last=time.monotonic()
        if partial.stat().st_size!=total:raise RuntimeError('Wrong output length')
        with partial.open('rb') as f:digest=hashlib.file_digest(f,'sha256').hexdigest()
        partial.replace(out);receipt.update(status='RANGES_ASSEMBLED_REQUIRES_MODEL_VALIDATION',sha256=digest)
    except BaseException as error:
        receipt.update(status='STOPPED_PARTIAL_PRESERVED',error=type(error).__name__+': '+str(error)[:200]);raise
    finally:report.write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt),flush=True)


if __name__=='__main__':main()
