param([switch]$SkipVoice,[string]$PythonExe='python')
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$models = Join-Path $PSScriptRoot 'windows-companion\perception\models'
New-Item -Type Directory -Force -Path $models | Out-Null
$artifacts = @(
  @{ Name='face_detection_yunet_2023mar.onnx'; Sha='8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4'; Uri='https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx' },
  @{ Name='face_recognition_sface_2021dec.onnx'; Sha='0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79'; Uri='https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx' }
)
foreach($model in $artifacts){
  $dest=Join-Path $models $model.Name
  if((Test-Path $dest) -and ((Get-FileHash $dest -Algorithm SHA256).Hash.ToLowerInvariant() -eq $model.Sha)){Write-Host "Verified existing $($model.Name)";continue}
  $temp="$dest.download"
  try {
    Invoke-WebRequest -Uri $model.Uri -OutFile $temp -MaximumRedirection 5
    $got=(Get-FileHash $temp -Algorithm SHA256).Hash.ToLowerInvariant()
    if($got -ne $model.Sha){throw "SHA256 mismatch ($got). Refusing model $($model.Name)."}
    Move-Item $temp $dest -Force
    Write-Host "Installed SHA256-verified $($model.Name)"
  } finally {Remove-Item $temp -Force -ErrorAction SilentlyContinue}
}
if(-not $SkipVoice){
  $voice = Join-Path $models 'vosk-model-small-en-us-0.15'
  if(!(Test-Path $voice)){
    $zip = Join-Path $models 'vosk-model-small-en-us-0.15.zip.download'
    try {
      Invoke-WebRequest -Uri 'https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip' -OutFile $zip
      # Check ZIP members for traversal before expanding. Official Vosk distribution only.
      @'
import sys,zipfile,pathlib
f=pathlib.Path(sys.argv[1]);root=pathlib.Path(sys.argv[2]).resolve()
with zipfile.ZipFile(f) as z:
  for entry in z.infolist():
    path=pathlib.PurePosixPath(entry.filename.replace('\\','/'))
    if path.is_absolute() or '..' in path.parts or (path.parts and path.parts[0]!='vosk-model-small-en-us-0.15'):
      raise SystemExit('Unsafe Vosk ZIP path')
  z.extractall(root)
'@ | & $PythonExe - $zip $models
      if ($LASTEXITCODE -ne 0) { throw 'Vosk model ZIP validation/extraction failed.' }
      Write-Host 'Installed Vosk local speech model.'
    } finally {Remove-Item $zip -Force -ErrorAction SilentlyContinue}
  }
}
Write-Host 'Models downloaded. Next set JARVIS_PERCEPTION_ENABLED=1 and JARVIS_FACE_VAULT_KEY in .env.'
Write-Host 'Generate a key privately with: python -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())"'
Write-Host 'Never share the vault key or expose JARVIS outside localhost.'
