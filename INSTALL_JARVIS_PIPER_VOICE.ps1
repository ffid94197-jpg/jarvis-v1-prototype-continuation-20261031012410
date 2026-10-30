# Download the user's selected voice; does not change existing .env or model profiles.
param([switch]$Force,[string]$PythonExe='python')
$ErrorActionPreference='Stop'
Set-Location $PSScriptRoot
$dest=Join-Path $PSScriptRoot 'windows-companion\perception\models\piper'
New-Item -ItemType Directory -Path $dest -Force | Out-Null
$source='https://huggingface.co/jgkawell/jarvis/resolve/main/en/en_GB/jarvis/high/'
$files=@('jarvis-high.onnx','jarvis-high.onnx.json')
$officialOnnxSha='9791877d9c099fabbf30be2825e011451c39b3431e21e81e866f5b6507e72993'
foreach($file in $files){
 $target=Join-Path $dest $file
 if((Test-Path $target) -and -not $Force){
   if($file -eq "jarvis-high.onnx" -and (Get-FileHash $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $officialOnnxSha){throw "Existing Piper ONNX SHA256 mismatch. Refusing to reuse file; inspect and use -Force only if appropriate."}
   Write-Host "Existing: $target";continue
 }
 $tmp="$target.download"
 try{
   Invoke-WebRequest -Uri ($source+$file) -OutFile $tmp -MaximumRedirection 5
   if(($file -eq 'jarvis-high.onnx') -and (Get-Item $tmp).Length -lt 50MB){throw 'ONNX is unexpectedly small. Refusing the download.'}
   if($file -eq 'jarvis-high.onnx' -and (Get-FileHash $tmp -Algorithm SHA256).Hash.ToLowerInvariant() -ne $officialOnnxSha){throw 'Downloaded Piper ONNX SHA256 does not match Hugging Face. Refusing model.'}
   if($file.EndsWith('.json')){
      $cfg=Get-Content $tmp -Raw | ConvertFrom-Json
      if(-not $cfg.audio.sample_rate){throw 'Invalid Piper JSON configuration.'}
   }
   Move-Item $tmp $target -Force
   $hash=(Get-FileHash $target -Algorithm SHA256).Hash
   Write-Host "Installed $file SHA256=$hash"
 }finally{Remove-Item $tmp -Force -ErrorAction SilentlyContinue}
}
& $PythonExe -m pip install 'piper-tts==1.8.0'
if ($LASTEXITCODE -ne 0) { throw 'Piper engine installation failed.' }
Write-Host 'Piper voice installed. Set JARVIS_TTS_ENABLED=1 in your private .env.'
Write-Host 'Review the model license and character/voice rights before public or commercial use.'
