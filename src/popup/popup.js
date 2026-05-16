import { PROVIDERS } from "../shared/providers.js";

const providerList = document.querySelector("#provider-list");
const currentPage = document.querySelector("#current-page");
const refreshButton = document.querySelector("#refresh-button");
const allModelsForm = document.querySelector("#all-models-form");
const allModelsPrompt = document.querySelector("#all-models-prompt");
const sendAllModelsButton = document.querySelector("#send-all-models-button");
const allChatGPTResult = document.querySelector("#all-chatgpt-result");
const allGeminiResult = document.querySelector("#all-gemini-result");
const allDeepSeekResult = document.querySelector("#all-deepseek-result");
const chatgptForm = document.querySelector("#chatgpt-form");
const chatgptPrompt = document.querySelector("#chatgpt-prompt");
const sendChatGPTButton = document.querySelector("#send-chatgpt-button");
const chatgptResult = document.querySelector("#chatgpt-result");
const geminiForm = document.querySelector("#gemini-form");
const geminiPrompt = document.querySelector("#gemini-prompt");
const sendGeminiButton = document.querySelector("#send-gemini-button");
const geminiResult = document.querySelector("#gemini-result");
const deepseekForm = document.querySelector("#deepseek-form");
const deepseekPrompt = document.querySelector("#deepseek-prompt");
const sendDeepSeekButton = document.querySelector("#send-deepseek-button");
const deepseekResult = document.querySelector("#deepseek-result");

function statusLabel(status) {
  const labels = {
    ready: "可用",
    needs_attention: "需处理",
    not_open: "未打开",
    content_unavailable: "未就绪"
  };

  return labels[status] ?? "未知";
}

function renderLoading() {
  currentPage.textContent = "正在检测当前页面...";
  providerList.innerHTML = PROVIDERS.map(
    (provider) => `
      <article class="provider">
        <div>
          <strong>${provider.name}</strong>
          <span>检测中...</span>
        </div>
        <div class="badge needs_attention">检测中</div>
      </article>
    `
  ).join("");
}

function renderError(error) {
  currentPage.textContent = "检测失败";
  providerList.innerHTML = `<div class="error">${error}</div>`;
}

function renderSnapshot(snapshot) {
  const activeProviderName = snapshot.activeTab?.providerName;
  currentPage.textContent = activeProviderName
    ? `当前标签页：${activeProviderName}`
    : "当前标签页：非模型页面";

  providerList.innerHTML = snapshot.providers
    .map(
      (provider) => `
        <article class="provider">
          <div>
            <strong>${provider.providerName}</strong>
            <span>${provider.message}</span>
          </div>
          <div class="badge ${provider.status}">${statusLabel(provider.status)}</div>
        </article>
      `
    )
    .join("");
}

async function refreshStatus() {
  renderLoading();

  const response = await chrome.runtime.sendMessage({
    type: "HAI_MEETING_GET_STATUS"
  });

  if (!response?.ok) {
    renderError(response?.error || "无法连接插件后台服务");
    return;
  }

  renderSnapshot(response.snapshot);
}

async function restoreLastChatGPTResult() {
  await restoreLastProviderResult("lastChatGPTResult", setChatGPTResult);
}

async function restoreLastGeminiResult() {
  await restoreLastProviderResult("lastGeminiResult", setGeminiResult);
}

async function restoreLastDeepSeekResult() {
  await restoreLastProviderResult("lastDeepSeekResult", setDeepSeekResult);
}

async function restoreLastAllModelsResult() {
  const stored = await chrome.storage.local.get("lastAllModelsResult");
  const last = stored.lastAllModelsResult;

  if (!last?.result?.results) {
    return;
  }

  renderAllModelResults(last.result.results);
}

async function restoreLastProviderResult(storageKey, setResult) {
  const stored = await chrome.storage.local.get(storageKey);
  const last = stored[storageKey];

  if (!last) {
    return;
  }

  if (last.status === "success") {
    setResult(last.message, "success");
    return;
  }

  if (last.status === "failure") {
    const stageText = last.result?.stage ? `\n阶段：${last.result.stage}` : "";
    setResult(`${last.message}${stageText}`, "failure");
    return;
  }

  if (last.status === "running") {
    setResult(last.message, "");
  }
}

function setChatGPTResult(message, type = "") {
  chatgptResult.textContent = message;
  chatgptResult.className = `result ${type}`.trim();
}

function setGeminiResult(message, type = "") {
  geminiResult.textContent = message;
  geminiResult.className = `result ${type}`.trim();
}

function setDeepSeekResult(message, type = "") {
  deepseekResult.textContent = message;
  deepseekResult.className = `result ${type}`.trim();
}

function setAllProviderResult(element, message, type = "") {
  element.textContent = message;
  element.className = `result compact ${type}`.trim();
}

function formatProviderResult(result) {
  if (!result) {
    return {
      message: "未返回结果",
      type: "failure"
    };
  }

  if (result.ok) {
    return {
      message: result.text || "完成，但回复为空",
      type: "success"
    };
  }

  const stageText = result.stage ? `\n阶段：${result.stage}` : "";

  return {
    message: `${result.error || "发送失败"}${stageText}`,
    type: "failure"
  };
}

