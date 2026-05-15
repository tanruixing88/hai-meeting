import { PROVIDERS } from "../shared/providers.js";

const providerList = document.querySelector("#provider-list");
const currentPage = document.querySelector("#current-page");
const refreshButton = document.querySelector("#refresh-button");
const chatgptForm = document.querySelector("#chatgpt-form");
const chatgptPrompt = document.querySelector("#chatgpt-prompt");
const sendChatGPTButton = document.querySelector("#send-chatgpt-button");
const chatgptResult = document.querySelector("#chatgpt-result");

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
  const stored = await chrome.storage.local.get("lastChatGPTResult");
  const last = stored.lastChatGPTResult;

  if (!last) {
    return;
  }

  if (last.status === "success") {
    setChatGPTResult(last.message, "success");
    return;
  }

  if (last.status === "failure") {
    const stageText = last.result?.stage ? `\n阶段：${last.result.stage}` : "";
    setChatGPTResult(`${last.message}${stageText}`, "failure");
    return;
  }

  if (last.status === "running") {
    setChatGPTResult(last.message, "");
  }
}

function setChatGPTResult(message, type = "") {
  chatgptResult.textContent = message;
  chatgptResult.className = `result ${type}`.trim();
}

async function sendToChatGPT(event) {
  event.preventDefault();

  const prompt = chatgptPrompt.value.trim();

  if (!prompt) {
    setChatGPTResult("请输入要发送的内容", "failure");
    return;
  }

  sendChatGPTButton.disabled = true;
  setChatGPTResult("正在发送到 ChatGPT，并等待回复...", "");

  let response;

  try {
    response = await chrome.runtime.sendMessage({
      type: "HAI_MEETING_SEND_CHATGPT_PROMPT",
      prompt
    });
  } catch (error) {
    sendChatGPTButton.disabled = false;
    setChatGPTResult(
      `发送失败：插件后台通信异常\n${error instanceof Error ? error.message : String(error)}`,
      "failure"
    );
    return;
  }

  sendChatGPTButton.disabled = false;

  if (!response?.ok) {
    const errorText = response?.error || "发送失败：插件后台没有返回具体原因";
    const stageText = response?.stage ? `\n阶段：${response.stage}` : "";
    const detailText = response?.detail ? `\n细节：${JSON.stringify(response.detail)}` : "";
    setChatGPTResult(`${errorText}${stageText}${detailText}`, "failure");
    await refreshStatus();
    return;
  }

  setChatGPTResult(response.text, "success");
  await refreshStatus();
}

refreshButton.addEventListener("click", refreshStatus);
chatgptForm.addEventListener("submit", sendToChatGPT);
refreshStatus();
restoreLastChatGPTResult();
