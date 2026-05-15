(() => {
  const provider = {
    id: "deepseek",
    name: "DeepSeek",
    inputSelectors: [
      "textarea[placeholder]",
      "textarea:not([readonly])",
      "[role='textbox'][contenteditable='true']",
      "div[contenteditable='true']",
      "textarea",
      "[role='textbox']"
    ]
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "HAI_MEETING_DETECT_PAGE" || message.providerId !== provider.id) {
      return false;
    }

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
  });
})();
