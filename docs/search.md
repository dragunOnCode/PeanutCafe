# Claude Code 源码分析 - Agent 实现机制研究

> 来源: 对 claude-code 源码的深入分析
> 日期: 2026-04-03
> 目标: 为 PeanutCafe 的 Agent 系统提供架构参考

---

## 一、项目概览

**Repository**: `anthropics/claude-code` on GitHub  
**语言分布**: Shell (47.1%), Python (29.2%), TypeScript (17.7%), PowerShell (4.1%)

### 核心目录结构

```
claude-code/
├── .claude-plugin/              # 插件市场配置
│   └── marketplace.json
├── .claude/                      # 内置命令
│   └── commands/
├── plugins/                      # 可扩展插件系统
│   ├── agent-sdk-dev/            # Agent SDK 开发工具
│   ├── code-review/              # PR review 插件
│   ├── feature-dev/              # 特性开发工作流
│   ├── hookify/                  # 自定义钩子系统
│   └── [other plugins...]
├── examples/                     # 示例配置
└── scripts/                      # 工具脚本
```

---

## 二、Agent 定义机制

### 2.1 Agent 文件格式 (Markdown + YAML Frontmatter)

```markdown
---
name: agent-identifier
description: Use this agent when [triggering conditions]. Examples:

<example>
Context: [Situation description]
user: "[User request]"
assistant: "[How assistant should respond]"
<commentary>
[Why this agent should be triggered]
</commentary>
</example>

model: inherit        # or sonnet, opus, haiku
color: blue           # or cyan, green, yellow, magenta, red
tools: ["Read", "Write", "Grep"]  # Optional - restricts tools
---

You are [agent role description]...

**Your Core Responsibilities:**

1. [Responsibility 1]
2. [Responsibility 2]

**Analysis Process:**
[Step-by-step workflow]

**Output Format:**
[What to return]
```

### 2.2 Frontmatter 字段说明

| 字段          | 必填 | 选项                                                | 用途           |
| ------------- | ---- | --------------------------------------------------- | -------------- |
| `name`        | Yes  | lowercase, hyphens, 3-50 chars                      | Agent 唯一标识 |
| `description` | Yes  | Text with `<example>` blocks                        | 触发条件描述   |
| `model`       | Yes  | `inherit`, `sonnet`, `opus`, `haiku`                | 模型选择       |
| `color`       | Yes  | `blue`, `cyan`, `green`, `yellow`, `magenta`, `red` | 视觉标识       |
| `tools`       | No   | Array of tool names                                 | 工具访问限制   |

### 2.3 模型选择策略

| 模型      | 用途                    | 特点           |
| --------- | ----------------------- | -------------- |
| `inherit` | 使用父 Agent 相同模型   | 默认推荐       |
| `haiku`   | 快速过滤/预检           | 便宜、快速     |
| `sonnet`  | 复杂分析                | 平衡之选       |
| `opus`    | 关键 bug 追踪、架构设计 | 最高能力、昂贵 |

### 2.4 颜色语义

- **Blue/Cyan**: 分析、审查
- **Green**: 成功导向任务、生成
- **Yellow**: 谨慎、验证
- **Red**: 关键问题、安全
- **Magenta**: 创造性任务、转换

---

## 三、插件架构

### 3.1 插件标准结构

```
plugin-name/
├── .claude-plugin/
│   └── plugin.json          # 插件元数据
├── agents/                   # Agent 定义
│   ├── agent-one.md
│   └── agent-two.md
├── commands/                 # Slash 命令
│   └── command.md
├── skills/                   # Agent 技能
│   └── skill-name/
│       └── SKILL.md
├── hooks/                    # 钩子处理器
│   ├── hooks.json            # 钩子配置
│   └── *.py                  # Python 实现
└── README.md
```

### 3.2 插件元数据格式 (`plugin.json`)

