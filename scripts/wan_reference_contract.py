"""Do not silently drop identity references in the single-reference WAN route."""
def validate_single_reference_conditions(conditions):
    for label in ('positive','negative'):
        if not conditions.get(label):raise ValueError('Missing '+label+' conditioning')
        for _,metadata in conditions[label]:
            refs=metadata.get('reference_latents')
            if not isinstance(refs,list) or len(refs)!=1:
                raise ValueError('This Control adapter supports exactly one shared-scene reference, not independent actor identity references')
            shape=tuple(refs[0].shape)
            if len(shape)!=5 or shape[0]!=1 or shape[1]!=48 or shape[2]!=1:
                raise ValueError('Expected one Wan2.2 reference image latent')
    return {'referenceMode':'single-shared-scene','independentActorIdentityBinding':False}
