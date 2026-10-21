#pragma once
#include <ESP8266WebServer.h>
namespace DeepetRecovery {
void begin(ESP8266WebServer& server);
bool busy();
}
