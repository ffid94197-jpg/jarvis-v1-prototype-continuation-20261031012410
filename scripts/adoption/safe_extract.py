"""Extract untrusted GitHub ZIP without execution; reject traversal, links, bombs and ambiguous Windows paths."""
import pathlib, stat, sys, unicodedata, zipfile
src, dst = sys.argv[1:3]
MAX_FILES = 1500
MAX_BYTES = 100*1024*1024
MAX_SINGLE = 12*1024*1024
WINDOWS_DEVICES = {'CON', 'PRN', 'AUX', 'NUL', *(f'COM{i}' for i in range(1,10)), *(f'LPT{i}' for i in range(1,10))}
with zipfile.ZipFile(src) as z:
    members = z.infolist()
    if len(members) > MAX_FILES:
        raise ValueError('too many repository files')
    if sum(i.file_size for i in members) > MAX_BYTES:
        raise ValueError('archive expands too large')
    base = pathlib.Path(dst).resolve()
    # Validate the whole manifest BEFORE writing any data.
    seen = set()
    for i in members:
        raw = i.filename[:-1] if i.is_dir() and i.filename.endswith('/') else i.filename
        segments = raw.split('/')
        if (not raw or i.filename.startswith('/') or '\\' in i.filename
                or len(i.filename) > 360 or any(seg in ('', '.', '..') for seg in segments)):
            raise ValueError('unsafe path')
        if any((seg.endswith((' ', '.')) or ':' in seg or any(ord(ch)<32 for ch in seg)
                or seg.split('.')[0].upper() in WINDOWS_DEVICES) for seg in segments):
            raise ValueError('Windows-unsafe package path')
        key = '/'.join(unicodedata.normalize('NFC',seg).casefold() for seg in segments)
        if key in seen:
            raise ValueError('duplicate or case-colliding archive entry')
        seen.add(key)
        mode = i.external_attr >> 16
        if stat.S_ISLNK(mode):
            raise ValueError('symlinks not supported')
        if stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR):
            raise ValueError('unsupported archive file type')
        if i.file_size > MAX_SINGLE:
            raise ValueError('oversized file')
        target = (base / i.filename).resolve()
        if not target.is_relative_to(base):
            raise ValueError('path traversal')
    base.mkdir(parents=True,exist_ok=True)
    for i in members:
        target = (base / i.filename).resolve()
        if i.is_dir():
            target.mkdir(parents=True,exist_ok=True)
            continue
        target.parent.mkdir(parents=True,exist_ok=True)
        with z.open(i) as read, open(target,'xb') as write:
            while chunk := read.read(65536):
                write.write(chunk)
print('JARVIS_INTEGRATION_ARCHIVE_VALID')
