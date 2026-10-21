# 素材来源、格式与授权

公开版没有附带第三方角色动画或系统字体字库。默认显示原创几何占位图；角色与字体的授权需独立于代码确认。

## 参考素材来源与致谢

Deepet 早期本地原型使用过以下素材，感谢来源站点提供的展示与参考。公开源码保留来源记录，素材文件不随仓库分发。

| 素材 | 来源 | 在本地原型中的使用方式 | 授权核查状态 |
| --- | --- | --- | --- |
| DeepSeek 娘 / 鲸娘的 22 套像素 GIF | [dsh-TUI 鲸娘像素表情集](https://dshtui.com/pets/whale-girl-emoji/) | Mac 显示 GIF；时钟端恢复为 69×66 逻辑像素并转换成 WSP1 动画，文字气泡由程序另行绘制 | 2026-10-20 的核查未确认原始作者署名和允许改编、嵌入固件及公开再分发的明确许可；未附带 GIF 或转换后的动画 |
| 中文点阵字库的字体来源 | macOS 苹方 PingFang SC Regular，字体选择名为 `PingFangSC-Regular`；参见 [Apple 系统字体列表](https://developer.apple.com/fonts/system-fonts/) | 本地原型将所需字符栅格化为 12×14 的 WCF1 `font.bin` | 尚未核实生成字库随固件公开再分发的许可；未附带系统字体文件或生成的字库。适用条款应查阅所用系统随附的许可，参考 [Apple 软件许可入口](https://www.apple.com/legal/sla/) |

dsh-TUI 是这套 GIF 的获取来源；原画、角色和动画的权利人仍需分别确认。上述引用用于说明来源和处理方式，不表示素材已采用 GPL、不替代权利人的授权，也不表示来源站点或字体提供方为 Deepet 背书。准备公开分发应用或固件时，请使用授权范围覆盖相应用途的素材，并保留其要求的署名及许可证。

## Mac 动画

准备自己有权使用的透明 GIF，按下列名称放进一个外部目录。构建时设置 `DEEPET_PET_ASSETS` 指向该目录，原文件不会写入源码仓库。

```text
01-idle.gif          02-idle-look.gif    03-idle-spout.gif
04-thinking.gif      05-typing.gif       06-music.gif
07-conducting.gif    08-building.gif     09-error.gif
10-happy.gif         11-notification.gif 12-compacting.gif
13-carrying.gif      14-sleeping.gif     15-waking.gif
16-poke-left.gif     17-poke-right.gif   18-tickle.gif
19-drag.gif          20-swim.gif         21-smile-hearts.gif
22-thumbs-up.gif
```

缺失的 GIF 自动显示占位图。占位图是静态形象，不冒充完整的动画包。

## ESP8266 资源

设备使用69×66逻辑像素、RGB565调色板加透明索引的WSP1格式。`tools/encode_sprites.py` 接受保持此网格、最近邻放大8倍的552×528 GIF；当前输入目录为被忽略的 `assets/references/whale-girl/`，目录名仅是格式适配历史命名，不附带任何角色授权。建议在本地副本修改输入目录以使用自己的素材。

转换输出放在 `firmware/resources/pet/`。构建前需准备全部22个动作，缺失时构建脚本会停止。该目录全部忽略，不进入本次源码发布。

字库为WCF1、12×14、16位字符编码索引。`tools/BuildFont.swift` 必须显式指定已安装且可合法使用的字体名称，没有系统字体自动回退；字符清单和生成的 `font.bin` 由使用者提供。生成工具不是字体授权证明。
