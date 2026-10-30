"""Conservative browser egress preflight for the experimental Windows Companion.

This is a defense-in-depth network boundary, NOT Windows OS isolation.
Requests are checked at routing time including navigations, subresources and
redirects. An attacker controlling DNS can still exploit resolution races:
production V1 must additionally enforce network egress at the OS sandbox.
"""
from __future__ import annotations

import ipaddress
import socket
import urllib.parse

_PRIVATE_SUFFIXES = ('.localhost', '.local', '.internal', '.test', '.invalid', '.home.arpa')


def is_public_http_url(url: str, resolve=socket.getaddrinfo) -> bool:
    """Only allow HTTP(S) endpoints resolving exclusively to global IPs.

    If *any* DNS address is non-public or DNS cannot be checked, deny. This
    handles mixed DNS answers, obfuscated numeric hosts, and DNS rebinding
    attempts better than a hostname-only allow policy; it is not a firewall.
    """
    if not isinstance(url, str) or len(url) > 4096 or any(ord(c) < 32 for c in url):
        return False
    try:
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme.lower() not in ('http', 'https'):
            return False
        if parsed.username is not None or parsed.password is not None:
            return False
        host = (parsed.hostname or '').lower().rstrip('.')
        if not host or '%' in host or host == 'localhost' or host.endswith(_PRIVATE_SUFFIXES):
            return False
        # No user-supplied non-web service ports or numeric IP alias tricks.
        port = parsed.port
        if port is not None and port not in (80, 443):
            return False
        try:
            ip = ipaddress.ip_address(host)
            return ip.is_global
        except ValueError:
            pass
        # DNS is not trusted to select public addresses from a mixed list.
        # IDNA is applied by Python's resolver; reject malformed host labels.
        if len(host) > 253 or any(not label or len(label) > 63 for label in host.split('.')):
            return False
        records = resolve(host, port, type=socket.SOCK_STREAM)
        if not records:
            return False
        for record in records:
            ip = ipaddress.ip_address(record[4][0].split('%')[0])
            if not ip.is_global:
                return False
        return True
    except (OSError, ValueError, TypeError, IndexError, OverflowError, UnicodeError):
        return False
