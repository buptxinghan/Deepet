// SPDX-License-Identifier: GPL-3.0-or-later
#include "companion/RecoveryWeb.h"
#include "companion/PetCompanion.h"
#include "companion/FirmwareSafety.h"
#include "config/ConfigManager.h"
#include <Hash.h>
#include <LittleFS.h>

extern ConfigManager configManager;
namespace {
constexpr const char* TEMP = "/deepet-upload.tmp";
File pending;
MD5Builder digest;
String target, expectedMd5, error;
uint32_t expectedSize = 0, written = 0;
bool uploading = false, complete = false;

bool authorized(ESP8266WebServer& server) {
  return configManager.getApiToken()[0] && server.header("Authorization") ==
      String("Bearer ") + configManager.getApiToken();
}
void abortUpload(const char* reason) {
  error = reason;
  pending.close();
  LittleFS.remove(TEMP);
}
void upload(ESP8266WebServer& server) {
  auto& file = server.upload();
  if (!authorized(server)) return;
  if (file.status == UPLOAD_FILE_START) {
    if (uploading) { abortUpload("only_one_file_per_request"); return; }
    complete = false; error = ""; written = 0;
    target = server.arg("path"); expectedMd5 = server.arg("md5");
    expectedSize = server.arg("size").toInt();
    if (!FirmwareSafety::allowedAsset(target.c_str()) || !expectedSize ||
        expectedSize > 131072 || String(expectedSize) != server.arg("size")) {
      error = "invalid_path_or_size"; return;
    }
    if (expectedMd5.length() != 32) { error = "invalid_checksum"; return; }
    for (char c : expectedMd5) if (!isxdigit(c)) { error = "invalid_checksum"; return; }
    expectedMd5.toLowerCase();
    FSInfo info{};
    if (!LittleFS.info(info) || info.totalBytes < info.usedBytes ||
        info.totalBytes - info.usedBytes < expectedSize + 262144) {
      error = "insufficient_storage"; return;
    }
    PetCompanion::suspendForUpdate();
    uploading = true;
    if (target.startsWith("/pet/") && !LittleFS.exists("/pet")) LittleFS.mkdir("/pet");
    LittleFS.remove(TEMP);
    pending = LittleFS.open(TEMP, "w");
    if (!pending) { abortUpload("open_failed"); return; }
    digest.begin();
  } else if (file.status == UPLOAD_FILE_WRITE && uploading && error.isEmpty()) {
    if (!FirmwareSafety::rangeFits(expectedSize, written, file.currentSize)) {
      abortUpload("size_exceeded"); return;
    }
    if (pending.write(file.buf, file.currentSize) != file.currentSize) {
      abortUpload("write_failed"); return;
    }
    digest.add(file.buf, file.currentSize);
    written += file.currentSize;
    yield();
  } else if (file.status == UPLOAD_FILE_END && uploading && error.isEmpty()) {
    pending.close(); digest.calculate();
    if (written != expectedSize || digest.toString() != expectedMd5) {
      abortUpload("checksum_or_size_mismatch"); return;
    }
    // LittleFS rename commits the verified temporary file atomically. Never
    // delete the existing resource before this operation succeeds.
    if (!LittleFS.rename(TEMP, target)) { abortUpload("rename_failed"); return; }
    complete = true;
  } else if (file.status == UPLOAD_FILE_ABORTED) {
    abortUpload("aborted"); uploading = false;
  }
}

// This page lives in program Flash and remains available with absent, damaged,
// or partially installed display resources. It uses the normal authenticated OTA.
const char RECOVERY[] PROGMEM = R"HTML(<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Deepet Recovery</title>
<h2>Deepet Recovery</h2><p>This page works without display assets. Upload an uncompressed firmware.bin to repair the program. Keep power connected.</p>
<form id="f"><p><input id="token" type="password" required placeholder="Connection token" autocomplete="off"></p><p><input id="file" type="file" accept=".bin" required></p><button>Update firmware</button></form><pre id="result"></pre>
<script>f.onsubmit=async e=>{e.preventDefault();let b=f.querySelector('button');b.disabled=true;result.textContent='Uploading...';try{let d=new FormData();d.append('firmware',file.files[0]);let r=await fetch('/api/v1/ota/fw',{method:'POST',headers:{Authorization:'Bearer '+token.value},body:d});result.textContent=await r.text()}catch(e){result.textContent='Connection ended; wait 20 seconds, then reload.'}finally{b.disabled=false}};</script>)HTML";
}
namespace DeepetRecovery {
bool busy() { return uploading; }
void begin(ESP8266WebServer& server) {
  LittleFS.remove(TEMP); // Discard an interrupted staging file after reboot.
  server.on("/recovery", HTTP_GET, [&server]() {
    server.sendHeader("Cache-Control", "no-store");
    server.send_P(200, "text/html; charset=utf-8", RECOVERY);
  });
  server.on("/api/v1/companion/asset", HTTP_GET, [&server]() {
    if (!authorized(server)) { server.send(401, "application/json", "{\"error\":\"unauthorized\"}"); return; }
    const String path = server.arg("path");
    if (!FirmwareSafety::allowedAsset(path.c_str())) { server.send(400, "application/json", "{}"); return; }
    File asset = LittleFS.open(path, "r");
    if (!asset) { server.send(404, "application/json", "{}"); return; }
    server.sendHeader("Cache-Control", "no-store");
    server.streamFile(asset, "application/octet-stream");
    asset.close();
  });
  server.on("/api/v1/companion/asset", HTTP_POST, [&server]() {
    if (!authorized(server)) { server.send(401, "application/json", "{\"error\":\"unauthorized\"}"); return; }
    uploading = false;
    if (!complete || !error.isEmpty()) {
      pending.close(); LittleFS.remove(TEMP);
      if (error.isEmpty()) error = "missing_file";
      server.send(400, "application/json", String("{\"ok\":false,\"error\":\"") + error + "\"}");
    } else server.send(200, "application/json", "{\"ok\":true}");
    complete = false;
  }, [&server]() { upload(server); });
}
}
