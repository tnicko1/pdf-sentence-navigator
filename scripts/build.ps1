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
$ocrTarget = Join-Path $target "ocr"
if (Test-Path $ocrTarget) { Remove-Item -LiteralPath $ocrTarget -Recurse -Force }
New-Item -ItemType Directory -Force -Path $ocrTarget | Out-Null
Copy-Item "$root/node_modules/tesseract.js/dist/tesseract.esm.min.js" "$ocrTarget/tesseract.esm.min.js" -Force
Copy-Item "$root/node_modules/tesseract.js/dist/worker.min.js" "$ocrTarget/worker.min.js" -Force
Copy-Item "$root/node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js" "$ocrTarget/tesseract-core-simd-lstm.wasm.js" -Force
Copy-Item "$root/node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz" "$ocrTarget/eng.traineddata.gz" -Force
Write-Output "PDF.js runtime copied to vendor/."
