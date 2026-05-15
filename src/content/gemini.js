(() => {
  if (window.haiMeetingGeminiLoaded) {
    return;
  }

  window.haiMeetingGeminiLoaded = true;

  const provider = {
    id: "gemini",
    name: "Gemini",
    inputSelectors: [
      "rich-textarea div[contenteditable='true']",
      "div.ql-editor[contenteditable='true']",
      "div[contenteditable='true'][aria-label]",
      "div[contenteditable='true']",
      "textarea"
    ],
    sendButtonSelectors: [
      "button[aria-label='Send message']",
      "button[aria-label*='Send']",
      "button[aria-label*='发送']",
      "button.send-button",
      "button mat-icon[data-mat-icon-name='send']",
      "button mat-icon[fonticon='send']"
    ],
    responseSelectors: [
      "model-response",
      "message-content",
      ".model-response-text",
      ".response-content",
      ".markdown",
      "div[class*='response']"
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

  function fillInput(input, prompt) {
    input.focus();

    if (input.tagName.toLowerCase() === "textarea") {
      input.value = prompt;
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

  function buttonFromIcon(icon) {
    return icon?.closest?.("button") ?? null;
  }

  function findSendButton() {
    for (const selector of provider.sendButtonSelectors) {
      const element = document.querySelector(selector);
      const button = element?.tagName?.toLowerCase() === "button" ? element : buttonFromIcon(element);

      if (button && getApi().isVisible(button) && !button.disabled && button.getAttribute("aria-disabled") !== "true") {
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
        button.getAttribute("aria-disabled") !== "true" &&
        (label.includes("send") || label.includes("发送"));
    }) ?? null;
  }

  function getResponseElements() {
    const seen = new Set();
    const elements = [];

    for (const selector of provider.responseSelectors) {
      for (const element of document.querySelectorAll(selector)) {
        const text = element.innerText?.trim();

        if (!seen.has(element) && getApi().isVisible(element) && text) {
          seen.add(element);
          elements.push(element);
        }
      }
    }

    return elements;
  }

  function getLastResponseText() {
    const elements = getResponseElements();
    const last = elements.at(-1);
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
        (label.includes("stop") || label.includes("停止") || label.includes("cancel"));
    });
  }

  async function waitForResponse(previousText, previousCount, timeoutMs) {
    const start = Date.now();
    let lastText = "";
    let lastChangedAt = Date.now();

    while (Date.now() - start < timeoutMs) {
      const currentCount = getResponseElements().length;
      const currentText = getLastResponseText();

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

    throw new Error("等待 Gemini 回复超时");
  }

  async function sendPrompt(prompt, timeoutMs = 120000) {
    const input = await getApi().waitFor(() => getInput(), { timeoutMs: 15000 })
      .catch(() => {
        throw new Error("阶段 input：未找到可见的 Gemini 输入框");
      });
    const previousCount = getResponseElements().length;
    const previousText = getLastResponseText();

    fillInput(input, prompt);
    await getApi().sleep(350);

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

    const text = await waitForResponse(previousText, previousCount, timeoutMs)
      .catch((error) => {
        throw new Error(`阶段 response：${error instanceof Error ? error.message : String(error)}`);
      });

    if (!text) {
      throw new Error("阶段 response：Gemini 回复内容为空");
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

    if (message?.type === "HAI_MEETING_GEMINI_SEND_PROMPT") {
      sendPrompt(message.prompt, message.timeoutMs)
        .then((text) => sendResponse({ ok: true, text }))
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            stage: "gemini_page_automation",
            href: window.location.href,
            title: document.title
          });
        });

      return true;
    }

    return false;
  });
})();
