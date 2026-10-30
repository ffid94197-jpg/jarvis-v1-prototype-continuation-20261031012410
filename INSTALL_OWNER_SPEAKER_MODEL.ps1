# Optional stronger owner-speaker model for JARVIS Wake (Windows local-only).
# ECAPA-TDNN VoxCeleb weights are ~83 MB; verify licenses before distribution.
# Run only on a trusted developer/testing laptop with internet access.
param(
  [string]$PythonExe = 'python',
  [string]$ModelRoot = '',
  [switch]$SkipPipInstall
)
$ErrorActionPreference = 'Stop'
if (-not $ModelRoot) { $ModelRoot = Join-Path $PSScriptRoot 'windows-companion\perception\models\speaker_ecapa' }
$ModelRoot = [IO.Path]::GetFullPath($ModelRoot)
New-Item -ItemType Directory -Path $ModelRoot -Force | Out-Null
if (-not $SkipPipInstall) {
  & $PythonExe -m pip install 'speechbrain>=1.0,<2' 'torch>=2.2' 'torchaudio>=2.2' 'huggingface_hub>=0.29,<2'
  if ($LASTEXITCODE -ne 0) { throw 'Speaker dependencies installation failed.' }
}
$env:JARVIS_OWNER_SPEAKER_MODEL_DIR = $ModelRoot
$code = @'
import os
from pathlib import Path
from huggingface_hub import snapshot_download
root=Path(os.environ['JARVIS_OWNER_SPEAKER_MODEL_DIR']).resolve()
snapshot_download(repo_id='speechbrain/spkrec-ecapa-voxceleb', local_dir=str(root), allow_patterns=['hyperparams.yaml','embedding_model.ckpt','mean_var_norm_emb.ckpt','classifier.ckpt','label_encoder.txt','config.json'])
required=['hyperparams.yaml','embedding_model.ckpt','mean_var_norm_emb.ckpt']
for n in required:
 p=root/n
 if not p.is_file() or p.stat().st_size < 100:
  raise SystemExit(f'Incomplete speaker model: {n}')
print('SPEAKER_MODEL_INSTALLED',root)
'@
$code | & $PythonExe -c 'import sys; exec(sys.stdin.read())'
if ($LASTEXITCODE -ne 0) { throw 'Speaker model download/validation failed.' }
Write-Host "Add to private .env: JARVIS_OWNER_SPEAKER_MODEL_DIR=`"$ModelRoot`""
Write-Host 'Then DELETE any legacy voice profile, and re-enroll three natural voice recordings.'
