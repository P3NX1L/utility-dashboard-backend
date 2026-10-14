"""Reuse certificate configuration, never user sessions or authenticated clients."""
from functools import lru_cache
import os
import ssl

import certifi
import httpx


@lru_cache(maxsize=1)
def tls_context():
    return ssl.create_default_context(
        cafile=os.getenv('SSL_CERT_FILE') or certifi.where(),
        capath=os.getenv('SSL_CERT_DIR') or None)


def verified_client(*, timeout):
    # A fresh client per operation retains isolated headers/cookies and normal closure.
    # Only certificate configuration is shared, avoiding repeated certificate loads.
    return httpx.Client(verify=tls_context(), timeout=timeout)