function renderAllModelResults(results) {
  const chatgpt = formatProviderResult(results.chatgpt);
  const gemini = formatProviderResult(results.gemini);
  const deepseek = formatProviderResult(results.deepseek);

  setAllProviderResult(allChatGPTResult, chatgpt.message, chatgpt.type);
  setAllProviderResult(allGeminiResult, gemini.message, gemini.type);
  setAllProviderResult(allDeepSeekResult, deepseek.message, deepseek.type);
}

async function sendToProvider({
  event,
  promptElement,
  sendButton,
  setResult,
  messageType,
  providerName
}) {
  event.preventDefault();

  const prompt = promptElement.value.trim();

  if (!prompt) {
    setResult("请输入要发送的内容", "failure");
    return;
  }

  sendButton.disabled = true;
  setResult(`正在发送到 ${providerName}，并等待回复...`, "");

  let response;

  try {
    response = await chrome.runtime.sendMessage({
      type: messageType,
      prompt
    });
  } catch (error) {
    sendButton.disabled = false;
    setResult(
      `发送失败：插件后台通信异常\n${error instanceof Error ? error.message : String(error)}`,
      "failure"
    );
    return;
  }

  sendButton.disabled = false;

  if (!response?.ok) {
    const errorText = response?.error || "发送失败：插件后台没有返回具体原因";
    const stageText = response?.stage ? `\n阶段：${response.stage}` : "";
    const detailText = response?.detail ? `\n细节：${JSON.stringify(response.detail)}` : "";
    setResult(`${errorText}${stageText}${detailText}`, "failure");
    await refreshStatus();
    return;
  }

  setResult(response.text, "success");
  await refreshStatus();
}

async function sendToChatGPT(event) {
  return sendToProvider({
    event,
    promptElement: chatgptPrompt,
    sendButton: sendChatGPTButton,
    setResult: setChatGPTResult,
    messageType: "HAI_MEETING_SEND_CHATGPT_PROMPT",
    providerName: "ChatGPT"
  });
}

async function sendToGemini(event) {
  return sendToProvider({
    event,
    promptElement: geminiPrompt,
    sendButton: sendGeminiButton,
    setResult: setGeminiResult,
    messageType: "HAI_MEETING_SEND_GEMINI_PROMPT",
    providerName: "Gemini"
  });
}

async function sendToDeepSeek(event) {
  return sendToProvider({
    event,
    promptElement: deepseekPrompt,
    sendButton: sendDeepSeekButton,
    setResult: setDeepSeekResult,
    messageType: "HAI_MEETING_SEND_DEEPSEEK_PROMPT",
    providerName: "DeepSeek"
  });
}

async function sendToAllModels(event) {
  event.preventDefault();

  const prompt = allModelsPrompt.value.trim();

  if (!prompt) {
    const message = "请输入要发送的内容";
    setAllProviderResult(allChatGPTResult, message, "failure");
    setAllProviderResult(allGeminiResult, message, "failure");
    setAllProviderResult(allDeepSeekResult, message, "failure");
    return;
  }

  sendAllModelsButton.disabled = true;
  setAllProviderResult(allChatGPTResult, "正在发送到 ChatGPT，并等待回复...", "");
  setAllProviderResult(allGeminiResult, "正在发送到 Gemini，并等待回复...", "");
  setAllProviderResult(allDeepSeekResult, "正在发送到 DeepSeek，并等待回复...", "");

  let response;

  try {
    response = await chrome.runtime.sendMessage({
      type: "HAI_MEETING_SEND_ALL_PROMPT",
      prompt
    });
  } catch (error) {
    const message = `发送失败：插件后台通信异常\n${error instanceof Error ? error.message : String(error)}`;
    sendAllModelsButton.disabled = false;
    setAllProviderResult(allChatGPTResult, message, "failure");
    setAllProviderResult(allGeminiResult, message, "failure");
    setAllProviderResult(allDeepSeekResult, message, "failure");
    return;
  }

  sendAllModelsButton.disabled = false;

  if (!response?.results) {
    const message = response?.error || "发送失败：插件后台没有返回三模型结果";
    setAllProviderResult(allChatGPTResult, message, "failure");
    setAllProviderResult(allGeminiResult, message, "failure");
    setAllProviderResult(allDeepSeekResult, message, "failure");
    await refreshStatus();
    return;
  }

  renderAllModelResults(response.results);
  await refreshStatus();
}

refreshButton.addEventListener("click", refreshStatus);
allModelsForm.addEventListener("submit", sendToAllModels);
chatgptForm.addEventListener("submit", sendToChatGPT);
geminiForm.addEventListener("submit", sendToGemini);
deepseekForm.addEventListener("submit", sendToDeepSeek);
refreshStatus();
restoreLastAllModelsResult();
restoreLastChatGPTResult();
restoreLastGeminiResult();
restoreLastDeepSeekResult();
