import { PROVIDERS } from "../shared/providers.js";

const providerList = document.querySelector("#provider-list");
const currentPage = document.querySelector("#current-page");
const refreshButton = document.querySelector("#refresh-button");
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

refreshButton.addEventListener("click", refreshStatus);
chatgptForm.addEventListener("submit", sendToChatGPT);
geminiForm.addEventListener("submit", sendToGemini);
deepseekForm.addEventListener("submit", sendToDeepSeek);
refreshStatus();
restoreLastChatGPTResult();
restoreLastGeminiResult();
restoreLastDeepSeekResult();
