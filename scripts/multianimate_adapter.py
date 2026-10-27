"""Validated MultiAnimate weights through external Comfy model APIs."""
import hashlib,json,re
from pathlib import Path
from safetensors import safe_open
from multianimate_conditioning import first_block_condition


def attach_weights(model, weights_path, verification_path):
    import comfy.lora
    weights_path=Path(weights_path);verified=json.loads(Path(verification_path).read_text())
    if verified.get('status')!='ADAPTER_FILE_VERIFIED_NOT_MODEL_APPROVAL':
        raise ValueError('Verified adapter bundle required')
    with weights_path.open('rb') as stream:
        if hashlib.file_digest(stream,'sha256').hexdigest()!=verified['sha256']:
            raise ValueError('Adapter changed after verification')
    backbone=model.model.diffusion_model
    if backbone.dim!=5120 or backbone.patch_embedding.in_channels!=36 or len(backbone.blocks)!=40:
        raise ValueError('Matching Wan2.1 I2V 14B architecture required')
    state=model.model.state_dict();lora={};mapping={};controls={};pairs={}
    with safe_open(weights_path,framework='pt',device='cpu') as bundle:
        if bundle.metadata()['source_revision']!=verified['sourceRevision']:
            raise ValueError('Adapter source revision mismatch')
        for name in bundle.keys():
            tensor=bundle.get_tensor(name)
            match=re.fullmatch(r'pipe\.dit\.(.+)\.lora_([AB])\.default\.weight',name)
            if match:
                prefix,side=match.groups();target='diffusion_model.'+prefix+'.weight'
                if target not in state:raise ValueError('Unmatched base key: '+target)
                lora[name.removeprefix('pipe.dit.')]=tensor;mapping[prefix]=target
                pairs.setdefault(prefix,{})[side]=tuple(tensor.shape)
            elif name.startswith(('label_embedding.','dwpose_embedding.','randomref_embedding_pose.')):
                controls[name]=tensor
            else:raise ValueError('Unexpected adapter key: '+name)
    if len(pairs)!=400 or len(controls)!=40:raise ValueError('Incomplete adapter modules')
    for prefix,pair in pairs.items():
        if set(pair)!=set('AB') or pair['A'][0]!=128 or pair['B'][1]!=128:
            raise ValueError('Invalid rank-128 pair')
        # GGUF's exported state_dict uses packed storage for VRAM estimation.
        # Validate the parameter's logical dimensions, without dequantizing it.
        parameter=model.model.get_parameter(mapping[prefix])
        logical_shape=tuple(getattr(parameter,'tensor_shape',parameter.shape))
        if logical_shape!=(pair['B'][0],pair['A'][1]):
            raise ValueError('LoRA/base shape mismatch: '+prefix+' '+str(logical_shape))
        if model.patches.get(mapping[prefix]):raise ValueError('Unvalidated stacked LoRA')
    # No alpha keys: unit B@A scaling, matching upstream's alpha=1.0.
    patches=comfy.lora.load_lora(lora,mapping,log_missing=False)
    if set(patches)!=set(mapping.values()):raise ValueError('LoRA loader omitted targets')
    patched=model.clone()
    applied=patched.add_patches(patches,1.0,1.0)
    if set(applied)!=set(patches):raise ValueError('Model rejected LoRA targets')
    return patched,controls


def attach_condition(model, condition):
    previous=model.model_options.get('transformer_options',{}).get('patches_replace',{}).get('dit',{})
    if ('double_block',0) in previous:raise ValueError('First block already replaced')
    patched=model.clone()
    patched.set_model_patch_replace(first_block_condition(condition),'dit','double_block',0)
    return patched


def attach_acceleration(model, weights_path, expected_sha256):
    """Explicit experimental stack; validate every LoRA/bias/delta target."""
    import comfy.lora
    weights_path=Path(weights_path)
    with weights_path.open('rb') as stream:
        if hashlib.file_digest(stream,'sha256').hexdigest()!=expected_sha256:
            raise ValueError('Acceleration weight checksum mismatch')
    parameters=dict(model.model.named_parameters())
    mapping={k.removesuffix('.weight') if k.endswith('.weight') else k:k for k in parameters if k.startswith('diffusion_model.')}
    weights={};pairs={};expected=set()
    with safe_open(weights_path,framework='pt',device='cpu') as bundle:
        for name in bundle.keys():
            tensor=bundle.get_tensor(name);weights[name]=tensor
            if name.endswith(('.lora_up.weight','.lora_down.weight')):
                side='up' if name.endswith('.lora_up.weight') else 'down'
                prefix=name.removesuffix('.lora_'+side+'.weight')
                pairs.setdefault(prefix,{})[side]=tuple(tensor.shape);target=mapping.get(prefix)
            elif name.endswith('.diff_b'):
                target=name.removesuffix('.diff_b')+'.bias'
                if target not in parameters or tuple(tensor.shape)!=tuple(parameters[target].shape):raise ValueError('Acceleration bias mismatch: '+name)
            elif name.endswith('.diff'):
                target=mapping.get(name.removesuffix('.diff'))
                if target is None or tuple(tensor.shape)!=tuple(getattr(parameters[target],'tensor_shape',parameters[target].shape)):raise ValueError('Acceleration delta mismatch: '+name)
            else:raise ValueError('Unsupported acceleration key: '+name)
            if target not in parameters:raise ValueError('Unknown acceleration target: '+name)
            expected.add(target)
    for prefix,pair in pairs.items():
        if set(pair)!=set(['up','down']) or pair['up'][1]!=64 or pair['down'][0]!=64:raise ValueError('Incomplete rank-64 acceleration pair')
        parameter=parameters[mapping[prefix]]
        if tuple(getattr(parameter,'tensor_shape',parameter.shape))!=(pair['up'][0],pair['down'][1]):raise ValueError('Acceleration shape mismatch')
    patches=comfy.lora.load_lora(weights,mapping,log_missing=False)
    if set(patches)!=expected:raise ValueError('Acceleration loader omitted target updates')
    before={k:len(v) for k,v in model.patches.items()};patched=model.clone()
    if set(patched.add_patches(patches,1.,1.))!=expected:raise ValueError('Model rejected acceleration patches')
    if before!={k:len(v) for k,v in model.patches.items()}:raise ValueError('Original patcher changed')
    return patched,{'tensorCount':len(weights),'loraPairs':len(pairs),'targetCount':len(patches),'overlappingMultiAnimateTargets':len(set(before)&expected),'strength':1.0,'qualityValidated':False}
