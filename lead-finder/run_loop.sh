#!/bin/bash
# Repeatedly crawl newly discovered seeds while discovery runs; final pass at the end.
cd "$(dirname "$0")"
while pgrep -f discover_dcoil.py >/dev/null; do
  python3 crawler.py --workers 10 --target 100000 >> output/crawl_loop.log 2>&1
  sleep 180
done
python3 crawler.py --workers 10 --target 100000 >> output/crawl_loop.log 2>&1
echo "LOOP-FINISHED" >> output/crawl_loop.log
