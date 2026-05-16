const PROVIDERS = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    matchPrefixes: ["https://chatgpt.com/", "https://chat.openai.com/"],
    scripts: ["src/content/common.js", "src/content/chatgpt.js"]
  },
  {
    id: "gemini",
    name: "Gemini",
    matchPrefixes: ["https://gemini.google.com/"],
    scripts: ["src/content/common.js", "src/content/gemini.js"]
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    matchPrefixes: ["https://chat.deepseek.com/"],
    scripts: ["src/content/common.js", "src/content/deepseek.js"]
  }
];

const providerRunTabsStorageKey = "providerRunTabs";

function getProviderByUrl(url = "") {
  return PROVIDERS.find((provider) =>
    provider.matchPrefixes.some((matchPrefix) => url.startsWith(matchPrefix))
  ) ?? null;
}

async function queryTabs() {
  return chrome.tabs.query({});
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

function getTabById(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }

      resolve(tab ?? null);
    });
  });
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({
          ok: false,
          error: `标签页消息失败：${chrome.runtime.lastError.message}`,
          stage: "tab_message",
          messageType: message?.type
        });
        return;
      }

      resolve(response ?? {
        ok: false,
        error: "页面脚本没有返回结果",
        stage: "empty_content_response",
        messageType: message?.type
      });
    });
  });
}

function waitForTabComplete(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(false);
    }, timeoutMs);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        clearTimeout(timeoutId);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(true);
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function injectProviderScripts(tabId, provider) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: provider.scripts
  });
}

async function sendProviderMessage(tabId, provider, message) {
  let response = await sendTabMessage(tabId, message);

  if (response?.ok || response?.status === "missing_context") {
    return response;
  }

  await injectProviderScripts(tabId, provider);
  response = await sendTabMessage(tabId, message);

  return response;
}

async function rememberProviderRunTab(providerId, runId, tabId) {
  if (!runId || !tabId) {
    return;
  }

  const stored = await chrome.storage.local.get(providerRunTabsStorageKey);
  const entries = stored[providerRunTabsStorageKey] ?? {};
  const nextEntries = {
    ...entries,
    [runId]: {
      providerId,
      tabId,
      updatedAt: Date.now()
    }
  };

  const prunedEntries = Object.fromEntries(
    Object.entries(nextEntries)
      .sort(([, first], [, second]) => (second.updatedAt || 0) - (first.updatedAt || 0))
      .slice(0, 80)
  );

  await chrome.storage.local.set({
    [providerRunTabsStorageKey]: prunedEntries
  });
}

async function findRememberedRunTab(providerId, runId) {
  const provider = PROVIDERS.find((candidate) => candidate.id === providerId);

  if (!provider || !runId) {
    return null;
  }

  const stored = await chrome.storage.local.get(providerRunTabsStorageKey);
  const entry = stored[providerRunTabsStorageKey]?.[runId];

  if (entry?.providerId !== providerId || !entry.tabId) {
    return null;
  }

  const tab = await getTabById(entry.tabId);

  if (!tab?.id || getProviderByUrl(tab.url)?.id !== providerId) {
    return null;
  }

  return {
    ok: true,
    tab,
    provider
  };
}

async function detectProviderPage(tabId, provider) {
  const message = {
    type: "HAI_MEETING_DETECT_PAGE",
    providerId: provider.id
  };
  let response = await sendTabMessage(tabId, message);

  if (response?.ok) {
    return response;
  }

  await injectProviderScripts(tabId, provider);
  response = await sendTabMessage(tabId, message);

  return response;
}

async function inspectProviderTab(provider, tabs) {
  const tab = tabs.find((candidate) => getProviderByUrl(candidate.url)?.id === provider.id);

  if (!tab?.id) {
    return {
      providerId: provider.id,
      providerName: provider.name,
      opened: false,
      status: "not_open",
      message: "未打开页面"
    };
  }

  const response = await detectProviderPage(tab.id, provider);

  if (!response?.ok) {
    return {
      providerId: provider.id,
      providerName: provider.name,
      opened: true,
      tabId: tab.id,
      url: tab.url,
      title: tab.title,
      status: "content_unavailable",
      message: response?.error || "页面脚本未就绪，请刷新该模型页面"
    };
  }

  return {
    providerId: provider.id,
    providerName: provider.name,
    opened: true,
    tabId: tab.id,
    url: tab.url,
    title: tab.title,
    status: response.inputReady ? "ready" : "needs_attention",
    message: response.inputReady ? "可用" : response.reason || "未找到输入框",
    details: response
  };
}

