const STORAGE_KEY = "tvsh_enabled";
const toggle = document.getElementById("toggle");

chrome.storage.sync.get({ [STORAGE_KEY]: true }, (res) => {
  toggle.checked = !!res[STORAGE_KEY];
});

toggle.addEventListener("change", () => {
  chrome.storage.sync.set({ [STORAGE_KEY]: toggle.checked });
});
