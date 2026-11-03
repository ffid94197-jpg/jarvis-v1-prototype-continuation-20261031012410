param(
  [string]$PythonPath = $env:JARVIS_PYTHON
)
$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($PythonPath)) { $PythonPath = "python" }
$root = Split-Path -Parent $PSScriptRoot
$requirements = Join-Path $root "windows-companion\requirements-cua.txt"
if ($env:OS -ne "Windows_NT") { throw "Cua Driver installation is Windows-only." }
if (!(Test-Path $requirements)) { throw "Pinned Cua Driver requirements file is missing." }

& $PythonPath -c "import sys; assert (3,10) <= sys.version_info[:2] <= (3,13), 'Python 3.10–3.13 required'; print('Python', sys.version)"
if ($LASTEXITCODE -ne 0) { throw "Use the same Python 3.10–3.13 interpreter configured by JARVIS_PYTHON." }

& $PythonPath -m pip install --disable-pip-version-check --only-binary=:all: --index-url https://pypi.org/simple -r $requirements
if ($LASTEXITCODE -ne 0) { throw "Pinned Cua Driver SDK installation failed." }

& $PythonPath -c "import cua_driver; assert cua_driver.__version__ == '0.38.0'; print('Cua Driver SDK', cua_driver.__version__)"
if ($LASTEXITCODE -ne 0) { throw "Cua Driver SDK import/version check failed." }

Write-Host ""
Write-Host "Install complete. Enable only in an isolated local development session:"
Write-Host "  JARVIS_EXPERIMENTAL_DESKTOP_CONTROL=1"
Write-Host "  JARVIS_CUA_DRIVER_ENABLED=1"
Write-Host "Guardian authorization and the localhost companion remain mandatory."
