(() => {
  if (window.haiMeetingDeepSeekLoadedV9) {
    return;
  }

  window.haiMeetingDeepSeekLoadedV9 = true;

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
      "div[role='button'].ds-icon-button",
      "button[aria-label='Send']",
      "button[aria-label='发送']",
      "button[aria-label*='Send']",
      "button[aria-label*='发送']",
      "button[type='submit']",
      "[role='button'][aria-label*='Send']",
      "[role='button'][aria-label*='发送']",
      "[class*='send']",
      "[class*='submit']"
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
      input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
      input.dispatchEvent(new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: prompt
      }));
      setNativeTextareaValue(input, prompt);
      input.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: prompt
      }));
      input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: prompt }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keyup", {
        bubbles: true,
        key: prompt.at(-1) || "",
        code: "KeyA"
      }));
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
    input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: prompt }));
    input.dispatchEvent(new KeyboardEvent("keyup", {
      bubbles: true,
      key: prompt.at(-1) || "",
      code: "KeyA"
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

  function isClickableElement(element) {
    if (!element) {
      return false;
    }

    const tag = element.tagName?.toLowerCase();
    const role = element.getAttribute?.("role");

    return tag === "button" ||
      role === "button" ||
      typeof element.onclick === "function" ||
      window.getComputedStyle(element).cursor === "pointer";
  }

  function candidateToClickable(element) {
    let current = element;

    while (current && current !== document.body) {
      if (isClickableElement(current)) {
        return current;
      }

      current = current.parentElement;
    }

    return candidateToButton(element);
  }

  function isUsableButton(button) {
    return button &&
      getApi().isVisible(button) &&
      !button.disabled &&
      button.getAttribute("aria-disabled") !== "true" &&
      !String(button.className || "").includes("disabled");
  }

  function isEnabledSendButton(button) {
    return isUsableButton(button) && isDeepSeekSendIconButton(button);
  }

  function isDeepSeekSendIconButton(button) {
    if (!button?.matches?.("[role='button'].ds-icon-button, button")) {
      return false;
    }

    const path = button.querySelector("svg path");
    const d = path?.getAttribute("d") || "";

    return d.includes("M8.3125 0.981587") &&
      d.includes("L14.707 6.83608") &&
      d.includes("V15.0431");
  }

  function isLikelySendButton(button) {
    const label = [
      button.getAttribute("aria-label"),
      button.getAttribute("data-testid"),
      button.getAttribute("title"),
      button.textContent
    ].filter(Boolean).join(" ").toLowerCase();

    return isDeepSeekSendIconButton(button) ||
      label.includes("send") ||
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

    if (isDeepSeekSendIconButton(button)) {
      score += 240;
    } else if (button.querySelector("svg")) {
      score += 20;
    }

    if (buttonCenterX >= inputRect.right - 140 && buttonCenterX <= inputRect.right + 180) {
      score += 70;
    } else if (buttonRect.left >= inputRect.left && buttonRect.left <= inputRect.right + 120) {
      score += 20;
    }

    if (buttonCenterX >= inputRect.right - 24) {
      score += 90;
    }

    if (buttonCenterY >= inputRect.bottom - 120 && buttonCenterY <= inputRect.bottom + 120) {
      score += 55;
    } else if (buttonRect.top >= inputRect.top - 40 && buttonRect.top <= inputRect.bottom + 100) {
      score += 15;
    }

    if (buttonCenterX > inputRect.left + inputRect.width / 2) {
      score += 35;
    }

    score += Math.max(0, Math.min((buttonCenterX - inputRect.left) / 12, 80));

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
      "button, [role='button'], [class*='send'], [class*='submit'], [aria-label], svg"
    ))
      .map(candidateToClickable)
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
    const input = getInput();
    const sendIconButton = Array.from(document.querySelectorAll("[role='button'].ds-icon-button, button"))
      .find((button) => isUsableButton(button) && isDeepSeekSendIconButton(button));

    if (sendIconButton) {
      return sendIconButton;
    }

    for (const selector of provider.sendButtonSelectors) {
      const button = candidateToButton(document.querySelector(selector));

      if (isUsableButton(button) && isLikelySendButton(button)) {
        return button;
      }
    }

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
      role: button.getAttribute("role") || "",
      ariaLabel: button.getAttribute("aria-label") || "",
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
    const rect = element.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const options = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX,
      clientY,
      screenX: window.screenX + clientX,
      screenY: window.screenY + clientY
    };

    element.dispatchEvent(new PointerEvent("pointerdown", {
      ...options,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true
    }));
    element.dispatchEvent(new MouseEvent("mousedown", options));
    element.dispatchEvent(new PointerEvent("pointerup", {
      ...options,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true
    }));
    element.dispatchEvent(new MouseEvent("mouseup", options));
    element.dispatchEvent(new MouseEvent("click", options));

    if (typeof element.click === "function") {
      element.click();
    }
  }

  function getExactResponseNodes() {
    return Array.from(document.querySelectorAll(".ds-message"))
      .filter((message) => message.querySelector(".ds-markdown.ds-assistant-message-main-content"))
      .sort((first, second) => {
      if (first === second) {
        return 0;
      }

      return first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
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
    return String(text || "")
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function getLatestDeepSeekSnapshot(run = activeRun) {
    const snapshots = getResponseSnapshots();
    const changedSnapshots = run
      ? snapshots.filter((snapshot) => run.baselineMessageTextById.get(snapshot.id) !== snapshot.text)
      : snapshots;

    for (const snapshot of changedSnapshots.slice().reverse()) {
      const text = normalizeResponseText(snapshot.text);

      if (isValidFinalAnswerText(text)) {
        return {
          ...snapshot,
          text
        };
      }
    }

    return null;
  }

  function getResponseSnapshots() {
    return getExactResponseNodes().map((message, index) => {
      const id = message.closest("[data-virtual-list-item-key]")?.getAttribute("data-virtual-list-item-key") ||
        message.getAttribute("data-message-id") ||
        `deepseek-message-${index}`;

      return {
        id,
        text: normalizeResponseText(getFinalAnswerTextFromMessage(message)),
        html: getFinalAnswerHtmlFromMessage(message)
      };
    });
  }

  function createMessageTextById(snapshots = getResponseSnapshots()) {
    return new Map(snapshots.map((snapshot) => [snapshot.id, snapshot.text]));
  }

  function getFinalAnswerNode(message) {
    const candidates = Array.from(message.querySelectorAll(".ds-markdown.ds-assistant-message-main-content"))
      .filter((node) => getElementText(node));

    return candidates.at(-1) ?? null;
  }

  function getFinalAnswerTextFromMessage(message) {
    const finalNode = getFinalAnswerNode(message);

    if (!finalNode) {
      return "";
    }

    return normalizeResponseText(getElementText(createReadableClone(finalNode)));
  }

  function getFinalAnswerHtmlFromMessage(message) {
    const finalNode = getFinalAnswerNode(message);

    if (!finalNode) {
      return "";
    }

    return sanitizeHtmlFragment(createReadableClone(finalNode));
  }

  function createReadableClone(element) {
    const clone = element.cloneNode(true);

    for (const selector of [
      "script",
      "style",
      "button",
      "svg",
      "iframe",
      ".md-code-block-banner-wrap",
      ".md-code-block-banner",
      ".ds-icon",
      ".ds-focus-ring",
      ".ds-theme",
      "[role='button']",
      "[aria-label*='复制']",
      "[aria-label*='下载']",
      "[aria-label*='copy' i]",
      "[aria-label*='download' i]"
    ]) {
      for (const node of clone.querySelectorAll(selector)) {
        node.remove();
      }
    }

    return clone;
  }

  function sanitizeHtmlFragment(root) {
    const allowedTags = new Set([
      "p",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "code",
      "pre",
      "blockquote",
      "ul",
      "ol",
      "li",
      "h1",
      "h2",
      "h3",
      "h4",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "hr"
    ]);
    const template = document.createElement("template");

    function copyNode(node, parent) {
      if (node.nodeType === Node.TEXT_NODE) {
        parent.append(document.createTextNode(node.textContent || ""));
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) {
        return;
      }

      const tagName = node.tagName.toLowerCase();
      const normalizedTagName = tagName === "b" ? "strong" : tagName === "i" ? "em" : tagName;
      const nextParent = allowedTags.has(tagName)
        ? document.createElement(normalizedTagName)
        : parent;

      if (allowedTags.has(tagName)) {
        parent.append(nextParent);
      }

      for (const child of node.childNodes) {
        copyNode(child, nextParent);
      }
    }

    for (const child of root.childNodes) {
      copyNode(child, template.content);
    }

    return template.innerHTML.trim();
  }

  function getElementText(element) {
    return (element?.innerText || element?.textContent || "").trim();
  }

  function getLastResponseText() {
    return getLatestDeepSeekSnapshot(activeRun)?.text ?? "";
  }

  async function waitForSendButtonEnabled(input, timeoutMs = 8000) {
    const start = Date.now();
    let lastButton = null;

    while (Date.now() - start < timeoutMs) {
      const button = Array.from(document.querySelectorAll("[role='button'].ds-icon-button, button"))
        .find((candidate) => isDeepSeekSendIconButton(candidate));

      if (button) {
        lastButton = button;

        if (isEnabledSendButton(button)) {
          return button;
        }
      }

      await getApi().sleep(150);
    }

    throw new Error(
      `阶段 send_button_enabled：已写入内容，但 DeepSeek 发送按钮仍为禁用态。按钮：${JSON.stringify(lastButton ? describeButton(lastButton, input) : null)}。候选：${JSON.stringify(describeTopButtonCandidates(input))}`
    );
  }

  const liveStorageKey = "liveResponse_deepseek";
  let activeRun = null;
  let observer = null;
  let emitTimer = null;

  function liveUpdatedAt() {
    return new Date().toISOString();
  }

  function setLiveState(value) {
    chrome.storage.local.set({
      [liveStorageKey]: {
        providerId: provider.id,
        providerName: provider.name,
        href: window.location.href,
        title: document.title,
        updatedAt: liveUpdatedAt(),
        ...value
      }
    });
  }

  function beginRun(runId, prompt) {
    activeRun = {
      runId,
      prompt,
      baselineMessageTextById: createMessageTextById(),
      lastText: "",
      startedAt: Date.now()
    };

    setLiveState({
      status: "waiting",
      runId,
      prompt,
      text: "",
      message: "已发送，等待 DeepSeek 回复..."
    });
  }

  function emitLatestResponse() {
    if (!activeRun) {
      return;
    }

    const snapshot = getLatestDeepSeekSnapshot(activeRun);
    const text = snapshot?.text ?? "";

    if (!text || text === activeRun.lastText) {
      return;
    }

    activeRun.lastText = text;
    setLiveState({
      status: "success",
      runId: activeRun.runId,
      prompt: activeRun.prompt,
      text,
      html: snapshot?.html || "",
      message: text
    });
  }

  function scheduleEmitLatestResponse() {
    window.clearTimeout(emitTimer);
    emitTimer = window.setTimeout(emitLatestResponse, 250);
  }

  function ensureResponseObserver() {
    if (observer) {
      return;
    }

    observer = new MutationObserver(scheduleEmitLatestResponse);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  ensureResponseObserver();

  async function sendPrompt(prompt, runId) {
    const input = await getApi().waitFor(() => getInput(), { timeoutMs: 15000 })
      .catch(() => {
        throw new Error("阶段 input：未找到可见的 DeepSeek 输入框");
      });

    beginRun(runId, prompt);
    fillInput(input, prompt);
    await getApi().sleep(350);

    await getApi().waitFor(() => findSendButton(), {
      timeoutMs: 10000,
      intervalMs: 200
    }).catch(() => {
      const buttonCount = document.querySelectorAll("button, [role='button']").length;
      const candidates = describeTopButtonCandidates(input);
      throw new Error(
        `阶段 send_button：已写入 ${describeElement(input)}，但没有找到可点击的发送按钮。页面按钮数：${buttonCount}。候选：${JSON.stringify(candidates)}`
      );
    });

    const sendButton = await waitForSendButtonEnabled(input);
    await getApi().sleep(200);
    dispatchMouseClick(sendButton);
    scheduleEmitLatestResponse();

    return {
      runId,
      status: "sent",
      message: "已发送到 DeepSeek，回复将由页面监听器更新",
      clickTarget: describeButton(sendButton, input)
    };
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

    if (message?.type === "HAI_MEETING_DEEPSEEK_SEND_PROMPT_V9") {
      sendPrompt(message.prompt, message.runId)
        .then((result) => sendResponse({ ok: true, ...result }))
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
