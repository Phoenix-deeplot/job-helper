
  (function () {
    const CONSENT_KEY = 'privacy_consent_v1';
    const checkbox = document.getElementById('privacyConsent');
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');

    // 更新 UI 禁用状态
    function updateState(isConsent) {
      checkbox.checked = isConsent;
      if (fileInput) fileInput.disabled = !isConsent;

      if (isConsent) {
        uploadArea.classList.remove('disabled');
      } else {
        uploadArea.classList.add('disabled');
      }
    }

    // 1. 初始化读取本地存储状态
    if (window.chrome && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([CONSENT_KEY], (res) => {
        updateState(Boolean(res?.[CONSENT_KEY]));
      });
    } else {
      updateState(false);
    }

    // 2. 监听勾选框状态变化
    checkbox.addEventListener('change', (e) => {
      const isChecked = e.target.checked;
      updateState(isChecked);
      if (window.chrome && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [CONSENT_KEY]: isChecked });
      }
    });

    // 3. 核心修复：捕获阶段直接拦截并杀死所有点击与拖拽事件，彻底切断 popup.js 的响应
    const eventsToBlock = ['click', 'mousedown', 'mouseup', 'dragenter', 'dragover', 'dragleave', 'drop'];
    eventsToBlock.forEach((eventName) => {
      uploadArea.addEventListener(
        eventName,
        (e) => {
          if (!checkbox.checked) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation(); // 核心：直接终止 popup.js 中的任何事件回调执行
          }
        },
        true // true 代表捕获阶段（先于 popup.js 的冒泡/普通事件触发）
      );
    });
  })();