#include "companion/FirmwareSafety.h"
#include <cassert>
#include <cstdint>
#include <initializer_list>
int main() {
  using namespace FirmwareSafety;
  // A damaged persisted interval must never become a zero divisor.
  for (int v : {INT32_MIN, -1, 0, 1, 65536, INT32_MAX}) assert(!validRotationSeconds(v));
  for (int v : {10, 15, 30, 60}) assert(validRotationSeconds(v));
  assert(rangeFits(100, 92, 8));
  assert(!rangeFits(100, 92, 9));
  assert(!rangeFits(100, UINT32_MAX - 4, 8));
  assert(!rangeFits(100, 16, UINT32_MAX));
  // Deadline sentinels and millis rollover must still permit resource recovery.
  assert(due(0x80000001U, 0));
  assert(due(0x10U, 0xfffffff0U));
  assert(!due(0xfffffff0U, 0x10U));
  for (const char* path : {"/font.bin", "/pet/01-idle.spr", "/web/index.html", "/web/companion.html", "/web/js/companion.js"}) assert(allowedAsset(path));
  for (const char* path : {"/config.json", "/companion.json", "/pet/../config.json", "/pet/foo/bar.spr", "/pet/evil..spr", "/pet/evil.spr/", "/web/js/api.js", "/pet/.spr", ""}) assert(!allowedAsset(path));
}
