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
          error: chrome.runtime.lastError.message
        });
        return;
      }

      resolve(response ?? { ok: false, error: "No response from content script." });
    });
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
  if (message?.type !== "HAI_MEETING_GET_STATUS") {
    return false;
  }

  getStatusSnapshot()
    .then((snapshot) => sendResponse({ ok: true, snapshot }))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    });

  return true;
});
