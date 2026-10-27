"""Flag ASR discrepancies for listening; homophone agreement is not approval."""
import json,re,difflib
from pathlib import Path
from pypinyin import lazy_pinyin,Style
root=Path('artifacts/wolong-local-film/asr');rows=[]
def norm(s):return ''.join(re.findall(r'[\u3400-\u9fff]',s))
for p in sorted(root.glob('*.json')):
 d=json.loads(p.read_text())
 if 'expected' not in d:continue
 a,b=norm(d['expected']),norm(d['transcript'])
 pa,pb=lazy_pinyin(a,style=Style.NORMAL),lazy_pinyin(b,style=Style.NORMAL)
 ratio=difflib.SequenceMatcher(None,pa,pb,autojunk=False).ratio()
 changes=[{'operation':tag,'expected':''.join(a[i:j]),'recognized':''.join(b[k:l])} for tag,i,j,k,l in difflib.SequenceMatcher(None,pa,pb,autojunk=False).get_opcodes() if tag!='equal']
 rows.append({'lineId':d['lineId'],'audio':d['audio'],'expected':d['expected'],'recognized':d['transcript'],'phoneticSimilarity':round(ratio,3),'priority':'HIGH' if not b or ratio<.85 else 'NORMAL','differences':changes,'decision':'LISTENING_REQUIRED; pinyin ignores tones and polyphone context'})
rows.sort(key=lambda x:x['phoneticSimilarity'])
out=root/'triage';out.mkdir(exist_ok=True)
(out/'report.json').write_text(json.dumps({'purpose':'review ordering only; never approves audio','lines':rows},ensure_ascii=False,indent=2))
print(json.dumps({'reviewed':len(rows),'highPriority':sum(x['priority']=='HIGH' for x in rows),'firstFive':[{'line':r['lineId'],'score':r['phoneticSimilarity'],'differences':r['differences']} for r in rows[:5]]},ensure_ascii=False))
