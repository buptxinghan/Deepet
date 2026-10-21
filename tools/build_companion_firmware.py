#!/usr/bin/env python3
"""Stage a custom GPL firmware on top of the verified baseline; never upload."""
import datetime,gzip,hashlib,json,os,shutil,struct,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
CACHE=Path.home()/'Library/Caches/Deepet/firmware'
STAGE=CACHE/'deepet-firmware'
BASE=ROOT/'src/geekmagic-open-firmware'
OVERLAY=ROOT/'firmware/overlay'

def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def prepare():
    if not (ROOT/"firmware/resources/font.bin").is_file() or len(list((ROOT/"firmware/resources/pet").glob("*.spr")))!=22:
        raise SystemExit("Supply your own licensed font.bin and 22 WSP1 sprites; see docs/ASSETS.md. No firmware was built or uploaded.")
    revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=BASE,text=True).strip()
    assert revision=='a0c2ddcef4e76fa6eb040f6f544124763a2d85f5'
    assert not subprocess.check_output(['git','diff','--name-only','HEAD'],cwd=BASE,text=True).strip()
    STAGE.mkdir(parents=True,exist_ok=True)
    for name in ['src','include','lib','scripts','data']:
        shutil.copytree(BASE/name,STAGE/name,dirs_exist_ok=True,ignore=shutil.ignore_patterns('._*','.DS_Store'))
    shutil.copy(BASE/'LICENSE',STAGE/'LICENSE')
    shutil.copytree(OVERLAY,STAGE,dirs_exist_ok=True,ignore=shutil.ignore_patterns('._*','.DS_Store'))
    shutil.copytree(ROOT/'firmware/resources/pet',STAGE/'data/pet',dirs_exist_ok=True,ignore=shutil.ignore_patterns('._*'))
    shutil.copy(ROOT/'firmware/resources/font.bin',STAGE/'data/font.bin')
    source=STAGE/'src/main.cpp';text=source.read_text()
    text=text.replace('#include <array>','#include <array>\n#include "companion/PetCompanion.h"')
    text=text.replace('    const bool littleFsMounted = LittleFS.begin();','    LittleFSConfig fsConfig;\n    fsConfig.setAutoFormat(false);\n    LittleFS.setConfig(fsConfig);\n    const bool littleFsMounted = LittleFS.begin();')
    text=text.replace('DisplayManager::drawStartup(wifiManager->getIP().toString());','DisplayManager::drawStartup(wifiManager->getIP().toString());\n    PetCompanion::begin(webserver);')
    text=text.replace('    DisplayManager::update();','    PetCompanion::update();')
    source.write_text(text)
    config=STAGE/'src/config/ConfigManager.cpp';text=config.read_text()
    text=text.replace('    if (size == 0) {','    if (size == 0 || size > 4096) {',1)
    config.write_text(text)
    api=STAGE/'src/web/Api.cpp';text=api.read_text();text='#include "companion/PetCompanion.h"\n'+text
    text=text.replace('    otaInProgress = true;','    PetCompanion::suspendForUpdate();\n    otaInProgress = true;',1)
    text += '\n// Keep the local player off the OTA progress screen.\nbool companionOtaBusy() { return otaInProgress; }\n'
    for handler in ['handlePlayGif','handleStopGif']:
        marker='void '+handler+'(Webserver* webserver) {'
        assert marker in text
        text=text.replace(marker,marker+'\n    if (!requireBearerToken(webserver)) return;\n    webserver->raw().send(409, "application/json", "{\\"error\\":\\"companion_controls_display\\"}");\n    return;\n',1)
    api.write_text(text)
    home=STAGE/'data/web/index.html';text=home.read_text();text=text.replace('<body>','<body>\n<div style="padding:18px;text-align:center"><a href="/companion.html">桌宠与状态 · Deepet</a></div>',1);home.write_text(text)
    (STAGE/'data/config.json').write_text((BASE/'data/config-smartTV.example').read_text())
    shutil.copy(ROOT/'tools/platformio-macos.ini',STAGE/'platformio-native.ini')
    resource_bytes=sum(p.stat().st_size for p in (STAGE/'data/pet').glob('*.spr'))
    assert resource_bytes<=655360 and (STAGE/'data/font.bin').stat().st_size<=131072
    assert sum(p.stat().st_size for p in (OVERLAY/'data/web').rglob('*') if p.is_file() and not p.name.startswith('.'))<=131072
    return revision,resource_bytes
def main():
    revision,animation_bytes=prepare()
    stamp=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).strftime('%Y%m%d-%H%M%S')
    dest=ROOT/'firmware/releases'/('deepet-0.1.5-'+stamp);dest.mkdir(parents=True,exist_ok=False)
    environment=os.environ.copy();environment.update(PLATFORMIO_CORE_DIR=str(CACHE/'platformio'),DESKTOP_CLOCK_BUILD_CACHE=str(CACHE),PLATFORMIO_SETTING_ENABLE_TELEMETRY='No')
    for target,log in [(None,'build-firmware.log'),('buildfs','build-filesystem.log')]:
        args=[str(CACHE/'venv/bin/pio'),'run','-e','esp12e','-c','platformio-native.ini']
        if target:args+=['--target',target]
        print('Building '+(target or 'program'),flush=True)
        with (dest/log).open('w') as file:
            result=subprocess.run(args,cwd=STAGE,env=environment,stdout=file,stderr=subprocess.STDOUT)
        if result.returncode:raise SystemExit('Build failed: '+str(dest/log))
        # PlatformIO can invalidate the program cache when switching to buildfs.
        # Retain the just-built artifact before selecting the next target.
        name='littlefs.bin' if target else 'firmware.bin'
        shutil.copy(STAGE/'.pio/build/esp12e'/name,dest/name)
    (dest/'firmware.bin.gz').write_bytes(gzip.compress((dest/'firmware.bin').read_bytes(),compresslevel=9,mtime=0))
    sys.path.insert(0,str(ROOT/'tools'));import build_baseline
    build_baseline.STAGE=STAGE;verification=build_baseline.verify_artifacts(dest)
    manifest={'name':'Deepet','version':'0.1.5','baseline_commit':revision,'stage':str(STAGE),'animation_bytes':animation_bytes,'font_bytes':(STAGE/'data/font.bin').stat().st_size,'device_flashed':False,'deployment':'Uncompressed program OTA followed by checksum-verified atomic resource uploads; preserve the live filesystem and NVS','checks':verification,'artifacts':[{'file':p.name,'bytes':p.stat().st_size,'sha256':digest(p)} for p in [dest/'firmware.bin',dest/'firmware.bin.gz',dest/'littlefs.bin']]}
    (dest/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    (ROOT/'firmware/releases/latest.json').write_text(json.dumps({'directory':str(dest)},indent=2)+'\n')
    print(json.dumps(manifest),flush=True)
if __name__=='__main__':main()
