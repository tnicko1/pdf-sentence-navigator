$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root "node_modules/pdfjs-dist"
$target = Join-Path $root "vendor"

if (-not (Test-Path $source)) { throw "Run npm install before npm run build." }
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item "$source/build/pdf.min.mjs" "$target/pdf.min.mjs" -Force
Copy-Item "$source/build/pdf.worker.min.mjs" "$target/pdf.worker.min.mjs" -Force
foreach ($folder in @("cmaps", "standard_fonts", "wasm")) {
  $folderTarget = Join-Path $target $folder
  if (Test-Path $folderTarget) { Remove-Item -LiteralPath $folderTarget -Recurse -Force }
  Copy-Item "$source/$folder" $folderTarget -Recurse -Force
}
Write-Output "PDF.js runtime copied to vendor/."
