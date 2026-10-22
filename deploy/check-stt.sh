#!/usr/bin/env bash
# Diagnoses "Generate subtitles does not work" on the server. Run from /srv/video-editor:
#   bash check-stt.sh                      # uses https://editor.shahabdev.ir
#   bash check-stt.sh https://other.domain
cd "$(dirname "$0")"
DOMAIN=${1:-https://editor.shahabdev.ir}
PORT=$(grep -s '^APP_PORT=' .env | cut -d= -f2); PORT=${PORT:-8081}
LOCAL=http://127.0.0.1:$PORT
# Colours only on a terminal, so `bash check-stt.sh > report.txt` stays plain text.
if [ -t 1 ]; then G='\033[32m' R='\033[31m' N='\033[0m'; else G='' R='' N=''; fi
ok() { printf "  ${G}OK${N}   %s\n" "$*"; }
bad() { printf "  ${R}FAIL${N} %s\n" "$*"; }

echo "== 1. Containers"
docker compose ps

echo "== 2. Model files on disk (./models), sizes compared with Hugging Face"
# size path (relative to ./models); from a complete download of every file.
EXPECTED="
32894434 onnx-community/whisper-tiny_timestamped/onnx/encoder_model.onnx
30730264 onnx-community/whisper-tiny_timestamped/onnx/decoder_model_merged_quantized.onnx
86804581 onnx-community/whisper-tiny_timestamped/onnx/decoder_model_merged_q4.onnx
82451730 onnx-community/whisper-base_timestamped/onnx/encoder_model.onnx
53712708 onnx-community/whisper-base_timestamped/onnx/decoder_model_merged_quantized.onnx
123738327 onnx-community/whisper-base_timestamped/onnx/decoder_model_merged_q4.onnx
352791798 onnx-community/whisper-small_timestamped/onnx/encoder_model.onnx
156795750 onnx-community/whisper-small_timestamped/onnx/decoder_model_merged_quantized.onnx
233421212 onnx-community/whisper-small_timestamped/onnx/decoder_model_merged_q4.onnx
32904992 onnx-community/whisper-tiny/onnx/encoder_model.onnx
30719241 onnx-community/whisper-tiny/onnx/decoder_model_merged_quantized.onnx
86713702 onnx-community/whisper-tiny/onnx/decoder_model_merged_q4.onnx
82468078 onnx-community/whisper-base/onnx/encoder_model.onnx
53693315 onnx-community/whisper-base/onnx/decoder_model_merged_quantized.onnx
123602419 onnx-community/whisper-base/onnx/decoder_model_merged_q4.onnx
352825870 onnx-community/whisper-small/onnx/encoder_model.onnx
156750845 onnx-community/whisper-small/onnx/decoder_model_merged_quantized.onnx
233149327 onnx-community/whisper-small/onnx/decoder_model_merged_q4.onnx
"
echo "$EXPECTED" | while read -r size path; do
  [ -z "$path" ] && continue
  f=models/$path
  if [ ! -e "$f" ]; then
    case $path in *_timestamped*) bad "missing  $path";; *) echo "  --   (older plain model, optional) $path";; esac
  else
    have=$(stat -c %s "$f")
    [ "$have" = "$size" ] && ok "$path" || bad "WRONG SIZE $path: $have bytes, expected $size (cut-off download)"
  fi
done
for d in models/onnx-community/whisper-*; do
  [ -d "$d" ] || continue
  for j in config.json tokenizer.json preprocessor_config.json generation_config.json; do
    [ -s "$d/$j" ] || bad "missing $d/$j"
  done
done
parts=$(find models -name '*.part' 2>/dev/null)
[ -n "$parts" ] && { bad "unfinished downloads (run fetch-models again):"; echo "$parts" | sed 's/^/        /'; }
echo "  owner/permissions of the models folder (nginx must be able to read it):"
ls -ld models models/onnx-community 2>&1 | sed 's/^/        /'

echo "== 3. Files as the browser gets them (inside the server: $LOCAL)"
check_url() { # url [html]: files must not come back as HTML (the SPA fallback), the page must
  h=$(curl -sS -I -m 15 "$1" 2>&1)
  code=$(echo "$h" | head -1 | awk '{print $2}')
  type=$(echo "$h" | grep -i '^content-type:' | tr -d '\r' | cut -d' ' -f2-)
  len=$(echo "$h" | grep -i '^content-length:' | tr -d '\r' | cut -d' ' -f2)
  want=${2:-file}
  if [ "$code" = 200 ] && { [ "$want" = html ] && echo "$type" | grep -qi html || { [ "$want" != html ] && ! echo "$type" | grep -qi html; }; }; then ok "$code $type ${len:-?} B  $1"; else bad "${code:-no answer} $type  $1"; echo "$h" | head -3 | sed 's/^/        /'; fi
}
M=/models/onnx-community/whisper-small_timestamped
for p in /wasm/ort-wasm-simd-threaded.asyncify.mjs /wasm/ort-wasm-simd-threaded.asyncify.wasm \
         $M/config.json $M/tokenizer.json $M/onnx/encoder_model.onnx $M/onnx/decoder_model_merged_quantized.onnx $M/onnx/decoder_model_merged_q4.onnx; do
  check_url "$LOCAL$p"
done

echo "== 4. Same through the public domain ($DOMAIN, via Caddy)"
check_url "$DOMAIN/" html
for p in /wasm/ort-wasm-simd-threaded.asyncify.wasm $M/onnx/encoder_model.onnx; do
  check_url "$DOMAIN$p"
done
echo "  headers the speech worker needs on the page (COOP/COEP):"
curl -sS -I -m 15 "$DOMAIN/" | grep -i -E '^(cross-origin|content-security|cache-control)' | sed 's/^/        /'

echo "== 5. Can this server download models itself?"
for u in https://huggingface.co/onnx-community/whisper-tiny_timestamped/resolve/main/config.json; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' -m 20 -L "$u" 2>&1)
  [ "$code" = 200 ] && ok "huggingface.co reachable" || bad "huggingface.co: $code (fetch-models cannot work here; copy ./models from a PC that has them)"
done

echo "== 6. Recent nginx errors for models/wasm"
docker compose logs --tail 400 app 2>&1 | grep -E '/(models|wasm)/' | grep -E '" (4|5)[0-9]{2} |error' | tail -15 | sed 's/^/        /'
echo "done."
