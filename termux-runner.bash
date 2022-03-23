#!/usr/bin/bash

# This is expected to run in a Termux proot distro. For use in native Termux
# (if you have a working puppeteer), use the specific shebang:
#!/data/data/com.termux/files/usr/bin/bash

set -o pipefail

echo "bsn runner started: $(date)"
cd "$(dirname "$0")" || exit 1

exec 5>&1
out=$(timeout -v 600 node main.js 2>&1 | tee >(cat - >&5))
res=$?
if [ $res -eq 0 ]; then
  title="bsn ok"
  vib=1000
else
  title="bsn error"
  vib=2000
fi

termux-notification -t "$title" -c "$(echo "$out" | tail -n1)" \
  --action="termux-dialog confirm -t '$title' -i '$out'"
termux-vibrate -d $vib
exit $res