async function findReadyProviderTab(providerId) {
  const provider = PROVIDERS.find((candidate) => candidate.id === providerId);
  const tabs = await queryTabs();
  const matchingTabs = tabs.filter((tab) => getProviderByUrl(tab.url)?.id === providerId);

  if (!provider || matchingTabs.length === 0) {
    const providerName = providerId === "chatgpt"
      ? "ChatGPT"
      : providerId === "gemini"
        ? "Gemini"
        : providerId === "deepseek"
          ? "DeepSeek"
          : "模型";
    return {
      ok: false,
      error: `请先打开并登录 ${providerName} 页面`
    };
  }

  for (const tab of matchingTabs) {
    if (!tab.id) {
      continue;
    }

    if (tab.status !== "complete") {
      await waitForTabComplete(tab.id);
    }

    const response = await detectProviderPage(tab.id, provider);

    if (response?.ok && response.inputReady) {
      return {
        ok: true,
        tab,
        provider,
        page: response
      };
    }
  }

  return {
    ok: false,
    error: providerId === "chatgpt"
      ? "请先打开并登录 ChatGPT 页面，确认输入框可用"
      : providerId === "gemini"
        ? "请先打开并登录 Gemini 页面，确认输入框可用"
        : providerId === "deepseek"
          ? "请先打开并登录 DeepSeek 页面，确认输入框可用"
          : "模型页面未就绪"
  };
}

