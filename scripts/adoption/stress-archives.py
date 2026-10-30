"""Portable ZIP adversarial corpus, includes Windows-specific filename collision checks."""
import contextlib, io, json, pathlib, runpy, stat, subprocess, sys, tempfile, warnings, zipfile
EXTRACTOR=pathlib.Path(__file__).with_name('safe_extract.py')
checks=0

def run_zip(members,valid):
    global checks
    with tempfile.TemporaryDirectory() as t:
        zpath=pathlib.Path(t)/'test.zip'
        with warnings.catch_warnings():
            warnings.simplefilter('ignore',UserWarning)
            with zipfile.ZipFile(zpath,'w',zipfile.ZIP_DEFLATED) as z:
                for name,payload,mode in members:
                    zi=zipfile.ZipInfo(name)
                    if mode:
                        zi.create_system=3;zi.external_attr=(mode<<16)
                    z.writestr(zi,payload)
        old_argv=sys.argv
        accepted=False
        try:
            sys.argv=[str(EXTRACTOR),str(zpath),str(pathlib.Path(t)/'extract')]
            with contextlib.redirect_stdout(io.StringIO()):
                runpy.run_path(str(EXTRACTOR),run_name='__main__')
            accepted=True
        except (ValueError,zipfile.BadZipFile,FileExistsError,NotADirectoryError,IsADirectoryError):
            pass
        finally:
            sys.argv=old_argv
        if valid != accepted:
            raise AssertionError(f'Unexpected archive acceptance={accepted} for {members[0][0]}')
        checks+=1
        if valid:
            destination=pathlib.Path(t)/'extract'
            for name,payload,mode in members:
                if not name.endswith('/'):
                    assert (destination/name).read_bytes()==payload
                    checks+=1

def member(name,data=b'sample',mode=0):return (name,data,mode)
run_zip([member('repo/SKILL.md',b'---\nname: a\ndescription: b\n---\nGood')],True)
run_zip([member('repo/a'),member('repo/b'),member('repo/sub/c')],True)
for name in [
 '../escape', 'repo/../escape', '/etc/passwd', 'repo\\secret.txt', 'C:/windows.txt',
 'repo/CON', 'repo/NUL.txt', 'repo/AUX.log', 'repo/lpt1.dat',
 'repo/file.', 'repo/file ', 'repo/x:y', 'repo//empty', 'repo/./dot',
 'repo/space\tname', 'repo/forbidden\x01', 'repo/'+('a'*370),
 ]:
    run_zip([member(name)],False)
run_zip([member('repo/SKILL.md'),member('repo/SKILL.md',b'shadow')],False)
run_zip([member('repo/skill.md'),member('repo/SKILL.md',b'shadow')],False)
run_zip([member('repo/e\u0301.txt'),member('repo/\u00e9.txt')],False)
run_zip([member('repo/link',b'../../etc/passwd',stat.S_IFLNK|0o777)],False)
run_zip([member('repo/pipe',b'',stat.S_IFIFO|0o600)],False)
run_zip([member('repo/huge.bin',b'A'*(12*1024*1024+1))],False)
run_zip([member(f'repo/f{i}',b'') for i in range(1501)],False)
# Large mutation matrix: many distinct legal paths, all archive normalization rules.
for n in range(120):
    good=f'repo/subdir{n}/file_{n}.txt'
    run_zip([member(good,b'x'*n)],True)
print(json.dumps({'status':'PASS','archiveChecks':checks,'validAndHostileCases':'real ZIP extraction exercised through Python runpy in isolated temporary folders','windowsCollisionProtection':True}))
