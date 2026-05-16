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
const summarizeDiscussionButton = document.querySelector("#summarize-discussion-button");
const copySummaryButton = document.querySelector("#copy-summary-button");
const discussionSummaryResult = document.querySelector("#discussion-summary-result");
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

const liveResponseKeys = {
  chatgpt: "liveResponse_chatgpt",
  gemini: "liveResponse_gemini",
  deepseek: "liveResponse_deepseek"
};

const providerStorageKeys = {
  chatgpt: "lastChatGPTResult",
  gemini: "lastGeminiResult",
  deepseek: "lastDeepSeekResult"
};

const providerResultSetters = {
  chatgpt: setChatGPTResult,
  gemini: setGeminiResult,
  deepseek: setDeepSeekResult
};

const allProviderElements = {
  chatgpt: allChatGPTResult,
  gemini: allGeminiResult,
  deepseek: allDeepSeekResult
};

const activeProviderRuns = new Map();
const renderedLiveSignatures = new Map();
let activeAllRunIds = {};
let activeAllPrompt = "";
let activeLiveSyncTimer = null;
let activeSummaryRunId = "";
let activeSummaryPrompt = "";
let latestSummaryText = "";

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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function renderTable(lines) {
  const rows = lines
    .filter((line) => !isTableSeparator(line))
    .map((line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim()));

  if (rows.length === 0) {
    return "";
  }

  const [head, ...body] = rows;
  const headHtml = head.map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`).join("");
  const bodyHtml = body
    .map((row) => `<tr>${row.map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`).join("")}</tr>`)
    .join("");

  return `<div class="md-table-wrap"><table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
}

function markdownToHtml(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let paragraph = [];
  let list = [];
  let orderedList = [];
  let table = [];
  let codeBlock = [];
  let inCodeBlock = false;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      html.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };

  const flushList = () => {
    if (list.length > 0) {
      html.push(`<ul>${list.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ul>`);
      list = [];
    }

    if (orderedList.length > 0) {
      html.push(`<ol>${orderedList.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ol>`);
      orderedList = [];
    }
  };

  const flushTable = () => {
    if (table.length > 0) {
      html.push(renderTable(table));
      table = [];
    }
  };

  const flushCodeBlock = () => {
    if (codeBlock.length > 0) {
      html.push(`<pre><code>${escapeHtml(codeBlock.join("\n"))}</code></pre>`);
      codeBlock = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      if (inCodeBlock) {
        flushCodeBlock();
        inCodeBlock = false;
      } else {
        flushParagraph();
        flushList();
        flushTable();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlock.push(line);
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      flushTable();
      continue;
    }

    if (trimmed.includes("|") && (isTableSeparator(trimmed) || table.length > 0 || /^\|.+\|$/.test(trimmed))) {
      flushParagraph();
      flushList();
      table.push(trimmed);
      continue;
    }

    flushTable();

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(heading[1].length + 2, 6);
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const unordered = trimmed.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      orderedList = [];
      list.push(unordered[1]);
      continue;
    }

    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      list = [];
      orderedList.push(ordered[1]);
      continue;
    }

    if (trimmed.startsWith(">")) {
      flushParagraph();
      flushList();
      html.push(`<blockquote>${renderInlineMarkdown(trimmed.replace(/^>\s?/, ""))}</blockquote>`);
      continue;
    }

    paragraph.push(trimmed);
  }

  flushCodeBlock();
  flushParagraph();
  flushList();
  flushTable();

  return html.join("");
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

function createRunId(providerId) {
  const randomPart = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${providerId}-${randomPart}`;
}

function liveSnapshotToResult(snapshot) {
  if (!snapshot) {
    return null;
  }

  if (snapshot.status === "success" && snapshot.text) {
    return {
      ok: true,
      text: snapshot.text,
      html: snapshot.html || "",
      runId: snapshot.runId
    };
  }

  if (snapshot.status === "failure") {
    return {
      ok: false,
      error: snapshot.message || "页面监听器返回失败",
      runId: snapshot.runId
    };
  }

  return {
    pending: true,
    message: snapshot.message || "已发送，等待页面回复...",
    runId: snapshot.runId
  };
}

async function saveProviderLiveResult(providerId, snapshot) {
  const storageKey = providerStorageKeys[providerId];

  if (!storageKey || !snapshot) {
    return;
  }

  await chrome.storage.local.set({
    [storageKey]: {
      status: snapshot.status === "success" ? "success" : snapshot.status || "running",
      prompt: snapshot.prompt,
      runId: snapshot.runId,
      updatedAt: snapshot.updatedAt || new Date().toISOString(),
      message: snapshot.text || snapshot.message || "",
      html: snapshot.html || "",
      result: liveSnapshotToResult(snapshot)
    }
  });
}

async function handleLiveResponse(providerId, snapshot) {
  if (!snapshot?.runId) {
    return;
  }

  if (providerId === "chatgpt" && activeSummaryRunId === snapshot.runId) {
    await handleDiscussionSummarySnapshot(snapshot);
    return;
  }

  const signature = createLiveSnapshotSignature(snapshot);

  if (renderedLiveSignatures.get(providerId) === signature) {
    return;
  }

  renderedLiveSignatures.set(providerId, signature);
  renderProviderLiveSnapshot(providerId, snapshot);
  await saveProviderLiveResult(providerId, snapshot);

  const singleRunId = activeProviderRuns.get(providerId);

  if (singleRunId === snapshot.runId && snapshot.status === "failure") {
    activeProviderRuns.delete(providerId);
  }

  if (activeAllRunIds[providerId] === snapshot.runId) {
    await updateAllModelProviderResult(providerId, snapshot);
    return;
  }

  await updateStoredAllModelProviderResult(providerId, snapshot);
}

function createLiveSnapshotSignature(snapshot) {
  return [
    snapshot.runId || "",
    snapshot.status || "",
    snapshot.updatedAt || "",
    snapshot.text || "",
    snapshot.message || ""
  ].join("|");
}

function hasActiveRunForSnapshot(providerId, snapshot) {
  return Boolean(snapshot?.runId) &&
    (activeProviderRuns.get(providerId) === snapshot.runId ||
      activeAllRunIds[providerId] === snapshot.runId);
}

async function syncActiveLiveResponses() {
  const hasActiveSingleRun = activeProviderRuns.size > 0;
  const hasActiveAllRun = Object.keys(activeAllRunIds).length > 0;

  if (!hasActiveSingleRun && !hasActiveAllRun) {
    return;
  }

  await syncActiveProviderTabs();

  const stored = await chrome.storage.local.get(Object.values(liveResponseKeys));

  for (const [providerId, storageKey] of Object.entries(liveResponseKeys)) {
    const snapshot = stored[storageKey];

    if (hasActiveRunForSnapshot(providerId, snapshot)) {
      await handleLiveResponse(providerId, snapshot);
    }
  }
}

async function syncActiveProviderTabs() {
  const runEntries = [];

  for (const [providerId, runId] of activeProviderRuns.entries()) {
    runEntries.push([providerId, runId]);
  }

  for (const [providerId, runId] of Object.entries(activeAllRunIds)) {
    runEntries.push([providerId, runId]);
  }

  const uniqueRunEntries = Array.from(
    new Map(runEntries.map(([providerId, runId]) => [`${providerId}:${runId}`, [providerId, runId]])).values()
  );

  await Promise.allSettled(
    uniqueRunEntries
      .filter(([providerId]) => providerId === "chatgpt")
      .map(([providerId, runId]) => chrome.runtime.sendMessage({
        type: "HAI_MEETING_SYNC_PROVIDER_RESPONSE",
        providerId,
        runId
      }))
  );
}

function ensureActiveLiveSync() {
  if (activeLiveSyncTimer) {
    return;
  }

  activeLiveSyncTimer = window.setInterval(syncActiveLiveResponses, 1000);
}

function renderProviderLiveSnapshot(providerId, snapshot) {
  const setResult = providerResultSetters[providerId];

  if (!setResult) {
    return;
  }

  const formatted = formatProviderResult(liveSnapshotToResult(snapshot));
  setResult(formatted.message, formatted.type, formatted.html);
}

async function updateAllModelProviderResult(providerId, snapshot) {
  const result = liveSnapshotToResult(snapshot);
  const formatted = formatProviderResult(result);
  setAllProviderResult(allProviderElements[providerId], formatted.message, formatted.type, formatted.html);

  const stored = await chrome.storage.local.get("lastAllModelsResult");
  const previousResults = stored.lastAllModelsResult?.result?.results ?? {};
  const nextResults = {
    ...previousResults,
    [providerId]: result
  };

  await saveAllModelsResult(activeAllPrompt || snapshot.prompt || "", nextResults);
}

async function updateStoredAllModelProviderResult(providerId, snapshot) {
  const stored = await chrome.storage.local.get("lastAllModelsResult");
  const last = stored.lastAllModelsResult;
  const previousResults = last?.result?.results ?? {};
  const previousProviderResult = previousResults[providerId];

  if (previousProviderResult?.runId !== snapshot.runId) {
    return;
  }

  const nextResult = liveSnapshotToResult(snapshot);
  const nextResults = {
    ...previousResults,
    [providerId]: nextResult
  };

  await saveAllModelsResult(last.prompt || snapshot.prompt || "", nextResults);
  renderAllModelResults(nextResults);
}

async function restoreLiveResponses() {
  const stored = await chrome.storage.local.get(Object.values(liveResponseKeys));
  let restoredActiveRun = false;

  for (const [providerId, storageKey] of Object.entries(liveResponseKeys)) {
    const snapshot = stored[storageKey];

    if (snapshot?.runId) {
      renderProviderLiveSnapshot(providerId, snapshot);

      if (snapshot.status !== "success" && snapshot.status !== "failure") {
        activeProviderRuns.set(providerId, snapshot.runId);
        restoredActiveRun = true;
      }
    }
  }

  if (restoredActiveRun) {
    ensureActiveLiveSync();
    await syncActiveLiveResponses();
  }
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

  activeAllPrompt = last.prompt || last.result.prompt || "";
  activeAllRunIds = Object.fromEntries(
    Object.entries(last.result.results)
      .filter(([, result]) => result?.runId)
      .map(([providerId, result]) => [providerId, result.runId])
  );

  const reconciledResults = await reconcileAllModelsWithLiveResponses(last.result.results);
  renderAllModelResults(reconciledResults);
}

async function restoreLastDiscussionSummary() {
  const stored = await chrome.storage.local.get("lastDiscussionSummary");
  const summary = stored.lastDiscussionSummary;

  if (!summary) {
    return;
  }

  activeSummaryRunId = summary.status === "running" ? summary.runId || "" : "";
  activeSummaryPrompt = summary.prompt || "";
  latestSummaryText = summary.text || "";

  if (summary.status === "success") {
    setDiscussionSummaryResult(summary.text || "总结为空", "success");
    return;
  }

  if (summary.status === "failure") {
    setDiscussionSummaryResult(summary.message || "总结失败", "failure");
    return;
  }

  if (summary.status === "running") {
    setDiscussionSummaryResult(summary.message || "正在生成本轮总结...", "");

    if (activeSummaryRunId) {
      activeProviderRuns.set("chatgpt", activeSummaryRunId);
      ensureActiveLiveSync();
    }
  }
}

async function reconcileAllModelsWithLiveResponses(results) {
  const stored = await chrome.storage.local.get(Object.values(liveResponseKeys));
  const nextResults = { ...results };
  let changed = false;

  for (const [providerId, storageKey] of Object.entries(liveResponseKeys)) {
    const liveSnapshot = stored[storageKey];

    if (liveSnapshot?.runId && results[providerId]?.runId === liveSnapshot.runId) {
      const liveResult = liveSnapshotToResult(liveSnapshot);

      if (liveResult?.ok || liveResult?.pending === false || liveSnapshot.status === "success") {
        nextResults[providerId] = liveResult;
        changed = true;
      }
    }
  }

  if (changed) {
    await saveAllModelsResult(activeAllPrompt, nextResults);
  }

  return nextResults;
}

async function restoreLastProviderResult(storageKey, setResult) {
  const stored = await chrome.storage.local.get(storageKey);
  const last = stored[storageKey];

  if (!last) {
    return;
  }

  if (last.status === "success") {
    setResult(last.message, "success", last.html || last.result?.html || "");
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

function setChatGPTResult(message, type = "", html = "") {
  chatgptResult.innerHTML = type === "success" && html ? html : type === "success" ? markdownToHtml(message) : escapeHtml(message);
  chatgptResult.className = `result ${type}`.trim();
}

function setGeminiResult(message, type = "", html = "") {
  geminiResult.innerHTML = type === "success" && html ? html : type === "success" ? markdownToHtml(message) : escapeHtml(message);
  geminiResult.className = `result ${type}`.trim();
}

function setDeepSeekResult(message, type = "", html = "") {
  deepseekResult.innerHTML = type === "success" && html ? html : type === "success" ? markdownToHtml(message) : escapeHtml(message);
  deepseekResult.className = `result ${type}`.trim();
}

function setDiscussionSummaryResult(message, type = "", html = "") {
  discussionSummaryResult.innerHTML = type === "success" && html ? html : type === "success" ? markdownToHtml(message) : escapeHtml(message);
  discussionSummaryResult.className = `result ${type}`.trim();
}

function setAllProviderResult(element, message, type = "", html = "") {
  element.innerHTML = type === "success" && html ? html : type === "success" ? markdownToHtml(message) : escapeHtml(message);
  element.className = `result compact ${type}`.trim();
}

function formatProviderResult(result) {
  if (!result) {
    return {
      message: "未返回结果",
      type: "failure"
    };
  }

  if (result.pending) {
    return {
      message: result.message || "正在等待回复...",
      type: ""
    };
  }

  if (result.ok) {
    return {
      message: result.text || "完成，但回复为空",
      type: "success",
      html: result.html || ""
    };
  }

  const stageText = result.stage ? `\n阶段：${result.stage}` : "";

  return {
    message: `${result.error || "发送失败"}${stageText}`,
    type: "failure"
  };
}

async function saveAllModelsResult(prompt, results, status = "running") {
  await chrome.storage.local.set({
    lastAllModelsResult: {
      status,
      prompt,
      updatedAt: new Date().toISOString(),
      message: status === "running" ? "三模型运行中" : "三模型运行完成",
      result: {
        ok: Object.values(results).some((result) => result?.ok),
        prompt,
        updatedAt: new Date().toISOString(),
        results
      }
    }
  });
}

function shouldKeepStoredResult(storedResult, nextResult) {
  return Boolean(storedResult?.ok && !nextResult?.ok);
}

async function mergeStoredAllModelResults(results) {
  const stored = await chrome.storage.local.get("lastAllModelsResult");
  const storedResults = stored.lastAllModelsResult?.result?.results ?? {};
  const merged = { ...results };

  for (const [providerId, storedResult] of Object.entries(storedResults)) {
    if (shouldKeepStoredResult(storedResult, merged[providerId])) {
      merged[providerId] = storedResult;
    }
  }

  return merged;
}

function renderAllModelResults(results) {
  const chatgpt = formatProviderResult(results.chatgpt);
  const gemini = formatProviderResult(results.gemini);
  const deepseek = formatProviderResult(results.deepseek);

  setAllProviderResult(allChatGPTResult, chatgpt.message, chatgpt.type, chatgpt.html);
  setAllProviderResult(allGeminiResult, gemini.message, gemini.type, gemini.html);
  setAllProviderResult(allDeepSeekResult, deepseek.message, deepseek.type, deepseek.html);
}

function getProviderDiscussionText(providerName, result) {
  if (result?.ok && result.text) {
    return `${providerName} 回答：\n${result.text}`;
  }

  if (result?.pending) {
    return `${providerName} 回答：\n暂未收集到有效回复。`;
  }

  return `${providerName} 回答：\n不可用：${result?.error || result?.message || "未返回结果"}`;
}

function buildDiscussionSummaryPrompt(topic, results) {
  return [
    "你是这场 AI 讨论的主持人。请根据议题和各位 AI 的回答，生成本轮讨论总结。",
    "",
    "要求：",
    "1. 不要重复粘贴原文，提炼即可。",
    "2. 区分共识、分歧、可执行结论。",
    "3. 如果某个模型没有有效回复，直接说明该模型未参与有效讨论，不要编造。",
    "4. 输出 Markdown。",
    "",
    "输出结构：",
    "## 本轮结论",
    "## 主要共识",
    "## 关键分歧",
    "## 推荐方案",
    "## 下一步行动",
    "",
    `议题：\n${topic}`,
    "",
    getProviderDiscussionText("ChatGPT", results.chatgpt),
    "",
    getProviderDiscussionText("Gemini", results.gemini),
    "",
    getProviderDiscussionText("DeepSeek", results.deepseek)
  ].join("\n");
}

async function saveDiscussionSummary(summary) {
  await chrome.storage.local.set({
    lastDiscussionSummary: {
      updatedAt: new Date().toISOString(),
      ...summary
    }
  });
}

async function handleDiscussionSummarySnapshot(snapshot) {
  const result = liveSnapshotToResult(snapshot);
  const formatted = formatProviderResult(result);

  setDiscussionSummaryResult(formatted.message, formatted.type, formatted.html);

  if (result?.ok) {
    latestSummaryText = result.text || "";
    activeProviderRuns.delete("chatgpt");
    activeSummaryRunId = "";
    await saveDiscussionSummary({
      status: "success",
      runId: snapshot.runId,
      prompt: activeSummaryPrompt || snapshot.prompt || "",
      text: latestSummaryText,
      message: latestSummaryText
    });
    return;
  }

  if (snapshot.status === "failure") {
    activeProviderRuns.delete("chatgpt");
    activeSummaryRunId = "";
    await saveDiscussionSummary({
      status: "failure",
      runId: snapshot.runId,
      prompt: activeSummaryPrompt || snapshot.prompt || "",
      text: "",
      message: formatted.message
    });
    return;
  }

  await saveDiscussionSummary({
    status: "running",
    runId: snapshot.runId,
    prompt: activeSummaryPrompt || snapshot.prompt || "",
    text: "",
    message: formatted.message
  });
}

async function sendToProvider({
  event,
  promptElement,
  sendButton,
  setResult,
  messageType,
  providerName,
  providerId
}) {
  event.preventDefault();

  const prompt = promptElement.value.trim();

  if (!prompt) {
    setResult("请输入要发送的内容", "failure");
    return;
  }

  sendButton.disabled = true;
  const runId = createRunId(providerId);
  activeProviderRuns.set(providerId, runId);
  ensureActiveLiveSync();
  setResult(`正在发送到 ${providerName}，等待页面回复...`, "");

  let response;

  try {
    response = await chrome.runtime.sendMessage({
      type: messageType,
      prompt,
      runId
    });
  } catch (error) {
    sendButton.disabled = false;
    activeProviderRuns.delete(providerId);
    setResult(
      `发送失败：插件后台通信异常\n${error instanceof Error ? error.message : String(error)}`,
      "failure"
    );
    return;
  }

  sendButton.disabled = false;

  if (!response?.ok) {
    activeProviderRuns.delete(providerId);
    const errorText = response?.error || "发送失败：插件后台没有返回具体原因";
    const stageText = response?.stage ? `\n阶段：${response.stage}` : "";
    const detailText = response?.detail ? `\n细节：${JSON.stringify(response.detail)}` : "";
    setResult(`${errorText}${stageText}${detailText}`, "failure");
    await refreshStatus();
    return;
  }

  await refreshStatus();
}

async function sendToChatGPT(event) {
  return sendToProvider({
    event,
    promptElement: chatgptPrompt,
    sendButton: sendChatGPTButton,
    setResult: setChatGPTResult,
    messageType: "HAI_MEETING_SEND_CHATGPT_PROMPT",
    providerName: "ChatGPT",
    providerId: "chatgpt"
  });
}

async function sendToGemini(event) {
  return sendToProvider({
    event,
    promptElement: geminiPrompt,
    sendButton: sendGeminiButton,
    setResult: setGeminiResult,
    messageType: "HAI_MEETING_SEND_GEMINI_PROMPT",
    providerName: "Gemini",
    providerId: "gemini"
  });
}

async function sendToDeepSeek(event) {
  return sendToProvider({
    event,
    promptElement: deepseekPrompt,
    sendButton: sendDeepSeekButton,
    setResult: setDeepSeekResult,
    messageType: "HAI_MEETING_SEND_DEEPSEEK_PROMPT",
    providerName: "DeepSeek",
    providerId: "deepseek"
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
  activeAllPrompt = prompt;
  activeAllRunIds = {
    chatgpt: createRunId("chatgpt"),
    gemini: createRunId("gemini"),
    deepseek: createRunId("deepseek")
  };
  ensureActiveLiveSync();
  const results = {
    chatgpt: { pending: true, runId: activeAllRunIds.chatgpt, message: "正在发送到 ChatGPT，等待页面回复..." },
    gemini: { pending: true, runId: activeAllRunIds.gemini, message: "正在发送到 Gemini，等待页面回复..." },
    deepseek: { pending: true, runId: activeAllRunIds.deepseek, message: "正在发送到 DeepSeek，等待页面回复..." }
  };
  const targets = [
    {
      id: "chatgpt",
      messageType: "HAI_MEETING_SEND_CHATGPT_PROMPT",
      element: allChatGPTResult,
      runId: activeAllRunIds.chatgpt
    },
    {
      id: "gemini",
      messageType: "HAI_MEETING_SEND_GEMINI_PROMPT",
      element: allGeminiResult,
      runId: activeAllRunIds.gemini
    },
    {
      id: "deepseek",
      messageType: "HAI_MEETING_SEND_DEEPSEEK_PROMPT",
      element: allDeepSeekResult,
      runId: activeAllRunIds.deepseek
    }
  ];

  renderAllModelResults(results);
  await saveAllModelsResult(prompt, results);

  const tasks = targets.map(async (target) => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: target.messageType,
        prompt,
        runId: target.runId
      });

      if (response?.ok) {
        const liveStored = await chrome.storage.local.get(liveResponseKeys[target.id]);
        const liveSnapshot = liveStored[liveResponseKeys[target.id]];

        if (liveSnapshot?.runId === target.runId && liveSnapshot.status === "success") {
          results[target.id] = liveSnapshotToResult(liveSnapshot);
        }
      } else {
        results[target.id] = {
          ok: false,
          error: response?.error || "发送失败：插件后台没有返回具体原因",
          stage: response?.stage,
          detail: response?.detail
        };
      }
    } catch (error) {
      results[target.id] = {
        ok: false,
        error: `发送失败：插件后台通信异常\n${error instanceof Error ? error.message : String(error)}`
      };
    }

    const mergedResults = await mergeStoredAllModelResults(results);
    Object.assign(results, mergedResults);

    const formatted = formatProviderResult(results[target.id]);
    setAllProviderResult(target.element, formatted.message, formatted.type, formatted.html);
    await saveAllModelsResult(prompt, results);
  });

  await Promise.allSettled(tasks);
  sendAllModelsButton.disabled = false;
  const mergedResults = await mergeStoredAllModelResults(results);
  Object.assign(results, mergedResults);
  renderAllModelResults(results);
  await saveAllModelsResult(prompt, results, "running");
  await refreshStatus();
}

async function summarizeDiscussion() {
  const stored = await chrome.storage.local.get("lastAllModelsResult");
  const discussion = stored.lastAllModelsResult?.result;
  const prompt = activeAllPrompt || stored.lastAllModelsResult?.prompt || discussion?.prompt || "";
  const results = discussion?.results || {};

  if (!prompt || Object.keys(results).length === 0) {
    setDiscussionSummaryResult("请先发起一轮讨论，再生成总结。", "failure");
    return;
  }

  if (!Object.values(results).some((result) => result?.ok)) {
    setDiscussionSummaryResult("当前还没有任何模型的有效回复，暂时无法总结。", "failure");
    return;
  }

  summarizeDiscussionButton.disabled = true;
  activeSummaryRunId = createRunId("chatgpt-summary");
  activeSummaryPrompt = buildDiscussionSummaryPrompt(prompt, results);
  latestSummaryText = "";
  activeProviderRuns.set("chatgpt", activeSummaryRunId);
  ensureActiveLiveSync();
  setDiscussionSummaryResult("正在请 ChatGPT 生成本轮主持总结...", "");

  await saveDiscussionSummary({
    status: "running",
    runId: activeSummaryRunId,
    prompt: activeSummaryPrompt,
    text: "",
    message: "正在请 ChatGPT 生成本轮主持总结..."
  });

  let response;

  try {
    response = await chrome.runtime.sendMessage({
      type: "HAI_MEETING_SEND_CHATGPT_PROMPT",
      prompt: activeSummaryPrompt,
      runId: activeSummaryRunId
    });
  } catch (error) {
    activeProviderRuns.delete("chatgpt");
    const message = `总结失败：插件后台通信异常\n${error instanceof Error ? error.message : String(error)}`;
    setDiscussionSummaryResult(message, "failure");
    await saveDiscussionSummary({
      status: "failure",
      runId: activeSummaryRunId,
      prompt: activeSummaryPrompt,
      text: "",
      message
    });
    activeSummaryRunId = "";
    summarizeDiscussionButton.disabled = false;
    return;
  }

  summarizeDiscussionButton.disabled = false;

  if (!response?.ok) {
    activeProviderRuns.delete("chatgpt");
    const message = response?.error || "总结失败：ChatGPT 页面没有返回具体原因";
    setDiscussionSummaryResult(message, "failure");
    await saveDiscussionSummary({
      status: "failure",
      runId: activeSummaryRunId,
      prompt: activeSummaryPrompt,
      text: "",
      message
    });
    activeSummaryRunId = "";
  }
}

async function copyDiscussionSummary() {
  const stored = await chrome.storage.local.get("lastDiscussionSummary");
  const text = latestSummaryText || stored.lastDiscussionSummary?.text || "";

  if (!text) {
    setDiscussionSummaryResult("当前没有可复制的总结。", "failure");
    return;
  }

  await navigator.clipboard.writeText(text);
  const previousText = copySummaryButton.textContent;
  copySummaryButton.textContent = "已复制";
  window.setTimeout(() => {
    copySummaryButton.textContent = previousText;
  }, 1200);
}

refreshButton.addEventListener("click", refreshStatus);
allModelsForm.addEventListener("submit", sendToAllModels);
summarizeDiscussionButton.addEventListener("click", summarizeDiscussion);
copySummaryButton.addEventListener("click", copyDiscussionSummary);
chatgptForm.addEventListener("submit", sendToChatGPT);
geminiForm.addEventListener("submit", sendToGemini);
deepseekForm.addEventListener("submit", sendToDeepSeek);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  for (const [providerId, storageKey] of Object.entries(liveResponseKeys)) {
    if (changes[storageKey]?.newValue) {
      handleLiveResponse(providerId, changes[storageKey].newValue);
    }
  }
});

refreshStatus();
restoreLastAllModelsResult();
restoreLastDiscussionSummary();
restoreLastChatGPTResult();
restoreLastGeminiResult();
restoreLastDeepSeekResult();
restoreLiveResponses();
