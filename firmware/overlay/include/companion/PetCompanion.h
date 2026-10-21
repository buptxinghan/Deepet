#pragma once
#include "web/Webserver.h"
namespace PetCompanion {
void begin(Webserver* server);
void update();
void suspendForUpdate();
}
