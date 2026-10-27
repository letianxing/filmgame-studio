"""Verify partner-directed bow and explicit head aim in exported Blender anchors."""
import argparse
import json
import math
from pathlib import Path


def subtract(a, b):
    return [x-y for x, y in zip(a, b)]


def length(v):
    return math.sqrt(sum(x*x for x in v))


def check(contract, exported):
    rows = exported['samples']
    assert len(rows) == contract['frames']
    assert [r['frame'] for r in rows] == list(range(contract['frames']))
    errors = []
    max_side = max_aim = 0
    aim_samples = 0
    for actor in contract['actors']:
        name = actor['id']; target = actor['gazeTarget'].split('.')[0]
        start = rows[0]['anchors'][name]['head']['world']
        partner = rows[0]['anchors'][target]['head']['world']
        direction = subtract(partner[:2], start[:2]); size = length(direction)
        direction = [x/size for x in direction]
        for row in rows:
            anchors = row['anchors']; head = anchors[name]['head']['world']
            delta = subtract(head[:2], start[:2])
            side = abs(delta[0]*direction[1]-delta[1]*direction[0])
            max_side = max(max_side, side)
            if side > .001: errors.append(f'{name}:{row["frame"]}:off-axis bow')
            if sum(x*y for x,y in zip(delta,direction)) < -.001:
                errors.append(f'{name}:{row["frame"]}:backward bow')
            if 'nose' not in anchors[name]:
                errors.append(f'{name}:{row["frame"]}:missing head direction evidence'); continue
            nose = subtract(anchors[name]['nose']['world'], head)
            aim = subtract(anchors[target]['head']['world'], head)
            cosine = sum(x*y for x,y in zip(nose,aim))/(length(nose)*length(aim))
            angle = math.degrees(math.acos(max(-1,min(1,cosine))))
            max_aim = max(max_aim,angle)
            aim_samples += 1
            if angle > .1: errors.append(f'{name}:{row["frame"]}:head misses partner')
        if length(subtract(rows[-1]['anchors'][name]['head']['world'],start))>.001:
            errors.append(f'{name}:head did not return')
    return dict(status='PASS_GEOMETRY_ONLY' if not errors else 'FAIL',
                frames=len(rows), maximumLateralBowMeters=max_side,
                maximumHeadAimErrorDegrees=max_aim if aim_samples else None,
                measuredHeadAimSamples=aim_samples, errors=errors,
                productionApproved=False)


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('contract',type=Path);parser.add_argument('anchors',type=Path)
    parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    result=check(json.loads(args.contract.read_text()),json.loads(args.anchors.read_text()))
    args.output.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k!='errors'}))
    raise SystemExit(bool(result['errors']))
