(() => {
  const provider = {
    id: "chatgpt",
    name: "ChatGPT",
    inputSelectors: [
      "#prompt-textarea",
      "[data-testid='prompt-textarea']",
      "div[role='textbox'][contenteditable='true']",
      "div.ProseMirror[contenteditable='true']",
      "textarea[data-id='root']",
      "div[contenteditable='true']",
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
