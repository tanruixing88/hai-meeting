(() => {
  const provider = {
    id: "gemini",
    name: "Gemini",
    inputSelectors: [
      "rich-textarea div[contenteditable='true']",
      "div.ql-editor[contenteditable='true']",
      "div[contenteditable='true'][aria-label]",
      "textarea"
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
