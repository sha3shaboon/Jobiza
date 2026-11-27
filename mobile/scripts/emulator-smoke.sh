#!/usr/bin/env bash
# Smoke test on an Android emulator: install, launch, wait for the on-phone
# server, add a PDF the way "Share to Jobiza" does, and wait until it's processed.
# Usage: mobile/scripts/emulator-smoke.sh <apk> <out-dir>
set -uo pipefail
APK="$1"
OUT="$2"
PKG=app.jobiza.mobile
mkdir -p "$OUT"

collect() {
  adb logcat -d > "$OUT/logcat.txt" 2>&1 || true
  adb shell run-as $PKG cat files/logs/jobiza.log > "$OUT/server.log" 2>&1 || true
  adb exec-out screencap -p > "$OUT/$1.png" 2>/dev/null || true
}
fail() {
  echo "SMOKE TEST FAILED: $1"
  collect failure
  tail -40 "$OUT/server.log" || true
  exit 1
}

adb install -r "$APK" || fail "install"
adb logcat -c
adb shell am start -n $PKG/.MainActivity || fail "launch"

echo "Waiting for the server…"
for i in $(seq 1 150); do
  adb logcat -d -s Jobiza:I | grep -q "Server ready on port" && break
  adb logcat -d -s Jobiza:E | grep -q "Server failed to start" && fail "the server failed to start"
  sleep 2
done
adb logcat -d -s Jobiza:I | grep -q "Server ready on port" || fail "the server never became ready"
echo "Server ready after about $((i * 2))s"
sleep 10
collect 1-home

echo "Adding a PDF through the inbox…"
adb push "$(dirname "$0")/fixtures/smoke.pdf" /data/local/tmp/smoke.pdf >/dev/null
adb shell chmod 644 /data/local/tmp/smoke.pdf
adb shell "run-as $PKG sh -c 'cp /data/local/tmp/smoke.pdf files/library/inbox/.incoming && mv files/library/inbox/.incoming files/library/inbox/smoke.pdf'" || fail "couldn't write to the inbox"
for i in $(seq 1 90); do
  adb shell run-as $PKG cat files/logs/jobiza.log 2>/dev/null | grep -q "ingest-paper done" && break
  adb shell run-as $PKG cat files/logs/jobiza.log 2>/dev/null | grep -q "ingest-paper failed" && fail "processing the PDF failed"
  sleep 2
done
adb shell run-as $PKG cat files/logs/jobiza.log | grep -q "ingest-paper done" || fail "the PDF was never processed"
echo "PDF processed after about $((i * 2))s"

# Share a link the way another app would; the app should open the library.
adb shell am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT "'Worth reading: https://arxiv.org/abs/1706.03762'" -n $PKG/.MainActivity >/dev/null
sleep 12
collect 2-library

adb logcat -d | grep -q "FATAL EXCEPTION" && fail "the app crashed"
echo "Smoke test passed"
