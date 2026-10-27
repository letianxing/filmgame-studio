"""A callable cache must not extend a model's lifetime beyond its explicit owner."""
import weakref


def weak_model_call(model):
    reference = weakref.ref(model)
    def forward(*args, **kwargs):
        target = reference()
        if target is None:
            raise RuntimeError('Model owner was released before forward call')
        return target(*args, **kwargs)
    return forward
