"""First-party least-squares similarity fit for reversible face coordinates."""
import numpy as np


def similarity_transform(source,target):
    source=np.asarray(source,dtype=np.float64);target=np.asarray(target,dtype=np.float64)
    if source.shape!=(3,2) or target.shape!=(3,2) or not np.isfinite([source,target]).all():
        raise ValueError('Three finite anchors required')
    rows=[];values=[]
    for (x,y),(u,v) in zip(source,target):
        rows.extend([[x,-y,1,0],[y,x,0,1]]);values.extend([u,v])
    solution,_,rank,_=np.linalg.lstsq(rows,values,rcond=None)
    if rank!=4:raise ValueError('Degenerate face anchors')
    a,b,tx,ty=solution
    if a*a+b*b<1e-12:raise ValueError('Degenerate transform')
    return np.array([[a,-b,tx],[b,a,ty]])


def transform_points(points,matrix):
    points=np.asarray(points,dtype=np.float64)
    return np.column_stack([points,np.ones(len(points))])@np.asarray(matrix).T
