# Deepet

把 Mac、SSH 服务器和 AI 编程任务状态，变成桌上的一个小伙伴。

Deepet 是个人体验阶段的开源项目，包含 macOS 配套程序、浏览器控制台、Codex 状态转发插件，以及面向部分 ESP8266 / ST7789 小时钟的固件扩展源码。

## 能做什么

- 读取 Mac 的 CPU、Apple GPU、内存和磁盘状态；安装 Stats 时可选读取温度。
- 通过用户主动启用的现有 SSH 别名，读取 Linux / NVIDIA 服务器状态；支持双服务器同屏。
- 接收 Codex Hooks 的最少量任务状态，显示思考、工作、等待处理等动作。
- 日常9动作循环：前7个默认各45秒，打盹60秒、醒来30秒。可选30/45/60秒，任务与提醒优先，中断后延续进度。
- 留言气泡、网页遥控、夜间作息、持续高温与休息提醒。
- 固件采用局部合成与内容缓存，保留独立恢复页面；源码包含布局切换和字形排版修复。

## 公开版包含哪些内容

本仓库发布代码及原创几何占位图。**不包含 DeepSeek 娘或其他第三方角色 GIF、转换后的动画、系统字体字库、个人配置、实机照片、调试日志或预编译固件。** 现有第三方角色素材未核实完整的再分发授权，因此不会随源码发布。没有提供素材时，Mac 界面使用静态占位角色；补充自己有权使用的素材后可启用动画。见 [素材格式与授权](docs/ASSETS.md)。

早期本地原型的角色动画取自 [dsh-TUI 鲸娘像素表情集](https://dshtui.com/pets/whale-girl-emoji/)，中文字库由 macOS 苹方 PingFang SC Regular 生成。来源引用、转换方式和待确认的授权范围见 [素材来源与致谢](docs/ASSETS.md#参考素材来源与致谢)；引用不代表已取得素材再分发许可。

公开源码从独立目录建立全新 Git 历史，未导入开发工作区历史。此版本使用独立应用标识 `org.deepet.app` 和 `~/Library/Application Support/Deepet` 设置目录。

## 在 Mac 上运行

需要 macOS 14+、Xcode Command Line Tools、Node.js 24；打包脚本复用本机 Node 可执行文件，不自动安装软件。

```sh
git clone https://github.com/buptxinghan/Deepet.git
cd Deepet
./script/build_and_run.sh
```

如果 Node 不在 PATH 中，可设置 `DEEPET_NODE_BINARY`。只构建而不启动应用：

```sh
./script/build_and_run.sh --build-only
```

首次运行不会自动连接时钟或 SSH 服务器。在控制台填写自己的时钟地址及令牌，并主动选择服务器。局域网访问需允许 macOS 的本地网络权限。打包产物为本机临时签名，不包含 Apple 公证。

开发控制台也可单独启动：

```sh
node companion/server.cjs
```

默认仅监听本机；以输出的 `READY` 地址为准。退出程序停止采样。安装 Codex 插件见 [接入说明](integration/codex-plugin/README.md)。

## 测试

```sh
node --test companion/tests/*.test.cjs
c++ -std=c++17 -Ifirmware/overlay/include tools/test_firmware_safety.cpp -o /tmp/deepet-safety
/tmp/deepet-safety
```

测试覆盖配置持久化与校验、真实本机 API 的鉴权及来源限制、任务事件转发、指标过期、提醒优先级、断线重试、日常循环完整时长与抢占恢复。固件布局的资源相关测试与个人实机记录没有打包进公开仓库。

## 固件与硬件

固件基于 [Times-Z/GeekMagic-Open-Firmware](https://github.com/Times-Z/GeekMagic-Open-Firmware)，固定提交 `a0c2ddcef4e76fa6eb040f6f544124763a2d85f5`。本仓库提供 `firmware/overlay/` 扩展与构建脚本，未复制上游完整仓库。

GPIO、屏幕驱动、Flash布局和升级方式依具体硬件而定。编译和刷写不是同一步，本项目构建脚本不上传设备。本仓库不提供通用刷机包；使用前需确认屏幕接线、Flash布局、资源授权，并具备有线恢复方案。见 [构建边界](docs/BUILDING.md)。

## 隐私与许可

采样与控制服务在本机运行；指标按配置发送至用户的局域网时钟，服务器采样使用系统 SSH。Hooks 只转发事件类别和哈希会话标识，不保存或发送提示词、命令正文、模型回答。运行数据和连接令牌保存在用户目录，文件权限0600，不属于源码仓库。详见 [隐私与安全](SECURITY.md)。

代码采用 **GPL-3.0-or-later**；上游许可与贡献者声明见 [LICENSE](LICENSE) 和 [第三方说明](THIRD_PARTY_NOTICES.md)。素材授权单独计算，不能由代码许可证覆盖。
