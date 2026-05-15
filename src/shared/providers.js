export const PROVIDERS = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    origin: "https://chatgpt.com",
    matchPrefixes: ["https://chatgpt.com/", "https://chat.openai.com/"]
  },
  {
    id: "gemini",
    name: "Gemini",
    origin: "https://gemini.google.com",
    matchPrefixes: ["https://gemini.google.com/"]
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    origin: "https://chat.deepseek.com",
    matchPrefixes: ["https://chat.deepseek.com/"]
  }
];

export function getProviderByUrl(url = "") {
  return PROVIDERS.find((provider) =>
    provider.matchPrefixes.some((matchPrefix) => url.startsWith(matchPrefix))
  ) ?? null;
}
