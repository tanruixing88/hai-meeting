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
      "[role='button'][aria-label*='发送']",
      "[class*='send']",
      "[class*='submit']"
    ],
    responseSelectors: [
      "[data-role='assistant']",
      "[data-message-author-role='assistant']",
      "[class*='assistant']",
      ".markdown",
      ".ds-markdown",
      "[class*='markdown']",
      "[class*='message-content']",
      "[class*='chat-message']",
      "[class*='answer']"
    ],
    reasoningSelectors: [
      "[class*='reason']",
      "[class*='thinking']",
      "[class*='think']",
      "[class*='cot']",
      "[data-testid*='reason']",
      "[data-testid*='think']"
    ],
    finalAnswerSelectors: [
      ".ds-markdown",
      ".markdown",
      "[class*='markdown']",
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

    return element.closest?.("button, [role='button'], [class*='send'], [class*='submit']") ?? null;
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
      label.includes("send-message") ||
      label.includes("arrow") ||
      label.includes("up");
  }

  function isLikelyNonSendButton(button) {
    const label = [
      button.getAttribute("aria-label"),
      button.getAttribute("data-testid"),
      button.getAttribute("title"),
      button.textContent
    ].filter(Boolean).join(" ").toLowerCase();

    return label.includes("deepthink") ||
      label.includes("deep think") ||
      label.includes("深度思考") ||
      label.includes("联网搜索") ||
      label.includes("search") ||
      label.includes("upload") ||
      label.includes("attach") ||
      label.includes("file");
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
    const buttonCenterX = buttonRect.left + buttonRect.width / 2;
    const buttonCenterY = buttonRect.top + buttonRect.height / 2;
    let score = 0;

    if (label.includes("send") || label.includes("发送") || label.includes("submit")) {
      score += 100;
    }

    if (label.includes("arrow") || label.includes("up") || label.includes("send-message")) {
      score += 40;
    }

    if (button.querySelector("svg")) {
      score += 20;
    }

    if (buttonCenterX >= inputRect.right - 140 && buttonCenterX <= inputRect.right + 180) {
      score += 70;
    } else if (buttonRect.left >= inputRect.left && buttonRect.left <= inputRect.right + 120) {
      score += 20;
    }

    if (buttonCenterY >= inputRect.bottom - 120 && buttonCenterY <= inputRect.bottom + 120) {
      score += 55;
    } else if (buttonRect.top >= inputRect.top - 40 && buttonRect.top <= inputRect.bottom + 100) {
      score += 15;
    }

    if (buttonCenterX > inputRect.left + inputRect.width / 2) {
      score += 35;
    }

    if (buttonRect.width <= 72 && buttonRect.height <= 72) {
      score += 15;
    }

    score -= Math.min(distanceBetween(button, input) / 20, 60);

    if (isLikelyNonSendButton(button)) {
      score -= 120;
    }

    return score;
  }

  function getButtonSearchScopes(input) {
    const scopes = [];
    let current = input;

    while (current && scopes.length < 7) {
      scopes.push(current);
      current = current.parentElement;
    }

    scopes.push(document);

    return Array.from(new Set(scopes));
  }

  function getClickableCandidates(scope) {
    return Array.from(scope.querySelectorAll(
      "button, [role='button'], [class*='send'], [class*='submit'], [aria-label]"
    ))
      .map(candidateToButton)
      .filter(Boolean);
  }

  function getRankedButtonCandidates(input) {
    const seen = new Set();
    const candidates = [];

    for (const scope of getButtonSearchScopes(input)) {
      for (const button of getClickableCandidates(scope)) {
        if (seen.has(button) || !isUsableButton(button) || isLikelyNonSendButton(button)) {
          continue;
        }

        seen.add(button);
        candidates.push({
          button,
          score: scoreButton(button, input)
        });
      }
    }

    return candidates.sort((a, b) => b.score - a.score);
  }

  function findSendButton() {
    for (const selector of provider.sendButtonSelectors) {
      const button = candidateToButton(document.querySelector(selector));

      if (isUsableButton(button) && isLikelySendButton(button)) {
        return button;
      }
    }

    const input = getInput();
    const candidates = input ? getRankedButtonCandidates(input) : [];
    const best = candidates.find(({ button, score }) => isLikelySendButton(button) || score >= 75);

    return best?.button ?? null;
  }

  function describeButton(button, input) {
    const rect = button.getBoundingClientRect();
    const label = [
      button.getAttribute("aria-label"),
      button.getAttribute("data-testid"),
      button.getAttribute("title"),
      button.textContent
    ].filter(Boolean).join(" ").trim();

    return {
      label: label || "(no label)",
      tag: button.tagName.toLowerCase(),
      className: String(button.className || "").slice(0, 120),
      score: input ? Math.round(scoreButton(button, input)) : 0,
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    };
  }

  function describeTopButtonCandidates(input) {
    return getRankedButtonCandidates(input)
      .slice(0, 6)
      .map(({ button }) => describeButton(button, input));
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

  function submitClosestForm(input) {
    const form = input.closest?.("form");

    if (!form) {
      return false;
    }

    if (typeof form.requestSubmit === "function") {
      form.requestSubmit();
      return true;
    }

    form.dispatchEvent(new SubmitEvent("submit", {
      bubbles: true,
      cancelable: true
    }));
    return true;
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
        const text = getFinalAnswerTextFromResponse(element);

        if (!seen.has(element) && getApi().isVisible(element) && isValidFinalAnswerText(text)) {
          seen.add(element);
          elements.push(element);
        }
      }
    }

    return elements.sort((first, second) => {
      if (first === second) {
        return 0;
      }

      return first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
  }

  function isInsideReasoning(element) {
    return provider.reasoningSelectors.some((selector) => Boolean(element.closest(selector)));
  }

  function isProbablyReasoningText(text) {
    const normalized = text.trim();

    return normalized.startsWith("嗯，") ||
      normalized.startsWith("好的，") ||
      normalized.startsWith("我需要") ||
      normalized.startsWith("我得") ||
      normalized.includes("回顾一下之前的对话") ||
      normalized.includes("用户可能是") ||
      normalized.includes("深层需求") ||
      normalized.includes("所以，我的回复应该") ||
      normalized.includes("考虑到之前的对话");
  }

  function isTransientStatusText(text) {
    const normalized = normalizeResponseText(text).replace(/\s/g, "");
    const transientTexts = [
      "正在思考",
      "思考中",
      "深度思考",
      "思考过程",
      "思考完成",
      "已深度思考",
      "thinking",
      "reasoning"
    ];

    return transientTexts.some((transientText) => normalized.toLowerCase() === transientText.toLowerCase()) ||
      normalized.length <= 12 && transientTexts.some((transientText) =>
        normalized.toLowerCase().includes(transientText.toLowerCase())
      );
  }

  function isValidFinalAnswerText(text) {
    const normalized = normalizeResponseText(text);

    return Boolean(normalized) &&
      !isTransientStatusText(normalized) &&
      !isProbablyReasoningText(normalized);
  }

  function normalizeResponseText(text) {
    return text
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function stripReasoningText(text) {
    const normalized = normalizeResponseText(text);
    const markerPatterns = [
      /(?:^|\n)\s*(?:最终答案|最终回复|正式回复|回复|回答)\s*[:：]\s*/i,
      /(?:^|\n)\s*(?:Final answer|Answer)\s*[:：]\s*/i
    ];

    for (const pattern of markerPatterns) {
      const parts = normalized.split(pattern);

      if (parts.length > 1) {
        return normalizeResponseText(parts.at(-1));
      }
    }

    const paragraphs = normalized.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);

    if (paragraphs.length > 1 && paragraphs.slice(0, -1).some(isProbablyReasoningText)) {
      return normalizeResponseText(paragraphs.at(-1));
    }

    return normalized;
  }

  function getFinalAnswerTextFromResponse(element) {
    const finalCandidates = [];

    for (const selector of provider.finalAnswerSelectors) {
      for (const candidate of element.querySelectorAll(selector)) {
        const text = candidate.innerText?.trim();

        if (text && getApi().isVisible(candidate) && !isInsideReasoning(candidate)) {
          finalCandidates.push(candidate);
        }
      }
    }

    if (finalCandidates.length > 0) {
      return stripReasoningText(finalCandidates.at(-1).innerText ?? "");
    }

    const clone = element.cloneNode(true);

    for (const selector of provider.reasoningSelectors) {
      for (const reasoningNode of clone.querySelectorAll(selector)) {
        reasoningNode.remove();
      }
    }

    return stripReasoningText(clone.innerText ?? element.innerText ?? "");
  }

  function getLastResponseText() {
    const elements = getResponseElements();
    const texts = elements
      .map((element) => getFinalAnswerTextFromResponse(element))
      .filter(isValidFinalAnswerText);

    return texts.at(-1) ?? "";
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
        (label.includes("stop") ||
          label.includes("停止生成") ||
          label.includes("cancel generation"));
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
      const candidates = describeTopButtonCandidates(input);
      throw new Error(
        `阶段 send_button：已写入 ${describeElement(input)}，但没有找到可点击的发送按钮。页面按钮数：${buttonCount}。候选：${JSON.stringify(candidates)}`
      );
    });

    dispatchMouseClick(sendButton);

    const startedAfterClick = await waitForSendStarted(previousText, previousCount);

    if (!startedAfterClick) {
      pressEnter(input);
      await getApi().sleep(300);

      const startedAfterEnter = await waitForSendStarted(previousText, previousCount, 1200);

      if (startedAfterEnter) {
        const text = await waitForResponse(previousText, previousCount, timeoutMs)
          .catch((error) => {
            throw new Error(`阶段 response：${error instanceof Error ? error.message : String(error)}`);
          });

        if (!text) {
          throw new Error("阶段 response：DeepSeek 回复内容为空");
        }

        return text;
      }

      submitClosestForm(input);
      await getApi().sleep(500);

      const startedAfterSubmit = await waitForSendStarted(previousText, previousCount, 1200);

      if (startedAfterSubmit) {
        const text = await waitForResponse(previousText, previousCount, timeoutMs)
          .catch((error) => {
            throw new Error(`阶段 response：${error instanceof Error ? error.message : String(error)}`);
          });

        if (!text) {
          throw new Error("阶段 response：DeepSeek 回复内容为空");
        }

        return text;
      }

      const retryButton = findSendButton();

      if (retryButton && retryButton !== sendButton) {
        dispatchMouseClick(retryButton);
      }

      const startedAfterRetry = await waitForSendStarted(previousText, previousCount, 1500);

      if (!startedAfterRetry) {
        throw new Error(
          `阶段 send_start：已填入内容，但点击/回车/表单提交都未触发发送。候选：${JSON.stringify(describeTopButtonCandidates(input))}`
        );
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
