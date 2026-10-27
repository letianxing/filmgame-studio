"""Conservative image-space lip mask; no jaw, cheek or beard reconstruction."""
import numpy as np

OUTER_LIPS = (61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185)

def lip_mask(points, box, preserve_upper_lip=False):
    import cv2
    x1,y1,x2,y2=box
    pts=np.asarray(points,dtype=np.float32)[list(OUTER_LIPS)]-np.array([x1,y1])
    h,w=y2-y1,x2-x1
    if h<=0 or w<=0 or not np.isfinite(pts).all():raise ValueError('Invalid face geometry')
    # Hard support bounds remain tied to the real lips, not generated facial shape.
    left=max(0,int(np.floor(pts[:,0].min()))-2)
    right=min(w,int(np.ceil(pts[:,0].max()))+3)
    top=max(0,int(np.floor(pts[:,1].min()))-1)
    if preserve_upper_lip:
        top=max(top,int(np.ceil(np.asarray(points)[13,1]-y1)))
    bottom=min(h,int(np.ceil(pts[:,1].max()))+max(3,round(w*.035)))
    if left>=right or top>=bottom:raise ValueError('Lips outside face box')
    mask=np.zeros((h,w),np.float32)
    cv2.ellipse(mask,((left+right)//2,(top+bottom)//2),
        (max(1,(right-left)//2),max(1,(bottom-top)//2)),0,0,360,1,-1)
    mask=cv2.GaussianBlur(mask,(0,0),max(.6,w*.01))
    support=np.zeros((h,w),np.float32);support[top:bottom,left:right]=1
    return (mask*support)[:,:,None]
