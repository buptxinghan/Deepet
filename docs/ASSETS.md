# 自带素材

公开版没有附带第三方角色动画或系统字体字库。默认显示原创几何占位图；角色与字体的授权需独立于代码确认。

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
