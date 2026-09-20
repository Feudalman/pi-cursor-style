# pi-cursor-style

[English](README.md) | [简体中文](README.zh-CN.md)

自定义 [pi](https://github.com/earendil-works/pi) 输入框的光标样式：**竖条**、**下划线** 或 **彩色方块**——替换默认的反显块。

```
默认方块     my text▮rest          反显块（前景/背景互换）
竖条         my text▏rest          细竖条，可着色
下划线       my text̲r̲est           字符保持可见
```

pi 自绘的"假光标"硬编码为反显样式，主题和设置都改不了它。本扩展包装默认编辑器，在每一帧渲染后改写光标所在单元格——保持宽度守恒，且不触碰隐藏的 IME 光标标记，输入法候选框定位不受影响。

## 安装

用 pi 的包管理器（推荐）：

```bash
pi install git:github.com/Feudalman/pi-cursor-style
```

npm 发布后也可以：

```bash
pi install npm:pi-cursor-style
```

或手动安装：把 [`extensions/cursor-style.ts`](extensions/cursor-style.ts) 复制到 `~/.pi/agent/extensions/`。

## 配置

创建 `~/.pi/agent/cursor-style.json`：

```jsonc
{
	"style": "bar",          // "block" | "bar" | "underline"   （默认 "block"）
	"color": "#00aaff"       // 默认 "#00aaff"（蓝色）；见下表；"none" 关闭着色
}
```

不创建配置文件时，默认为 `block` + `#00aaff`。

颜色写法：

| 值 | 含义 |
|-------|---------|
| `"#ff5f00"` | 任意 hex RGB |
| `"208"` | xterm 256 色索引 |
| `"theme:accent"` | 引用当前主题的 token；切换主题自动跟随 |
| `"none"` | 不着色，用终端默认前景色 |

省略 `"color"` 时使用内置默认 `#00aaff`（蓝色）。

样式说明：

- `block` — 默认反显方块；配置 `color` 后变成该颜色填充的方块
- `bar` — 细竖条 `▏`；宽字符（CJK）自动补位，对齐不受影响；光标停留处字符会被暂时遮挡
- `underline` — 字符加下划线且保持可见；空白单元格（行尾）用 `▁`，因为多数终端不给空白画下划线

修改配置后执行 `/reload`（或重启 pi）生效。样式非法时回落 `block`；颜色无法解析时不着色。

## 范围与限制

- 只作用于**主输入框**。单行输入（`/model`、`/resume` 等的搜索框）由 pi 核心内部构造，扩展无法替换。
- 扩展通过后处理渲染输出实现，匹配光标序列 `\x1b[7m<字符>\x1b[0m`。若未来 pi 版本改变该格式，扩展需要同步更新。
- 工作状态 spinner、thinking 级别边框色、bash 模式、自动补全、历史记录等原生功能全部保留：包装类继承 pi 自己的 `CustomEditor` 并启用 `embedWorkingStatus`。

## 兼容性

在 pi `0.86.0` 上验证通过。只使用公开扩展 API（`session_start`、`ctx.ui.setEditorComponent`），并做了防护，print/RPC 模式下自动跳过。

## 工作原理

1. `session_start` 时通过 `ctx.ui.setEditorComponent()` 替换编辑器。
2. 包装类调用 `super.render(width)` 后逐行改写，把反显光标单元格替换为配置的样式。
3. 单元格宽度守恒（竖条对宽字符补位；下划线保留原字形），填充与边框不会错位。光标前发射的零宽 IME 标记原样透传。

## 许可证

[MIT](LICENSE)
