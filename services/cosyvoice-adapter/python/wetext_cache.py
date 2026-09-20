"""Keep CosyVoice's text normaliser from silently disappearing.

CosyVoiceFrontEnd builds its wetext normaliser inside a bare `except:`. wetext.Normalizer
calls modelscope's snapshot_download on every construction -- even when the FSTs are
already on disk -- so a transient 403 or a flaky proxy degrades the frontend to '' and the
service then reads numbers and dates digit by digit, with nothing in the logs but a single
`no frontend is avaliable` INFO line.

Two guards live here, shared by the adapter server and the smoke script:
  * pin_wetext_to_local_cache() removes the network from the happy path.
  * require_text_frontend() turns a degraded frontend into a loud failure.
"""

import logging
import os
from pathlib import Path

WETEXT_REPO = "pengzhendong/wetext"
# The four FSTs CosyVoice's wetext frontend actually loads (zh/en, tn tagger + verbalizer).
WETEXT_REQUIRED_FILES = (
    "zh/tn/tagger.fst",
    "zh/tn/verbalizer.fst",
    "en/tn/tagger.fst",
    "en/tn/verbalizer.fst",
)


def cached_wetext_directory() -> str | None:
    """Return a local wetext copy that has every FST we need, or None."""
    candidates = []
    override = os.environ.get("WETEXT_MODEL_DIR")
    if override:
        candidates.append(Path(override))
    cache_root = Path(os.environ.get("MODELSCOPE_CACHE") or Path.home() / ".cache" / "modelscope")
    candidates.append(cache_root / "hub" / "models" / WETEXT_REPO)
    candidates.append(cache_root / "hub" / WETEXT_REPO)
    for candidate in candidates:
        if all((candidate / relative).is_file() for relative in WETEXT_REQUIRED_FILES):
            return str(candidate)
    return None


def pin_wetext_to_local_cache() -> None:
    """Serve the complete local wetext copy; only reach the network when there is none.

    Must be called before the CosyVoice model is constructed.
    """
    try:
        import wetext.wetext as wetext_module
    except ImportError:
        return

    original_snapshot_download = wetext_module.snapshot_download

    def snapshot_download(repo_id, *args, **kwargs):
        if repo_id == WETEXT_REPO:
            cached = cached_wetext_directory()
            if cached is not None:
                return cached
        return original_snapshot_download(repo_id, *args, **kwargs)

    wetext_module.snapshot_download = snapshot_download


def text_frontend_of(model) -> str:
    """The normaliser CosyVoice ended up with: 'ttsfrd', 'wetext', or '' when none loaded."""
    return getattr(getattr(model, "frontend", None), "text_frontend", "") or ""


MISSING_FRONTEND_MESSAGE = (
    "No text frontend loaded, so numbers and dates would be read digit by digit.\n"
    "Expected the wetext FSTs in one of:\n"
    "  $WETEXT_MODEL_DIR\n"
    f"  $MODELSCOPE_CACHE/hub[/models]/{WETEXT_REPO}\n"
    f"  ~/.cache/modelscope/hub[/models]/{WETEXT_REPO}\n"
    "Fetch them once with:\n"
    f"  python -c \"from modelscope import snapshot_download as d; print(d('{WETEXT_REPO}'))\""
)


def require_text_frontend(model, allow_degraded: bool = False, opt_out_hint: str = "") -> str:
    """Check what CosyVoice actually loaded instead of trusting that the import worked.

    Returns the frontend name. Raises SystemExit when none loaded and allow_degraded is False.
    """
    text_frontend = text_frontend_of(model)
    if text_frontend:
        logging.info("text frontend: %s", text_frontend)
        return text_frontend
    if allow_degraded:
        logging.warning(
            "no text frontend loaded; numbers and dates will be read digit by digit"
        )
        return ""
    raise SystemExit(MISSING_FRONTEND_MESSAGE + (f"\n{opt_out_hint}" if opt_out_hint else ""))
