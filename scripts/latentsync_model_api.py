"""Load only LatentSync's neural model API, without its video I/O dependencies.

The model imports one logging function from a module that eagerly imports decord
and video utilities. Scope that import to a logging facade; never use this to
load the full upstream pipeline or bypass its image processing contracts.
"""
import importlib
from pathlib import Path
import sys
import types


def load_model_class(upstream):
    root=str(Path(upstream).resolve())
    sys.path.insert(0,root)
    name='latentsync.utils.util'
    previous=sys.modules.get(name)
    facade=types.ModuleType(name)
    def zero_rank_log(logger,message):logger.info(message)
    facade.zero_rank_log=zero_rank_log
    sys.modules[name]=facade
    try:
        return importlib.import_module('latentsync.models.unet').UNet3DConditionModel
    finally:
        if previous is None:sys.modules.pop(name,None)
        else:sys.modules[name]=previous
        sys.path.remove(root)
