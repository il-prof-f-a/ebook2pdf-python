#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSION_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd "$EXTENSION_DIR/.." && pwd)"
TEMP_DIR="$REPO_DIR/.tesseract-assets-tmp"

printf '%s\n' "Ebook2PDF - installazione asset OCR locali"
printf 'Cartella extension: %s\n' "$EXTENSION_DIR"

rm -rf "$TEMP_DIR"
mkdir -p "$TEMP_DIR"

npm install --prefix "$TEMP_DIR" --ignore-scripts --no-save \
  tesseract.js@7.0.0 \
  tesseract.js-core@7.0.0 \
  @tesseract.js-data/ita@1.0.0 \
  @tesseract.js-data/eng@1.0.0 \
  pdf-lib@1.17.1

mkdir -p \
  "$EXTENSION_DIR/lib/tesseract" \
  "$EXTENSION_DIR/lib/tesseract-core" \
  "$EXTENSION_DIR/lib/pdf-lib" \
  "$EXTENSION_DIR/tessdata"

cp "$TEMP_DIR/node_modules/tesseract.js/dist/tesseract.min.js" \
   "$EXTENSION_DIR/lib/tesseract/tesseract.min.js"
cp "$TEMP_DIR/node_modules/tesseract.js/dist/worker.min.js" \
   "$EXTENSION_DIR/lib/tesseract/worker.min.js"
cp "$TEMP_DIR"/node_modules/tesseract.js-core/tesseract-core* \
   "$EXTENSION_DIR/lib/tesseract-core/"
cp "$TEMP_DIR/node_modules/pdf-lib/dist/pdf-lib.min.js" \
   "$EXTENSION_DIR/lib/pdf-lib/pdf-lib.min.js"
cp "$TEMP_DIR/node_modules/@tesseract.js-data/ita/4.0.0_best_int/ita.traineddata.gz" \
   "$EXTENSION_DIR/tessdata/ita.traineddata.gz"
cp "$TEMP_DIR/node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz" \
   "$EXTENSION_DIR/tessdata/eng.traineddata.gz"

rm -rf "$TEMP_DIR"

printf '\nAsset OCR installati correttamente.\n'
printf 'Incluso pdf-lib per comporre immagine originale e layer text-only Tesseract.\n'
printf 'Ricarica l estensione dal pannello delle estensioni prima di provarla.\n'