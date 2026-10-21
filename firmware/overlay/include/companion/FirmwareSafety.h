#pragma once
#include <stddef.h>
#include <stdint.h>
#include <string.h>

namespace FirmwareSafety {
inline bool validRotationSeconds(int value) {
  return value == 10 || value == 15 || value == 30 || value == 60;
}
inline bool rangeFits(uint32_t size, uint32_t offset, uint32_t length) {
  return offset <= size && length <= size - offset;
}
inline bool due(uint32_t now, uint32_t deadline) {
  return deadline == 0 || int32_t(now - deadline) >= 0;
}
// Only independent display assets may be replaced. Settings, NVS and code
// cannot be addressed through the resource uploader.
inline bool allowedAsset(const char* path) {
  if (!path) return false;
  if (!strcmp(path, "/font.bin") || !strcmp(path, "/web/index.html") ||
      !strcmp(path, "/web/companion.html") || !strcmp(path, "/web/js/companion.js")) return true;
  if (strncmp(path, "/pet/", 5)) return false;
  const char* name = path + 5;
  const size_t n = strlen(name);
  if (n < 5 || n > 48 || strcmp(name + n - 4, ".spr")) return false;
  for (size_t i = 0; i < n - 4; ++i) {
    const char c = name[i];
    if (!(c >= 'a' && c <= 'z') && !(c >= '0' && c <= '9') && c != '-') return false;
  }
  return true;
}
}
