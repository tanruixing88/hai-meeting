(() => {
  if (window.haiMeetingChatGPTLoadedV9) {
    return;
  }

  window.haiMeetingChatGPTLoadedV9 = true;

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
      "[data-message-author-role='assistant'][data-message-id] .markdown p",
      "[data-message-author-role='assistant'][data-message-id] .markdown",
      "[data-message-author-role='assistant'][data-message-id]",
      "[data-message-author-role='assistant']",
      "[data-message-author-role='assistant'] .markdown",
      "[data-message-author-role='assistant'] [class*='markdown']",
      "[data-message-author-role='assistant'] [class*='prose']",
      "article:has([data-message-author-role='assistant'])",
      "article[data-testid*='conversation-turn'] [data-message-author-role='assistant']",
      "article[data-testid*='conversation-turn'] [class*='markdown']",
      "article[data-testid*='conversation-turn'] [class*='prose']",
      "article[data-testid*='conversation-turn']",
      "main .markdown",
      "main [class*='markdown']",
      "main [class*='prose']",
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

  function getExactResponseNodes() {
    return Array.from(document.querySelectorAll("[data-message-author-role='assistant'][data-message-id]"))
      .sort((first, second) => {
      if (first === second) {
        return 0;
      }

      return first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
  }

  function getLatestAssistantText(run = activeRun) {
    const snapshots = getResponseSnapshots();
    const changedSnapshots = run
      ? snapshots.filter((snapshot) => run.baselineMessageTextById.get(snapshot.id) !== snapshot.text)
      : snapshots;

    for (const snapshot of changedSnapshots.slice().reverse()) {
      const text = normalizeResponseText(snapshot.text);

      if (isValidResponseText(text, run)) {
        return text;
      }
    }

    return "";
  }

  function getResponseSnapshots() {
    return getExactResponseNodes().map((node) => ({
      id: node.getAttribute("data-message-id") || "",
      text: normalizeResponseText(getFinalTextFromMessage(node))
    }));
  }

  function createMessageTextById(snapshots = getResponseSnapshots()) {
    return new Map(snapshots.map((snapshot) => [snapshot.id, snapshot.text]));
  }

  function getFinalTextFromMessage(message) {
    if (!message) {
      return "";
    }

    const paragraphCandidates = Array.from(message.querySelectorAll(".markdown p, [class*='markdown'] p"))
      .filter((element) => getElementText(element));

    if (paragraphCandidates.length > 0) {
      return paragraphCandidates
        .map(getElementText)
        .filter(Boolean)
        .join("\n");
    }

    const markdownCandidates = Array.from(message.querySelectorAll(".markdown, [class*='markdown']"))
      .filter((element) => getElementText(element));

    if (markdownCandidates.length > 0) {
      return markdownCandidates
        .map(getElementText)
        .filter(Boolean)
        .join("\n");
    }

    return "";
  }

  function getElementText(element) {
    return (element?.textContent || element?.innerText || "").trim();
  }

  function normalizeResponseText(text) {
    return String(text || "")
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  function isValidResponseText(text, run = activeRun) {
    const normalized = normalizeResponseText(text);

    if (!normalized) {
      return false;
    }

    if (run?.prompt && normalized === normalizeResponseText(run.prompt)) {
      return false;
    }

    return !normalized.includes("已发送到 ChatGPT，回复将由页面监听器更新") &&
      !normalized.includes("window.__oai_") &&
      !normalized.includes("requestAnimationFrame") &&
      !normalized.includes("window.__remixContext") &&
      !normalized.includes("<script");
  }

  const liveStorageKey = "liveResponse_chatgpt";
  let activeRun = null;
  let observer = null;
  let emitTimer = null;
  let pollTimer = null;
  let diagnosticTimer = null;

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
    window.clearInterval(pollTimer);
    window.clearTimeout(diagnosticTimer);
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
      message: "已发送，等待 ChatGPT 回复..."
    });

    pollTimer = window.setInterval(() => {
      if (!activeRun || Date.now() - activeRun.startedAt > 120000) {
        window.clearInterval(pollTimer);
        pollTimer = null;
        return;
      }

      emitLatestResponse();
    }, 750);

    diagnosticTimer = window.setTimeout(() => {
      if (!activeRun?.lastText) {
        setLiveState({
          status: "waiting",
          runId,
          prompt,
          text: "",
          message: `仍在等待 ChatGPT 回复。诊断：${JSON.stringify(getExtractionDiagnostics())}`
        });
      }
    }, 8000);
  }

  function emitLatestResponse() {
    if (!activeRun) {
      return;
    }

    const text = getLatestAssistantText(activeRun);

    if (!isValidResponseText(text, activeRun) || text === activeRun.lastText) {
      return;
    }

    activeRun.lastText = text;
    window.clearTimeout(diagnosticTimer);
    setLiveState({
      status: "success",
      runId: activeRun.runId,
      prompt: activeRun.prompt,
      text,
      message: text
    });
  }

  function getExtractionDiagnostics() {
    const selectors = [
      "article[data-testid*='conversation-turn']",
      "[data-message-author-role='assistant'][data-message-id]",
      "[data-message-author-role='assistant'][data-message-id] .markdown",
      "[data-message-author-role='assistant'][data-message-id] .markdown p"
    ];

    return selectors.map((selector) => {
      const elements = Array.from(document.querySelectorAll(selector));
      const lastText = getElementText(elements.at(-1));

      return {
        selector,
        count: elements.length,
        lastText: lastText.slice(0, 80)
      };
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
        throw new Error("阶段 input：未找到可见的 ChatGPT 输入框");
      });

    beginRun(runId, prompt);
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
    scheduleEmitLatestResponse();

    return {
      runId,
      status: "sent",
      message: "已发送到 ChatGPT，回复将由页面监听器更新"
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

    if (message?.type === "HAI_MEETING_CHATGPT_SEND_PROMPT_V9") {
      sendPrompt(message.prompt, message.runId)
        .then((result) => sendResponse({ ok: true, ...result }))
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
