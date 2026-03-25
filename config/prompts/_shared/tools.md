# 工具定义

当你需要执行操作时，使用以下工具调用格式：

## 文件操作

### 读取文件

当需要读取文件内容时，使用：
<tool_call>{"name": "read_file", "args": {"path": "文件路径"}}</tool_call>

### 写入文件

当需要写入文件时，使用：
<tool_call>{"name": "write_file", "args": {"path": "文件路径", "content": "文件内容"}}</tool_call>

### 列出文件

当需要列出目录文件时，使用：
<tool_call>{"name": "list_files", "args": {}}</tool_call>

## 命令执行

### 执行命令

当需要执行Shell命令时，使用：
<tool_call>{"name": "execute_command", "args": {"command": "命令", "args": ["参数"]}}</tool_call>