```json
{
  "name": "plugin-name",
  "version": "1.0.0",
  "description": "Plugin description",
  "author": "Author name"
}
```

---

## 四、多 Agent 编排模式

### 4.1 编排流程 (来自 code-review 插件)

```
1. 启动 haiku agent 做快速过滤/预检
2. 并行启动 sonnet/opus agents 做独立分析
3. 启动验证 agents 确认问题
4. 按置信度过滤（只报告 ≥80% 置信度的问题）
5. 汇总结果
```

### 4.2 并行执行策略

- 独立任务并行启动多个 Agent
- 主 Agent 创建 todo list
- 子 Agent 并行工作
- 主 Agent 汇总子 Agent 结果

### 4.3 置信度评分模式

```markdown
Rate each issue 0-100:

- 0: False positive, pre-existing issue
- 25: Might be real, but likely false positive
- 50: Real but nitpick
- 75: Highly confident real issue
- 100: Absolutely certain

Only report issues with confidence ≥ 80
```

---

## 五、工具限制模式

### 5.1 工具白名单

```yaml
tools: ["Read", "Grep", "Glob"]           # 只读分析
tools: ["Read", "Write", "Bash"]          # 代码生成
tools: ["*"]                                # 完全访问（默认）
```

### 5.2 安全原则

按最小权限原则限制 Agent 可用工具，防止越权操作。

---

## 六、分阶段工作流

来自 `feature-dev` 插件的 Phase-Based 执行模式：

```markdown
## Phase 1: Discovery

- Understand requirements
- Create todo list

## Phase 2: Codebase Exploration

- Launch parallel code-explorer agents
- Read key files identified by agents

## Phase 3: Clarifying Questions

- Present questions to user
- Wait for answers before proceeding

## Phase 4: Architecture Design

- Launch parallel architects with different approaches
- Present comparison, get user approval

## Phase 5: Implementation

- Wait for explicit approval
- Implement following chosen architecture

## Phase 6: Quality Review

- Launch parallel reviewers
- Consolidate and present findings

## Phase 7: Summary

- Document accomplishments
```

---

## 七、事件钩子系统

### 7.1 可用钩子事件

| 事件               | 触发时机       |
| ------------------ | -------------- |
| `PreToolUse`       | 工具执行前     |
| `PostToolUse`      | 工具执行后     |
| `Stop`             | 用户请求停止时 |
| `UserPromptSubmit` | 用户提交提示时 |
| `SessionStart`     | 会话开始时     |

### 7.2 钩子配置格式 (`hooks/hooks.json`)

```json
{
  "description": "Plugin description",
  "hooks": {
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/pretooluse.py",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

### 7.3 钩子脚本输入/输出格式

**输入 (stdin)**:

```json
{
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": {"command": "rm -rf /"},
  "hook_specific_config": {...}
}
```

**输出 (stdout)**:

```json
{
  "decision": "allow|deny|block",
  "systemMessage": "Warning or blocking message",
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny"
  }
}
```

### 7.4 规则引擎 (来自 hookify)

`rule_engine.py` 实现了条件评估模式：

```python
class RuleEngine:
    def evaluate_rules(self, rules: List[Rule], input_data: Dict) -> Dict:
        # 检查所有规则
        # 阻塞规则优先
        # 返回适当响应
```

**支持的运算符**: `regex_match`, `contains`, `equals`, `not_contains`, `starts_with`, `ends_with`

**可用字段**: `command`, `content`, `new_text`, `file_path`, `reason`, `transcript`, `user_prompt`

---

## 八、技能系统

### 8.1 技能文件格式

```markdown
---
name: skill-name
description: This skill should be used when the user asks about [topic]
version: 0.1.0
---

# Skill Title

## Overview

[What the skill covers]

## When to Use

[Triggering conditions]

## How to Apply

