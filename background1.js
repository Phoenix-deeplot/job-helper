chrome.action.onClicked.addListener((tab) => {
  // 获取插件自带的 data_hub.html 在 Chrome 内部的绝对路径
  const url = chrome.runtime.getURL("popup.html");
  
  // 在新标签页中打开它
  chrome.tabs.create({ url: url });
});
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "FETCH_JD_DETAIL") {
    
    let targetUrl = request.url.replace(/^http:\/\//i, 'https://');

    fetch(targetUrl, {
      method: 'GET',
      mode: 'cors',
      // 💡 必须加上 credentials: 'include'，让 background 发请求时自动携带当前域名下的合法 Cookie/Token
      credentials: 'include', 
      redirect: 'follow',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Upgrade-Insecure-Requests': '1'
      }
    })
    .then(response => response.text())
    .then(html => {
      // 💡 增加一层防校验检查：如果发现返回的内容包含 CF_APP_WAF，说明依然被风控了
      if (html.includes("CF_APP_WAF") || html.includes("sceneId")) {
        console.warn("⚠️ 触发了前程无忧 WAF 人机验证，无法直接提取");
        sendResponse({ 
          success: false, 
          error: "WAF_BLOCKED",
          data: {
            responsibilities: "触发了目标网站安全验证，请点击卡片直接打开原网页完成一次验证。",
            requirements: "触发了目标网站安全验证，请点击卡片直接打开原网页完成一次验证。"
          }
        });
        return;
      }

      const parsedData = parseJobDetailText(html);
      sendResponse({ success: true, data: parsedData });
    })
    .catch(error => {
      sendResponse({ success: false, error: error.message });
    });

    return true;
  }
});

// ============================================================
// 加到 background1.js 里的 chrome.runtime.onMessage 监听器中。
//
// 只做一件事：接收 content script 发来的 URL，在 background（不受
// content script 那套 CORS 限制）发起 fetch，把原始 HTML 文本传
// 回去——不在这里做任何解析，DOM 解析交给 content_backend.js 自己
// 用 domToStructuredText + window.JdParsed 去做，background 这边
// 没有 DOMParser（service worker 环境没有 DOM），也不需要有。
//
// 如果 background1.js 里已经有 FETCH_JD_DETAIL 的处理逻辑，对照着
// 看它现在是不是"fetch + 自己解析一遍"——如果是，把解析那部分删掉，
// 只留 fetch + 返回 html 就行，解析逻辑现在统一由 content_backend.js
// 里新加的那条链路负责，两边不用再各写一份、容易长期不一致。
// ============================================================


// 监听来自列表页/PopUp 的抓取请求
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'FETCH_JOB_DETAIL') {
    fetchJobDetailInSilentTab(message.url)
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // 保持异步通信通道
  }
});

function fetchJobDetailInSilentTab(url) {
  return new Promise((resolve, reject) => {
    // 1. 后台静默打开标签页（不争抢用户焦点）
    chrome.tabs.create({ url, active: false }, (tab) => {
      const tabId = tab.id;
      
      // 超时保护（10秒无响应强制关闭）
      const timeout = setTimeout(() => {
        chrome.runtime.onMessage.removeListener(messageListener);
        chrome.tabs.remove(tabId);
        reject(new Error('请求超时或触发风控验证码'));
      }, 10000);

      // 2. 监听 content.js 回传的数据
      const messageListener = (msg, sender) => {
        if (sender.tab && sender.tab.id === tabId && msg.action === 'JOB_DETAIL_RESULT') {
          clearTimeout(timeout);
          chrome.runtime.onMessage.removeListener(messageListener);
          
          // 3. 提取完成后立刻销毁标签页
          chrome.tabs.remove(tabId);
          resolve(msg.data);
        }
      };

      chrome.runtime.onMessage.addListener(messageListener);
    });
  });
}
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "FETCH_RAW_HTML") {
    fetch(msg.url, { credentials: "include" })
      .then((res) => {
        if (!res.ok) {
          sendResponse({ success: false, error: `HTTP ${res.status}` });
          return;
        }
        return res.text().then((html) => {
          sendResponse({ success: true, html });
        });
      })
      .catch((err) => {
        sendResponse({ success: false, error: String(err) });
      });
    return true; // 保持消息通道开放，等待上面的异步 fetch 完成
  }
});