function createRunId(providerId) {
  return `${providerId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function sendPromptToProvider({ providerId, providerName, storageKey, messageType, prompt, runId }) {
  const text = prompt?.trim();
  const currentRunId = runId || createRunId(providerId);

  if (!text) {
    return {
      ok: false,
      error: "请输入要发送的内容"
    };
  }

  await chrome.storage.local.set({
    [storageKey]: {
      status: "running",
      prompt: text,
      runId: currentRunId,
      updatedAt: new Date().toISOString(),
      message: `正在发送到 ${providerName}，等待页面监听器捕获回复...`
    }
  });

  const readyTab = await findReadyProviderTab(providerId);

  if (!readyTab.ok) {
    await chrome.storage.local.set({
      [storageKey]: {
        status: "failure",
        prompt: text,
        runId: currentRunId,
        updatedAt: new Date().toISOString(),
        message: readyTab.error,
        result: readyTab
      }
    });
    return readyTab;
  }

  await injectProviderScripts(readyTab.tab.id, readyTab.provider);

  const response = await sendTabMessage(readyTab.tab.id, {
    type: messageType,
    prompt: text,
    runId: currentRunId
  });

  if (!response?.ok) {
    const result = {
      ok: false,
      error: response?.error || `${providerName} 执行失败，但页面脚本未返回具体原因`,
      stage: response?.stage || `${providerId}_content`,
      detail: response
    };

    await chrome.storage.local.set({
      [storageKey]: {
        status: "failure",
        prompt: text,
        runId: currentRunId,
        updatedAt: new Date().toISOString(),
        message: result.error,
        result
      }
    });

    return result;
  }

  const result = {
    ok: true,
    providerId,
    providerName,
    runId: currentRunId,
    tabId: readyTab.tab.id,
    title: readyTab.tab.title,
    status: response.status || "sent",
    message: response.message || `已发送到 ${providerName}，等待页面监听器捕获回复`
  };

  await rememberProviderRunTab(providerId, currentRunId, readyTab.tab.id);

  await chrome.storage.local.set({
    [storageKey]: {
      status: "running",
      prompt: text,
      runId: currentRunId,
      updatedAt: new Date().toISOString(),
      message: result.message,
      result
    }
  });

  return result;
}

async function sendPromptToChatGPT(prompt, runId) {
  return sendPromptToProvider({
    providerId: "chatgpt",
    providerName: "ChatGPT",
    storageKey: "lastChatGPTResult",
    messageType: "HAI_MEETING_CHATGPT_SEND_PROMPT_V12",
    prompt,
    runId
  });
}

async function syncProviderResponse(providerId, runId) {
  if (providerId !== "chatgpt") {
    return {
      ok: false,
      error: "当前只支持主动同步 ChatGPT 回复"
    };
  }

  const readyTab = await findRememberedRunTab(providerId, runId) ??
    await findReadyProviderTab(providerId);

  if (!readyTab.ok) {
    return readyTab;
  }

  return sendProviderMessage(readyTab.tab.id, readyTab.provider, {
    type: "HAI_MEETING_CHATGPT_SYNC_RESPONSE_V12",
    runId
  });
}

async function sendPromptToGemini(prompt, runId) {
  return sendPromptToProvider({
    providerId: "gemini",
    providerName: "Gemini",
    storageKey: "lastGeminiResult",
    messageType: "HAI_MEETING_GEMINI_SEND_PROMPT_V9",
    prompt,
    runId
  });
}

async function sendPromptToDeepSeek(prompt, runId) {
  return sendPromptToProvider({
    providerId: "deepseek",
    providerName: "DeepSeek",
    storageKey: "lastDeepSeekResult",
    messageType: "HAI_MEETING_DEEPSEEK_SEND_PROMPT_V9",
    prompt,
    runId
  });
}

async function sendPromptToAllProviders(prompt) {
  const text = prompt?.trim();

  if (!text) {
    return {
      ok: false,
      error: "请输入要发送的内容"
    };
  }

  await chrome.storage.local.set({
    lastAllModelsResult: {
      status: "running",
      prompt: text,
      updatedAt: new Date().toISOString(),
      message: "正在发送到全部模型，并等待回复..."
    }
  });

  const entries = await Promise.all([
    sendPromptToChatGPT(text, createRunId("chatgpt")).then((result) => ["chatgpt", result]),
    sendPromptToGemini(text, createRunId("gemini")).then((result) => ["gemini", result]),
    sendPromptToDeepSeek(text, createRunId("deepseek")).then((result) => ["deepseek", result])
  ]);
  const results = Object.fromEntries(entries);
  const ok = Object.values(results).some((result) => result.ok);

  const summary = {
    ok,
    prompt: text,
    updatedAt: new Date().toISOString(),
    results
  };

  await chrome.storage.local.set({
    lastAllModelsResult: {
      status: ok ? "success" : "failure",
      prompt: text,
      updatedAt: summary.updatedAt,
      message: ok ? "三模型运行完成" : "三模型运行失败",
      result: summary
    }
  });

  return summary;
}

async function getStatusSnapshot() {
  const [tabs, activeTab] = await Promise.all([queryTabs(), getActiveTab()]);
  const currentProvider = getProviderByUrl(activeTab?.url);
  const providers = await Promise.all(
    PROVIDERS.map((provider) => inspectProviderTab(provider, tabs))
  );

  return {
    activeTab: activeTab
      ? {
          id: activeTab.id,
          title: activeTab.title,
          url: activeTab.url,
          providerId: currentProvider?.id ?? null,
          providerName: currentProvider?.name ?? null
        }
      : null,
    providers
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "HAI_MEETING_GET_STATUS") {
    getStatusSnapshot()
      .then((snapshot) => sendResponse({ ok: true, snapshot }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      });

    return true;
  }

  if (message?.type === "HAI_MEETING_SEND_CHATGPT_PROMPT") {
    sendPromptToChatGPT(message.prompt, message.runId)
      .then((result) => sendResponse(result))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      });

    return true;
  }

  if (message?.type === "HAI_MEETING_SYNC_PROVIDER_RESPONSE") {
    syncProviderResponse(message.providerId, message.runId)
      .then((result) => sendResponse(result))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      });

    return true;
  }

  if (message?.type === "HAI_MEETING_SEND_GEMINI_PROMPT") {
    sendPromptToGemini(message.prompt, message.runId)
      .then((result) => sendResponse(result))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      });

    return true;
  }

  if (message?.type === "HAI_MEETING_SEND_DEEPSEEK_PROMPT") {
    sendPromptToDeepSeek(message.prompt, message.runId)
      .then((result) => sendResponse(result))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      });

    return true;
  }

  if (message?.type === "HAI_MEETING_SEND_ALL_PROMPT") {
    sendPromptToAllProviders(message.prompt)
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
});
