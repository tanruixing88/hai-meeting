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
    return {
      ok: false,
      error: providerId === "chatgpt" ? "请先打开并登录 ChatGPT 页面" : "请先打开模型页面"
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
      : "模型页面未就绪"
  };
}

async function sendPromptToChatGPT(prompt) {
  const text = prompt?.trim();

  if (!text) {
    return {
      ok: false,
      error: "请输入要发送的内容"
    };
  }

  await chrome.storage.local.set({
    lastChatGPTResult: {
      status: "running",
      prompt: text,
      updatedAt: new Date().toISOString(),
      message: "正在发送到 ChatGPT，并等待回复..."
    }
  });

  const readyTab = await findReadyProviderTab("chatgpt");

  if (!readyTab.ok) {
    await chrome.storage.local.set({
      lastChatGPTResult: {
        status: "failure",
        prompt: text,
        updatedAt: new Date().toISOString(),
        message: readyTab.error,
        result: readyTab
      }
    });
    return readyTab;
  }

  const response = await sendTabMessage(readyTab.tab.id, {
    type: "HAI_MEETING_CHATGPT_SEND_PROMPT",
    prompt: text,
    timeoutMs: 120000
  });

  if (!response?.ok) {
    const result = {
      ok: false,
      error: response?.error || "ChatGPT 执行失败，但页面脚本未返回具体原因",
      stage: response?.stage || "chatgpt_content",
      detail: response
    };

    await chrome.storage.local.set({
      lastChatGPTResult: {
        status: "failure",
        prompt: text,
        updatedAt: new Date().toISOString(),
        message: result.error,
        result
      }
    });

    return result;
  }

  const result = {
    ok: true,
    providerId: "chatgpt",
    providerName: "ChatGPT",
    tabId: readyTab.tab.id,
    title: readyTab.tab.title,
    text: response.text
  };

  await chrome.storage.local.set({
    lastChatGPTResult: {
      status: "success",
      prompt: text,
      updatedAt: new Date().toISOString(),
      message: response.text,
      result
    }
  });

  return result;
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
    sendPromptToChatGPT(message.prompt)
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
