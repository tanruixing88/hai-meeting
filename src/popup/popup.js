import { PROVIDERS } from "../shared/providers.js";

const providerList = document.querySelector("#provider-list");
const currentPage = document.querySelector("#current-page");
const refreshButton = document.querySelector("#refresh-button");

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
    ? `当前页面：${activeProviderName}`
    : "当前页面：未支持页面";

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

refreshButton.addEventListener("click", refreshStatus);
refreshStatus();