async function fetchDetailData(url) {
  if (!url || url.includes('javascript:')) {
    throw new Error("无效的链接 URL");
  }

  // 1. 发起网络请求，配置 Headers 避免被当作 Bot 拦截
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Cache-Control': 'no-cache'
    },
    credentials: 'include' // 捎带当前域名的 Cookie（防止未登录拦截）
  });

  if (!response.ok) {
    throw new Error(`HTTP 状态错误: ${response.status}`);
  }

  // 💡 关键一步：将 ReadableStream 流读取并解析为纯文本字符串！
  const htmlText = await response.text(); 

  console.log("📄 [Background] 成功获取 HTML 字符串，长度为:", htmlText.length);

  // 2. 解析文本提取职责和要求
  return parseJobDetailText(htmlText);
}



function parseJobDetailText(html) {
  if (!html || html.length < 200) {
    return {
      responsibilities: "获取页面内容过短，可能触发了反爬或验证码，请点击查看原页面。",
      requirements: "获取页面内容过短，可能触发了反爬或验证码，请点击查看原页面。"
    };
  }

  // 清理 <script>、<style> 及所有 HTML 标签，留存干净的换行文本
  const cleanText = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);

  let responsibilities = [];
  let requirements = [];
  let isReqMode = false;

  const respKeywords = ["职责", "工作内容", "描述", "负责", "推进", "建设","Responsibilities","Duties","What you will do","What you'll do","Role Overview","What you'll be doing"];
  const reqKeywords = ["要求", "任职", "资格", "优先", "掌握", "熟悉", "本科", "必要条件","经验","加分项","Requirements","Qualifications","What we're looking for","What you need","Who you are","Skills","Experience|Prerequisites"];
    // 1. 中英文“岗位职责”关键词正则
//   const respKeywords = /(?:岗位职责|工作职责|职位描述|工作内容|职责描述|Responsibilities|Duties|What you will do|What you'll do|Role Overview|What you'll be doing)/i;

//   // 2. 中英文“任职要求”关键词正则
//   const reqKeywords = /(?:任职要求|任职资格|岗位要求|职位要求|任职条件|Requirements|Qualifications|What we're looking for|What you need|Who you are|Skills & Experience|Prerequisites)/i;

//   const respMatch = text.match(respHeaderRegex);
//   const reqMatch = text.match(reqHeaderRegex);

  cleanText.forEach(line => {
    // 忽略太短或极长的噪声文本
    if (line.length < 3 || line.length > 300) return;

    // 模式切换判断
    if (/(任职要求|任职资格|岗位要求|入职条件|要求：)/i.test(line)) {
      isReqMode = true;
      return;
    }
    if (/(岗位职责|工作内容|职责描述|职责：)/i.test(line)) {
      isReqMode = false;
      return;
    }

    if (isReqMode) {
      if (reqKeywords.some(kw => line.includes(kw)) || line.length > 8) {
        requirements.push(line);
      }
    } else {
      if (respKeywords.some(kw => line.includes(kw)) || line.length > 8) {
        responsibilities.push(line);
      }
    }
  });

  return {
    responsibilities: responsibilities.slice(0, 8).join('\n') || "未能解析到明确的岗位职责，请点击直接查看原文。",
    requirements: requirements.slice(0, 8).join('\n') || "未能解析到明确的任职要求，请点击直接查看原文。"
  };
}

chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'DEV_LOG') {
    const { type, message, detail, time } = request.payload;
    console.log(`%c[${time}] [${type}] ${message}`, 'color: #00bebd; font-weight: bold;', detail || '');
  }
});