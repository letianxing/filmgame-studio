"""Explicit local evaluation profiles; do not infer memory limits from filenames."""
def validate_wan_profile(request, model_config):
    width,height,frames,steps=(request[k] for k in ('width','height','frames','steps'))
    if any(type(x) is not int for x in (width,height,frames,steps)):
        raise ValueError('Integer dimensions, frames and steps required')
    if not (5<=frames<=97 and (frames-1)%4==0 and 1<=steps<=40):
        raise ValueError('Unsafe frame count or step count')
    if model_config.get('dual_model'):
        lightning=bool(request.get('lightningDir'))
        max_frames=65 if lightning and steps==4 else 17
        if lightning and steps!=4:raise ValueError('Pinned Lightning profile requires four steps')
        if not (request.get('evaluationOnly') is True and
                model_config.get('model_type')=='i2v' and
                model_config.get('dim')==5120 and model_config.get('in_dim')==36 and
                model_config.get('num_layers')==40 and
                model_config.get('quantization')=={'bits':4,'group_size':64} and
                (width,height)==(512,288) and frames<=max_frames):
            raise ValueError('14B exceeds the bounded isolated evaluation profile')
        return {'mlxLimitGiB':20,'fps':16,'family':'Wan2.2-I2V-A14B-q4-evaluation'}
    standard=(width,height) in ((512,288),(288,512))
    detail=(width,height)==(768,448) and frames<=25 and request.get('evaluationOnly') is True
    if not (standard or detail):raise ValueError('Unsafe dimensions')
    if model_config.get('in_dim')!=48:raise ValueError('Unsupported single-model family')
    return {'mlxLimitGiB':16,'fps':24,'family':'Wan2.2-TI2V-5B'}
