(() => {
  if (window.haiMeetingGeminiLoadedV9) {
    return;
  }

  window.haiMeetingGeminiLoadedV9 = true;

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

  function getExactResponseNodes() {
    return Array.from(document.querySelectorAll(
      "structured-content-container.model-response-text message-content[id^='message-content-id-'], message-content[id^='message-content-id-']"
    )).sort((first, second) => {
      if (first === second) {
        return 0;
      }

      return first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
  }

  function getLastResponseText() {
    return getLatestGeminiSnapshot(activeRun)?.text ?? "";
  }

  function getLatestGeminiSnapshot(run = activeRun) {
    const snapshots = getResponseSnapshots();
    const changedSnapshots = run
      ? snapshots.filter((snapshot) => run.baselineMessageTextById.get(snapshot.id) !== snapshot.text)
      : snapshots;

    for (const snapshot of changedSnapshots.slice().reverse()) {
      const text = normalizeResponseText(snapshot.text);

      if (isValidResponseText(text, run)) {
        return {
          ...snapshot,
          text
        };
      }
    }

    return null;
  }

  function getResponseSnapshots() {
    return getExactResponseNodes().map((node, index) => {
      const id = node.getAttribute("id") || `gemini-message-${index}`;

      return {
        id,
        text: normalizeResponseText(getFinalTextFromMessage(node)),
        html: getFinalHtmlFromMessage(node)
      };
    });
  }

  function createMessageTextById(snapshots = getResponseSnapshots()) {
    return new Map(snapshots.map((snapshot) => [snapshot.id, snapshot.text]));
  }

  function getFinalTextFromMessage(message) {
    const markdown = getMessageMarkdown(message);

    if (!markdown) {
      return "";
    }

    return normalizeResponseText(stripGeminiChromeText(getElementText(createReadableClone(markdown))));
  }

  function getFinalHtmlFromMessage(message) {
    const markdown = getMessageMarkdown(message);

    if (!markdown) {
      return "";
    }

    return sanitizeHtmlFragment(createReadableClone(markdown));
  }

  function getMessageMarkdown(message) {
    return message?.querySelector(".markdown.markdown-main-panel, .markdown[aria-busy='false'], [class*='markdown']")
      ?? null;
  }

  function createReadableClone(element) {
    const clone = element.cloneNode(true);

    for (const selector of [
      "script",
      "style",
      "button",
      "svg",
      "iframe",
      "mat-icon",
      ".buttons",
      ".code-block-decoration",
      ".avatar-gutter",
      "bard-avatar",
      "sources-list",
      ".screen-reader-model-response-label",
      ".thoughts-container",
      ".response-footer",
      "sensitive-memories-banner",
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

  function stripGeminiChromeText(text) {
    return String(text || "")
      .replace(/^Gemini\s*说[。.]?\s*/i, "")
      .replace(/^Gemini\s+says[.:]?\s*/i, "")
      .trim();
  }

  function isValidResponseText(text, run = activeRun) {
    const normalized = normalizeResponseText(text).replace(/\s/g, "");
    const transientTexts = [
      "Gemini说。",
      "Gemini说",
      "Geminisays",
      "正在生成",
      "正在思考",
      "生成中"
    ];

    return Boolean(normalized) &&
      (!run?.prompt || normalized !== normalizeResponseText(run.prompt).replace(/\s/g, "")) &&
      !transientTexts.some((transientText) => normalized.toLowerCase() === transientText.toLowerCase());
  }

  const liveStorageKey = "liveResponse_gemini";
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
      message: "已发送，等待 Gemini 回复..."
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
          message: "Gemini 还在输出中..."
        });
      }
    }, 8000);
  }

  function emitLatestResponse() {
    if (!activeRun) {
      return;
    }

    const snapshot = getLatestGeminiSnapshot(activeRun);
    const text = snapshot?.text ?? "";

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
        throw new Error("阶段 input：未找到可见的 Gemini 输入框");
      });

    beginRun(runId, prompt);
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
    scheduleEmitLatestResponse();

    return {
      runId,
      status: "sent",
      message: "已发送到 Gemini，回复将由页面监听器更新"
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

    if (message?.type === "HAI_MEETING_GEMINI_SEND_PROMPT_V9") {
      sendPrompt(message.prompt, message.runId)
        .then((result) => sendResponse({ ok: true, ...result }))
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
