# Deepet Codex Hooks

本插件把任务事件发送给同一台Mac上的Deepet应用，不是读取Codex宠物内部状态的接口。

将本目录作为本地插件按Codex支持的方式安装、启用并审阅信任。`hooks/hooks.json` 声明监听的事件；`hooks/report.py` 仅转发事件类型与哈希会话标识，忽略提示词、命令参数及输出，不打印事件内容。插件读取 `~/Library/Application Support/Deepet/runtime.json`，后台未启动时静默退出。

不同Codex版本的插件配置支持可能不同，安装时以该版本官方文档为准。`plugin.portable.example.json` 是另一种插件描述示例，不能当成已适用于所有版本的入口。

插件和Mac应用需在同一台机器运行；服务器显示使用SSH，与此插件独立。
