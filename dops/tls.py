from __future__ import annotations

import ssl
from functools import lru_cache


@lru_cache(maxsize=1)
def create_ssl_context() -> ssl.SSLContext:
    try:
        import certifi
    except ImportError:
        return ssl.create_default_context()
    return ssl.create_default_context(cafile=certifi.where())
