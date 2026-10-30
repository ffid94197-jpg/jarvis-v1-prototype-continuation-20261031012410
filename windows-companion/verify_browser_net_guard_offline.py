"""No-network tests for browser URL/network policy (DNS resolver supplied)."""
from __future__ import annotations

from browser_net_guard import is_public_http_url


def resolver(records):
    def fake(host, port, type):
        return [(0, 0, 0, '', (ip, port or 443)) for ip in records]
    return fake


cases = [
    ('https://example.com/path', ['8.8.8.8'], True),
    ('https://example.com/path', ['2606:4700:4700::1111'], True),
    ('http://example.com', ['8.8.8.8', '10.0.0.2'], False),
    ('http://example.com', ['8.8.8.8', '127.0.0.1'], False),
    ('https://example.com', [], False),
    ('http://localhost:3000', ['8.8.8.8'], False),
    ('http://localhost.localdomain', ['127.0.0.1'], False),
    ('http://printer.internal', ['8.8.8.8'], False),
    ('https://device.home.arpa', ['8.8.8.8'], False),
    ('http://192.168.0.100/', ['8.8.8.8'], False),
    ('http://[::1]/', ['8.8.8.8'], False),
    ('http://[::ffff:127.0.0.1]/', ['8.8.8.8'], False),
    ('http://169.254.169.254/latest/meta-data/', ['8.8.8.8'], False),
    ('http://0x7f000001/', ['127.0.0.1'], False),
    ('http://somehost:20189/', ['8.8.8.8'], False),
    ('file:///etc/passwd', ['8.8.8.8'], False),
    ('javascript:alert(1)', ['8.8.8.8'], False),
    ('https://user:pass@example.com/', ['8.8.8.8'], False),
    ('https://example.com\nHost:localhost', ['8.8.8.8'], False),
    ('https://bad...example/', ['8.8.8.8'], False),
    ('https://example.com:443/', ['8.8.8.8'], True),
    ('http://example.com:80/', ['8.8.8.8'], True),
]
for i, (url, addresses, expected) in enumerate(cases):
    got = is_public_http_url(url, resolve=resolver(addresses))
    assert got is expected, (i, url, got, expected)


def raises(*a, **kw):
    raise OSError('DNS unavailable')
assert not is_public_http_url('https://example.com', resolve=raises)
print('BROWSER_NETWORK_GUARD 23/23 PASS (mocked DNS, not OS egress proof)')
