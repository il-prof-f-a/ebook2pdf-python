$ErrorActionPreference = "Stop"

$ExtensionDir = Split-Path -Parent $PSScriptRoot
$RepoDir = Split-Path -Parent $ExtensionDir
$TempDir = Join-Path $RepoDir ".tesseract-assets-tmp"
$NodeModules = Join-Path $TempDir "node_modules"

Write-Host "Ebook2PDF - installazione asset OCR Tesseract.js"
Write-Host "Cartella extension: $ExtensionDir"

if (Test-Path $TempDir) {
    Remove-Item -Recurse -Force $TempDir
}

New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

npm install --prefix $TempDir --ignore-scripts --no-save `
    tesseract.js@7.0.0 `
    tesseract.js-core@7.0.0 `
    @tesseract.js-data/ita@1.0.0 `
    @tesseract.js-data/eng@1.0.0

$TesseractDir = Join-Path $ExtensionDir "lib\tesseract"
$CoreDir = Join-Path $ExtensionDir "lib\tesseract-core"
$TessdataDir = Join-Path $ExtensionDir "tessdata"

New-Item -ItemType Directory -Force -Path $TesseractDir, $CoreDir, $TessdataDir | Out-Null

Copy-Item (Join-Path $NodeModules "tesseract.js\dist\tesseract.min.js") $TesseractDir -Force
Copy-Item (Join-Path $NodeModules "tesseract.js\dist\worker.min.js") $TesseractDir -Force
Copy-Item (Join-Path $NodeModules "tesseract.js-core\tesseract-core*") $CoreDir -Force
Copy-Item (Join-Path $NodeModules "@tesseract.js-data\ita\4.0.0_best_int\ita.traineddata.gz") $TessdataDir -Force
Copy-Item (Join-Path $NodeModules "@tesseract.js-data\eng\4.0.0_best_int\eng.traineddata.gz") $TessdataDir -Force

Remove-Item -Recurse -Force $TempDir

Write-Host ""
Write-Host "Asset OCR installati correttamente." -ForegroundColor Green
Write-Host "Ricarica l'estensione da chrome://extensions/ prima di provarla."