/* Video Spoiler Hider
 *
 * Adds the `tvsh-active` class to <html> so the CSS in content.css can hide
 * duration, seek bar progress, tooltip time, etc. on supported video pages.
 *
 * Also hides timestamp text inside hover preview tooltips as a fallback for
 * Twitch markup changes.
 */

(() => {
  const STORAGE_KEY = "tvsh_enabled";
  const ROOT_CLASS = "tvsh-active";
  const TWITCH_CLASS = "tvsh-platform-twitch";
  const YOUTUBE_CLASS = "tvsh-platform-youtube";
  const HIDDEN_ATTR = "data-tvsh-hidden";
  const HOVER_TIME_ATTR_VALUE = "hover-time";
  const TIMESTAMP_RE = /^-?(?:(?:\d{1,2}:)?\d{1,2}:\d{2})$/;
  const HOVER_CONTEXT_RE = /(tooltip|preview|hover)/i;

  let enabled = true;
  let scrubPending = false;

  const isTwitchHost = () =>
    location.hostname === "twitch.tv" || location.hostname.endsWith(".twitch.tv");

  const isYouTubeHost = () =>
    location.hostname === "youtube.com" ||
    location.hostname.endsWith(".youtube.com");

  const getTargetPlatform = () => {
    const { pathname, search } = location;

    // Twitch VODs: /videos/12345.
    if (isTwitchHost() && /^\/videos\/\d+/.test(pathname)) {
      return "twitch";
    }

    // YouTube regular watch pages. Shorts are intentionally left alone.
    if (isYouTubeHost() && pathname === "/watch") {
      const params = new URLSearchParams(search);
      if (params.has("v")) return "youtube";
    }

    return null;
  };

  const applyState = () => {
    const platform = getTargetPlatform();
    const shouldHide = enabled && platform !== null;

    document.documentElement.classList.toggle(ROOT_CLASS, shouldHide);
    document.documentElement.classList.toggle(
      TWITCH_CLASS,
      shouldHide && platform === "twitch"
    );
    document.documentElement.classList.toggle(
      YOUTUBE_CLASS,
      shouldHide && platform === "youtube"
    );

    if (shouldHide) scheduleHoverTimeScrub();
  };

  const isActive = () => document.documentElement.classList.contains(ROOT_CLASS);

  const hasHoverContext = (element) => {
    let node = element;

    while (node && node !== document.body) {
      const className =
        typeof node.className === "string" ? node.className : "";
      const target = node.getAttribute?.("data-a-target") || "";
      const role = node.getAttribute?.("role") || "";

      if (role === "tooltip" || HOVER_CONTEXT_RE.test(`${className} ${target}`)) {
        return true;
      }

      node = node.parentElement;
    }

    return false;
  };

  const looksLikeStandaloneTimestamp = (element) => {
    if (element.childElementCount > 0) return false;

    const text = element.textContent.trim();
    return TIMESTAMP_RE.test(text);
  };

  const shouldHideHoverTimestamp = (element) =>
    looksLikeStandaloneTimestamp(element) && hasHoverContext(element);

  const scrubHoverTimes = () => {
    if (!isActive() || !document.body) return;

    document
      .querySelectorAll(`[${HIDDEN_ATTR}="${HOVER_TIME_ATTR_VALUE}"]`)
      .forEach((element) => {
        if (!shouldHideHoverTimestamp(element)) {
          element.removeAttribute(HIDDEN_ATTR);
        }
      });

    document.querySelectorAll("div, span, p").forEach((element) => {
      if (shouldHideHoverTimestamp(element)) {
        element.setAttribute(HIDDEN_ATTR, HOVER_TIME_ATTR_VALUE);
      }
    });
  };

  const scheduleHoverTimeScrub = () => {
    if (scrubPending) return;

    scrubPending = true;
    requestAnimationFrame(() => {
      scrubPending = false;
      scrubHoverTimes();
    });
  };

  const startHoverTimeObserver = () => {
    const observer = new MutationObserver(scheduleHoverTimeScrub);

    const observeBody = () => {
      if (!document.body) {
        requestAnimationFrame(observeBody);
        return;
      }

      observer.observe(document.body, {
        childList: true,
        characterData: true,
        subtree: true
      });

      scheduleHoverTimeScrub();
    };

    observeBody();
  };

  // Listen for SPA navigation (Twitch is a SPA, pushState/replaceState).
  const hookHistory = () => {
    const fire = () => window.dispatchEvent(new Event("tvsh:locationchange"));
    const wrap = (name) => {
      const orig = history[name];
      history[name] = function (...args) {
        const ret = orig.apply(this, args);
        fire();
        return ret;
      };
    };
    wrap("pushState");
    wrap("replaceState");
    window.addEventListener("popstate", fire);
  };

  window.addEventListener("tvsh:locationchange", applyState);

  // Load persisted toggle.
  const loadState = () =>
    new Promise((resolve) => {
      try {
        chrome.storage?.sync.get({ [STORAGE_KEY]: true }, (res) => {
          enabled = !!res[STORAGE_KEY];
          resolve();
        });
      } catch {
        resolve();
      }
    });

  // React to popup toggle changes.
  try {
    chrome.storage?.onChanged.addListener((changes, area) => {
      if (area === "sync" && changes[STORAGE_KEY]) {
        enabled = !!changes[STORAGE_KEY].newValue;
        applyState();
      }
    });
  } catch {
    /* not in extension context */
  }

  hookHistory();
  startHoverTimeObserver();
  loadState().then(applyState);

  // Run once DOM is ready as well (CSS handles the rest reactively).
  document.addEventListener("DOMContentLoaded", applyState);
})();
