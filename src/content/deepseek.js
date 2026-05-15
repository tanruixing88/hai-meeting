(() => {
  if (window.haiMeetingDeepSeekLoaded) {
    return;
  }

  window.haiMeetingDeepSeekLoaded = true;

  const provider = {
    id: "deepseek",
    name: "DeepSeek",
    inputSelectors: [
      "textarea[placeholder]",
      "textarea:not([readonly])",
      "[role='textbox'][contenteditable='true']",
      "div[contenteditable='true']",
      "textarea",
      "[role='textbox']"
    ],
    sendButtonSelectors: [
      "button[aria-label='Send']",
      "button[aria-label='发送']",
      "button[aria-label*='Send']",
      "button[aria-label*='发送']",
      "button[type='submit']",
      "[role='button'][aria-label*='Send']",
      "[role='button'][aria-label*='发送']"
    ],
    responseSelectors: [
      "[data-role='assistant']",
      "[data-message-author-role='assistant']",
      ".markdown",
      ".ds-markdown",
      "[class*='markdown']",
      "[class*='message']",
      "[class*='answer']"
    ]
  };

  function getApi() {
    return window.haiMeetingContentApi;
  }

  function getInput() {
    const candidates = getApi().findAll(provider.inputSelectors);
    return candidates.find(({ element }) => {
      if (!getApi().isVisible(element)) {
        return false;
      }

      if (element.matches?.("textarea") && element.readOnly) {
        return false;
      }

      return true;
    })?.element ?? null;
  }

  function describeElement(element) {
    if (!element) {
      return "null";
    }

    return [
      element.tagName.toLowerCase(),
      element.id ? `#${element.id}` : "",
      element.getAttribute("role") ? `[role="${element.getAttribute("role")}"]` : "",
      element.getAttribute("aria-label") ? `[aria-label="${element.getAttribute("aria-label")}"]` : "",
      element.getAttribute("placeholder") ? `[placeholder="${element.getAttribute("placeholder")}"]` : ""
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

  function candidateToButton(element) {
    if (!element) {
      return null;
    }

    if (element.tagName?.toLowerCase() === "button") {
      return element;
    }

    return element.closest?.("button, [role='button']") ?? null;
  }

  function isUsableButton(button) {
    return button &&
      getApi().isVisible(button) &&
      !button.disabled &&
      button.getAttribute("aria-disabled") !== "true";
  }

  function isLikelySendButton(button) {
    const label = [
      button.getAttribute("aria-label"),
      button.getAttribute("data-testid"),
      button.getAttribute("title"),
      button.textContent
    ].filter(Boolean).join(" ").toLowerCase();

    return label.includes("send") ||
      label.includes("发送") ||
      label.includes("submit") ||
      label.includes("arrow") ||
      label.includes("up");
  }

  function distanceBetween(first, second) {
    const a = first.getBoundingClientRect();
    const b = second.getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    const bx = b.left + b.width / 2;
    const by = b.top + b.height / 2;

    return Math.hypot(ax - bx, ay - by);
  }

  function scoreButton(button, input) {
    const label = [
      button.getAttribute("aria-label"),
      button.getAttribute("data-testid"),
      button.getAttribute("title"),
      button.textContent
    ].filter(Boolean).join(" ").toLowerCase();
    const buttonRect = button.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();
    let score = 0;

    if (label.includes("send") || label.includes("发送") || label.includes("submit")) {
      score += 100;
    }

    if (label.includes("arrow") || label.includes("up")) {
      score += 40;
    }

    if (button.querySelector("svg")) {
      score += 20;
    }

    if (buttonRect.left >= inputRect.left && buttonRect.left <= inputRect.right + 80) {
      score += 20;
    }

    if (buttonRect.top >= inputRect.top - 40 && buttonRect.top <= inputRect.bottom + 80) {
      score += 20;
    }

    score -= Math.min(distanceBetween(button, input) / 20, 60);

    return score;
  }

  function findSendButton() {
    for (const selector of provider.sendButtonSelectors) {
      const button = candidateToButton(document.querySelector(selector));

      if (isUsableButton(button) && isLikelySendButton(button)) {
        return button;
      }
    }

    const input = getInput();
    const scopes = [
      input?.closest?.("form"),
      input?.closest?.("[class*='input']"),
      input?.closest?.("[class*='chat']"),
      input?.parentElement?.parentElement,
      document
    ].filter(Boolean);

    for (const scope of scopes) {
      const candidates = Array.from(scope.querySelectorAll("button, [role='button']"))
        .filter((button) => isUsableButton(button))
        .map((button) => ({
          button,
          score: input ? scoreButton(button, input) : 0
        }))
        .filter(({ button, score }) => isLikelySendButton(button) || score >= 20)
        .sort((a, b) => b.score - a.score);

      if (candidates[0]) {
        return candidates[0].button;
      }
    }

    return null;
  }

  function dispatchMouseClick(element) {
    const options = {
      bubbles: true,
      cancelable: true,
      view: window
    };

    element.dispatchEvent(new PointerEvent("pointerdown", options));
    element.dispatchEvent(new MouseEvent("mousedown", options));
    element.dispatchEvent(new PointerEvent("pointerup", options));
    element.dispatchEvent(new MouseEvent("mouseup", options));
    element.dispatchEvent(new MouseEvent("click", options));
  }

  function pressEnter(input) {
    input.focus();

    const eventOptions = {
      bubbles: true,
      cancelable: true,
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13
    };

    input.dispatchEvent(new KeyboardEvent("keydown", eventOptions));
    input.dispatchEvent(new KeyboardEvent("keypress", eventOptions));
    input.dispatchEvent(new KeyboardEvent("keyup", eventOptions));
  }

  async function waitForSendStarted(previousText, previousCount, timeoutMs = 2500) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const currentCount = getResponseElements().length;
      const currentText = getLastResponseText();

      if (isGenerating() || currentCount > previousCount || (currentText && currentText !== previousText)) {
        return true;
      }

      await getApi().sleep(150);
    }

    return false;
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
        control.getAttribute("title"),
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

    throw new Error("等待 DeepSeek 回复超时");
  }

  async function sendPrompt(prompt, timeoutMs = 120000) {
    const input = await getApi().waitFor(() => getInput(), { timeoutMs: 15000 })
      .catch(() => {
        throw new Error("阶段 input：未找到可见的 DeepSeek 输入框");
      });
    const previousCount = getResponseElements().length;
    const previousText = getLastResponseText();

    fillInput(input, prompt);
    await getApi().sleep(350);

    const sendButton = await getApi().waitFor(() => findSendButton(), {
      timeoutMs: 10000,
      intervalMs: 200
    }).catch(() => {
      const buttonCount = document.querySelectorAll("button, [role='button']").length;
      throw new Error(
        `阶段 send_button：已写入 ${describeElement(input)}，但没有找到可点击的发送按钮。页面按钮数：${buttonCount}`
      );
    });

    dispatchMouseClick(sendButton);

    const startedAfterClick = await waitForSendStarted(previousText, previousCount);

    if (!startedAfterClick) {
      pressEnter(input);
      await getApi().sleep(300);

      const retryButton = findSendButton();

      if (retryButton && retryButton !== sendButton) {
        dispatchMouseClick(retryButton);
      }
    }

    const text = await waitForResponse(previousText, previousCount, timeoutMs)
      .catch((error) => {
        throw new Error(`阶段 response：${error instanceof Error ? error.message : String(error)}`);
      });

    if (!text) {
      throw new Error("阶段 response：DeepSeek 回复内容为空");
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

    if (message?.type === "HAI_MEETING_DEEPSEEK_SEND_PROMPT") {
      sendPrompt(message.prompt, message.timeoutMs)
        .then((text) => sendResponse({ ok: true, text }))
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            stage: "deepseek_page_automation",
            href: window.location.href,
            title: document.title
          });
        });

      return true;
    }

    return false;
  });
})();
