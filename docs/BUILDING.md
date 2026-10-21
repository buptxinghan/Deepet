# 构建说明与边界

## Mac

参见根目录README。`script/build_and_run.sh` 是打包和运行入口，`--build-only` 不停止或启动运行中的应用。公开版应用标识、设置目录和缓存与原个人开发版本分离，默认不连接任何设备或服务器。

只发布源码，不附带Node运行时、应用ZIP或已编译固件。任何后续二进制发布都需要重新核对依赖和资源的再分发条件。

## ESP8266

公开的是覆盖层和已有构建脚本，目前还不是全平台一键工具链安装器。所需原生工具链、PlatformIO和文件系统工具需要先准备；没有提供一键刷写脚本。

1. 将上游源码克隆至 `src/geekmagic-open-firmware`，检出README所列的固定提交，保持其受跟踪源码干净。
2. 按 `tools/platformio-macos.ini` 准备 ESP8266 原生编译器、mklittlefs 与 PlatformIO 环境。脚本在 `~/Library/Caches/Deepet/firmware/` 下寻找 `venv/bin/pio`、`native-toolchain/`、`native-mklittlefs/` 和 `platformio/`，不会使用个人开发工作区缓存。
3. 根据 `docs/ASSETS.md` 准备自己有权使用的22份动画和 `font.bin`。
4. 执行 `python3 tools/build_companion_firmware.py`。脚本构建程序及文件系统镜像，并校验CRC与解包文件哈希，不上传设备。

仅有源码并不代表任意外观相似的时钟可使用。GPIO、方向、供电、Flash分区与原固件的OTA兼容性需在自己的设备上确认。没有原固件备份或有线恢复工具时，不建议直接试刷。

本次公开版验证Mac构建与无设备的测试；没有用公开占位图重新刷写个人时钟，没有声称附带可直接刷入的成品固件。
