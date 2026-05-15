# HAI Meeting

Chrome 插件 MVP，用于识别 ChatGPT、Gemini、DeepSeek 网页，为后续“自动填写、发送、读取回复、会议总结”能力打基础。

## 当前版本能力

- Chrome Extension Manifest V3。
- Popup 状态面板。
- 识别当前标签页是否属于 ChatGPT、Gemini、DeepSeek。
- 检测三家模型页面是否已打开。
- 检测页面输入框是否可见。
- 对已打开但未注入脚本的模型页面，会尝试自动补注入。

当前版本还不执行自动发送，这是下一阶段要做的能力。

## 构建

在项目根目录执行：

```bash
npm run build
```

构建产物固定输出到：

```text
/Users/tanruixing/project/hai-meeting/dist
```

## Chrome 加载路径

验收时只选择这个目录，没有其他可选目录：

```text
/Users/tanruixing/project/hai-meeting/dist
```

Chrome 操作路径：

```text
Chrome -> 扩展程序 -> 管理扩展程序 -> 开启开发者模式
-> 加载已解压的扩展程序
-> 选择 /Users/tanruixing/project/hai-meeting/dist
```

## 第一阶段验收

1. 执行 `npm run build`。
2. 在 Chrome 加载 `/Users/tanruixing/project/hai-meeting/dist`。
3. 打开插件 popup，确认能看到 `HAI Meeting` 面板。
4. 分别打开并登录：

```text
https://chatgpt.com/
https://gemini.google.com/
https://chat.deepseek.com/
```

5. 再次打开插件 popup 或点击刷新按钮。
6. 预期状态：

```text
ChatGPT: 可用，或提示页面脚本未就绪/未找到输入框
Gemini: 可用，或提示页面脚本未就绪/未找到输入框
DeepSeek: 可用，或提示页面脚本未就绪/未找到输入框
```

如果页面已打开但显示“页面脚本未就绪”，先点击插件里的刷新按钮；如果仍未恢复，再刷新对应模型页面后重新点击插件刷新按钮。

## 已知限制

- 插件不保存账号密码，也不会代替用户登录。
- 当前只做页面识别和输入框检测。
- 三家模型网页 DOM 可能变化，后续自动发送阶段需要为每家页面维护独立适配器。
