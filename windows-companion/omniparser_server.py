"""Opt-in localhost inference server for the official Microsoft OmniParser v2.

This is a model *driver*, not an independent JARVIS agent. It loads
the pinned upstream OmniParser implementation from an operator-installed
checkout, and exposes ONLY POST /parse with short-lived bounded image input.
No model weights or upstream code are embedded in JARVIS.

Use ONLY on the trusted owner Windows desktop. A strong bearer secret and
loopback bind are mandatory; requests/results are never logged.
"""
from __future__ import annotations

import argparse
import base64
import binascii
import hmac
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path
import subprocess
import sys

PINNED_REVISION = '354021201345a96178360b28733573e27269f2de'
MAX_REQUEST_BYTES = 3_000_000
MAX_IMAGE_BYTES = 2_000_000
MAX_REPLY_BYTES = 256_000


def validate_image_request(payload):
    if not isinstance(payload, dict) or set(payload) != {'image_base64'}:
        raise ValueError('Only one image_base64 field is permitted.')
    encoded = payload['image_base64']
    if not isinstance(encoded, str) or not 16 <= len(encoded) <= 2_700_000:
        raise ValueError('Invalid image size.')
    try:
        data = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ValueError('Invalid base64 image.') from exc
    # A screenshot from the JARVIS client is an actual PNG, not an arbitrary
    # model-supplied path, URL, or remotely hosted image.
    if len(data) > MAX_IMAGE_BYTES or not data.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('Only bounded PNG screenshots are accepted.')
    return encoded


def load_pinned_omniparser(root):
    root = Path(root).resolve(strict=True)
    if not (root / 'util' / 'omniparser.py').is_file():
        raise RuntimeError('Operator-selected directory lacks the official OmniParser source.')
    rev = subprocess.run(['git', '-C', str(root), 'rev-parse', 'HEAD'],
                         capture_output=True, text=True, timeout=5, check=True).stdout.strip()
    if rev != PINNED_REVISION:
        raise RuntimeError('OmniParser checkout does not match pinned reviewed revision.')
    detector = root / 'weights' / 'icon_detect_v3' / 'model.pt'
    caption = root / 'weights' / 'icon_caption_florence'
    if not detector.is_file() or not caption.is_dir():
        raise RuntimeError('Official OmniParser v2 weights are missing; install them separately.')
    # The pinned upstream parser loads Florence2 and a YOLOv9-E detector,
    # using their own dependencies and model-specific licenses.
    # Preserve the upstream import path for model helpers loaded lazily.
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    from util.omniparser import Omniparser
    parser = Omniparser({
            'som_model_path': str(detector),
            'caption_model_name': 'florence2',
            'caption_model_path': str(caption),
            'BOX_TRESHOLD': 0.05,
        })
    return parser


def create_handler(parser, token):
    if not isinstance(token, str) or len(token) < 32:
        raise ValueError('OmniParser requires a bearer token of at least 32 characters.')

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # Never log bearer, screenshot, OCR text, query, response.
        def _respond(self, code, body):
            raw = json.dumps(body, separators=(',', ':')).encode('utf-8')
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
        def do_GET(self):
            self._respond(404, {'ok': False})
        def do_POST(self):
            if self.path != '/parse':
                self._respond(404, {'ok': False})
                return
            authorization = self.headers.get('Authorization', '')
            if not hmac.compare_digest(authorization, 'Bearer ' + token):
                self._respond(401, {'ok': False})
                return
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if size <= 0 or size > MAX_REQUEST_BYTES:
                    raise ValueError('Invalid bounded request size.')
                raw = self.rfile.read(size)
                image = validate_image_request(json.loads(raw))
            except (ValueError, UnicodeError, json.JSONDecodeError):
                self._respond(400, {'ok': False})
                return
            try:
                _, rows = parser.parse(image)  # actual pinned official parser
                if not isinstance(rows, list):
                    raise ValueError('Unexpected parser output.')
                response = {'parsed_content_list': rows[:250]}
                result = json.dumps(response, ensure_ascii=False).encode('utf-8')
                if len(result) > MAX_REPLY_BYTES:
                    raise ValueError('Inference result too large.')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Content-Length', str(len(result)))
                self.end_headers()
                self.wfile.write(result)
            except Exception:
                # No exception strings or image content are exposed.
                self._respond(503, {'ok': False, 'reason': 'Inference unavailable'})
    return Handler


def main():
    p = argparse.ArgumentParser(description='Private JARVIS OmniParser model inference')
    p.add_argument('--root', required=True, help='Pinned official OmniParser repo')
    args = p.parse_args()
    if os.name != 'nt' or os.environ.get('JARVIS_OMNIPARSER_ENABLED') != '1':
        raise SystemExit('Only explicit owner Windows test mode is supported.')
    token = os.environ.get('JARVIS_OMNIPARSER_TOKEN', '')
    port = os.environ.get('JARVIS_OMNIPARSER_PORT', '')
    if len(token) < 32 or not port.isdigit() or not 1024 <= int(port) <= 65535:
        raise SystemExit('Missing private bearer token / bounded loopback port.')
    parser = load_pinned_omniparser(args.root)
    server = HTTPServer(('127.0.0.1', int(port)), create_handler(parser, token))
    try:
        print('[JARVIS] Local OmniParser model driver is ready (no remote bind).', flush=True)
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
