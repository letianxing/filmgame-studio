"""Export SHA-bound review context from archived story versions (not invented provider prompts)."""
import argparse
import json
from pathlib import Path
import urllib.request


def export(root, project_id, output, base):
    project = json.load(urllib.request.urlopen(f'{base}/v1/comic/projects/{project_id}', timeout=30))['project']
    runs = {r['id']: r for r in project['runs']}
    directory = root / project_id
    def source(run):
        path = directory/'versions'/f"{int(run['storyVersion'])}.json"
        story = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
        shots = [s for e in story.get('episodes', []) for s in e['shots']]
        index = next((i for i, s in enumerate(shots) if s['id'] == run['shotId']), None)
        shot = shots[index] if index is not None else {}
        return shot, shots, index
    def lineage(run, seen):
        if run['id'] in seen:
            return []
        seen.add(run['id'])
        shot, _, _ = source(run)
        edit = run.get('derivative', {}).get('editDescription') or run.get('assembly', {}).get('editDescription') or ''
        result = [dict(runId=run['id'], scene=shot.get('scene', '历史场景未存档'), description=shot.get('description', '历史分镜未存档'), edit=edit)]
        ids = [s['runId'] for s in run.get('assembly', {}).get('sources', [])]
        if run.get('derivative'): ids.append(run['derivative']['sourceRunId'])
        for rid in ids:
            if rid in runs: result += lineage(runs[rid], seen)
        return result
    contexts = {}
    for run in project['runs']:
        if run['status'] != 'REVIEW' or run.get('stale'): continue
        shot, shots, index = source(run)
        # These are historical storyboard neighbours, not a claimed runtime branch order.
        before = shots[index-1]['description'] if index is not None and index > 0 else '未记录相邻镜头'
        after = shots[index+1]['description'] if index is not None and index+1 < len(shots) else '未记录相邻镜头'
        contexts[run['id']] = dict(sha256=run.get('sha256'), scene=shot.get('scene', '场景未存档'),
            description=shot.get('description', '分镜提示词未存档'), before=before, after=after,
            promptNote=f"来自本候选的历史分镜版本 {run['storyVersion']}，不是后来修改的稿件。供应商最终完整提交提示词未在本记录存档，不将分镜冒充完整提交请求。前后段为该历史稿的编排顺序，分支以正式剧情树为准。若为剪辑片，请展开来源查看原分镜及剪辑说明。",
            sources=lineage(run, set()))
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(contexts, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'contexts': len(contexts), 'revision': project['revision'], 'output': str(output)}))


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root', type=Path, required=True)
    p.add_argument('--project', required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--base', default='http://127.0.0.1:4100')
    a = p.parse_args()
    export(a.root, a.project, a.output, a.base)
