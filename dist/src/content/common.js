(() => {
  const api = {
    findFirst(selectors) {
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
          return element;
        }
      }

      return null;
    },

    findAll(selectors) {
      return selectors.flatMap((selector) =>
        Array.from(document.querySelectorAll(selector)).map((element) => ({
          element,
          selector
        }))
      );
    },

    isVisible(element) {
      if (!element) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none"
      );
    },

    detectInput(selectors) {
      const candidates = api.findAll(selectors);
      const visibleCandidate = candidates.find(({ element }) => api.isVisible(element));
      const fallbackCandidate = candidates[0];
      const input = visibleCandidate?.element ?? fallbackCandidate?.element;
      const selector = visibleCandidate?.selector ?? fallbackCandidate?.selector;

      if (!input) {
        return {
          inputReady: false,
          reason: "未找到输入框"
        };
      }

      if (!api.isVisible(input)) {
        return {
          inputReady: false,
          reason: "输入框存在但当前不可见"
        };
      }

      return {
        inputReady: true,
        reason: "可用",
        inputTag: input.tagName.toLowerCase(),
        inputSelectorHint: selector,
        matchedInputCount: candidates.length
      };
    }
  };

  window.haiMeetingContentApi = api;
})();
