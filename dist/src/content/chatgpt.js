(() => {
  const scriptStateKey = "__haiMeetingChatGPTStateV12";
  const previousState = window[scriptStateKey];

  if (previousState?.cleanup) {
    try {
      previousState.cleanup();
    } catch {
      // A stale script from a reloaded extension can no longer be trusted.
    }
  }

  const cleanupTasks = [];

  window[scriptStateKey] = {
    cleanup() {
      for (const cleanupTask of cleanupTasks.splice(0)) {
        try {
          cleanupTask();
        } catch {
          // Ignore cleanup failures from stale extension contexts.
        }
      }
    }
  };

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
    const seen = new Set();
    const nodes = [];

    for (const element of document.querySelectorAll("[data-message-author-role='assistant']")) {
      const message = element.closest("[data-message-author-role='assistant']") ?? element;

      if (!seen.has(message)) {
        seen.add(message);
        nodes.push(message);
      }
    }

    return nodes.sort((first, second) => {
      if (first === second) {
        return 0;
      }

      return first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
  }

  function getLatestAssistantText(run = activeRun) {
    const snapshot = getLatestAssistantSnapshot(run);
    return snapshot?.text ?? "";
  }

  function getLatestAssistantSnapshot(run = activeRun) {
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
    return getExactResponseNodes().map((node, index) => ({
      id: node.getAttribute("data-message-id") ||
        node.closest("[data-message-id]")?.getAttribute("data-message-id") ||
        `chatgpt-assistant-${index}`,
      text: normalizeResponseText(getFinalTextFromMessage(node)),
      html: getFinalHtmlFromMessage(node)
    }));
  }

  function getSyncDiagnostics(run, contextStatus) {
    const snapshots = getResponseSnapshots();
    const lastSnapshots = snapshots.slice(-3).map((snapshot) => ({
      id: snapshot.id,
      textLength: snapshot.text.length,
      textPreview: snapshot.text.slice(0, 80),
      baselineTextLength: run?.baselineMessageTextById?.get(snapshot.id)?.length ?? null,
      changedFromBaseline: run ? run.baselineMessageTextById.get(snapshot.id) !== snapshot.text : null,
      valid: isValidResponseText(snapshot.text, run)
    }));
    const latestChanged = run
      ? snapshots.filter((snapshot) => run.baselineMessageTextById.get(snapshot.id) !== snapshot.text).at(-1)
      : null;

    return {
      contextStatus,
      href: window.location.href,
      title: document.title,
      activeRunId: activeRun?.runId || "",
      syncRunId: run?.runId || "",
      runMatchedActive: Boolean(run && activeRun?.runId === run.runId),
      assistantNodeCount: snapshots.length,
      latestChangedTextPreview: latestChanged?.text?.slice(0, 120) || "",
      latestChangedTextLength: latestChanged?.text?.length || 0,
      lastSnapshots
    };
  }

  function formatSyncDiagnostics(diagnostics) {
    const lastLines = diagnostics.lastSnapshots.length > 0
      ? diagnostics.lastSnapshots.map((snapshot, index) =>
        `${index + 1}. id=${snapshot.id || "(empty)"}，文本长度=${snapshot.textLength}，基线长度=${snapshot.baselineTextLength ?? "无"}，已变化=${snapshot.changedFromBaseline}，有效=${snapshot.valid}，预览=${snapshot.textPreview || "(空)"}`
      ).join("\n")
      : "无 assistant 节点";

    return [
      "ChatGPT 同步诊断：",
      `上下文状态：${diagnostics.contextStatus}`,
      `activeRunId：${diagnostics.activeRunId || "(无)"}`,
      `syncRunId：${diagnostics.syncRunId || "(无)"}`,
      `是否匹配 activeRun：${diagnostics.runMatchedActive}`,
      `assistant 节点数：${diagnostics.assistantNodeCount}`,
      `最新变化文本长度：${diagnostics.latestChangedTextLength}`,
      `最新变化文本预览：${diagnostics.latestChangedTextPreview || "(空)"}`,
      "最后 3 个 assistant：",
      lastLines
    ].join("\n");
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

  function getFinalHtmlFromMessage(message) {
    const markdown = message?.querySelector(".markdown.markdown-new-styling, .markdown, [class*='markdown']");

    if (!markdown) {
      return "";
    }

    const clone = markdown.cloneNode(true);

    for (const selector of [
      "script",
      "style",
      "button",
      "svg",
      "iframe",
      ".not-prose",
      ".not-markdown",
      "[data-dil-widget-copy-target]",
      "[aria-label*='复制']",
      ".select-none"
    ]) {
      for (const node of clone.querySelectorAll(selector)) {
        node.remove();
      }
    }

    return sanitizeHtmlFragment(clone);
  }

  function sanitizeHtmlFragment(root) {
    const allowedTags = new Set([
      "p",
      "br",
      "strong",
      "em",
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
      const nextParent = allowedTags.has(tagName)
        ? document.createElement(tagName)
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
  const runContextStorageKey = "chatgptRunContext";
  let activeRun = null;
  let observer = null;
  let emitTimer = null;
  let pollTimer = null;
  let diagnosticTimer = null;

  function liveUpdatedAt() {
    return new Date().toISOString();
  }

  function setLiveState(value) {
    const snapshot = {
      providerId: provider.id,
      providerName: provider.name,
      href: window.location.href,
      title: document.title,
      updatedAt: liveUpdatedAt(),
      ...value
    };

    try {
      chrome.storage.local.set({
        [liveStorageKey]: snapshot
      });
    } catch {
      return snapshot;
    }

    return snapshot;
  }

  function createWaitingStateForRun(run, extra = {}) {
    return {
      status: "waiting",
      runId: run?.runId || "",
      prompt: run?.prompt || "",
      text: "",
      message: "ChatGPT 网页版在后台标签页可能不会及时渲染回复。请打开 ChatGPT 页面后再同步查看。",
      ...extra
    };
  }

  function beginRun(runId, prompt) {
    window.clearInterval(pollTimer);
    window.clearTimeout(diagnosticTimer);
    const baselineMessageTextById = createMessageTextById();

    activeRun = {
      runId,
      prompt,
      baselineMessageTextById,
      lastText: "",
      startedAt: Date.now()
    };

    try {
      chrome.storage.local.set({
        [runContextStorageKey]: {
          runId,
          prompt,
          baselineEntries: Array.from(baselineMessageTextById.entries()),
          startedAt: Date.now()
        }
      });
    } catch {
      // The next injected instance will rebuild context from the current page.
    }

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
    }, 300);

    diagnosticTimer = window.setTimeout(() => {
      if (!activeRun?.lastText) {
        setLiveState({
          status: "waiting",
          runId,
          prompt,
          text: "",
          message: "ChatGPT 网页版在后台标签页可能不会及时渲染回复。请打开 ChatGPT 页面后再同步查看。"
        });
      }
    }, 8000);
  }

  function emitLatestResponseForRun(run, { force = false } = {}) {
    if (!run) {
      return null;
    }

    const snapshot = getLatestAssistantSnapshot(run);
    const text = snapshot?.text ?? "";

    if (!isValidResponseText(text, run) || (!force && text === run.lastText)) {
      return null;
    }

    run.lastText = text;
    window.clearTimeout(diagnosticTimer);
    return setLiveState({
      status: "success",
      runId: run.runId,
      prompt: run.prompt,
      text,
      html: snapshot?.html || "",
      message: text
    });
  }

  function emitLatestResponse(options = {}) {
    return emitLatestResponseForRun(activeRun, options);
  }

  async function getRunForSync(runId) {
    if (activeRun?.runId === runId) {
      return {
        run: activeRun,
        contextStatus: "activeRun"
      };
    }

    const stored = await chrome.storage.local.get(runContextStorageKey);
    const context = stored[runContextStorageKey];

    if (context?.runId !== runId) {
      return {
        run: null,
        contextStatus: context?.runId ? "storedRunIdMismatch" : "missingStoredContext"
      };
    }

    return {
      run: {
        runId: context.runId,
        prompt: context.prompt || "",
        baselineMessageTextById: new Map(context.baselineEntries || []),
        lastText: "",
        startedAt: context.startedAt || Date.now()
      },
      contextStatus: "storedContext"
    };
  }

  async function syncLatestResponse(runId) {
    const { run, contextStatus } = await getRunForSync(runId);

    if (!run) {
      const diagnostics = getSyncDiagnostics(null, contextStatus);

      return {
        ok: false,
        status: "missing_context",
        message: "ChatGPT 当前没有匹配的运行上下文",
        diagnostics,
        snapshot: setLiveState(createWaitingStateForRun({
          runId,
          prompt: ""
        }, {
          diagnostics
        }))
      };
    }

    let snapshot = emitLatestResponseForRun(run, { force: true });

    if (!snapshot) {
      await nudgeResponseRendering();
      snapshot = emitLatestResponseForRun(run, { force: true });
    }

    if (snapshot?.status === "success") {
      return {
        ok: true,
        snapshot
      };
    }

    const diagnostics = getSyncDiagnostics(run, contextStatus);

    return {
      ok: true,
      snapshot: setLiveState(createWaitingStateForRun(run, {
        diagnostics
      }))
    };
  }

  async function nudgeResponseRendering() {
    const turns = Array.from(document.querySelectorAll("[data-turn='assistant'], [data-message-author-role='assistant']"));
    const latestTurn = turns.at(-1);

    latestTurn?.scrollIntoView?.({
      block: "end",
      inline: "nearest"
    });

    const scrollTargets = [
      document.scrollingElement,
      document.documentElement,
      document.body,
      ...Array.from(document.querySelectorAll("[class*='scroll'], [data-testid*='conversation'], main"))
    ].filter(Boolean);

    for (const target of scrollTargets) {
      try {
        target.scrollTop = target.scrollHeight;
        target.dispatchEvent(new Event("scroll", { bubbles: true }));
      } catch {
        // Some page-owned scroll containers are read-only or detached.
      }
    }

    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("scroll"));
    await getApi().sleep(600);
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

    cleanupTasks.push(() => observer?.disconnect());
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

  function handleRuntimeMessage(message, _sender, sendResponse) {
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

    if (message?.type === "HAI_MEETING_CHATGPT_SEND_PROMPT_V12") {
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

    if (message?.type === "HAI_MEETING_CHATGPT_SYNC_RESPONSE_V12") {
      syncLatestResponse(message.runId)
        .then((result) => sendResponse(result))
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          });
        });
      return true;
    }

    return false;
  }

  chrome.runtime.onMessage.addListener(handleRuntimeMessage);
  cleanupTasks.push(() => {
    window.clearTimeout(emitTimer);
    window.clearInterval(pollTimer);
    window.clearTimeout(diagnosticTimer);
    chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
  });
})();
