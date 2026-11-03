"""Real localhost HTTP transport test with a stub inference model.

Exercises actual server code; NO model downloads, screenshots, or Windows
input. This does NOT certify the official OmniParser weights or live desktop.
"""
import base64
import http.client
from http.server import HTTPServer
import json
from threading import Thread

from omniparser_server import create_handler, validate_image_request


class FakeParser:
    def __init__(self):
        self.calls = 0
    def parse(self, b64):
        self.calls += 1
        assert b64.startswith('iVBOR')
        return '', [{'type': 'icon', 'bbox': [0.1,0.2,0.4,0.5],
                     'content': 'Save', 'interactivity': True}]

parser = FakeParser()
token = 'x' * 40
server = HTTPServer(('127.0.0.1', 0), create_handler(parser, token))
thread = Thread(target=server.serve_forever, daemon=True)
thread.start()
count = 0
def send(url, payload, auth=None):
    connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=3)
    body = json.dumps(payload).encode('utf-8')
    connection.request('POST', url, body, {
        'Content-Type':'application/json',
        'Authorization':'Bearer ' + (auth or ''),
    })
    result=connection.getresponse()
    data=result.read()
    connection.close()
    return result.status, json.loads(data)

def check(result, note):
    global count
    assert result, note
    count += 1
    print('PASS', note)

try:
    header=(b'\x89PNG\r\n\x1a\n' + (13).to_bytes(4,'big') + b'IHDR' +
            (1).to_bytes(4,'big') + (1).to_bytes(4,'big') + b'\x08\x02\x00\x00\x00' + bytes(4))
    png=base64.b64encode(header).decode('ascii')
    check(validate_image_request({'image_base64':png}) == png,
          'actual bounded local PNG accepted')
    status,result=send('/parse',{'image_base64':png},token)
    check(status==200 and result['parsed_content_list'][0]['content']=='Save'
          and parser.calls==1,'actual loopback handler delegates to approved parser')
    status,_=send('/parse',{'image_base64':png},'bad')
    check(status==401 and parser.calls==1,'invalid token cannot reach inference')
    status,_=send('/another',{'image_base64':png},token)
    check(status==404 and parser.calls==1,'unlisted endpoint denied')
    status,_=send('/parse',{'url':'https://bad.example'},token)
    check(status==400 and parser.calls==1,'external screenshot URLs not allowed')
    status,_=send('/parse',{'image_base64':'not-encoded'},token)
    check(status==400 and parser.calls==1,'malformed image never reaches model')
    huge=(b'\x89PNG\r\n\x1a\n' + (13).to_bytes(4,'big') + b'IHDR' +
          (50000).to_bytes(4,'big') + (50000).to_bytes(4,'big') +
          b'\x08\x02\x00\x00\x00' + bytes(4))
    status,_=send('/parse',{'image_base64':base64.b64encode(huge).decode('ascii')},token)
    check(status==400 and parser.calls==1,'decompression-bomb dimensions denied')

    try:
        validate_image_request({'image_base64':png,'command':'click'})
        raise AssertionError('Unexpected effect parameter accepted')
    except ValueError:
        count+=1;print('PASS no extra action parameters')
finally:
    server.shutdown()
    server.server_close()
    thread.join(timeout=2)
print(f'OMNIPARSER_LOOPBACK: {count}/{count} PASS (stub inference; NOT live model)')