[Step-by-step guidance]
```

### 8.2 自动触发机制

当用户提到相关主题时自动调用技能（如："create an agent" 触发 `agent-development` 技能）。

---

## 九、命令系统

### 9.1 命令文件格式

```markdown
---
allowed-tools: Bash(gh *), Bash(git *) # 限制可用工具
description: Description of when to use command
argument-hint: Optional parameter hint
---

Command implementation...
```

### 9.2 Slash 命令

通过 `/command-name` 语法调用。

---

## 十、通信机制

### 10.1 组件间通信

| 机制          | 用途                                       |
| ------------- | ------------------------------------------ |
| Markdown 文件 | Agents, commands, skills 在启动时解析      |
| Hook 脚本     | Python/Shell 脚本接收 JSON，返回 JSON 响应 |
| MCP servers   | 外部工具集成 via `.mcp.json`               |

---

## 十一、对 PeanutCafe 的建议点

| #   | 建议点                                        | 文档                                                        | 状态 |
| --- | --------------------------------------------- | ----------------------------------------------------------- | ---- |
| 1   | Agent 定义：考虑用 Markdown 文件定义 Agent    | `docs/claude-code-analysis/01-agent-definition.md`          | ✅   |
| 2   | 插件结构：每个 Agent/技能 作为独立模块组织    | `docs/claude-code-analysis/02-plugin-architecture.md`       | ✅   |
| 3   | 多Agent协作：启动子Agent并行工作，主Agent汇总 | `docs/claude-code-analysis/03-multi-agent-collaboration.md` | ✅   |
| 4   | 工具限制：按最小权限原则限制 Agent 可用工具   | `docs/claude-code-analysis/04-tool-restriction.md`          | ✅   |
| 5   | 事件钩子：实现 PreToolUse/PostToolUse 等钩子  | `docs/claude-code-analysis/05-event-hooks.md`               | ✅   |
| 6   | **核心Agent执行机制**：任务拆解/循环/验证等   | `docs/claude-code-analysis/06-agent-execution-mechanism.md` | ✅   |

> ✅ 表示已完成并经源码审核

### 审核发现的关键问题

1. **Agent定义** (`01-agent-definition.md`)
   - ✅ Claude Code 源码机制已验证
   - ⚠️ 发现 `agent-tools-config.json` 配置存在但未被代码引用

2. **插件架构** (`02-plugin-architecture.md`)
   - ✅ Claude Code 源码机制已验证
   - ⚠️ 文档描述 agent 数量需更新（实际有3个agent）

3. **多Agent协作** (`03-multi-agent-collaboration.md`)
   - ✅ Claude Code superpowers 插件机制已验证
   - ✅ PeanutCafe LangGraph 工作流源码已验证

4. **工具限制** (`04-tool-restriction.md`)
   - ✅ Claude Code 官方文档机制已整理
   - ✅ **关键Bug**: `agent-tools-config.json` 完全未被使用

5. **事件钩子** (`05-event-hooks.md`)
   - ✅ Claude Code 22种Hook事件源码已验证
   - ⚠️ `src/common/interceptors/` 和 `src/common/filters/` 目录不存在

---

## 十二、关键文件参考

| 文件                                                    | 用途                  |
| ------------------------------------------------------- | --------------------- |
| `plugins/README.md`                                     | 插件系统概述          |
| `plugins/plugin-dev/skills/agent-development/SKILL.md`  | 完整的 Agent 开发指南 |
| `plugins/agent-sdk-dev/agents/agent-sdk-verifier-ts.md` | 验证 Agent 示例       |
| `plugins/code-review/commands/code-review.md`           | 多 Agent 编排示例     |
| `plugins/feature-dev/commands/feature-dev.md`           | 分阶段工作流示例      |
| `plugins/hookify/hooks/hooks.json`                      | 钩子配置格式          |
| `plugins/hookify/core/rule_engine.py`                   | 规则评估模式          |
| `.claude-plugin/marketplace.json`                       | 插件注册表格式        |
