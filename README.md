# HAI Meeting

Chrome 插件 MVP，用于识别 ChatGPT、Gemini、DeepSeek 网页，为后续“自动填写、发送、读取回复、会议总结”能力打基础。

## 当前版本能力

- Chrome Extension Manifest V3。
- Popup 状态面板。
- 识别当前标签页是否属于 ChatGPT、Gemini、DeepSeek。
- 检测三家模型页面是否已打开。
- 检测页面输入框是否可见。
- 对已打开但未注入脚本的模型页面，会尝试自动补注入。
- 支持从 popup 发送内容到 ChatGPT、Gemini，并读取回复。
- ChatGPT 发送结果会写入本地存储，重新打开 popup 仍可看到最近一次结果。

当前版本只对 ChatGPT、Gemini 执行自动发送和读取回复；DeepSeek 暂时仍只做页面状态检测。

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
- 当前只有 ChatGPT 支持自动填写、发送和读取回复。
- 三家模型网页 DOM 可能变化，后续自动发送阶段需要为每家页面维护独立适配器。

## 第二阶段验收

先确认 ChatGPT 页面已打开、已登录，并且插件状态里显示 `ChatGPT: 可用`。

### P0 用例

1. 正常发送：

```text
请只回复：HAI_MEETING_TEST_OK
```

预期：

```text
ChatGPT 页面出现这条消息
ChatGPT 开始回复
插件结果区显示包含 HAI_MEETING_TEST_OK 的回复
```

2. ChatGPT 未打开：

```text
关闭所有 ChatGPT 页面
点击“发送到 ChatGPT”
```

预期：

```text
请先打开并登录 ChatGPT 页面
```

3. 空 prompt：

```text
输入框留空
点击“发送到 ChatGPT”
```

预期：

```text
请输入要发送的内容
```

4. 页面刷新后发送：

```text
刷新 ChatGPT 页面
等待页面加载完成
再次发送测试 prompt
```

预期：仍能成功发送并读取回复。

### P1 用例

1. 当前标签页不在 ChatGPT：

```text
当前停在 Gemini 或普通网页
ChatGPT 在另一个标签页打开
从插件发送 prompt
```

预期：仍能发送到 ChatGPT 标签页。

2. 连续发送两次：

```text
请只回复：FIRST_OK
请只回复：SECOND_OK
```

预期：两次都能完成，结果区显示最新回复。

3. popup 不应因发送而自动关闭：

```text
当前停在任意页面
从插件发送 prompt 到 ChatGPT
```

预期：插件不会主动切换到 ChatGPT 标签页；popup 应尽量保持打开。若用户手动切换标签页导致 popup 被 Chrome 关闭，重新打开 popup 应显示最近一次结果。

## ChatGPT 发送失败时如何反馈

如果 popup 结果区显示失败，请把完整错误文案反馈回来，尤其是包含 `阶段：` 的内容。

常见阶段含义：

```text
input：没有找到可见输入框，通常是未登录、页面未加载完、或 ChatGPT 页面结构变化。
send_button：内容已写入，但没有找到可点击发送按钮，通常是输入事件没有被页面识别。
response：已点击发送，但没有等到可读取的回复。
tab_message：插件后台无法和 ChatGPT 页面脚本通信。
```

## Gemini 阶段验收

先确认 Gemini 页面已打开、已登录，并且插件状态里显示 `Gemini: 可用`。

### P0 用例

1. 正常发送：

```text
请只回复：HAI_GEMINI_TEST_OK
```

预期：

```text
Gemini 页面出现这条消息
Gemini 开始回复
插件结果区显示包含 HAI_GEMINI_TEST_OK 的回复
```

2. Gemini 未打开：

```text
关闭所有 Gemini 页面
点击“发送到 Gemini”
```

预期：

```text
请先打开并登录 Gemini 页面
```

3. 空 prompt：

```text
Gemini 输入框留空
点击“发送到 Gemini”
```

预期：

```text
请输入要发送的内容
```

4. 当前标签页不在 Gemini：

```text
当前停在 ChatGPT 或普通网页
Gemini 在另一个标签页打开
从插件发送 prompt
```

预期：仍能发送到 Gemini 标签页，插件不主动切换标签页。
