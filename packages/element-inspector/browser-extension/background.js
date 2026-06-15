chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "send-to-pi",
    title: "Send to Pi",
    contexts: ["all"],
  });
});

chrome.action.onClicked.addListener(async (tab) => {
  await ensureContentScript(tab.id);
  chrome.tabs.sendMessage(tab.id, { action: "toggle-inspect" });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "send-to-pi" && tab?.id) {
    await ensureContentScript(tab.id);
    chrome.tabs.sendMessage(tab.id, { action: "inspect-clicked" });
  }
});

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: "ping" });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  }
}
