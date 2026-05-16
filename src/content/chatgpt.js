(() => {
  if (window.haiMeetingChatGPTLoaded) {
    return;
  }

  window.haiMeetingChatGPTLoaded = true;

  const provider = {
    id: "chatgpt",
    name: "ChatGPT",
    inputSelectors: [
      "#prompt-textarea",
      "[data-testid='prompt-textarea']",
      "div[role='textbox'][contenteditable='true']",
      "div.ProseMirror[contenteditable='true']",
      "textarea[data-id='root']",
      "div[contenteditable='true']",
      "textarea"
    ],
    sendButtonSelectors: [
      "[data-testid='send-button']",
      "button[data-testid='send-button']",
      "button[aria-label='Send prompt']",
      "button[aria-label='Send message']",
      "button[aria-label*='Send']"
    ],
    assistantMessageSelectors: [
      "[data-message-author-role='assistant']",
      "article:has([data-message-author-role='assistant'])",
      "article[data-testid*='conversation-turn'] [data-message-author-role='assistant']",
      "article[data-testid*='conversation-turn']",
      "main [data-message-author-role='assistant']"
    ]
  };

  function getApi() {
    return window.haiMeetingContentApi;
  }

  function getInput() {
    const candidates = getApi().findAll(provider.inputSelectors);
    return candidates.find(({ element }) => getApi().isVisible(element))?.element ?? null;
  }

  function describeElement(element) {
    if (!element) {
      return "null";
    }

    return [
      element.tagName.toLowerCase(),
      element.id ? `#${element.id}` : "",
      element.getAttribute("data-testid") ? `[data-testid="${element.getAttribute("data-testid")}"]` : "",
      element.getAttribute("role") ? `[role="${element.getAttribute("role")}"]` : "",
      element.getAttribute("aria-label") ? `[aria-label="${element.getAttribute("aria-label")}"]` : ""
    ].join("");
  }

  function setNativeTextareaValue(textarea, value) {
    const prototype = Object.getPrototypeOf(textarea);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

    if (descriptor?.set) {
      descriptor.set.call(textarea, value);
    } else {
      textarea.value = value;
    }
  }

  function fillInput(input, prompt) {
    input.focus();

    if (input.tagName.toLowerCase() === "textarea") {
      setNativeTextareaValue(input, prompt);
      input.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: prompt
      }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(input);
    selection.removeAllRanges();
    selection.addRange(range);

    const inserted = document.execCommand("insertText", false, prompt);

    if (!inserted || !input.innerText.includes(prompt)) {
      input.textContent = prompt;
      const fallbackRange = document.createRange();
      fallbackRange.selectNodeContents(input);
      fallbackRange.collapse(false);
      selection.removeAllRanges();
      selection.addRange(fallbackRange);
    }

    input.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: prompt
    }));
  }

  function findSendButton() {
    for (const selector of provider.sendButtonSelectors) {
      const button = document.querySelector(selector);

      if (button && getApi().isVisible(button) && !button.disabled) {
        return button;
      }
    }

    return Array.from(document.querySelectorAll("button")).find((button) => {
      const label = [
        button.getAttribute("aria-label"),
        button.getAttribute("data-testid"),
        button.textContent
      ].filter(Boolean).join(" ").toLowerCase();

      return getApi().isVisible(button) &&
        !button.disabled &&
        (label.includes("send") || label.includes("发送"));
    }) ?? null;
  }

  function getAssistantMessages() {
    const seen = new Set();
    const messages = [];

    for (const selector of provider.assistantMessageSelectors) {
      for (const element of document.querySelectorAll(selector)) {
        const text = element.innerText?.trim();
        const hasAssistantRole = element.matches("[data-message-author-role='assistant']") ||
          Boolean(element.querySelector("[data-message-author-role='assistant']"));

        if (!seen.has(element) && getApi().isVisible(element) && text && hasAssistantRole) {
          seen.add(element);
          messages.push(element);
        }
      }
    }

    return messages.sort((first, second) => {
      if (first === second) {
        return 0;
      }

      return first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
  }

  function getLastAssistantText(previousElements = new Set()) {
    const messages = getAssistantMessages().filter((message) => !previousElements.has(message));
    const last = messages.at(-1);
    return last?.innerText?.trim() ?? "";
  }

  function isGenerating() {
    const controls = Array.from(document.querySelectorAll("button, [role='button']"));

    return controls.some((control) => {
      const label = [
        control.getAttribute("aria-label"),
        control.getAttribute("data-testid"),
        control.textContent
      ].filter(Boolean).join(" ").toLowerCase();

      return getApi().isVisible(control) &&
        (label.includes("stop") || label.includes("停止") || label.includes("streaming"));
    });
  }

  async function waitForResponse(previousText, previousCount, previousElements, timeoutMs) {
    const start = Date.now();
    let lastText = "";
    let lastChangedAt = Date.now();

    while (Date.now() - start < timeoutMs) {
      const currentMessages = getAssistantMessages();
      const currentCount = currentMessages.length;
      const currentText = getLastAssistantText(previousElements) || getLastAssistantText();

      if (currentText && currentText !== lastText) {
        lastText = currentText;
        lastChangedAt = Date.now();
      }

      const hasNewText = lastText && (lastText !== previousText || currentCount > previousCount);
      const stableLongEnough = Date.now() - lastChangedAt >= 2500;

      if (hasNewText && stableLongEnough && !isGenerating()) {
        return lastText;
      }

      await getApi().sleep(400);
    }

    throw new Error("等待 ChatGPT 回复超时");
  }

  async function sendPrompt(prompt, timeoutMs = 120000) {
    const input = await getApi().waitFor(() => getInput(), { timeoutMs: 15000 })
      .catch(() => {
        throw new Error("阶段 input：未找到可见的 ChatGPT 输入框");
      });
    const previousMessages = getAssistantMessages();
    const previousElements = new Set(previousMessages);
    const previousCount = previousMessages.length;
    const previousText = getLastAssistantText();

    fillInput(input, prompt);
    await getApi().sleep(300);

    const sendButton = await getApi().waitFor(() => findSendButton(), {
      timeoutMs: 10000,
      intervalMs: 200
    }).catch(() => {
      const buttonCount = document.querySelectorAll("button").length;
      throw new Error(
        `阶段 send_button：已写入 ${describeElement(input)}，但没有找到可点击的发送按钮。页面按钮数：${buttonCount}`
      );
    });

    sendButton.click();

    const text = await waitForResponse(previousText, previousCount, previousElements, timeoutMs)
      .catch((error) => {
        throw new Error(`阶段 response：${error instanceof Error ? error.message : String(error)}`);
      });

    if (!text) {
      throw new Error("阶段 response：ChatGPT 回复内容为空");
    }

    return text;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "HAI_MEETING_DETECT_PAGE" && message.providerId === provider.id) {
      const inputStatus = window.haiMeetingContentApi.detectInput(provider.inputSelectors);
      sendResponse({
        ok: true,
        providerId: provider.id,
        providerName: provider.name,
        href: window.location.href,
        title: document.title,
        loggedIn: inputStatus.inputReady,
        ...inputStatus
      });

      return false;
    }

    if (message?.type === "HAI_MEETING_CHATGPT_SEND_PROMPT") {
      sendPrompt(message.prompt, message.timeoutMs)
        .then((text) => sendResponse({ ok: true, text }))
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            stage: "chatgpt_page_automation",
            href: window.location.href,
            title: document.title
          });
        });

      return true;
    }

    return false;
  });
})();
