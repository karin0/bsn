#!/data/data/com.termux/files/usr/bin/bash

echo "bsn runner started: $(date)"
set -o pipefail
cd "$(dirname "$0")" || exit 1

exec 5>&1
out=$(timeout -v 600 node main.js 2>&1 | tee >(cat - >&5))
if [ $? -eq 0 ]; then
  termux-notification -t "bsn ok" -c "$(echo "$out" | tail -n1)"
  termux-vibrate -d 1000
else
  termux-notification -t "bsn error" -c "$out"
  termux-vibrate -d 2000
  exit 2
fi
