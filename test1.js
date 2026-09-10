


// (function () {
//   'use strict';


//   if (window.__jdpIntegratedInjected) return;
//   window.__jdpIntegratedInjected = true;

//   const API_BASE_URL = "http://127.0.0.1:8000";
//   const REPORT_CACHE_TTL = 5 * 60 * 1000;

//   // =====================================================================
//   // "点击风险卡片"崩溃检测：某些卡片点击后站点自己的 JS 会主动整页刷新
//   // （不是浏览器原生跳转，e.preventDefault() 拦不住这种命令式跳转/reload），
//   // 一旦发生，我们的脚本实例跟页面一起被销毁，代码根本执行不到"记录一下"
//   // 这一步。这里用 sessionStorage（能扛过页面刷新）做一次简单的崩溃检测：
//   // 点击前先写"即将点击这张卡"的标记，点击流程正常结束（不管成功还是超时）
//   // 就清掉标记；脚本重新注入时如果发现标记还在，说明上次点了之后就没有
//   // 下文了，基本可以断定是那次点击导致了整页刷新——记下这张卡"点击有风险"，
//   // 以后遇到直接跳过点击、只走 fetch。
//   // =====================================================================
//   const CLICK_RISK_STORAGE_KEY = 'jdp_click_risk_cardids';
//   const PENDING_CLICK_STORAGE_KEY = 'jdp_pending_click';

//   function loadClickRiskyCardIds() {
//     try {
//       const raw = sessionStorage.getItem(CLICK_RISK_STORAGE_KEY);
//       return raw ? new Set(JSON.parse(raw)) : new Set();
//     } catch (e) { return new Set(); }
//   }
//   function saveClickRiskyCardIds(set) {
//     try { sessionStorage.setItem(CLICK_RISK_STORAGE_KEY, JSON.stringify(Array.from(set))); } catch (e) { /* ignore */ }
//   }
//   function markPendingClick(cardId) {
//     try { sessionStorage.setItem(PENDING_CLICK_STORAGE_KEY, JSON.stringify({ cardId: String(cardId), ts: Date.now() })); } catch (e) { /* ignore */ }
//   }
//   function clearPendingClick() {
//     try { sessionStorage.removeItem(PENDING_CLICK_STORAGE_KEY); } catch (e) { /* ignore */ }
//   }

//   const clickRiskyCardIds = loadClickRiskyCardIds();
//   (function detectCrashFromLastClick() {
//     try {
//       const raw = sessionStorage.getItem(PENDING_CLICK_STORAGE_KEY);
//       if (raw) {
//         const { cardId, ts } = JSON.parse(raw);
//         // 只采信比较新鲜的残留标记（15秒内）——太久之前的更可能是用户自己手动
//         // 刷新/关闭标签页等无关原因留下的，不该被误判成"点击导致的"
//         if (cardId && Date.now() - ts < 15000) {
//           clickRiskyCardIds.add(cardId);
//           saveClickRiskyCardIds(clickRiskyCardIds);
//           console.warn(`⚠️ [content.js] 检测到上次点击卡片(${cardId})后页面被整体刷新，已标记为"点击风险"，以后跳过点击改走 fetch 兜底`);
//         }
//       }
//     } catch (e) { /* ignore */ }
//     clearPendingClick();
//   })();

//   // =====================================================================
//   // 0. 站点识别 & Hint 配置（未知站点会落到 'generic'，用纯通用兜底跑）
//   // =====================================================================
//   const SITE = location.host.includes('zhipin.com')
//     ? 'boss'
//     : location.host.includes('linkedin.com')
//       ? 'linkedin'
//       : (location.host.includes('zhaopin.com') || location.host.includes('zhilian.com'))
//         ? 'zhaopin'
//         : 'generic';

//   // ⚡ 预取窗口大小：默认只看当前卡片后面 2 张(next1/next2)，BOSS 允许拉大到 15。
//   // BOSS 是"一批 15 条一次性加载完"的滚动列表，且现在点击优先(免费流量)，
//   // 只有点击不安全时才会用到限频的 fetch——把整批提前排进预取队列的代价
//   // 没有想象中大，真正消耗限频名额的只是"点击不安全的那几张"。
//   // 注意这不是"一次性瞬间拉完 15 条"：受限频约束，真正跑完一批仍然需要时间
//   // （每次 fetch 间隔 ~8~11 秒），只是提前把它们排进队列，让后台在你阅读
//   // 当前卡片的这段时间里有机会提前处理掉，而不是等你翻到了才现排队。
//   // ⚡ BOSS 预取彻底关掉网络请求：BOSS 上唯一安全的取数手段是"点击当前卡片"
//   // （点击触发的是站点自己的流量），而预取按设计又绝不允许点击——这意味着
//   // BOSS 的预取只剩"主动 fetch"一条路，而那恰恰是触发风控的路径，也是你测到
//   // 的"5 秒才发出 detail"的真正来源（预取流水线被 8 秒限频器卡着，它的响应
//   // 又被我们自己的 hook 拦一遍再发出来，跟点击毫无关系）。
//   // 结论：BOSS 上预取没有安全的实现方式，直接关掉，只保留"当前卡片点击"。
//   const PREFETCH_LOOKAHEAD = SITE === 'boss' ? 0 : 2;
//   const PREFETCH_ALLOW_NETWORK = SITE !== 'boss';
//   // 只有这两个站点在 injected.js 里实现了真正的 JSON 详情接口；
//   // 其它站点走 'fetch' 策略必然拿到 null，不该为它付限频等待的代价。
//   const SITE_HAS_JSON_API = SITE === 'boss' || SITE === 'linkedin' || SITE === 'zhaopin';

//   // 已知站点的"加速配置"：每个字段都可选。没写的字段自动落到下面的通用兜底实现。
//   const SITE_HINTS = {
//     boss: {
//       listSelectors: '.rec-job-list .card-area, .job-list-container .card-area, .job-card-wrapper, .job-card-box, .job-card-wrap',
//       linkPattern: /\/job_detail\/([^\/\?]+)\.html/,
//       extractCardId(cardNode) {
//         const link = cardNode.tagName === 'A' ? cardNode : cardNode.querySelector('a[href*="/job_detail/"]');
//         if (!link) return null;
//         const href = link.getAttribute('href') || link.href || '';
//         const m = href.match(this.linkPattern);
//         return m ? m[1] : null; // encryptJobId，BOSS 详情接口强依赖这个，通用兜底拿不到
//       },
//       rightPaneSelectors: '.job-sider-detail, .jobs-search__job-details--container, .job-detail-outer, [class*="sider-detail"], [class*="job-detail"]',
//       descSelectors: '.job-sec-text, .show-more-less-html__markup, .job-detail-section, [class*="sec-text"], [class*="description"]',
//       titleSelectors: '.job-name, .job-title, [class*="job-name"], [class*="title"]',
//       panelScopeGuard: () => window.location.href.includes('/web/geek/jobs'),
//       clickTargetSelector: '.job-card-left, .card-area, .job-info, .job-card-body'
//     },
//     linkedin: {
//       listSelectors: '.job-card-container, .jobs-search-results__list-item, div[data-job-id], .scaffold-layout__list-item, .job-card-list',
//       rightPaneSelectors: '.jobs-search__job-details--container, .jobs-search__right-rail, .scaffold-layout__detail, .job-view-layout, main [class*="detail"]',
//       descSelectors: '.show-more-less-html__markup, .jobs-description__content, .jobs-description, [class*="description"]',
//       titleSelectors: 'h1, h2, .job-details-jobs-unified-top-card__job-title, [class*="title"]',
//       panelScopeGuard: () => window.location.href.includes('/jobs'),
//       clickTargetSelector: 'a, .job-card-list__title, .job-card-container__link'
//       // extractCardId 不配置：LinkedIn 的通用 extractJobIdUniversal 已经足够准，不用单独写
//     },
//     zhaopin: {
//       // 通过 window.__jdpDiag 诊断日志确认——通用兜底(locateJdContainer)
//       // 在智联的实际结构上找不到面板，state/dom 两路因此同时失效。
//       // 其余字段（title/desc/clickTarget）先不配置，落到通用兜底：
//       // getDescNode 在没有 descSelectors 时直接用整个 rightPaneNode 的
//       // innerText，getTitleFromPane 落到 locateTitleGeneric——先用最小
//       // 改动把 dom/state 两路的根因堵上，其余字段等这个先跑通了、
//       // 如果还有问题（比如标题提取不准）再针对性补。
//       rightPaneSelectors: '.job-detail-card__body, .job-detail-card, [class*="job-detail"], [class*="position-detail"], [class*="detail-card"]',
//       descSelectors: '.job-detail-card__body, [class*="description"], [class*="describe"], [class*="responsibility"], [class*="job-content"], [class*="detail-content"]',
//       titleSelectors: '.job-detail-card__title, .job-name, h1, h2, [class*="job-title"], [class*="position-title"]',
//       clickTargetSelector: '.joblist-box__item, .job-card, .job-item, [class*="joblist"], [class*="job-card"], [class*="position"], [class*="job-name"], [class*="job-title"]',
//       preferCardClick: true,
//       disablePageFetch: true,
//       extractCardId(cardNode) {
//         const attrNames = [
//           'data-job-number', 'data-number', 'data-job-id', 'data-jobid',
//           'data-position-id', 'data-position-number', 'data-zp-job-number',
//           'jobid', 'job-id', 'number', 'positionid', 'position-id'
//         ];
//         for (const attrName of attrNames) {
//           const el = cardNode.hasAttribute?.(attrName) ? cardNode : cardNode.querySelector(`[${attrName}]`);
//           const val = el?.getAttribute(attrName);
//           if (val && /^[A-Za-z0-9_-]{6,40}$/.test(val)) return val;
//         }
//         const html = cardNode.outerHTML || '';
//         const patterns = [
//           /(?:jobNumber|job_number|jobId|jobID|positionId|positionID|positionNumber|number)["']?\s*[:=]\s*["']?([A-Za-z0-9_-]{6,40})/i,
//           /(?:jobNumber|jobId|positionId|number)=([A-Za-z0-9_-]{6,40})/i,
//           /\/jobs?\/detail\/([A-Za-z0-9_-]{6,40})/i
//         ];
//         for (const pattern of patterns) {
//           const match = html.match(pattern);
//           if (match) return match[1];
//         }
//         return null;
//       }
//     }
//     // 'generic' 站点（Indeed / Glassdoor / 未来任何新站点）：完全不配置，
//     // 全部字段落到下面的通用兜底实现，开箱直接跑。
//   };
//   const adapter = SITE_HINTS[SITE] || {};


//   // =====================================================================
//   // 1. 数据池：被动监听得到的数据 + 主动兜底缓存
//   //    - listDataMap  : 网络监听到的"列表级"基础字段（BOSS 的 joblist.json 等）
//   //    - detailCache  : 已解析完成的"详情级"完整数据（三种策略中任一种成功后写入）
//   //    - detailWaiters: 正在等待网络监听回填详情的 Promise resolver
//   // =====================================================================
//   const listDataMap = new Map();     // matchKey -> { securityId, lid, salaryDesc, ... } (仅 BOSS 会填充)
//   const detailCache = new Map();     // cardId -> 完整详情对象
//   const detailWaiters = new Map();   // matchKey -> resolve 函数（等待 injected.js 的监听回传）
//   const processedJobIds = new Set();

//   window.addEventListener('message', (event) => {
//     const msg = event.data;
//     if (!msg || msg.site !== SITE) return;

//     if (msg.type === 'JOB_HOOK_LIST') {
//       let count = 0;
//       (msg.data || []).forEach((item) => {
//         const key = item.encryptJobId || item.jobId || item.jobID || item.number || item.jobNumber || item.positionId || item.positionNumber || item.id;
//         if (key) { listDataMap.set(String(key), item); count++; }
//       });
//       if (count > 0) console.log(`⚡ [content.js] 监听到列表数据 ${count} 条，Map 共 ${listDataMap.size} 条`);
//     }

//     if (msg.type === 'JOB_HOOK_DETAIL') {
//       const detail = msg.data;
//       if (!detail || !detail.matchKey) return;
//       detailCache.set(String(detail.matchKey), { ...detail, source: 'Network Intercept (triggered by click)' });
//       // 如果有人正在等待这条详情（模拟点击流程中），立刻唤醒
//       const waiter = detailWaiters.get(String(detail.matchKey));
//       if (waiter) { waiter(detail); detailWaiters.delete(String(detail.matchKey)); }
//     }
//     if (msg.type === 'ZHILIAN_INTERCEPTED_DATA') {
//       const detail = msg.data;
//       console.log("zhilian",detail)
//       if (!detail || !detail.matchKey) return;
//       detailCache.set(String(detail.matchKey), { ...detail, source: 'Network Intercept (triggered by click)' });
//       // 如果有人正在等待这条详情（模拟点击流程中），立刻唤醒
//       const waiter = detailWaiters.get(String(detail.matchKey));
//       if (waiter) { waiter(detail); detailWaiters.delete(String(detail.matchKey)); }
//     }
//   });

//   // =====================================================================
//   // 2. 通用聚类算法（主用于任意左右分栏列表定位）
//   //    —— 完全站点无关，不依赖 class 名，靠几何特征识别"重复卡片组"
//   // =====================================================================
//   function calculateStdDev(array) {
//     if (array.length <= 1) return 0;
//     const mean = array.reduce((a, b) => a + b, 0) / array.length;
//     const variance = array.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / array.length;
//     return Math.sqrt(variance);
//   }

//   const NOISE_KEYWORDS = [
//     '这些结果有帮助吗', '您的反馈可以帮助我们', '无障碍模式提示',
//     '改进搜索结果', 'Was this helpful', 'Help us improve', 'Accessibility feedback'
//   ];
//   function isNoiseElement(element) {
//     if (!element) return true;
//     const text = (element.innerText || element.textContent || '').trim();
//     return NOISE_KEYWORDS.some((k) => text.includes(k));
//   }

//   function isFooterOrSystemNoise(node) {
//     if (!node || !(node instanceof HTMLElement)) return true;
//     if (node.tagName === 'FOOTER' || node.closest('footer')) return true;
//     const text = (node.innerText || node.textContent || '').trim();
//     const footerKeywords = [
//       'LinkedIn Corporation', '©', '无障碍模式', '隐私政策', '帮助中心', '广告设置',
//       '商业服务', '获取领英 APP', 'Accessibility', 'Privacy Policy', 'User Agreement',"上一页","下一步","Previous","Next"
//     ];
//     if (footerKeywords.some((kw) => text.includes(kw))) return true;
//     const links = Array.from(node.querySelectorAll('a[href]'));
//     const systemUrlPrefixes = ['about.linkedin.com', '/accessibility/', '/help/linkedin', '/ad/start', '/mobile/'];
//     return links.some((a) => systemUrlPrefixes.some((u) => a.href.includes(u)));
//   }

//   function isValidContentCard(node) {
//     const dom = node.node || node;
//     if (!dom || !(dom instanceof HTMLElement)) return false;
//     const text = (dom.innerText || dom.textContent || '').trim();
//     if (text.length < 10) return false;
//     const html = dom.outerHTML.toLowerCase();
//     if (html.includes('aria-label="feedback"') || html.includes('feedback-container')) return false;
//     const hasLink = dom.querySelector('a[href]') !== null;
//     const childCount = dom.querySelectorAll('*').length;
//     if (!hasLink && childCount < 5) return false;
//     return true;
//   }

//   function findCandidateCards() {
//     const allNodes = document.querySelectorAll('div, li, article, section');
//     const candidates = [];
//     const maxLeftBoundary = window.innerWidth * 0.45; // 只在左侧列表区域找卡片

//     allNodes.forEach((node) => {
//       const rect = node.getBoundingClientRect();
//       if (rect.width === 0 || rect.height === 0) return;

//       const text = (node.innerText || '').trim();
//       const isPositionValid = rect.left >= 0 && rect.left + rect.width <= maxLeftBoundary;
//       const isSizeValid = rect.width >= 140 && rect.width <= 600 && rect.height >= 35 && rect.height <= 300;
//       const isTextValid = text.length >= 10 && text.length <= 400;

//       if (isPositionValid && isSizeValid && isTextValid) {
//         const hasPointer = window.getComputedStyle(node).cursor === 'pointer' || !!node.querySelector('*[style*="pointer"]');
//         candidates.push({ node, rect, textLength: text.length, hasPointer });
//       }
//     });
//     return candidates;
//   }

//   function normalizeToStructuralCard(candidate) {
//     let current = candidate.node;
//     while (current.parentElement && current.parentElement.childElementCount === 1 && current.parentElement !== document.body) {
//       current = current.parentElement;
//     }
//     return current;
//   }

//   function analyzeAndScoreGroups(candidates) {
//     const groupsMap = new Map();
//     candidates.forEach((item) => {
//       const structuralNode = normalizeToStructuralCard(item);
//       const parent = structuralNode.parentElement;
//       if (!parent) return;
//       if (!groupsMap.has(parent)) groupsMap.set(parent, []);
//       const group = groupsMap.get(parent);
//       if (!group.some((g) => g.node === structuralNode)) {
//         group.push({ node: structuralNode, rect: structuralNode.getBoundingClientRect(), textLength: item.textLength, hasPointer: item.hasPointer });
//       }
//     });

//     const scoredGroups = [];
//     groupsMap.forEach((items) => {
//       if (items.length < 3) return;
//       const lefts = items.map((i) => i.rect.left);
//       const widths = items.map((i) => i.rect.width);
//       const leftStdDev = calculateStdDev(lefts);
//       const widthStdDev = calculateStdDev(widths);
//       const avgLeft = lefts.reduce((a, b) => a + b, 0) / lefts.length;

//       items.sort((a, b) => a.rect.top - b.rect.top);
//       let isYMonotonic = true;
//       for (let i = 1; i < items.length; i++) {
//         if (items[i].rect.top <= items[i - 1].rect.top) { isYMonotonic = false; break; }
//       }

//       let score = 0;
//       score += items.length >= 5 ? 50 + items.length * 2 : items.length * 5;
//       if (leftStdDev < 15) score += 30;
//       if (widthStdDev < 20) score += 20;
//       if (isYMonotonic) score += 25;
//       if (avgLeft < window.innerWidth * 0.5) {
//         score += (1 - avgLeft / (window.innerWidth * 0.5)) * 40;
//       } else {
//         score -= 30;
//       }

//       scoredGroups.push({ items: items.map((i) => i.node), itemCount: items.length, score });
//     });

//     scoredGroups.sort((a, b) => b.score - a.score);
//     return scoredGroups;
//   }

//   const MIN_CLUSTER_SCORE = 60; // 低于这个分，认为聚类不可信，走 selector 兜底

//   function locateByClustering() {
//     const candidates = findCandidateCards()
//       .filter((c) => !isNoiseElement(c.node))
//       .filter((c) => isValidContentCard(c))
//       .filter((c) => !isFooterOrSystemNoise(c.node));

//     const scoredGroups = analyzeAndScoreGroups(candidates);
//     if (!scoredGroups.length || scoredGroups[0].score < MIN_CLUSTER_SCORE) return [];
//     return scoredGroups[0].items;
//   }

//   // ---- 次选兜底：站点已知 selector（聚类失败/得分过低时使用；generic 站点没配置，天然跳过） ----
//   function locateBySelector() {
//     if (!adapter.listSelectors) return [];
//     return Array.from(document.querySelectorAll(adapter.listSelectors));
//   }

//   function deduplicateJobCards(cardNodes) {
//     const uniqueCards = [];
//     const seenKeys = new Set();
//     cardNodes.forEach((card) => {
//       const id = resolveCardId(card);
//       if (id && !seenKeys.has(id)) { seenKeys.add(id); uniqueCards.push(card); }
//     });
//     return uniqueCards;
//   }

//   function getTargetJobCards() {
//     let cards = locateByClustering();
//     let usedMethod = 'clustering';
//     if (cards.length === 0) {
//       cards = locateBySelector();
//       usedMethod = 'selector-fallback';
//     }
//     if (cards.length > 0) console.log(`📋 [content.js] 列表定位方式: ${usedMethod}, 共 ${cards.length} 张卡片`);
//     return deduplicateJobCards(cards);
//   }

//   // =====================================================================
//   // 3. 通用 ID 提取 —— 三级兜底，任何站点都能拿到一个稳定 ID
//   //    a) 站点 hint 的 extractCardId（比如 BOSS 需要 encryptJobId，通用方法拿不到）
//   //    b) extractJobIdUniversal：常见 data-* 属性 / href 模式识别
//   //    c) hashString：都识别不到时，用卡片链接或文本内容算一个稳定哈希当 ID，
//   //       保证 generic 站点也能做去重/缓存，只是不会有 securityId 这类专属字段
//   // =====================================================================
//   function hashString(str) {
//     str = String(str || '');
//     let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
//     for (let i = 0, ch; i < str.length; i++) {
//       ch = str.charCodeAt(i);
//       h1 = Math.imul(h1 ^ ch, 2654435761);
//       h2 = Math.imul(h2 ^ ch, 1597334677);
//     }
//     h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
//     h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
//     h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
//     h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
//     return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
//   }

//   function extractJobIdUniversal(cardNode) {
//     if (!cardNode || !(cardNode instanceof HTMLElement)) return null;
//     const EXACT_ATTRS = ['data-job-id', 'data-occludable-job-id', 'data-entity-urn', 'componentkey', 'data-jobid', 'jobid', 'id'];
//     for (const attrName of EXACT_ATTRS) {
//       const el = cardNode.hasAttribute?.(attrName) ? cardNode : cardNode.querySelector(`[${attrName}]`);
//       if (el) {
//         const val = el.getAttribute(attrName);
//         const idMatch = val ? val.match(/(\d{6,12})/) : null;
//         if (idMatch) return idMatch[1];
//       }
//     }
//     const links = cardNode.querySelectorAll('a[href]');
//     for (const a of links) {
//       const match = a.href.match(/(?:currentJobId=|\/jobs\/view\/|\/job_detail\/|\/position\/|\/job\/|\/viewjob|jk=)([\w\-]+)/i);
//       if (match) {
//         const cleanId = match[1].match(/([\w\-]{6,20})/);
//         if (cleanId) return cleanId[1];
//       }
//     }
//     const html = cardNode.outerHTML;
//     const SEMANTIC_PATTERNS = [/urn:li:jobPosting:(\d+)/, /job-card-component-ref-(\d+)/, /job[_\-]?id["']?\s*[:=]\s*["']?(\d+)/i, /data-job-id=["'](\d+)["']/i];
//     for (const pattern of SEMANTIC_PATTERNS) {
//       const match = html.match(pattern);
//       if (match) return match[1];
//     }
//     return null;
//   }

//   // 终极兜底：任何站点都用得了，靠"链接地址"或"卡片文本"算一个稳定哈希当 ID。
//   // 换页/重渲染只要链接和文字不变，哈希就不变，可以正常去重和走缓存。
//   function stableHashId(cardNode) {
//     const firstLink = cardNode.querySelector?.('a[href]');
//     const seed = firstLink ? firstLink.href.split('?')[0] : (cardNode.innerText || '').slice(0, 80);
//     return 'h_' + hashString(seed);
//   }

//   function resolveCardId(cardNode) {
//     if (adapter.extractCardId) {
//       const hinted = adapter.extractCardId(cardNode);
//       if (hinted) return hinted;
//     }
//     return extractJobIdUniversal(cardNode) || stableHashId(cardNode);
//   }

//   // 重新扫描页面，找一个 cardId 匹配、且仍然挂在文档里的活节点——用于
//   // state.engineCards 里的快照引用已经脱离文档时的恢复兜底（见 ensureJobDetail）。
//   // 只在这种边缘情况下才会调用，不是热路径，重新跑一次聚类扫描可以接受。
//   function findLiveNodeByCardId(cardId) {
//     const cardNodes = getTargetJobCards();
//     for (const node of cardNodes) {
//       if (resolveCardId(node) === cardId) return node;
//     }
//     return null;
//   }

//   // =====================================================================
//   // 4. 卡片基础信息提取（DOM 兜底 + listDataMap 命中增强）
//   // =====================================================================
//   const UI_NOISE_PATTERNS = [
//     /无障碍(模式|浏览|操作|说明|声明|元素)/i, /accessibility\s*(mode|statement|menu|link|skip)/i,
//     /skip\s*to\s*(main\s*)?content/i, /screen\s*reader/i, /这些结果有帮助吗/i,
//     /did\s*you\s*find\s*this\s*helpful/i, /反馈/i, /feedback/i, /展开(全文)?/i, /收起/i,
//     /show\s*(more|less)/i, /see\s*(more|less)/i, /page\s*\d+\s*of\s*\d+/i, /第\s*\d+\s*页/i, /cookie/i
//   ];
//   function isNoiseLine(lineText) {
//     if (!lineText || lineText.trim().length === 0) return true;
//     const clean = lineText.trim();
//     if (clean.length < 2 && !/\d/.test(clean)) return true;
//     return UI_NOISE_PATTERNS.some((p) => p.test(clean));
//   }
//   const SALARY_PATTERN = /(?:(?:USD|EUR|GBP|RMB|HKD|SGD|CAD|AUD|\$|¥|€|£|￥)\s*)?\d+[\d,.]*\s*(?:[kKmMwW]|万|千)?.*?(?:[-~—–到至]\s*\d+[\d,.]*\s*(?:[kKmMwW]|万|千)?)?/;
//   const LOCATION_PATTERN = /(现场办公|远程|混合|湾区|市|省|国|Area|Remote|On-site|Hybrid|\(.+\))/i;

//   function extractBasicInfoFromDom(cardNode) {
//     const rawText = cardNode.innerText || '';
//     const lines = rawText.split('\n').map((l) => l.trim()).filter((l) => !isNoiseLine(l));
//     let salary = '';
//     let location = '';
//     const rest = [];
//     lines.forEach((line) => {
//       if (!salary && SALARY_PATTERN.test(line) && /\d/.test(line)) salary = line;
//       else if (!location && LOCATION_PATTERN.test(line)) location = line;
//       else rest.push(line);
//     });
//     return {
//       title: rest[0] || '',
//       company: rest[1] || '',
//       salary: salary || t('salary'),
//       location: location || '',
//     };
//   }

//   function extractBasicInfo(cardNode, cardId) {
//     // 优先命中网络监听到的列表数据（比如 BOSS 的 securityId/lid，DOM 里根本拿不到）
//     const hooked = cardId ? listDataMap.get(String(cardId)) : null;
//     const domInfo = extractBasicInfoFromDom(cardNode);
//     if (hooked) {
//       return {
//         cardId,
//         title: hooked.jobName || hooked.name || hooked.title || hooked.jobTitle || hooked.positionName || domInfo.title,
//         salary: hooked.salaryDesc || hooked.salary || hooked.salaryReal || hooked.salary60 || domInfo.salary,
//         company: hooked.brandName || hooked.companyName || hooked.company?.name || (typeof hooked.company === 'string' ? hooked.company : '') || domInfo.company,
//         location: hooked.cityName || hooked.workCity || hooked.city?.display || (typeof hooked.city === 'string' ? hooked.city : '') || hooked.areaDistrict || hooked.location || domInfo.location,
//         securityId: hooked.securityId || '',
//         lid: hooked.lid || '',
//         source: 'List Intercept + DOM'
//       };
//     }
//     return { cardId, ...domInfo, securityId: '', lid: '', source: 'DOM Parsing' };
//   }

//   // =====================================================================
//   // 4b. JD 文本清洗管线：cleanText → normalizeAndMergeLines → parseJdSmart
//   //     DOM 兜底路径拿到的 rawText 必须过一遍这个管线才能用；
//   //     网络监听路径（injected.js）已经在源头跑过 parseJdSmart，这里不用重复。
//   // =====================================================================
//   function cleanText(str) {
//     if (!str) return '';
//     const tailNoisePattern = /(?:去App|随时沟通|点击查看地图|查看更多信息|微信扫码|Easy Apply|Apply now).*$/i;
//     // BOSS/Indeed 等站点右侧面板里常见的"地点 上海市""完整的职位描述"这类
//     // UI 标签/小节引导语，混着 &nbsp; 这种没转义的 HTML 实体一起出现在
//     // innerText/textContent 里。
//     // ⚡ 修复：这些标签经常不是独占一行，而是跟正文其他内容挤在同一行里
//     // （比如 innerText 把相邻的行内元素拼在了一起，"地点 上海市完整的职位描述
//     // 岗位职责..."全连成一行）——之前用 ^...$ 锚定整行匹配，只要标签不是
//     // 独占一行就永远匹配不上，这就是清理不掉的原因。改成不锚定的替换：
//     // 不管这些词组出现在行首、行中还是整行，一律原地替换掉，再看剩下的
//     // 内容是否还有意义，而不是要求整行必须严格等于某个标签。
//     const uiInlineNoisePattern = /(地点[:：]?\s*[\u4e00-\u9fa5]{1,10}(市|区|省)?|完整的职位描述|职位描述如下|查看完整职位描述|Full\s+Job\s+Description)/gi;
//     return str
//       .replace(/&nbsp;/gi, ' ')
//       .split('\n')
//       .map((line) => {
//         let cleaned = line.trim().replace(tailNoisePattern, '').trim();
//         cleaned = cleaned.replace(uiInlineNoisePattern, ' ').replace(/[ \t]{2,}/g, ' ').trim();
//         return cleaned;
//       })
//       .filter((line) => line && line.length >= 2 && !line.includes('🎯 JD 智能解析'))
//       .join('\n')
//       .trim();
//   }

//   // DOM 抽取的文本经常被节点拆成很多短行（一句话被拆成三四行），
//   // 这里按"上一行是否以终止标点结尾/是否是列表项"做启发式合并，还原成自然段落。
//   // ============================================================================
//   // 优化版 parseJdSmart —— 针对 LinkedIn / Indeed 英文 JD "照单全收" 的问题
//   //
//   // 四个改动：
//   //  [根因] normalizeAndMergeLines 会把不带冒号的英文小标题并进下一行，
//   //         标题特征被彻底破坏 → 打分全军覆没 → 退化成"全文塞进 responsibilities"。
//   //         现在识别到"疑似小标题"的行一律不参与合并。
//   //  [词表] 按真实 JD 写作规范扩充（Essential Duties / Basic Qualifications /
//   //         What You'll Bring / Nice-to-Haves 等），并区分 required vs preferred。
//   //  [新增] 停止小节(STOP_SECTIONS)：Benefits / EEO / About Us 这类尾部样板段落
//   //         以前会被并进最后一个小节，现在遇到即截断。
//   //  [判定] 英文标题的结构特征另算：Title Case / ALL CAPS / 独立短行 / 后接列表。
//   // ============================================================================

//   // ============================================================================
//   // 合并版 JD 解析：DOM 有状态遍历(element 感知打分) + 文本兜底
//   //
//   // 架构取自你的 parseJdSmartMultiSignal：按渲染顺序遍历块 → 遇标题切换当前小节 →
//   // 其余内容归入当前小节。这个结构比"先压成文本再按位置切片"更好，因为打分时
//   // element 还在手上，className/id/tagName 都能用。
//   //
//   // 在此基础上修掉三个实测失分点，并补上纯文本路径：
//   //   [修] \b 对中文无效 + 全角冒号未处理 → 中文标题一个都识别不出
//   //   [修] 无停止小节 → Benefits/EEO/公司介绍 一路污染最后一个小节
//   //   [修] unspecified(前言) 被丢弃 → 岗位概述整段消失
//   //   [补] parseJdSmartText：API 返回的是 JSON/纯文本时没有 DOM，必须有这条路
//   // ============================================================================

//   // ============================================================================
//   // 合并版 JD 解析：DOM 有状态遍历(element 感知打分) + 文本兜底
//   //
//   // 架构取自你的 parseJdSmartMultiSignal：按渲染顺序遍历块 → 遇标题切换当前小节 →
//   // 其余内容归入当前小节。这个结构比"先压成文本再按位置切片"更好，因为打分时
//   // element 还在手上，className/id/tagName 都能用。
//   //
//   // 在此基础上修掉三个实测失分点，并补上纯文本路径：
//   //   [修] \b 对中文无效 + 全角冒号未处理 → 中文标题一个都识别不出
//   //   [修] 无停止小节 → Benefits/EEO/公司介绍 一路污染最后一个小节
//   //   [修] unspecified(前言) 被丢弃 → 岗位概述整段消失
//   //   [补] parseJdSmartText：API 返回的是 JSON/纯文本时没有 DOM，必须有这条路
//   // ============================================================================

//   // ============================================================================
//   // 合并版 JD 解析：DOM 有状态遍历(element 感知打分) + 文本兜底
//   //
//   // 架构取自你的 parseJdSmartMultiSignal：按渲染顺序遍历块 → 遇标题切换当前小节 →
//   // 其余内容归入当前小节。这个结构比"先压成文本再按位置切片"更好，因为打分时
//   // element 还在手上，className/id/tagName 都能用。
//   //
//   // 在此基础上修掉三个实测失分点，并补上纯文本路径：
//   //   [修] \b 对中文无效 + 全角冒号未处理 → 中文标题一个都识别不出
//   //   [修] 无停止小节 → Benefits/EEO/公司介绍 一路污染最后一个小节
//   //   [修] unspecified(前言) 被丢弃 → 岗位概述整段消失
//   //   [补] parseJdSmartText：API 返回的是 JSON/纯文本时没有 DOM，必须有这条路
//   // ============================================================================

//   // ============================================================================
//   // 合并版 JD 解析：DOM 有状态遍历(element 感知打分) + 文本兜底
//   //
//   // 架构取自你的 parseJdSmartMultiSignal：按渲染顺序遍历块 → 遇标题切换当前小节 →
//   // 其余内容归入当前小节。这个结构比"先压成文本再按位置切片"更好，因为打分时
//   // element 还在手上，className/id/tagName 都能用。
//   //
//   // 在此基础上修掉三个实测失分点，并补上纯文本路径：
//   //   [修] \b 对中文无效 + 全角冒号未处理 → 中文标题一个都识别不出
//   //   [修] 无停止小节 → Benefits/EEO/公司介绍 一路污染最后一个小节
//   //   [修] unspecified(前言) 被丢弃 → 岗位概述整段消失
//   //   [补] parseJdSmartText：API 返回的是 JSON/纯文本时没有 DOM，必须有这条路
//   // ============================================================================

//  const SECTION_VOCAB = [
//     {
//       type: 'responsibilities',
//       tiers: [
//         { weight: 0.85, phrases: [
//           '岗位职责', '工作职责', '职责描述', '主要职责', '核心职责', '工作内容',
//           '岗位描述', '职位描述', '职位职责', '工作内容及职责', '职责范围', '工作任务',
//           'Responsibilities', 'Key Responsibilities', 'Primary Responsibilities',
//           'Core Responsibilities', 'Main Responsibilities', 'Job Responsibilities',
//           'Duties and Responsibilities', 'Essential Duties', 'Essential Functions',
//           "What You'll Build"
//         ] },
//         { weight: 0.65, phrases: [
//           "What you'll do", 'What you will do', "What You'll Be Doing","What You'll Build",
//           'Your Day-to-Day', 'About the Role', 'Role Overview', 'Role Summary',
//           '主要工作', '主要负责', '负责内容', '你将负责', '工作重点', '负责',
//           '我们在找', '我们在招', '负责搭建',
//         ] },
//       ],
//     },
//     {
//       type: 'requirements',
//       tiers: [
//         { weight: 0.85, phrases: [
//           '任职要求', '任职资格', '岗位要求', '招聘条件', '职位要求', '能力要求',
//           '任职条件', '基本要求', '资格要求', '技能要求', '经验要求', '学历要求', '硬性要求',
//           'Requirements', 'Job Requirements', 'Qualifications', 'Basic Qualifications',
//           'Minimum Qualifications', 'Required Qualifications', 'Required Skills',
//           'Required Experience', 'Technical Requirements', 'Candidate Profile',
//           'Non-Negotiables', 'What We Need From You',
//         ] },
//         { weight: 0.65, phrases: [
//           "What we're looking for", 'Who You Are', "What You'll Bring", 'What You Need',
//           'Must Have', 'Must-have', 'Key Skills', '你需要具备', '我们需要你', '我们希望你',
//         ] },
//       ],
//     },
//     {
//       type: 'preferred',
//       tiers: [
//         { weight: 0.85, phrases: [
//           '加分项', '优先条件', '优先考虑', '加分技能', '优先经验',
//           'Preferred Qualifications', 'Preferred Experience', 'Preferred Skills',
//           'Additional Qualifications', 'Nice to Have', 'Nice-to-have', 'Bonus Points',
//           'Strong Signal',
//         ] },
//         { weight: 0.65, phrases: [
//           '具备以下者优先', '有相关经验者优先', '属于加分项',
//           'Bonus points for', 'A plus', 'Would be a plus', 'Strong plus',
//         ] },
//       ],
//     },
//     // 以下两类是"停止小节"：命中后正文收集结束，不再归入前三类
//     {
//       type: 'benefits',
//       tiers: [{ weight: 0.85, phrases: [
//         '福利待遇', '员工福利', '薪酬福利', '公司福利', '员工待遇',
//         'Benefits', 'Employee Benefits', 'Perks', 'What We Offer', 'Total Rewards',
//         'What You Get',
//       ] }],
//     },
//     {
//       type: 'compensation',
//       tiers: [{ weight: 0.85, phrases: [
//         '薪资范围', '薪酬待遇', '年薪', '月薪',
//         'Salary', 'Compensation', 'Salary Range', 'Pay Range', 'Base Salary',
//       ] }],
//     },
//     {
//       type: 'other',
//       tiers: [{ weight: 0.85, phrases: [
//         '公司简介', '关于我们', '企业文化', 'About Us', 'About the Company',
//         'Our Story', 'Why Join Us', 'Equal Opportunity', 'EEO', 'How to Apply',
//         'What This Is Not',
//       ] }],
//     },
//   ];

//   // const STOP_SECTIONS = new Set(['benefits', 'compensation', 'other']);
//    const STOP_SECTIONS = new Set([
//     '福利待遇','薪资福利','公司简介','关于我们','企业文化','工作地点','投递方式','我们提供',
//     'Benefits','What We Offer','Perks','Perks and Benefits','Compensation','Salary','Pay Range',
//     'Working Conditions','Work Environment','Physical Requirements',
//     'EEO Statement','Equal Opportunity','Equal Employment Opportunity','EEO',
//     'About Us','About the Company','Our Story','Our Mission','Why Join Us','Who We Are',
//     'How to Apply','Application Process','Next Steps','Disclaimer','Legal',"What We Offer"
//   ])

//   // ⚡ 归一化：把真实页面里的各种写法变体收敛到同一形态再匹配。
//   // 实测这一步能解决一大半漏判——弯引号、全角括号、连字符/&、多余空白。
//   function normalizeForMatch(s) {
//     return String(s || '')
//       .replace(/[\u2018\u2019\u02bc]/g, "'")      // 弯引号 → 直引号
//       .replace(/[\u201c\u201d]/g, '"')
//       .replace(/[\u2010-\u2015\u2212]/g, '-')      // 各种破折号 → 连字符
//       .replace(/[（）]/g, (m) => (m === '（' ? '(' : ')'))
//       .replace(/\s*&\s*/g, ' and ')                // & → and
//       .replace(/-/g, ' ')                          // 连字符与空格等价
//       .replace(/\s+/g, ' ')
//       .trim()
//       .toLowerCase();
//   }

//   // 中文短语足够独特（"岗位职责"几乎不可能出现在非标题语境的正文短行里），
//   // 直接用包含匹配，不再要求特定的前后缀字符——之前要求前缀必须是空白/项目符号，
//   // 导致"一、岗位职责""1.岗位职责""（一）岗位职责"这类编号标题全部漏判。
//   function matchPhrase(normText, phrase) {
//     const p = normalizeForMatch(phrase);
//     if (/[\u4e00-\u9fa5]/.test(p)) return normText.includes(p);
//     // 英文：词边界匹配，并容忍词尾复数
//     const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
//     return new RegExp(`(?:^|\\b)${esc}(?:e?s)?(?:\\b|[:：]|$)`, 'i').test(normText);
//   }

//   // ⚡ 核心词正则（你提的思路）：词表覆盖不到的写法用"含核心词"兜底。
//   // 权重压得低，单独出现过不了阈值，必须叠加排版/DOM 证据才成立——
//   // 这样既能捞回"主要负责""职位职责"这类变体，又不会把正文里提到
//   // "负责"的普通句子误判成标题。
//   const CORE_PATTERNS = [
//     { type: 'responsibilities', weight: 22, re: /(职责|负责|工作内容|responsibilit|duties|what you.{0,4}(ll|will) do)/i },
//     { type: 'requirements',     weight: 22, re: /(要求|资格|条件|qualificat|requirement|what (we|you).{0,4}(re |ll )?(looking|bring|have))/i },
//     { type: 'bonus',            weight: 22, re: /(加分|优先|preferred|nice to have|bonus|desirable|a plus)/i },
//   ];

//   // 最长匹配优先：解决 "Preferred Qualifications" 被 "Qualifications" 抢走
//   // 判成 requirements 的问题（同权重时，命中的短语越长越具体，应该赢）。
//   function matchVocab(text) {
//     const normText = normalizeForMatch(text);
//     let best = { type: null, keywordScore: 0, len: 0 };
//     for (const cfg of SECTION_VOCAB) {
//       for (const tier of cfg.tiers) {
//         for (const p of tier.phrases) {
//           if (!matchPhrase(normText, p)) continue;
//           const len = normalizeForMatch(p).length;
//           if (tier.weight > best.keywordScore || (tier.weight === best.keywordScore && len > best.len)) {
//             best = { type: cfg.type, keywordScore: tier.weight, len };
//           }
//         }
//       }
//     }
//     if (!best.type) {
//       for (const c of CORE_PATTERNS) {
//         if (c.re.test(normText) && c.weight > best.keywordScore) {
//           best = { type: c.type, keywordScore: c.weight, len: 0 };
//         }
//       }
//     }
//     return best;
//   }

//   function isStopSection(text) {
//     const t = text.trim().replace(/[:：\s]+$/, '').toLowerCase();
//     return STOP_SECTIONS.some((w) => t === w.toLowerCase());
//   }

//   // ---------------------------------------------------------------------------
//   // 多维打分：DOM 维度 + 排版维度 + 语义维度
//   // ---------------------------------------------------------------------------
//   function assessSectionHeader(element, text) {
//     const isCJKText = /[\u4e00-\u9fa5]/.test(text);

//     // 一票否决：项目符号开头的绝不是标题
//     if (/^[*•▪◦●\-–]\s+/.test(text)) return { isHeader: false, score: 0, type: null };

//     // ⚡ 数字编号不再一律否决。"1.岗位职责" 是标题，"1.负责推荐算法设计" 是列表项，
//     // 两者的区别不在编号而在长度：标题短、列表项长。以前一刀切否决，导致中文
//     // JD 里极常见的 "1.岗位职责" "2.任职资格" 全被判成列表项而漏掉。
//     const numbered = /^\d+[.、)）]\s*\S/.test(text) || /^[一二三四五六七八九十]+[、.]\s*\S/.test(text);
//     const bare = text.replace(/^[（(]?[\d一二三四五六七八九十]+[）)]?[.、)）]?\s*/, '');
//     if (numbered && bare.length > (isCJKText ? 12 : 30)) {
//       return { isHeader: false, score: 0, type: null };
//     }

//     let domScore = 0;
//     if (element && element.tagName) {
//       const tag = element.tagName.toLowerCase();
//       // className 在 SVG 元素上是对象，统一转字符串
//       const cls = typeof element.className === 'string' ? element.className : (element.getAttribute?.('class') || '');
//       const idName = element.id || '';
//       if (/^h[1-3]$/.test(tag)) domScore += 35;
//       else if (/^h[4-6]$/.test(tag)) domScore += 25;
//       else if (tag === 'b' || tag === 'strong') domScore += 20;
//       else if (tag === 'dt') domScore += 20;
//       // ⚡ class/id 语义信号——这是纯文本路径拿不到的证据，也是不同平台
//       // "职责和要求 class 不一样"时最可靠的线索
//       if (/header|title|section|heading|caption|label|subtitle/i.test(cls + ' ' + idName)) domScore += 30;
//       // 反向信号：一看就是正文/描述容器
//       if (/(desc|content|body|text|paragraph)/i.test(cls + ' ' + idName) && !/title|header|heading/i.test(cls + ' ' + idName)) domScore -= 10;
//     }

//     let layoutScore = 0;
//     const isCJK = isCJKText;
//     if (/[:：]\s*$/.test(text)) layoutScore += 25;
//     if (text.length <= (isCJK ? 20 : 40)) layoutScore += 20;
//     if (!isCJK && text === text.toUpperCase() && /[A-Z]{3,}/.test(text)) layoutScore += 18;
//     if (/[.。]$/.test(text) && !/[:：]$/.test(text)) layoutScore -= 20;
//     if (text.length > (isCJK ? 40 : 80)) layoutScore -= 40;
//     // 叙述句特征
//     if (/(?:we\s+are|you\s+will|our\s+team|looking\s+for\s+a|我们正在|如果你)/i.test(text) && text.length > 30) layoutScore -= 35;

//     const { type, keywordScore } = matchVocab(text);
//     const totalScore = domScore + layoutScore + keywordScore;
//     const headingLen = isCJKText ? 22 : 50;
//     const isHeader = (totalScore >= 60 && keywordScore > 0)
//       || (domScore >= 35 && keywordScore >= 25 && text.length <= headingLen);
//     return { isHeader, type, score: totalScore };
//   }

//   // ---------------------------------------------------------------------------
//   // 按渲染顺序拆块。相比原版修了两处：
//   //   - <li> 单独成块（原版 UL 的子元素是 LI，不在 some() 的标签清单里，
//   //     导致整个 UL 被当成一个叶子块，所有列表项糊成一坨）
//   //   - 直系文本节点不再丢失（原版 else 分支只遍历 element.children）
//   // ---------------------------------------------------------------------------
//   const LEAFY = /^(P|LI|H[1-6]|DT|DD|TD|TH|BLOCKQUOTE)$/i;
//   const CONTAINER = /^(DIV|SECTION|ARTICLE|UL|OL|DL|TABLE|TBODY|TR|MAIN|SPAN|BODY)$/i;

//   function getVisualTextBlocks(node) {
//     const blocks = [];
//     const walk = (el) => {
//       if (!el || !el.tagName) return;
//       const tag = el.tagName;
//       if (/^(SCRIPT|STYLE|NOSCRIPT|SVG)$/i.test(tag)) return;

//       if (LEAFY.test(tag)) {
//         const t = (el.textContent || '').trim();
//         if (t) blocks.push({ element: el, text: t });
//         return;
//       }
//       if (/^(H[1-6]|STRONG|B)$/i.test(tag)) {
//         const t = (el.textContent || '').trim();
//         if (t) blocks.push({ element: el, text: t });
//         return;
//       }
//       if (CONTAINER.test(tag)) {
//         // 先看有没有值得下钻的子元素；没有就把自己整体作为一块
//         const hasElementChild = el.children && el.children.length > 0;
//         if (!hasElementChild) {
//           const t = (el.textContent || '').trim();
//           if (t) blocks.push({ element: el, text: t });
//           return;
//         }
//         // 有子元素：逐个 childNode 处理，直系文本节点也要保留（原版会丢）
//         for (const child of Array.from(el.childNodes)) {
//           if (child.nodeType === 3) { // TEXT_NODE
//             const t = (child.nodeValue || '').trim();
//             if (t) blocks.push({ element: el, text: t });
//           } else if (child.nodeType === 1) {
//             walk(child);
//           }
//         }
//         return;
//       }
//       // 其它标签(如 <a>/<em>)：并入父级由父级处理，这里只兜底取文本
//       const t = (el.textContent || '').trim();
//       if (t) blocks.push({ element: el, text: t });
//     };
//     walk(node);
//     return blocks;
//   }

//   // ---------------------------------------------------------------------------
//   // 主入口（DOM 路径）
//   // ---------------------------------------------------------------------------
//   function parseJdFromDom(containerNode) {
//     // ⚡ 块内换行必须再拆一层。很多站点(含 LinkedIn 的 description 容器)把整段 JD
//     // 放在一个文本节点里、只用 \n 分行，getVisualTextBlocks 会把它当成"一个块"，
//     // assessSectionHeader 拿一整坨去判定当然不是标题 → 全部落进 intro →
//     // 最终全塞进 responsibilities。这正是"页面上全显示到职责"的直接原因。
//     const blocks = [];
//     for (const b of getVisualTextBlocks(containerNode)) {
//       if (b.text.includes('\n')) {
//         for (const line of b.text.split('\n')) {
//           const t = line.trim();
//           if (t) blocks.push({ element: b.element, text: t, __split: true });
//         }
//       } else {
//         blocks.push(b);
//       }
//     }
//     const buckets = { intro: [], responsibilities: [], requirements: [], bonus: [] };
//     let current = 'intro'; // ⚡ 第一个标题之前的内容不再丢弃，归入 intro

//     for (const blk of blocks) {
//       const { element, text } = blk;
//       const blockIsSplit = !!blk.__split;
//       const t = text.trim();
//       if (!t) continue;

//       // 停止小节：只认"看起来像标题"的短行，且必须已经进入过真实小节
//       // （开头的 About Us / 公司简介 是开场白，不是结尾样板）
//       if (current !== 'intro' && t.length <= 40 && isStopSection(t)) break;

//       const a = assessSectionHeader(blockIsSplit ? null : element, t);
//       if (a.isHeader && a.type) { current = a.type; continue; }
//       buckets[current].push(t);
//     }

//     // intro 并入 responsibilities 前部（岗位概述本质上属于"做什么"）
//     const resp = [...buckets.intro, ...buckets.responsibilities].join('\n').trim();
//     return {
//       responsibilities: resp,
//       requirements: buckets.requirements.join('\n').trim(),
//       bonus: buckets.bonus.join('\n').trim(),
//       fullCleanText: blocks.map((b) => b.text).join('\n').trim(),
//     };
//   }

//   // ---------------------------------------------------------------------------
//   // 纯文本路径（API/JSON 返回时没有 DOM，这条必须保留）
//   // 复用同一套词表和停止小节，保证两条路结论一致。
//   // ---------------------------------------------------------------------------
//   function looksLikeHeadingLine(s) {
//     s = s.trim();
//     if (!s || s.length > 60) return false;
//     if (/^##\s/.test(s) || /[:：]$/.test(s) || /^【.+】$/.test(s) || /^#+\s/.test(s)) return true;
//     const isCJK = /[\u4e00-\u9fa5]/.test(s);
//     if (!isCJK && s.length <= 45 && !/[.!?]$/.test(s)) {
//       if (s === s.toUpperCase() && /[A-Z]{3,}/.test(s)) return true;
//       const w = s.split(/\s+/);
//       const small = ['a','an','the','and','or','of','to','for','in','you','we','your','our','will','be','with'];
//       if (w.length <= 6 && w.every((x) => !/^[a-z]/.test(x) || small.includes(x.toLowerCase()))) return true;
//     }
//     return isCJK && s.length <= 20 && !/[。！？]$/.test(s);
//   }

//   function normalizeAndMergeLines(text) {
//     const lines = text.split('\n');
//     const bullet = /^([•▪◦●\-*]|[\d一二三四五六七八九十]+[.、)）])\s*/;
//     const out = [];
//     for (const raw of lines) {
//       const line = raw.trim();
//       if (!line) { out.push(''); continue; }
//       const prev = out[out.length - 1];
//       const canMerge = prev
//         && !bullet.test(line) && !looksLikeHeadingLine(line)
//         && !/[。！？.!?:：；;]$/.test(prev) && !bullet.test(prev) && !looksLikeHeadingLine(prev)
//         && /^[a-z(,;)]/.test(line); // 只有小写开头才算折行续写
//       if (canMerge) out[out.length - 1] = prev + ' ' + line;
//       else out.push(line);
//     }
//     return out.filter(Boolean).join('\n');
//   }

//   function parseJdFromText(rawText) {
//     const result = { responsibilities: '', requirements: '', bonus: '', fullCleanText: '' };
//     if (!rawText || typeof rawText !== 'string') return result;
//     const text = normalizeAndMergeLines(
//       rawText.replace(/\r\n?/g, '\n').replace(/\u3000/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
//     );
//     result.fullCleanText = text.replace(/^##\s+/gm, '');

//     const buckets = { intro: [], responsibilities: [], requirements: [], bonus: [] };
//     let current = 'intro';
//     for (const raw of text.split('\n')) {
//       const t = raw.trim();
//       if (!t) continue;
//       const bare = t.replace(/^##\s+/, '');
//       // ⚡ 停止小节只在"已经进入过真实小节"之后才生效。JD 以 "About Us"/"公司简介"
//       // 开头极其常见，那是开场介绍标题，不是结尾样板；以前一律 break，导致
//       // 整份 JD 从第一行就被丢弃，最后靠兜底把全文塞进职责（表现为完全不切分）。
//       if (current !== 'intro' && bare.length <= 40 && isStopSection(bare)) break;

//       // ⚡ 统一走标定过的 assessSectionHeader（element 传 null 即纯文本+排版+语义）。
//       // 之前这里是另一套弱判定（looksLikeHeadingLine + keywordScore>=15），
//       // 阈值远低于 DOM 路径，结果把 "1、负责推荐算法的设计" 这种列表项当成标题
//       // 吞掉，正文反而丢了。两条路必须共用同一套判定，结论才会一致。
//       const a = assessSectionHeader(null, bare);
//       if (a.isHeader && a.type) { current = a.type; continue; }
//       buckets[current].push(bare);
//     }
//     result.responsibilities = [...buckets.intro, ...buckets.responsibilities].join('\n').trim();
//     result.requirements = buckets.requirements.join('\n').trim();
//     result.bonus = buckets.bonus.join('\n').trim();
//     if (!result.responsibilities && !result.requirements && !result.bonus) {
//       result.responsibilities = result.fullCleanText;
//     }
//     return result;
//   }

//   // 统一入口：有 DOM 走 DOM，没有就走文本
//   // function parseJdSmart(input) {
//   //   if (input && typeof input === 'object' && input.nodeType === 1) return parseJdFromDom(input);
//   //   const result = { responsibilities: '', requirements: '', bonus: '', fullCleanText: '' };
//   //   const jdresult=window.JdParsed.parseJd(input);
//   //    result.responsibilities = [...jdresult.responsibilities].join('\n').trim();
//   //   result.requirements = jdresult.requirements.join('\n').join(jdresult.preferred).trim();
//   //   result.bonus = jdresult.preferred.join('\n').trim();
//   //   result.fullCleanText=[...jdresult.responsibilities].join('\n').join(jdresult.requirements).join("\n").join(jdresult.preferred);
//   //   console.log("responsibilities",jdresult.responsibilities,"requirements",jdresult.requirements)
//   //   return result;
//   // }
// function parseJdSmart(input) {
//   if (input && typeof input === 'object' && input.nodeType === 1) return parseJdFromDom(input);
  
//   const result = { responsibilities: '', requirements: '', bonus: '', fullCleanText: '' };
//   const jdresult = window.JdParsed.parseJd(input);

//   // 防错处理：确保即使某些字段不存在也不会崩溃（默认为空数组）
//   const resp = jdresult.responsibilities || [];
//   const req = jdresult.requirements || [];
//   const pref = jdresult.preferred || [];

//   // 1. 职责
//   result.responsibilities = resp.join('\n').trim();

//   // 2. 要求（将 requirements 与 preferred 两个数组合并后再 join）
//   result.requirements = [...req, ...pref].join('\n').trim();

//   // 3. 加分项/福利
//   result.bonus = pref.join('\n').trim();

//   // 4. 完整清洗文本（合并所有数组后统一 join）
//   result.fullCleanText = [...resp, ...req, ...pref].join('\n').trim();

//   console.log("responsibilities", resp, "requirements", req);
//   return result;
// }

// //   function parseJdSmart(formattedText) {
// //     if (!formattedText || typeof formattedText !== 'string') {
// //       return { responsibilities: '', requirements: '', bonus: '', fullCleanText: '' };
// //     }
// //     const cleanedNewlines = formattedText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
// //     const SECTION_RULES = [
// //       { type: 'responsibilities', pattern: /(?:^|\n)\s*(?:[#*->\s\d.、\-[\]【】()]+)*(?:岗位职责|工作职责|职责描述|岗位描述|工作内容|职责|Responsibilities|Key\s+Responsibilities|What\s+you(?:'ll|\s+will)\s+do|Duties|Role\s+(?:&|and)\s+Responsibilities|Position\s+Summary|Overview)(?:[#*:\s\-[\]【】()]+)*(?=\n|$)/im },
// //       { type: 'requirements', pattern: /(?:^|\n)\s*(?:[#*->\s\d.、\-[\]【】()]+)*(?:任职要求|任职资格|岗位要求|招聘条件|要求|Qualifications|Requirements|Basic\s+Qualifications|Minimum\s+Qualifications|What\s+(?:we're|we\s+are)\s+looking\s+for|Who\s+You\s+Are)(?:[#*:\s\-[\]【】()]+)*(?=\n|$)/im },
// //       { type: 'bonus', pattern: /(?:^|\n)\s*(?:[#*->\s\d.、\-[\]【】()]+)*(?:加分项|优先条件|优先考虑|拟优先|Preferred\s+Qualifications|Nice\s+to\s+have|Bonus\s+Points?|Desirable(?:\s+Skills)?)(?:[#*:\s\-[\]【】()]+)*(?=\n|$)/im }
// //     ];
// //     const detected = [];
// //     SECTION_RULES.forEach(({ type, pattern }) => {
// //       const m = pattern.exec(cleanedNewlines);
// //       if (m) detected.push({ type, startIndex: m.index, headerLength: m[0].length });
// //     });
// //     detected.sort((a, b) => a.startIndex - b.startIndex);

// //     const result = { responsibilities: '', requirements: '', bonus: '', fullCleanText: cleanedNewlines };
// //     if (!detected.length) { result.responsibilities = cleanedNewlines; return result; }

// //     detected.forEach((s, idx) => {
// //       const start = s.startIndex + s.headerLength;
// //       const end = idx + 1 < detected.length ? detected[idx + 1].startIndex : cleanedNewlines.length;
// //       const chunk = cleanedNewlines.slice(start, end).trim();
// //       result[s.type] = result[s.type] ? result[s.type] + '\n' + chunk : chunk;
// //     });
// //     if (detected[0].startIndex > 50) {
// //       const intro = cleanedNewlines.slice(0, detected[0].startIndex).trim();
// //       if (intro) result.responsibilities = intro + (result.responsibilities ? '\n\n' + result.responsibilities : '');
// //     }
// //     return result;
// //   }

//   function refineDomExtractedText(rawText) {
//     const cleaned = cleanText(rawText);
//     const formatted = normalizeAndMergeLines(cleaned);
//     return parseJdSmart(formatted);
//     // return parseJdFromText(formatted);
//   }

//   // ⚡ DOM 路径优先：拿得到面板元素时直接走 parseJdFromDom——打分阶段
//   // element 还在手上，tagName/className/id 都能当证据用（不同平台"职责和
//   // 要求 class 不一样"时最有价值）。DOM 路径结果为空才退回文本路径。
//   // 一份解析结果"分没分开"的判据：只有职责有内容、要求和加分全空，
//   // 基本就是没切开(整份 JD 被当成一段)，不能算成功。
//   function isDumpResult(r) {
//     if (!r) return true;
//     const resp = (r.responsibilities || '').length;
//     const rest = (r.requirements || '').length + (r.bonus || '').length;
//     return rest === 0 && resp > 0;
//   }

// // function refineFromPaneElement(paneEl, rawTextFallback) {
// //     let domResult = null;
// //     if (paneEl && paneEl.nodeType === 1) {
// //       try {
// //         const clone = paneEl.cloneNode(true);
// //         clone.querySelectorAll('#job-fast-carousel-panel, [id^="jdp-"], [class^="jdp-"]').forEach((w) => w.remove());
// //         // domToStructuredText 保留标题/列表结构（"## "/"• " 标记），
// //         // 喂给统一的新引擎——不再单独维护 parseJdFromDom 那条路。
// //         const r = refineDomExtractedText(domToStructuredText(clone));
// //         if (r && (r.responsibilities || r.requirements || r.bonus)) domResult = r;
// //       } catch (e) { /* DOM 结构不可预期，异常一律降级到文本路径 */ }
// //     }
// //     if (domResult && !isDumpResult(domResult)) return domResult;
// //     const textResult = refineDomExtractedText(rawTextFallback || '');
// //     if (!isDumpResult(textResult)) return textResult;
// //     return domResult || textResult;
// // }

//   // =====================================================================
//   // 4c. 通用右侧详情面板定位 —— 关键词锚点 + 向上溯源
//   //     从"JD 特征词"出发找容器，比单纯几何位置+密度打分更准：
//   //     先在全页找含有"岗位职责/Responsibilities"等锚点词的文本节点，
//   //     向上找到第一个"文本量够大、宽度够大、且落在中右侧"的祖先容器，
//   //     多个候选按 关键词命中数 + 文本长度 + 文本密度 打分，取最高分。
//   //     完全找不到锚点词（比如站点用图片/自定义术语描述职责）时，
//   //     才退化到 findFallbackContainer 的纯几何+密度打分兜底。
//   //     优先级：站点 hint selector（更准、更快）→ 关键词锚点通用兜底
//   // =====================================================================
//   const JD_ANCHOR_PATTERN = /(岗位职责|工作职责|职责描述|岗位描述|工作内容|任职要求|任职资格|岗位要求|招聘条件|加分项|优先条件|职位描述|职位信息|Responsibilities|Requirements|Qualifications|What\s+you.{0,10}do|What\s+we.{0,15}looking\s+for|Job\s+Description|About\s+the\s+role|About\s+this\s+role)/i;

//   // ⚡ 结构信号加分：class/id/相邻标题这些"结构层面"的线索，跟纯关键词文本
//   // 匹配是互补关系——很多站点会用语义化 class 命名 JD 容器（job-description、
//   // jobDescription、jd-content 等），这是比"扫到几个关键词"更直接的信号；
//   // 另外候选容器内部/紧邻位置如果能找到一个像标题的元素（h1~h4/strong/b 且
//   // 文本命中 JD_ANCHOR_PATTERN），说明这块确实是被一个语义化标题引出的正文，
//   // 而不是页面里偶然堆了几个关键词的杂项区域。这个函数在 className/id/
//   // querySelector/textContent 上工作，对"实时渲染的 DOM"和"fetch 回来解析出的
//   // 游离文档"都适用（不依赖任何需要渲染布局的 API）。
//   const SEMANTIC_CLASS_PATTERN = /(job[-_]?desc|jobdescription|description[-_]?content|jd[-_]?content|jd[-_]?body|posting[-_]?content|posting[-_]?body|position[-_]?desc|job[-_]?detail|content[-_]?description)/i;

//   function hasNearbyHeadingContext(element) {
//     const inner = element.querySelector && element.querySelector('h1, h2, h3, h4, h5, strong, b');
//     if (inner && JD_ANCHOR_PATTERN.test(inner.textContent || '')) return true;
//     const prevSibling = element.previousElementSibling;
//     if (prevSibling && JD_ANCHOR_PATTERN.test((prevSibling.textContent || '').slice(0, 60))) return true;
//     return false;
//   }

//   function computeStructuralBonus(element) {
//     let bonus = 0;
//     const classAndId = `${element.className || ''} ${element.id || ''}`;
//     if (SEMANTIC_CLASS_PATTERN.test(classAndId)) bonus += 80;
//     if (hasNearbyHeadingContext(element)) bonus += 30;
//     return bonus;
//   }

//   function findFallbackContainer() {
//     const blocks = document.querySelectorAll('div, section, article, main');
//     const rightBoundary = window.innerWidth * 0.25;
//     const MAX_TEXT_LEN = 6000; // 同样加体量上限，避免兜底路径也框出近乎整页的范围
//     let best = null;
//     let bestScore = -Infinity;
//     blocks.forEach((node) => {
//       const rect = node.getBoundingClientRect();
//       if (rect.width < 200 || rect.height < 150) return;
//       if (rect.left < rightBoundary) return;
//       const text = (node.innerText || '').trim();
//       if (text.length < 120 || text.length > MAX_TEXT_LEN) return;
//       const childTagsCount = node.querySelectorAll('*').length;
//       const density = text.length / (childTagsCount + 1);
//       const score = text.length * 0.2 + density * 5 + computeStructuralBonus(node);
//       if (score > bestScore) { bestScore = score; best = node; }
//     });
//     return best;
//   }

//   // 常见语义化 JD 容器 selector——网站开发者自己留下的最直接结构信号，
//   // 命中且内容体量合理时直接用，比"扫全页文本节点找关键词"更快也更准。
//   const SEMANTIC_JD_SELECTORS = '[class*="job-description" i], [class*="jobDescription" i], [class*="jd-content" i], [class*="jd-body" i], [id*="jobDescription" i], [id*="job-description" i], [class*="posting-requirements" i], [class*="description-content" i], [class*="job-detail" i],[class*="job-intro-container"]';


//   function locateJdContainer() { 
//     // ⚡ 结构优先快速路径：先按语义化 class/id 直接查，命中且内容体量合理就
//     // 直接用，不用再跑一遍关键词锚点扫描全页文本节点。
//     const semanticCandidates = Array.from(document.querySelectorAll(SEMANTIC_JD_SELECTORS));
//     for (const el of semanticCandidates) {
//       const text = el.innerText || '';
//       const rect = el.getBoundingClientRect();
//       if (text.length > 120 && text.length < 6000 && rect.width > 200) {
//         console.log('⚡ [content.js] 命中语义化 class/id，直接使用:', el.className || el.id);
//         return el;
//       }
//     }

//     const viewWidth = window.innerWidth;
//     const candidates = [];
//     const seenElements = new Set();
//     // ⚡ 修复"英文JD基本全页都提取"：根因是下面打分公式里 matches.length * 100
//     // 线性放大，一个包含"相似职位/侧栏推荐"的大容器如果碰巧堆了好几个
//     // "Responsibilities/Requirements"字样（每个推荐职位摘要都会各出现一次），
//     // 关键词命中数量反而比真正紧凑的 JD 正文块更多，导致大容器在打分上"赢"了，
//     // 越大越容易赢，最后框选出接近整页的范围。这里加三处硬约束：
//     //   1. 体量硬上限（文本长度/子节点数）——超过直接放弃该候选，不参与打分
//     //   2. 关键词命中数量封顶（超过 4 次边际收益归零）——避免"数量堆砌"跑赢
//     //   3. 体量惩罚项——候选越大越扣分，让"刚好框住正文"的紧凑容器更有竞争力
//     const MAX_TEXT_LEN = 6000;
//     const MAX_CHILD_COUNT = 400;

//     const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
//     let textNode;
//     while ((textNode = walker.nextNode())) {
//       if (!JD_ANCHOR_PATTERN.test(textNode.nodeValue)) continue;
//       let parent = textNode.parentElement;
//       while (parent && parent !== document.body && parent !== document.documentElement) {
//         const rect = parent.getBoundingClientRect();
//         const text = parent.innerText || '';
//         // 启发式：文本够长(>120字) + 宽度够大(>200px) + 落在中右侧(左边界 > 25%视口宽)
//         if (text.length > 120 && rect.width > 200 && rect.left > viewWidth * 0.25) {
//           const childTagsCount = parent.querySelectorAll('*').length;

//           if (text.length > MAX_TEXT_LEN || childTagsCount > MAX_CHILD_COUNT) {
//             // 太大了，大概率把整版列表/侧栏也框进来了，放弃这条锚点
//             break;
//           }
//           if (seenElements.has(parent)) { break; } // 同一个容器已经算过一次，跳过避免重复加分
//           seenElements.add(parent);

//           const density = text.length / (childTagsCount + 1);
//           const matches = text.match(new RegExp(JD_ANCHOR_PATTERN, 'gi')) || [];
//           const matchBonus = Math.min(matches.length, 4) * 60; // 命中次数封顶，防止"数量堆砌"跑赢
//           const sizePenalty = Math.max(0, text.length - 800) * 0.05; // 体量惩罚，越大扣越多
//           const structuralBonus = computeStructuralBonus(parent); // class/id/相邻标题结构信号

//           candidates.push({
//             element: parent,
//             score: matchBonus + text.length * 0.1 + density * 5 - sizePenalty + structuralBonus
//           });
//           break; // 找到第一层合格容器就停止向上溯源，避免过度扩大到 body
//         }
//         parent = parent.parentElement;
//       }
//     }
//     if (candidates.length === 0) {
//       console.warn('⚠️ [content.js] 未找到 JD 关键词锚点，启动全屏几何+密度兜底...');
//       return findFallbackContainer();
//     }
//     candidates.sort((a, b) => b.score - a.score);
//     return candidates[0].element;
//   }

//   // 标题通常是 JD 容器的"兄弟/祖先"而不是内部元素（锚点词溯源只框住了描述正文），
//   // 所以先在容器内找，找不到再沿祖先链往上找同级标题，最后退化到全页右侧第一个 h1/h2。
//   function locateTitleGeneric(jdContainer) {
//     if (jdContainer) {
//       const inner = jdContainer.querySelector('h1, h2, h3');
//       if (inner) return inner.innerText.trim();
//       let node = jdContainer;
//       for (let i = 0; i < 4 && node && node.parentElement; i++) {
//         const parent = node.parentElement;
//         const sibling = parent.querySelector(':scope > h1, :scope > h2, :scope > h3');
//         if (sibling) return sibling.innerText.trim();
//         node = parent;
//       }
//     }
//     const rightBoundary = window.innerWidth * 0.25;
//     const headings = document.querySelectorAll('h1, h2');
//     for (const h of headings) {
//       const rect = h.getBoundingClientRect();
//       if (rect.width > 0 && rect.left > rightBoundary) return h.innerText.trim();
//     }
//     return '';
//   }

//   function getRightPaneNode() {
//     if (adapter.rightPaneSelectors) {
//       const el = document.querySelector(adapter.rightPaneSelectors);
//       if (el) return el;
//     }
//     const fallback = locateJdContainer();
//     // 诊断用：控制台执行 window.__jdpDiag = true 后能看到每次调用实际
//     // 找没找到面板、找到的元素是什么——智联没有专门的 adapter 配置，
//     // 走的就是这条通用兜底，先确认它到底有没有命中，命中的是不是对的
//     // 元素，比继续猜哪个环节出问题更直接。
//     if (window.__jdpDiag) {
//       console.log('%c[JDP-DIAG] getRightPaneNode (通用兜底)', 'color:#e91e63',
//         fallback ? { tag: fallback.tagName, className: fallback.className, textLen: (fallback.textContent || '').length }
//                  : '没有找到任何候选面板');
//     }
//     return fallback;
//   }

//   function getTitleFromPane(paneNode) {
//     if (adapter.titleSelectors) {
//       const el = paneNode?.querySelector(adapter.titleSelectors);
//       if (el) return el.innerText.trim();
//     }
//     return locateTitleGeneric(paneNode);
//   }

//   function getDescNode(paneNode) {
//     if (adapter.descSelectors) {
//       const el = paneNode?.querySelector(adapter.descSelectors);
//       if (el) return el;
//     }
//     return paneNode; // 通用兜底：locateJdContainer 已经把范围收窄到 JD 正文区块，直接取整块 innerText
//   }

//   function getClickTarget(cardNode) {
//     if (adapter.clickTargetSelector) {
//       const el = cardNode.matches?.(adapter.clickTargetSelector)
//         ? cardNode
//         : cardNode.querySelector(adapter.clickTargetSelector);
//       if (el) return el;
//       if (adapter.preferCardClick) return cardNode;
//     }
//     return cardNode.querySelector('a[href]') || cardNode; // 通用兜底：点卡片里第一个链接，没有就点卡片本身
//   }

//   // =====================================================================
//   // 5. 详情提取：三级策略 —— 模拟点击(+监听) → 主动 fetch(限频兜底)
//   // =====================================================================

//   // ---- 两级节流器 ----
//   // clickStagger: 控制"模拟点击"本身的节奏（第一/二级），比 fetch 兜底宽松很多，
//   //               因为点击本身是"像真人一样操作"，不是密集主动请求。
//   // directFetchLimiter: 只用来节流第三级"主动 fetch 兜底"，这条路才是真正容易触发风控的。
//   const clickStagger = {
//     lastClickAt: 0,
//     // ⚡ 900 → 250：这个等待发生在【点击之前】，是纯粹叠加在用户感知延迟上的
//     // 成本。它的本意是"避免连点太快"，但现在只有当前卡片才会点击(预取不点)，
//     // 而用户手动切卡的节奏本身就远慢于此，900ms 属于白等。降到 250ms 仍然能
//     // 防住"程序化连点"，但把点击路径的总耗时直接砍掉约 0.9 秒。
//     minIntervalMs: 250,
//     // ⚡ 可中断的等待：以前这里是一整段不可打断的 setTimeout，如果排队等点击的
//     // 这段时间里用户已经切到别的卡片，这次等待还是会傻等满 900~1500ms 才轮到
//     // 处理——而且点完之后还要再等最多 4.5s 的 DOM/网络观察窗口，全程没有任何
//     // 机制能让"已经不相关的点击"提前让路。isStale() 每 150ms 被轮询一次，
//     // 一旦发现过期就立刻放弃，不再傻等完整个等待窗口。
//     async wait(isStale) {
//       const now = Date.now();
//       const elapsed = now - this.lastClickAt;
//       const jitter = 200 + Math.random() * 400;
//       let waitMs = Math.max(0, this.minIntervalMs + jitter - elapsed);
//       const step = 150;
//       while (waitMs > 0) {
//         if (isStale && isStale()) return false; // 排队期间已经过期，放弃这次点击
//         const chunk = Math.min(step, waitMs);
//         await new Promise((r) => setTimeout(r, chunk));
//         waitMs -= chunk;
//       }
//       this.lastClickAt = Date.now();
//       return true;
//     }
//   };
//   const directFetchLimiter = {
//     lastCallAt: 0,
//     // ⚡ 之前是 4000ms，实测你这边即使有这个间隔，请求 job/detail.json 还是会
//     // 触发风控——说明这个接口对请求频率的容忍度比我们最初估计的更低。调大到
//     // 8000ms 起步是个更保守的默认值，但这个数字终究是拍出来的，不是测出来的；
//     // 如果你这边实测下来还是偶发触发，就继续往上调，反过来如果观察一段时间
//     // 完全没触发过，也可以适当往下调，找到你这边站点实际能接受的下限。
//     minIntervalMs: 3000,
//     async wait() {
//       const now = Date.now();
//       const elapsed = now - this.lastCallAt;
//       const jitter = 1000 + Math.random() * 1000;
//       const waitMs = Math.max(0, this.minIntervalMs + jitter - elapsed);
//       if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
//       this.lastCallAt = Date.now();
//     }
//   };

//   let directFetchRequestSeq = 0;
//   function directFetchDetail(matchKey, meta) {
//     return new Promise((resolve) => {
//       const requestId = String(++directFetchRequestSeq);
//       const timer = setTimeout(() => {
//         document.removeEventListener('RESP_DIRECT_FETCH_JOB', handler);
//         resolve(null);
//       }, 2000);

//       function handler(e) {
//         const detail = e.detail || {};
//         if (detail.requestId !== requestId) return;
//         clearTimeout(timer);
//         document.removeEventListener('RESP_DIRECT_FETCH_JOB', handler);
//         resolve(detail.data || null);
//       }
//       document.addEventListener('RESP_DIRECT_FETCH_JOB', handler);
//       document.dispatchEvent(new CustomEvent('REQ_DIRECT_FETCH_JOB', { detail: { matchKey, meta, requestId } }));
//     });
//   }

//   // =====================================================================
//   // ⚡ 第四级通用兜底：Indeed 这类站点没有已知的 JSON API，directFetchDetail
//   // 必然拿不到东西。既然拿不到接口数据，就退而求其次——直接 fetch 这张卡片
//   // 链接指向的详情页 HTML，解析出正文，复用前面已经验证过的
//   // JD_ANCHOR_PATTERN 关键词锚点算法定位正文块，再走同一套 cleanText→
//   // normalizeAndMergeLines→parseJdSmart 管线切分职责/要求。
//   // 这条路径完全站点无关，不依赖任何特定网站的接口格式，是"通用方案"。
//   // =====================================================================

//   // 从卡片里挑出真正指向详情页的链接：卡片里通常还有配图、公司 logo、分享/
//   // 收藏按钮这类无关链接，要过滤掉，只信任"同源 + 非图片/功能性路径 + 不是
//   // 纯图标包裹"的候选，多个候选时优先选文本最长的（职位标题本身通常就是
//   // 卡片里文本最长的可点击链接）。
//   function extractDetailPageUrl(cardNode) {
//     if (!cardNode) return null;
//     const links = Array.from(cardNode.querySelectorAll('a[href]'));
//     const candidates = links
//       .map((a) => ({ el: a, href: a.href }))
//       .filter(({ href, el }) => {
//         if (!href) return false;
//         if (/^(javascript:|mailto:|tel:|#)/i.test(href)) return false;
//         if (/\.(png|jpe?g|gif|svg|webp|ico|pdf)(\?|#|$)/i.test(href)) return false; // 排除图片/文件类链接
//         if (/\b(share|login|signin|signup|logout|apply|help|about|privacy|terms|company\/)\b/i.test(href)) return false; // 排除功能性/非详情链接
//         try {
//           const u = new URL(href, location.href);
//           if (u.host !== location.host) return false; // 只信任同源，避免抓到外链广告/追踪重定向
//         } catch (e) { return false; }
//         const hasMeaningfulText = (el.innerText || '').trim().length > 1;
//         const onlyWrapsImage = el.children.length === 1 && el.children[0].tagName === 'IMG' && !hasMeaningfulText;
//         return !onlyWrapsImage; // 排除纯图片包裹的链接（配图/logo）
//       });
//     if (!candidates.length) return null;
//     candidates.sort((a, b) => (b.el.innerText || '').length - (a.el.innerText || '').length);
//     return candidates[0].href;
//   }

//   // 和 locateJdContainer 同一套打分逻辑（关键词命中封顶 + 体量硬上限 + 体量惩罚），
//   // 但去掉了所有依赖渲染布局的几何判断（rect.left/rect.width）——因为 fetch 回来
//   // 的 HTML 用 DOMParser 解析出的是游离文档，没有真正渲染过，getBoundingClientRect
//   // 永远是 0，innerText 也拿不到有效值，只能退回到用 textContent 做纯文本层面的判断。
//   function locateJdContainerInDoc(doc) {
//     // ⚡ 结构优先快速路径，跟 locateJdContainer 同一套 selector，逻辑一致
//     const semanticCandidates = Array.from(doc.querySelectorAll(SEMANTIC_JD_SELECTORS));
//     for (const el of semanticCandidates) {
//       const text = (el.textContent || '').trim();
//       if (text.length > 120 && text.length < 8000) return el;
//     }

//     const candidates = [];
//     const seenElements = new Set();
//     const MAX_TEXT_LEN = 8000;
//     const MAX_CHILD_COUNT = 500;
//     const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null, false);
//     let textNode;
//     while ((textNode = walker.nextNode())) {
//       if (!JD_ANCHOR_PATTERN.test(textNode.nodeValue)) continue;
//       let parent = textNode.parentElement;
//       while (parent && parent !== doc.body) {
//         const text = (parent.textContent || '').trim();
//         if (text.length > 120) {
//           const childTagsCount = parent.querySelectorAll('*').length;
//           if (text.length > MAX_TEXT_LEN || childTagsCount > MAX_CHILD_COUNT) break;
//           if (seenElements.has(parent)) break;
//           seenElements.add(parent);
//           const density = text.length / (childTagsCount + 1);
//           const matches = text.match(new RegExp(JD_ANCHOR_PATTERN, 'gi')) || [];
//           const matchBonus = Math.min(matches.length, 4) * 60;
//           const sizePenalty = Math.max(0, text.length - 800) * 0.05;
//           const structuralBonus = computeStructuralBonus(parent); // 同一套 class/id/相邻标题结构信号，fetch 回来的游离文档也适用
//           candidates.push({ element: parent, score: matchBonus + text.length * 0.1 + density * 5 - sizePenalty + structuralBonus });
//           break;
//         }
//         parent = parent.parentElement;
//       }
//     }
//     if (!candidates.length) return null;
//     candidates.sort((a, b) => b.score - a.score);
//     return candidates[0].element;
//   }

//   // 原来（4636-4675行）先 parseJdFromDom，找不到/不满意再退化成 jdContainer.textContent
// // 或 doc.body.textContent（纯文本、丢结构），改成统一走 domToStructuredText：
// async function fetchAndParseDetailPage(cardNode) {
//     const url = extractDetailPageUrl(cardNode);
//     if (!url) return null;
//     try {
//       const res = await fetch(url, { credentials: 'include' });
//       if (!res.ok) return null;
//       const html = await res.text();
//       const doc = new DOMParser().parseFromString(html, 'text/html');
//       doc.querySelectorAll('script, style, noscript, nav, footer, header, aside, svg, iframe, form').forEach((el) => el.remove());

//       const jdContainer = locateJdContainerInDoc(doc);
//       const structuredText = domToStructuredText(jdContainer || doc.body);
//       if (!structuredText || structuredText.length < 100) return null;

//       const parsed = refineDomExtractedText(structuredText);
//       if (!parsed.responsibilities && !parsed.requirements && !parsed.fullCleanText) return null;

//       const titleEl = doc.querySelector('h1');
//       return { title: titleEl ? titleEl.textContent.trim() : '', ...parsed, source: 'Detail Page Fetch (parsed HTML)' };
//     } catch (e) {
//       console.warn('[content.js] 拉取/解析详情页失败:', e);
//       return null;
//     }
// }


//   // ---- 第一级 + 第二级：模拟点击，同时监听 (a) 网络拦截 (b) 右侧 DOM 变化 ----
//   // 干净读取右侧面板文本：clone 之后剔除插件自己的悬浮面板/自定义节点，
//   // 避免我们自己的 UI（比如 #job-fast-carousel-panel）污染 JD 文本对比。
//   // ⚡ 结构化文本提取：不再用 innerText。
//   // innerText 会把 <li> 的项目符号丢掉（那些 • 是 CSS ::marker 生成的，不在文本里），
//   // 也会把 <h3>/<strong> 这类小标题降级成普通文字——DOM 里明明存在的结构信号
//   // 全被抹平了，后面只能靠纯文本特征去猜，这正是"简单 JD 也识别不出来"的上游原因。
//   // 这里改成遍历 DOM，把结构直接翻译成文本标记：
//   //   <li>            → "• " 前缀（恢复列表项身份）
//   //   <h1>~<h6>       → "## " 前缀（明确的小标题）
//   //   独立成段的 <strong>/<b> → "## " 前缀（很多站点用加粗当小标题）
//   //   <br>/<p>/<div>  → 换行
//   // 这样打分算法拿到的是"带结构标记的文本"，而不是被压平的一坨。
//   const BLOCK_TAGS = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'TR', 'UL', 'OL', 'TABLE', 'HEADER', 'FOOTER']);
//   const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

//   function domToStructuredText(root) {
//     const out = [];
//     const walk = (node) => {
//       if (!node) return;
//       if (node.nodeType === Node.TEXT_NODE) {
//         const t = node.nodeValue.replace(/\s+/g, ' ');
//         if (t.trim()) out.push(t);
//         return;
//       }
//       if (node.nodeType !== Node.ELEMENT_NODE) return;
//       const tag = node.tagName;
//       if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'SVG') return;

//       if (tag === 'BR') { out.push('\n'); return; }

//       if (tag === 'LI') {
//         out.push('\n• ');
//         Array.from(node.childNodes).forEach(walk);
//         out.push('\n');
//         return;
//       }
//       if (HEADING_TAGS.has(tag)) {
//         out.push('\n## ');
//         Array.from(node.childNodes).forEach(walk);
//         out.push('\n');
//         return;
//       }
//       // 加粗元素如果自己独占一段（父节点里没有别的实质文本），当小标题处理
//       if ((tag === 'STRONG' || tag === 'B')) {
//         const own = (node.innerText || node.textContent || '').trim();
//         const parentText = (node.parentElement?.innerText || node.parentElement?.textContent || '').trim();
//         if (own && parentText && own.length >= parentText.length - 2 && own.length <= 60) {
//           out.push('\n## ');
//           Array.from(node.childNodes).forEach(walk);
//           out.push('\n');
//           return;
//         }
//       }
//       if (BLOCK_TAGS.has(tag)) out.push('\n');
//       Array.from(node.childNodes).forEach(walk);
//       if (BLOCK_TAGS.has(tag)) out.push('\n');
//     };
//     walk(root);
//     return out.join('')
//       .replace(/[ \t]+/g, ' ')
//       .replace(/ *\n */g, '\n')
//       .replace(/\n{3,}/g, '\n\n')
//       .trim();
//   }

//   // ⚡ 轻量版：只做变化检测用。
//   // 上一轮把 extractCleanRightPaneText 改成了 cloneNode(true) + domToStructuredText
//   // 的完整 JS 递归遍历——但它被 120ms 的轮询每 tick 调一次，等于每秒克隆并
//   // 递归遍历整个右侧面板 8 次。面板节点动辄上千个，这就是"刷新变慢"的原因。
//   // 变化检测其实只需要知道"文本变没变、稳没稳"，用原生 innerText 足够快，
//   // 昂贵的结构化解析留到真正要出结果时再做一次。
//   function quickPaneSnapshot() {
//     const rightPane = getRightPaneNode();
//     if (!rightPane) return null;
//     if (rightPane.id === 'job-fast-carousel-panel' || rightPane.closest('#job-fast-carousel-panel') === rightPane) return null;
//     return { rightPane, rawText: (rightPane.innerText || '').trim() };
//   }

//   function extractCleanRightPaneText() {
//     const rightPane = getRightPaneNode();
//     if (!rightPane) return null;
//     if (rightPane.id === 'job-fast-carousel-panel' || rightPane.closest('#job-fast-carousel-panel') === rightPane) {
//       return null; // 通用几何/关键词兜底极端情况下选中了我们自己的悬浮面板，直接跳过
//     }
//     const clone = rightPane.cloneNode(true);
//     clone.querySelectorAll('#job-fast-carousel-panel, [id^="jdp-"], [class^="jdp-"]').forEach((w) => w.remove());
//     let rawText = '';
//     try { rawText = domToStructuredText(clone); } catch (e) { rawText = ''; }
//     // 结构化提取万一异常/结果异常短，退回 innerText，保证不比以前更差
//     if (!rawText || rawText.length < 40) rawText = (clone.innerText || '').trim();
//     return { rightPane, rawText };
//   }

//   // ⚡ "冷启动直读"只应该在页面刚加载、我们自己还一次点击都没做过的时候用一次，
//   //    不能每次调用都重新判断——BOSS 这类站点点完一次之后 URL 上可能会持续带着
//   //    securityId 参数(不会被替换掉)，导致"URL 包含 matchKey"这个判断在后续每次
//   //    点击不同卡片时都可能因为 URL 参数堆积而误判命中，直接跳过真实点击去读一份
//   //    早就过期的内容——这正是"点击中文详情策略失效"的根因。加一个会话级只用一次
//   //    的开关，从根上避免这个判断被反复触发。
//   let coldStartDirectReadUsed = false;

//   // 稳定性读取：不是读一次就信，而是等右侧内容连续 stableWindowMs 没有再变化
//   // 才认为是真正加载完成的正文——避免把"加载过程中的一句摘要/骨架文案"
//   // （比如领英过渡态里一闪而过的简短摘要）当成完整详情接受下来。
//   function waitForStableRightPane({ timeout = 2000, stableWindowMs = 450 } = {}) {
//     return new Promise((resolve) => {
//       let lastText = null;
//       let stableTimer = null;
//       let finished = false;
//       const finish = (result) => {
//         if (finished) return;
//         finished = true;
//         clearTimeout(stableTimer);
//         clearTimeout(hardTimeout);
//         observer.disconnect();
//         resolve(result);
//       };
//       const check = () => {
//         const extracted = quickPaneSnapshot();
//         const rawText = extracted?.rawText || '';
//         if (rawText.length <= 20 || /加载中|loading/i.test(rawText.slice(0, 80))) { lastText = null; return; }
//         if (rawText === lastText) return; // 已经在等这份内容稳定，不用重设定时器
//         lastText = rawText;
//         clearTimeout(stableTimer);
//         stableTimer = setTimeout(() => {
//           // const parsed = refineFromPaneElement(extracted && extracted.rightPane, rawText);
//          const parsed = refineDomExtractedText(rawText);
//          console.log("after",parsed)
//           if (parsed.responsibilities || parsed.requirements || parsed.fullCleanText) {
//             finish({ rightPane: extracted.rightPane, rawText, parsed });
//           }
//         }, stableWindowMs);
//       };
//       const observer = new MutationObserver(check);
//       observer.observe(document.body, { childList: true, subtree: true, characterData: true });
//       check();
//       const hardTimeout = setTimeout(() => finish(null), timeout);
//     });
//   }

//   // ⚡ 你提的"直接读 Vue state/props"——实现在这里，作为轮询里的快路径。
//   // BOSS 是 Vue 应用，右侧详情面板的数据在组件实例内部，通常比 DOM 更早可用
//   // （数据到了但还没渲染完），而且是结构化的、不用做文本清洗，质量也更高。
//   // Vue 2 在 DOM 元素上挂 __vue__，Vue 3 挂 __vueParentComponent。
//   // ⚠️ 生产构建是否暴露这些内部字段没有保证（Vue 3 的 __vueParentComponent 在
//   // 部分构建下会被裁掉），所以这里只当"能拿到就赚了"的快路径，拿不到就静默
//   // 返回 null，正常走后面的 DOM 轮询，不影响原有链路。
//   // 用 window.__jdpDiag = true 可以看到它每次尝试的结果。
//   const JD_STATE_KEYS = ['postDescription', 'jobDescription', 'description', 'jobDesc', 'positionDesc'];

//   function pickJdFromStateObject(obj, depth = 0, seen = new Set()) {
//     if (!obj || typeof obj !== 'object' || depth > 4 || seen.has(obj)) return null;
//     seen.add(obj);
//     for (const k of JD_STATE_KEYS) {
//       const v = obj[k];
//       if (typeof v === 'string' && v.length > 100) {
//         return { text: v, title: obj.jobName || obj.title || obj.jobTitle || '' };
//       }
//     }
//     for (const key in obj) {
//       if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
//       if (key.startsWith('$') || key.startsWith('_')) continue; // 跳过框架内部循环引用
//       const v = obj[key];
//       if (v && typeof v === 'object') {
//         const sub = pickJdFromStateObject(v, depth + 1, seen);
//         if (sub) return sub;
//       }
//     }
//     return null;
//   }

//   function readDetailFromFrameworkState() {
//     try {
//       const pane = getRightPaneNode();
//       if (!pane) return null;
//       // 从右侧面板节点向上找挂着组件实例的祖先
//       let el = pane;
//       for (let i = 0; i < 8 && el; i++) {
//         const v2 = el.__vue__;                    // Vue 2
//         const v3 = el.__vueParentComponent;       // Vue 3
//         const buckets = [];
//         if (v2) buckets.push(v2.$data, v2.$props, v2);
//         if (v3) buckets.push(v3.props, v3.setupState, v3.data, v3.ctx);
//         for (const b of buckets) {
//           const hit = pickJdFromStateObject(b);
//           if (hit && hit.text) {
//             const cleaned = refineDomExtractedText(hit.text.replace(/<[^>]+>/g, '\n'));
//             if (cleaned.responsibilities || cleaned.requirements || cleaned.fullCleanText) {
//               if (window.__jdpDiag) console.log('%c[JDP-DIAG]', 'color:#0a66c2', '✅ 直接从框架 state 读到 JD，跳过 DOM 等待');
//               return { title: hit.title || cardTitleFallback(), ...cleaned };
//             }
//           }
//         }
//         el = el.parentElement;
//       }
//     } catch (e) { /* 框架内部结构不可预期，任何异常都静默降级到 DOM 轮询 */ }
//     return null;
//   }
//   function cardTitleFallback() { return ''; }

//   async function simulateClickAndListen(cardNode, matchKey, basicInfo, options = {}) {

//     const { timeout = 2000, generation } = options;
//     const tEnterFn = Date.now();
//     if (adapter.panelScopeGuard && !adapter.panelScopeGuard()) return null;

//     // ⚡ 代际过期检查：每次 ensureDetailsAroundCurrent 被调用（也就是"当前卡片"
//     // 变了）都会让 activeGeneration 自增。如果这次点击任务携带的 generation
//     // 跟当前最新的对不上，说明用户早就切到别的卡片去了，这次点击已经没有意义。
//     const isStale = () => generation !== undefined && generation !== activeGeneration;
//     if (isStale()) return null;

//     // ⚡ 冷启动直读：只在本次会话第一次调用、且是 LinkedIn（currentJobId= 这个
//     // URL 参数会被整体替换，不会像 BOSS 的 securityId 那样持续堆积在 URL 上，
//     // 判断更可靠）时才尝试。不再是单次读取即信，而是等内容稳定下来才接受，
//     // 避免把加载过程中的过渡态短文本当成正文。
//     if (!coldStartDirectReadUsed && SITE === 'linkedin' && matchKey) {
//       coldStartDirectReadUsed = true; // 不管这次成不成功，都只尝试这一次
//       const urlMatched = new RegExp(`[=/]${matchKey}(?:[&/]|$)`).test(location.href);
//       if (urlMatched) {
//         console.log(`⚡ [content.js] URL 已指向该职位(${matchKey})，尝试冷启动直读（等待内容稳定）`);
//         const stable = await waitForStableRightPane({ timeout: 1500 });
//         if (stable) {
//           const newHeaderTitle = getTitleFromPane(stable.rightPane);
//           return { title: basicInfo.title || newHeaderTitle, ...stable.parsed, matchKey, source: 'URL-matched Stable Read' };
//         }
//         console.log('⚡ [content.js] 冷启动直读未等到稳定内容，回退到正常点击流程');
//       }
//     }

//     // 节流：控制"点击"本身的节奏，避免后台预取和当前卡片渲染同时/过快连点。
//     // ⚡ 可中断——排队等待期间用户切到别的卡片，直接放弃这次点击，不浪费
//     // 一次真实点击(也不占用后续的 4.5s 观察窗口去等一个没人关心的结果)。
//     const proceeded = await clickStagger.wait(isStale);
//     if (!proceeded || isStale()) {
//       console.log(`⚡ [content.js] 排队等待点击期间已经切到别的卡片，放弃这次点击: ${matchKey || basicInfo.cardId}`);
//       return null;
//     }
//     // ⚡ 分段计时：把"点击路径到底慢在哪一段"直接打出来，不用再猜。
//     // 输出形如: ⏱ [耗时] card=xxx | 节流等待 260ms | 站点响应 780ms | 合计 1040ms
//     const tClickStart = Date.now();
//     const tStaggerCost = tClickStart - tEnterFn;

//     const cardTitle = basicInfo.title || '';
//     const before = quickPaneSnapshot();
//     const oldDescText = before?.rawText || '';

//     cardNode.style.outline = '2px solid #00bebd';
//     // cardNode.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
//     const clickableTarget = getClickTarget(cardNode);
//     // ⚡ 修复"读取失败刷新会导致整页刷新(BOSS)"：原来这里只拦截了
//     // a[target="_blank"] 的默认跳转——但那种链接本来就是开新标签页，不会导致
//     // 当前页面刷新，真正的风险反而是没有 target="_blank" 的普通 <a href>：
//     // 如果 getClickTarget 选中的元素本身就是（或包在）这样一个链接里，
//     // 站点自己的 SPA 拦截逻辑万一没接管这次模拟点击（比如用 element.click()
//     // 触发的是非可信事件，某些框架的点击拦截逻辑对这种事件处理不一致），
//     // 浏览器就会执行链接的默认行为——同标签页整页跳转/刷新。我们的模拟点击
//     // 目的自始至终都是"让站点自己更新右侧详情面板"，从来不需要真的发生页面
//     // 跳转，所以这里直接无条件阻止默认动作，不再区分是不是 target="_blank"。
//     const preventJump = (e) => { e.preventDefault(); };
//     clickableTarget.addEventListener('click', preventJump, { capture: true, once: true });
//     // ⚡ 崩溃检测的"落笔"点：点击前记一笔"即将点这张卡"，正常流程结束时
//     // （不管成功还是超时）都会调 clearPendingClick() 擦掉它。如果这次点击
//     // 导致了整页刷新，脚本会跟着页面一起被销毁，代码走不到 clearPendingClick()，
//     // 标记就会留在 sessionStorage 里，被下次脚本重新注入时的检测逻辑读到。
//     markPendingClick(matchKey || basicInfo.cardId);
//     // ⚡ 通用"点击相关性捕获"：告诉 injected.js"接下来这个窗口内出现的 JD 形状
//     // 响应，都算这张卡的"。这样即使站点的详情接口 URL 我们不认识、payload 里的
//     // ID 字段名我们也不知道，只要它在点击后返回了一段像 JD 的正文，就能正确
//     // 归属到这张卡片上——这是不依赖任何站点专属知识的兜底机制。
//     document.dispatchEvent(new CustomEvent('REQ_BEGIN_CAPTURE', {
//       detail: { cardId: String(matchKey || basicInfo.cardId) }
//     }));
//     clickableTarget.click();
//     // console.log("点击监听")
//     return new Promise((resolve) => {
//       let isFinished = false;
//       let staleCheckTimer = null;
//       let pendingBest = null;      // { rank, srcName, payload } —— 优先级仲裁用
//       let graceTimer = null;
//       const pollTimers = [];
//       const cleanup = () => { cardNode.style.outline = ''; };
//       const finalize = () => {
//         isFinished = true;
//         if (staleCheckTimer) clearInterval(staleCheckTimer);
//         if (graceTimer) clearTimeout(graceTimer);
//         pollTimers.forEach((t) => { clearInterval(t); clearTimeout(t); });
//         if (matchKey) detailWaiters.delete(String(matchKey));
//         cleanup();
//         clearPendingClick();
//         // 关闭捕获窗口：injected.js 会把窗口内攒到的最佳候选(如果有)发出来。
//         // 注意这个发出来的结果不一定被本次 Promise 接住(可能已经 resolve 了)，
//         // 但它一定会经 JOB_HOOK_DETAIL 走进 detailCache，不会浪费。
//         document.dispatchEvent(new CustomEvent('REQ_END_CAPTURE'));
//       };

//       // ⚡ 优先级仲裁：三个信号源(state/network/dom)是同一次点击的三个观察面，
//       // 天然在赛跑。这里不再"谁先到用谁"，而是按 CLICK_SOURCE_PRIORITY 仲裁：
//       // 低优先级的源先到时，先扣住不 resolve，等 SOURCE_GRACE_MS 看高优先级的
//       // 会不会追上；追上就用高优先级的，没追上再用先到的那个。
//       // 代价是最多 SOURCE_GRACE_MS(250ms) 的额外延迟，换取按平台配置的数据质量。
//       const sourcePriority = CLICK_SOURCE_PRIORITY[SITE] || CLICK_SOURCE_PRIORITY.generic;

//       const settleWith = (srcName, payload) => {
//         const total = Date.now() - tEnterFn;
//         const siteCost = Date.now() - tClickStart;
//         console.log(`⏱ [耗时] card=${matchKey || basicInfo.cardId} | 节流 ${tStaggerCost}ms | 站点响应+检测 ${siteCost}ms | 合计 ${total}ms | 来源 ${srcName}`);
//         finalize();
//         resolve(payload);
//       };

//       // 任何一个源拿到数据都走这里，由它决定是立刻采用还是再等一会儿
//       const offerSource = (srcName, payload) => {
//         if (isFinished) return;
//         const rank = sourcePriority.indexOf(srcName);
//         const effRank = rank < 0 ? 999 : rank;

//         if (effRank === 0) { // 最高优先级到了，没有等待的理由
//           clearTimeout(graceTimer);
//           settleWith(srcName, payload);
//           return;
//         }
//         // 记下当前最好的候选（rank 越小越好）
//         if (!pendingBest || effRank < pendingBest.rank) {
//           pendingBest = { rank: effRank, srcName, payload };
//         }
//         if (graceTimer) return; // 宽限窗口已经在跑了
//         graceTimer = setTimeout(() => {
//           if (isFinished || !pendingBest) return;
//           settleWith(pendingBest.srcName, pendingBest.payload);
//         }, SOURCE_GRACE_MS);
//       };

//       // ⚡ 点已经点出去了，没法收回，但"等结果"这件事可以提前放弃——真实的
//       // 网络响应/DOM 变化到达时依然会正常写入 detailCache（被动监听那条路径
//       // 不依赖这个 Promise 有没有人还在等），所以提前放弃等待不会丢数据，
//       // 只是不再占着车道等一个用户已经不关心的结果，车道能立刻去处理真正
//       // 当前的那张卡片。
//       if (generation !== undefined) {
//         staleCheckTimer = setInterval(() => {
//           if (isFinished || !isStale()) return;
//           finalize();
//           console.log(`⚡ [content.js] 等待点击结果期间已经切到别的卡片，提前放弃等待(数据仍会被动写入缓存): ${matchKey || basicInfo.cardId}`);
//           resolve(null);
//         }, 200);
//       }

//       // (a) 监听网络拦截：click 触发的真实站内请求会被 injected.js 捕获并广播
//       if (matchKey) {
//         detailWaiters.set(String(matchKey), (detail) => {
//           offerSource('network', { ...detail, matchKey, source: 'Simulated Click + Network Intercept' });
//         });
//       }

//       // (b) 同时用 MutationObserver 兜底解析右侧面板 DOM
//       //     标题匹配只做软校验（打日志），不再作为硬性拦截条件——
//       //     generic 站点的标题定位本身是启发式兜底，命中率有限，卡死会导致
//       //     DOM 兜底路径基本永远失败。真正判断"数据是否可用"靠：内容确实变了 +
//       //     长度够 + 不是加载中占位符。
//       const checkDom = () => {
//         try {
//           const extracted = extractCleanRightPaneText();
//           if (!extracted) return null;
//           const { rightPane, rawText } = extracted;
//           const isDescUpdated = oldDescText ? rawText !== oldDescText : true;
//           const looksLikeLoading = rawText.length < 80 && /加载中|loading/i.test(rawText);
//           if (!isDescUpdated || rawText.length <= 20 || looksLikeLoading) return null;

//           const newHeaderTitle = getTitleFromPane(rightPane);
//           const isTitleMatched = !cardTitle || !newHeaderTitle || newHeaderTitle.includes(cardTitle) || cardTitle.includes(newHeaderTitle);
//           if (!isTitleMatched) {
//             console.log('[content.js] 标题未完全匹配，仍采用当前内容（软校验，不拦截）：', { cardTitle, newHeaderTitle });
//           }

//           // const parsed = refineFromPaneElement(rightPane, rawText);
//           const parsed =refineDomExtractedText(rawText);
//           if (parsed.responsibilities || parsed.requirements || parsed.fullCleanText) {
//             return { title:  cardTitle, ...parsed };
//           }
//         } catch (err) { console.warn('解析右侧面板异常:', err); }
//         return null;
//       };

//       // ⚡ 性能根因修复：原来这里是"每次 DOM 变化就重置 350ms 防抖计时器"。
//       // 问题在于 observe 的是 document.body + subtree:true，捕获的是【整个页面】
//       // 的所有变化——BOSS 页面上聊天挂件、埋点、懒加载图片、动画都在持续制造
//       // mutation，甚至【我们自己的 renderGalleryCards 更新看板 DOM 也会触发它】。
//       // 只要页面上的 mutation 间隔小于 350ms，这个计时器就永远在被重置、
//       // 永远等不到"安静 350ms"这个条件，checkDom() 根本没机会执行，最后只能
//       // 硬等 4500ms 超时。这就是"页面明明 1 秒就刷新好了，我们却要 5 秒"的答案。
//       //
//       // 改成固定间隔轮询 + 内容稳定判定，不再有"重置"语义。
//       // state 源不需要等稳定（结构化数据到了就是到了）；dom 源需要连续两次一致。
//       const POLL_MS = 120;
//       const STABLE_TICKS = 2; // 连续 2 次(240ms)内容不变即认为稳定
//       let lastSeenText = null;
//       let stableCount = 0;
//       let stateOffered = false;

//       const pollTimer = setInterval(() => {        if (isFinished) return;

//         // 源① state：直接读框架内部状态（Vue/React），最快、最干净
//         if (!stateOffered) {
//           const fromState = readDetailFromFrameworkState();
//           if (fromState) {
//             stateOffered = true;
//             offerSource('state', { ...fromState, matchKey, source: 'Framework State Read' });
//             if (isFinished) return;
//           }
//         }

//         // 源② dom：轮询右侧面板文本
//         const extracted = quickPaneSnapshot();
//         const rawText = extracted?.rawText || '';
//         const isDescUpdated = oldDescText ? rawText !== oldDescText : true;
//         const looksLikeLoading = rawText.length < 80 && /加载中|loading/i.test(rawText);
//         if (!isDescUpdated || rawText.length <= 20 || looksLikeLoading) { stableCount = 0; return; }

//         if (rawText === lastSeenText) {
//           stableCount++;
//           if (stableCount >= STABLE_TICKS) {
//             const parsed = checkDom();
//             if (parsed) offerSource('dom', { ...parsed, matchKey, source: 'Simulated Click + DOM Parse' });
//           }
//         } else {
//           lastSeenText = rawText;
//           stableCount = 0;
//         }
//       }, POLL_MS);
//       pollTimers.push(pollTimer);

//       // ⚡ 提前 flush 捕获窗口：让 injected.js 里攒着的低置信度候选也有机会在
//       // 本次观察窗口内被采纳，而不是等到 finalize() 之后才发出来（那时 Promise
//       // 已经结束，等于白攒）。高置信度候选在 injected.js 侧是立即发出的，
//       // 这里只是给"分数不够高但确实只有它"的情况一个兜底机会。
//       const flushTimer = setTimeout(() => {
//         if (isFinished) return;
//         document.dispatchEvent(new CustomEvent('REQ_END_CAPTURE'));
//       }, Math.max(600, timeout - 1200));
//       pollTimers.push(flushTimer);

//       setTimeout(() => {
//         if (isFinished) return;
//         finalize();
//         resolve(null); // 点击+监听都没拿到，交给第三级 fetch 兜底
//       }, timeout);
//     });
//   }

//   // ---- 总调度：按 点击→监听→fetch 顺序尝试，命中即缓存 ----
//   // ⚡ 新增 allowClick 开关：只有"当前正在看的这张卡"才允许模拟点击。
//   //   原因见 ensureDetailsAroundCurrent 的注释——点击会改变站点自己右侧面板的
//   //   选中状态，连续点击多张卡片做预取，等于快速切换站点自己的选中项，
//   //   站点自身的异步响应/渲染很容易跟不上、乱序，这是"当前卡片显示的详情
//   //   其实是后面第 N 张卡片内容"这类错位读取的根源。预取阶段完全不点击，
//   //   只走被动缓存命中 + 主动 fetch，牺牲一点预取命中率换取正确性，且不
//   //   依赖任何站点特有的时序假设，是通用方案而不是专门适配某一个站点。
//   // =====================================================================
//   // 站点级详情获取策略——每个站点声明自己的优先级顺序，按需调整，不用改核心逻辑。
//   //   'click'     —— 模拟点击 + 被动监听（同一动作两个观察面：网络拦截优先，
//   //                   DOM兜底），触发的是站点自己会发生的流量，不算额外请求
//   //   'fetch'     —— 主动调用站点已知的 JSON API（BOSS 的 job/detail.json、
//   //                   LinkedIn 的 voyager API），是我们自己额外发起的请求，
//   //                   受 directFetchLimiter 限频
//   //   'pageFetch' —— 没有已知 JSON API 时，直接 fetch 详情页 HTML 解析正文，
//   //                   同样受限频
//   // 'click' 策略内部会自动处理"点击风险名单"和"节点已脱离文档"两种不安全场景
//   // （不安全就直接判定这一级不适用，跳到下一级），不需要在策略顺序表里手动排除。
//   // =====================================================================
//   // =====================================================================
//   // 按平台配置取数优先级
//   //   SITE_STRATEGY_ORDER  —— 大策略顺序（cache 永远最先，在 ensureJobDetail 里）
//   //   CLICK_SOURCE_PRIORITY —— 'click' 这一级内部三个信号源谁优先：
//   //       'state'   = 直接读框架内部状态(Vue/React)，最快、最干净
//   //       'network' = 点击触发站点自己的 XHR，被 injected.js 拦截
//   //       'dom'     = 轮询右侧面板 DOM 文本
//   //     三者是同一次点击的三个观察面，天然在赛跑。优先级的作用是：当低优先级
//   //     的源先到时，先等 SOURCE_GRACE_MS 看看高优先级的会不会跟上，跟上就用
//   //     高优先级的结果；没跟上再用低优先级的——用很小的延迟换数据质量。
//   // =====================================================================
//   const SITE_STRATEGY_ORDER = {
//     // BOSS：缓存 → 点击(页面读取优先) → fetch 兜底。
//     // 点击是唯一安全路径(站点自己的流量)，fetch 是风控高危，只在点击拿不到时用。
//     boss: ['click', 'fetch'],
//     // LinkedIn：接口优先。页面刷新慢、接口限制少，voyager API 已验证可行。
//     linkedin: ['fetch', 'click', 'pageFetch'],
//     // 智联：当前卡优先模拟点击 + 拦截站内详情接口；预取如果拿得到岗位 number 再走接口。
//     // 卡片里的 a 经常是公司页，禁用 pageFetch，避免把公司页当详情页解析。
//     zhaopin: ['click', 'fetch'],
//     // generic：拦截优先 → 页面提取 → api → (url 兜底已并入 pageFetch)
//     generic: ['click', 'pageFetch', 'fetch']
//   };

//   const CLICK_SOURCE_PRIORITY = {
//     boss: ['state', 'dom', 'network'],       // BOSS 是 Vue，能直读状态最快；其次页面读取；拦截兜底
//     linkedin: ['network', 'state', 'dom'],  // LinkedIn：拦截 > React 数据 > 页面读取
//     zhaopin: ['network', 'dom', 'state'],   // 智联：接口/捕获最可靠，DOM 作为兜底
//     generic: ['network', 'dom', 'state']    // 未知站点：拦截最可靠，其次页面提取
//   };

//   const SOURCE_GRACE_MS = 250; // 低优先级源先到时，给高优先级源的追赶窗口

//   async function tryDetailStrategy(strategyName, cardNode, basicInfo, matchKey, ctx) {
//     if (strategyName === 'click') {
//       if (!ctx.allowClick || ctx.isClickRisky) return { detail: null, cardNode }; // 这一级不适用，交给下一级
//       let targetNode = cardNode;
//       if (!document.body.contains(targetNode)) {
//         console.warn(`⚠️ [content.js] 卡片节点已从页面脱离(可能被站点自己的虚拟滚动回收)，尝试重新定位: ${ctx.cacheKey}`);
//         const freshNode = findLiveNodeByCardId(basicInfo.cardId);
//         if (!freshNode) {
//           console.warn(`⚠️ [content.js] 页面上确实找不到这张卡片了，跳过点击: ${ctx.cacheKey}`);
//           return { detail: null, cardNode };
//         }
//         targetNode = freshNode;
//         const engineCardEntry = (state.engineCards || []).find((c) => c.cardId === basicInfo.cardId);
//         if (engineCardEntry) engineCardEntry.node = freshNode; // 同步更新快照，避免下次又用回旧引用
//       }
//       const detail = await simulateClickAndListen(targetNode, matchKey, basicInfo, { generation: ctx.generation });
//       console.log(SITE,detail)
//       return { detail, cardNode: targetNode };
//     }
//     if (strategyName === 'fetch') {
//       // ⚡ 本站点根本没有已知 JSON API 时，这一级必然返回 null——
//       // injected.js 的 directFetchDetail 只实现了 boss/linkedin，generic 直接
//       // return null。以前这里仍然会先付 directFetchLimiter 的 9~10 秒空等，
//       // 再拿到一个注定的 null，是 Indeed 单卡片要二十多秒的主要来源。
//       // 现在直接跳过，把时间让给真正可行的 pageFetch。
//       if (!SITE_HAS_JSON_API) return { detail: null, cardNode };
//       // 预取模式下如果本站点不允许预取走网络（BOSS），这一级直接跳过。
//       if (!ctx.allowClick && !PREFETCH_ALLOW_NETWORK) return { detail: null, cardNode };
//       if (SITE === 'boss' && !basicInfo.securityId) return { detail: null, cardNode }; // 没有 securityId，接口打不通，省一次无意义的限频等待
//       if (SITE === 'zhaopin' && (!matchKey || /^h_/.test(String(matchKey)))) return { detail: null, cardNode }; // 智联没有岗位 number 时无法主动拉详情
//       await directFetchLimiter.wait();
//       const meta = { lid: basicInfo.lid };
//       const fetched = await directFetchDetail(matchKey, meta);
//       console.log(SITE,fetched)
//       return { detail: fetched ? { ...fetched, source: 'Direct Fetch (JSON API)' } : null, cardNode };
//     }
//     if (strategyName === 'pageFetch') {
//       if (adapter.disablePageFetch) return { detail: null, cardNode };
//       if (!ctx.allowClick && !PREFETCH_ALLOW_NETWORK) return { detail: null, cardNode };
//       await directFetchLimiter.wait();
//       const pageDetail = await fetchAndParseDetailPage(cardNode);
//       return { detail: pageDetail, cardNode };
//     }
//     return { detail: null, cardNode };
//   }

//   async function ensureJobDetail(cardNode, basicInfo, options = {}) {
//     const { allowClick = true, generation } = options;
//     const matchKey = SITE === 'boss' ? (basicInfo.securityId || basicInfo.cardId) : basicInfo.cardId;
//     const cacheKey = String(basicInfo.cardId || matchKey);
//     // ⚡ 失败结果不再当作"永久命中"——见 requestDetail/runLane 的
//     //   同步改动，以及下面 detailCache.set 的说明
//     const cached = detailCache.get(cacheKey);
//     if (cached && cached.source !== 'Failed') return cached;

//     // ⚡ 点击风险名单：这张卡之前点击后触发过"没有清掉 pending 标记就没了下文"
//     // （大概率是整页刷新），策略顺序里的 'click' 会自动跳过，不需要在这里特殊处理。
//     const isClickRisky = allowClick && clickRiskyCardIds.has(String(cacheKey));
//     if (isClickRisky) {
//       console.warn(`⚠️ [content.js] 卡片 ${cacheKey} 在点击风险名单里(上次点击后页面被整体刷新过)，策略顺序会跳过点击`);
//     }

//     const ctx = { allowClick, isClickRisky, cacheKey, generation };
//     const strategyOrder = SITE_STRATEGY_ORDER[SITE] || SITE_STRATEGY_ORDER.generic;

//     // ⚡ 基准测试模式：控制台执行 window.__jdpBench = true 打开。
//     // 打开后会【并行】跑 fetch 和 click 两条路，把各自耗时和成败都打出来，
//     // 用先返回的那个结果。这样"LinkedIn 上到底接口快还是拦截快"就有实测数据，
//     // 不用靠猜。测完记得关掉——并行会让请求量翻倍。
//     if (window.__jdpBench && allowClick) {
//       const t0 = Date.now();
//       const mark = (name) => (r) => {
//         console.log(`🏁 [BENCH] ${cacheKey} | ${name} ${r && r.detail ? '成功' : '失败/空'} 耗时 ${Date.now() - t0}ms`);
//         return { name, ...r };
//       };
//       const racers = [
//         tryDetailStrategy('fetch', cardNode, basicInfo, matchKey, ctx).then(mark('fetch(API)')),
//         tryDetailStrategy('click', cardNode, basicInfo, matchKey, ctx).then(mark('click(拦截/状态/DOM)'))
//       ];
//       const settled = await Promise.allSettled(racers);
//       const winner = settled.map((s) => s.value).find((v) => v && v.detail);
//       if (winner) {
//         console.log(`🏁 [BENCH] ${cacheKey} | 采用: ${winner.name}`);
//         const result0 = { ...basicInfo, ...winner.detail };
//         detailCache.set(cacheKey, result0);
//         return result0;
//       }
//     }

//     let detail = null;
//     for (const strategyName of strategyOrder) {
//       console.log(`⏳ [content.js] 按策略顺序尝试 [${strategyName}]: ${cacheKey}`);
//       const result = await tryDetailStrategy(strategyName, cardNode, basicInfo, matchKey, ctx);
//       cardNode = result.cardNode; // 'click' 策略如果重新定位过节点，后续策略沿用最新引用
//       if (result.detail) { detail = result.detail; break; }
//     }

//     if (!detail) {
//       detail = {
//         fullCleanText: allowClick
//           ? `⚠️ 已按 [${strategyOrder.join(' → ')}] 顺序尝试均未获取到详情，请稍后重试或手动点击该卡片`
//           : '⏳ 该卡片尚未加载，切换到它时会自动重新获取',
//         source: 'Failed'
//       };
//     }

//     const existingAfterAttempt = detailCache.get(cacheKey);
//     if (existingAfterAttempt && existingAfterAttempt.source !== 'Failed' && detail.source === 'Failed') {
//       return existingAfterAttempt;
//     }

//     const result = { ...basicInfo, ...detail };
//     // ⚡ 失败/待加载的结果依然写缓存（这样 UI 有占位文案可以显示），但用
//     //   source==='Failed' 这个标记区分，requestDetail/runLane 命中
//     //   缓存时会专门跳过这类标记，重新触发一次流程，而不是永远读到失败占位
//     detailCache.set(cacheKey, result);
//     return result;
//   }
//   // =====================================================================
//   // 桥接层 A：详情请求队列 —— 拆成两条独立车道，不再共用一条队列
//   //   activeLane   ：只处理 allowClick:true 的任务（当前卡片），一次只有一个
//   //   prefetchLane ：只处理 allowClick:false 的任务（预取），纯 fetch，不点击
//   // 拆开的原因：以前是一条共享队列，如果用户切卡时正好有一个"慢"的预取 fetch
//   // 任务在处理中（directFetchLimiter 内部有 4~5 秒的限频等待），当前卡片的
//   // 点击请求哪怕设了 priority 提到队首，也得等这个正在处理中的任务彻底结束——
//   // 这正是"读取时间变慢"的原因。点击和纯 fetch 之间并不存在真正的资源冲突
//   // （点击操作 DOM，fetch 只是发网络请求），完全可以并行跑，拆成两条车道后
//   // 当前卡片的点击不会再被别的卡片的预取 fetch 卡住。
//   // =====================================================================
//   const activeLane = [];
//   const prefetchLane = [];
//   let activeLaneRunning = false;
//   let prefetchLaneRunning = false;

//   function findEngineCardById(cardId) {
//     return (state.engineCards || []).find((c) => c.cardId === cardId) || null;
//   }

//   function requestDetail(cardId, { priority = false, allowClick = true, generation } = {}) {
//     const cached = detailCache.get(String(cardId));
//     if (cached && cached.source !== 'Failed') return Promise.resolve(cached);
//     const engineCard = findEngineCardById(cardId);
//     if (!engineCard) return Promise.resolve(null);

//     const lane = allowClick ? activeLane : prefetchLane;
//     const existing = lane.find((t) => t.cardId === cardId);
//     if (existing) {
//       if (generation !== undefined) existing.generation = generation; // 换成最新的代际号，旧的失效判断跟着更新
//       if (priority) {
//         const idx = lane.indexOf(existing);
//         if (idx > 0) { lane.splice(idx, 1); lane.unshift(existing); }
//       }
//       return new Promise((resolve) => existing.resolvers.push(resolve));
//     }

//     // 如果这张卡之前作为"预取"任务还排在 prefetchLane 里没处理完，
//     // 而这次是要当"当前卡片"点击查看——从 prefetchLane 里摘掉，
//     // 改投到 activeLane，避免同一张卡片同时占两条车道
//     if (allowClick) {
//       const idxInPrefetch = prefetchLane.findIndex((t) => t.cardId === cardId);
//       if (idxInPrefetch >= 0) {
//         const promoted = prefetchLane.splice(idxInPrefetch, 1)[0];
//         promoted.allowClick = true;
//         promoted.generation = generation;
//         return new Promise((resolve) => {
//           promoted.resolvers.push(resolve);
//           if (priority) activeLane.unshift(promoted); else activeLane.push(promoted);
//           runActiveLane();
//         });
//       }
//     }

//     return new Promise((resolve) => {
//       const task = { cardId, resolvers: [resolve], allowClick, generation };
//       if (priority) lane.unshift(task); else lane.push(task);
//       if (allowClick) runActiveLane(); else runPrefetchLane();
//     });
//   }

//   async function runLane(lane) {
//     while (lane.length) {
//       const { cardId, resolvers, allowClick, generation } = lane.shift();

//       // ⚡ 修复"预取只有前几张有效，第4张开始要等"：
//       // 预取(allowClick:false)最终都要落到 directFetchLimiter 限频的 fetch 上，
//       // 那个限频器强制两次请求间隔 ~4.5~5.5 秒。如果用户切卡片的速度比这个快，
//       // prefetchLane 里会越积越多——排在后面的任务，轮到它处理时用户可能早就
//       // 切过去好几张了，这张卡对当前视图已经没有意义，但它依然会老老实实占用
//       // 一次限频名额，把真正还需要的后续卡片继续往后挤。这里在真正消耗限频
//       // 名额之前先检查一下：这张卡是不是还在 currentIndex+1..+PREFETCH_LOOKAHEAD 的预取窗口内，
//       // 不在了就直接丢弃(不占用限频名额)，省下来的名额留给真正还需要的卡片。
//       // 丢弃不等于永久放弃——record._detailLoaded 还是 false，等用户真的翻到
//       // 这张卡附近时，ensureDetailsAroundCurrent 会重新把它排进来。
//       if (!allowClick) {
//         const idx = state.filteredDatalist.findIndex((r) => r.id === cardId);
//         const stillRelevant = idx >= 0 && idx > state.currentIndex && idx <= state.currentIndex + PREFETCH_LOOKAHEAD;
//         if (!stillRelevant) {
//           resolvers.forEach((r) => r(null));
//           continue;
//         }
//       } else {
//         // ⚡ 修复"快速连续切卡时，中途经过的卡片会被逐个真实点击、请求停不下来"：
//         // 快速切换时，每一张短暂路过的卡片都会在切过去的瞬间被当成"当前卡片"
//         // 塞进 activeLane 排队（虽然靠 priority 插队到前面优先处理，但更早排队
//         // 的那些并不会被移出队列）。如果不做限制，队列会在你早就停下来之后，
//         // 还在后台把路过的每一张都点一遍——既没有意义（你已经不关心那些卡片
//         // 了），又会不必要地增加撞上"点击导致整页刷新"这类站点异常行为的次数
//         // （越是快速划过的卡片，越可能对应站点自己已经虚拟滚动回收掉的节点，
//         // 恰恰是最容易触发这种问题的）。这里只在这张卡此刻仍然是
//         // state.currentIndex 指向的那条记录时，才值得真正点它。
//         const curRecord = state.filteredDatalist[state.currentIndex];
//         const stillCurrent = curRecord && curRecord.id === cardId;
//         if (!stillCurrent) {
//           resolvers.forEach((r) => r(null));
//           continue;
//         }
//       }

//       const cached = detailCache.get(String(cardId));
//       if (cached && cached.source !== 'Failed') { resolvers.forEach((r) => r(cached)); continue; }
//       const engineCard = findEngineCardById(cardId);
//       if (!engineCard) { resolvers.forEach((r) => r(null)); continue; }
//       let result = null;
//       try { result = await ensureJobDetail(engineCard.node, engineCard.basicInfo, { allowClick, generation }); } catch (e) { console.warn('详情提取异常:', e); }
//       resolvers.forEach((r) => r(result));
//     }
//   }

//   async function runActiveLane() {
//     if (activeLaneRunning) return;
//     activeLaneRunning = true;
//     await runLane(activeLane);
//     activeLaneRunning = false;
//   }

//   async function runPrefetchLane() {
//     if (prefetchLaneRunning) return;
//     prefetchLaneRunning = true;
//     await runLane(prefetchLane);
//     prefetchLaneRunning = false;
//   }


//   // =====================================================================
//   // 桥接层 B：引擎"发现卡片" → UI"渲染记录"
//   //   - runPipeline: 扫描 DOM，新卡片先以占位文案推入 state.rawDatalist 立即渲染，
//   //     详情异步补齐，不阻塞列表出现的速度
//   //   - ensureRecordDetail: 对单条记录发起详情提取，完成后原地更新并按需重渲染；
//   //     失败的结果不会被当成"已加载"锁死，下次切回这张卡会自动重新尝试
//   //   - ensureDetailsAroundCurrent: 当前卡片(允许点击) + 预取后面 2 张(只读缓存/fetch)
//   // =====================================================================
//   async function ensureRecordDetail(record, options = {}) {
//     const { allowClick = true, generation } = options;
//     if (!record || record._detailLoaded) return;
//     const loadingField = allowClick ? '_detailLoadingClick' : '_detailLoadingPrefetch';
//     if (record[loadingField]) return;
//     if (!allowClick && record._detailLoadingClick) return;
//     record[loadingField] = true;
//     record._detailLoading = true;
//     const isPriority = state.filteredDatalist[state.currentIndex] === record;
//     const detail = await requestDetail(record.id, { priority: isPriority, allowClick, generation });
//     record[loadingField] = false;
//     record._detailLoading = Boolean(record._detailLoadingClick || record._detailLoadingPrefetch);
//     if (!detail) return;

//     const isFailed = detail.source === 'Failed';
//     if (isFailed && record._detailLoaded) return;
//     // ⚡ 失败/待加载不算"已加载完成"——_detailLoaded 保持 false，下次这条记录
//     //   再被 ensureDetailsAroundCurrent 碰到（比如用户切走再切回来）时，
//     //   最上面的 guard 不会拦住它，会重新发起一次请求，而不是永远显示缓存里
//     //   的失败占位文案
//     record._detailLoaded = !isFailed;
//     record.title = detail.title || record.title;
//     record.fullText = detail.fullCleanText || record.fullText;
//     record.respText = detail.responsibilities || (isFailed ? detail.fullCleanText : t('respisNull'));
//     record.reqText = detail.requirements || (isFailed ? '' : t('reqisNull'));

//     // ⚡ 详情刚加载完成时，如果当前有生效的关键词过滤，需要重新跑一次过滤——
//     // 这条记录之前是按"标题/公司/地点"这些基础字段过滤的（见 applyFiltersAndRender
//     // 的说明），现在正文有了，可能应该被排除关键词命中、或者本来因为没命中
//     // 包含关键词而被排除的记录现在应该被纳入。只有真正拿到内容（非失败）才需要
//     // 重新过滤，失败占位文案不该参与关键词匹配。
//     const hasActiveFilter = state.filterConfig.excludeKeywords.trim() || state.filterConfig.includeKeywords.trim();
//     if (!isFailed && hasActiveFilter) {
//       applyFiltersAndRender();
//       return;
//     }

//     // 只有这条记录仍在可见范围（active/prev/next）才重渲染，避免无意义整卡片刷新
//     const visibleWindow = state.filteredDatalist.slice(Math.max(0, state.currentIndex - 1), state.currentIndex + 2);
//     if (visibleWindow.includes(record)) renderGalleryCards();
//   }

//   // ⚡ 代际计数器：每次"当前卡片"发生变化就自增，携带旧代际号的点击任务
//   // 一旦发现自己的代际号跟最新的对不上，就知道自己已经过期，可以提前放弃
//   // 排队/等待，而不是傻等完整个点击+观察周期才被发现"其实早就没用了"。
//   // 这是修"快速连续切卡时请求会堵塞"的关键——不只是"不再发起新的过时请求"，
//   // 而是"已经在进行中的过时请求也能提前让路"。
//   let activeGeneration = 0;

//   // ⚡ 防抖：切换频繁时，中途路过的卡片从一开始就不发起请求，而不是发起了
//   // 又靠 isStale() 很快中止。isStale 那套解决的是"已经在等的请求能不能
//   // 尽快让路"，这里解决的是更早一步的"要不要一开始就发起"——两者不冲突，
//   // 一起用效果更好：真正快速划过的卡片，完全不占用限频名额/请求开销。
//   const ENSURE_DETAILS_DEBOUNCE_MS = 400;
//   let ensureDetailsDebounceTimer = null;

//   function ensureDetailsAroundCurrent() {
//     // 代际号立刻自增，不防抖——这一步只是把"上一个还没写完的旧请求"标记
//     // 成过期，让它尽快通过 isStale() 检查提前放弃等待，晚了只会让旧请求
//     // 多占一会儿车道，没有任何好处。
//     activeGeneration++;
//     const myGeneration = activeGeneration;

//     if (ensureDetailsDebounceTimer) clearTimeout(ensureDetailsDebounceTimer);
//     ensureDetailsDebounceTimer = setTimeout(() => {
//       ensureDetailsDebounceTimer = null;
//       const list = state.filteredDatalist;
//       if (!list.length) return;
//       const cur = list[state.currentIndex];
//       // 只有真正在看的这张卡允许模拟点击，带上当前代际号
//       if (cur) ensureRecordDetail(cur, { allowClick: true, generation: myGeneration });
//       // 预取后面 PREFETCH_LOOKAHEAD 张：绝不模拟点击，只走被动缓存命中 + 主动
//       // fetch —— 见 ensureJobDetail 的策略顺序注释，这是修掉"current+2"这类
//       // 错位读取的关键改动。BOSS 这个数字比其它站点大很多，见上面常量定义。
//       // 预取任务不点击，不需要代际取消（runLane 里已经有基于位置的 stillRelevant
//       // 检查在做同样的事）。
//       // ⚡ 这个循环天然就是"滑动窗口"：ensureRecordDetail 内部一进来就检查
//       // record._detailLoaded，已经加载过的（比如上一次窗口就覆盖到了）
//       // 直接跳过，不会重复请求——正常翻页时窗口只往前挪一格，新进窗口的
//       // 只有最后那一张，实际每次只有1个新请求，不是重新请求整个窗口。
//       for (let i = 1; i <= PREFETCH_LOOKAHEAD; i++) {
//         const next = list[state.currentIndex + i];
//         if (next) ensureRecordDetail(next, { allowClick: false });
//       }
//     }, ENSURE_DETAILS_DEBOUNCE_MS);
//   }

//   async function runPipeline() {
//     mountGalleryToFilterBar();

//     const cardNodes = getTargetJobCards();
//     if (!cardNodes.length) return;

//     // 引擎侧卡片索引：requestDetail 通过 cardId 在这里查找 DOM 节点 + basicInfo
//     state.engineCards = cardNodes.map((node) => {
//       const cardId = resolveCardId(node);
//       const basicInfo = extractBasicInfo(node, cardId);
//       return { node, basicInfo, cardId };
//     });

//     let addedNew = false;
//     state.engineCards.forEach(({ node, basicInfo, cardId }) => {
//       if (processedJobIds.has(cardId)) return;
//       processedJobIds.add(cardId);
//       addedNew = true;

//       const linkEl = node.tagName === 'A' ? node : node.querySelector('a[href]');
//       let targetUrl = linkEl ? linkEl.href : (node.baseURI || '');
//       // ⚡ 修复"点击领英详情页打开的还是筛选页"：LinkedIn 卡片里抓到的 <a href>
//       // 通常是 /jobs/search/?currentJobId=xxx 这种"搜索页+选中态"的链接格式，
//       // 新开一个标签页打开时上下文（筛选条件/滚动位置）都不在，看起来就是一个
//       // 空的筛选页。LinkedIn 其实有一个真正独立的单职位详情页格式
//       // /jobs/view/{id}/，cardId 对 LinkedIn 来说就是这个数字 ID，直接拼出
//       // 干净的详情页链接，不依赖卡片里抓到的原始 href。
//       if (SITE === 'linkedin' && /^\d+$/.test(String(cardId))) {
//         targetUrl = `https://www.linkedin.com/jobs/view/${cardId}/`;
//       }

//       state.rawDatalist.push({
//         id: cardId,
//         title: basicInfo.title || '未知职位',
//         rawSalary: basicInfo.salary || t('salary'),
//         url: targetUrl,
//         rawNode: node,
//         location: basicInfo.location || '暂无地点',
//         company: basicInfo.company || '未知公司',
//         fullText: t('detaileloding'),
//         respText: t('detaileloding'),
//         reqText: t('detaileloding'),
//         _detailLoaded: false,
//         _detailLoading: false,
//         _detailLoadingClick: false,
//         _detailLoadingPrefetch: false
//       });
//     });

//     if (addedNew) applyFiltersAndRender();
//   }

//   function initObserver() {
//     let debounce = null;
//     const observer = new MutationObserver((mutations) => {
//       const isSelfMutation = mutations.every((m) => m.target.closest && m.target.closest('#jdp-gallery-wrapper'));
//       if (isSelfMutation) return;
//       clearTimeout(debounce);
//       debounce = setTimeout(() => runPipeline(), 300);
//     });
//     observer.observe(document.body, { childList: true, subtree: true });
//     window.__jdpObserver = observer;
//   }

//   function startSPAGuard() {
//     // 只在看板真的从 DOM 里消失时才重新挂载+抓取，不无条件每 tick 都跑——
//     // 这正是上次帮你定位的"universal_layout 正常 / test 不正常"那个 bug 的教训。
//     setInterval(() => {
//       const wrapper = document.getElementById('jdp-gallery-wrapper');
//       if (!wrapper || !document.body.contains(wrapper)) {
//         mountGalleryToFilterBar();
//         runPipeline();
//       }
//     }, 1500);
//   }

//   // =====================================================================
//   // UI 全局状态（来自 test.js；engineCards 是桥接层新增字段；
//   //   processedJobIds 复用引擎那份，不重复声明）
//   // =====================================================================
//   const state = {
//     rawDatalist: [],
//     filteredDatalist: [],
//     currentIndex: 0,
//     currentGroupStart: 0,   // 当前显示的这一组第一张卡片在 filteredDatalist 里的下标
//     pendingGroupJump: null, // 'end' = 一旦有新卡片入列，组起点自动跳到新数据处
//     engineCards: [],
//     filterConfig: {
//       excludeKeywords: '外包,996',
//       includeKeywords: '',
//       companyTypes: []
//     }
//   };
//   const GROUP_SIZE = 15;

//   // ==========================================
//   // UI 挂载与结构生成 (Gallery UI Builder) —— 来自 test.js，原样保留
//   // ==========================================
//   let galleryWrapperInstance = null;

//   function findFilterCandidates() {
//     const selector = [
//       '[role="toolbar"]', '[role="search"]', 'form',
//       '[class*="filter" i]', '[class*="condition" i]', '[class*="search-bar" i]', '[class*="select-bar" i]'
//     ].join(',');

//     let candidates = Array.from(document.querySelectorAll(selector));
//     if (candidates.length === 0) {
//       candidates = Array.from(document.querySelectorAll('div, section, nav')).filter((el) => {
//         const rect = el.getBoundingClientRect();
//         return rect.top >= 0 && rect.top <= 500 && rect.height > 20 && rect.height < 200;
//       });
//     }
//     return candidates;
//   }

//   function getFilterItems(node) {
//     if (!node) return [];
//     const nativeElements = Array.from(node.querySelectorAll('button, select, input, [role="button"], [role="radio"]'));
//     const customDivItems = Array.from(node.querySelectorAll('div, span, a')).filter((child) => {
//       const text = child.innerText ? child.innerText.trim() : '';
//       if (!text || text.length > 10) return false;
//       const hasIcon = child.querySelector('svg, i, em, [class*="icon" i], [class*="arrow" i], [class*="caret" i]');
//       const hasActionAttr = child.hasAttribute('ka') || child.hasAttribute('data-event') || child.onclick;
//       const className = (child.className || '').toString().toLowerCase();
//       const hasItemClass = ['label', 'item', 'option', 'btn', 'select', 'active'].some((cls) => className.includes(cls));
//       return hasIcon || hasActionAttr || hasItemClass;
//     });
//     return Array.from(new Set([...nativeElements, ...customDivItems]));
//   }

//   function findBestFilterBar() {
//     const candidates = findFilterCandidates();
//     if (!candidates || candidates.length === 0) return null;

//     const scoredList = candidates.map((node) => {
//       let score = 0;
//       const text = (node.innerText || '').toLowerCase();
//       const rect = node.getBoundingClientRect();
//       if (rect.width === 0 || rect.height === 0 || rect.height > 400) return { node, score: -999 };

//       if (node.getAttribute('role') === 'toolbar') score += 50;
//       if (node.getAttribute('role') === 'search') score += 30;
//       const className = (node.className || '').toString().toLowerCase();
//       if (className.includes('filter')) score += 25;
//       if (className.includes('condition')) score += 25;

//       const items = getFilterItems(node);
//       score += items.length * 8;

//       const keywords = ['城市', '经验', '学历', '薪资', '公司', '规模', '行业', 'filter', 'salary', 'experience'];
//       keywords.forEach((kw) => { if (text.includes(kw)) score += 6; });

//       if (rect.top >= 0 && rect.top <= 450) score += 20;
//       if (text.length > 600) score -= 40;
//       return { node, score };
//     });

//     scoredList.sort((a, b) => b.score - a.score);
//     return scoredList[0] && scoredList[0].score >= 20 ? scoredList[0].node : null;
//   }

//   function getOrCreateGalleryWrapper(filterConfig = { excludeKeywords: '', includeKeywords: '', companyTypes: [] }) {
//     if (galleryWrapperInstance) return galleryWrapperInstance;

//     const wrapper = document.createElement('div');
//     wrapper.id = 'jdp-gallery-wrapper';
//     wrapper.style.cssText = `
//       width: 100% !important; max-width: 1200px !important; clear: both !important;
//       margin: 12px auto 20px auto !important; box-sizing: border-box !important;
//       display: block !important; position: relative !important; float: none !important;
//       z-index: 99 !important;
//     `;

//     wrapper.innerHTML = `
//       <style>
//         #jdp-gallery-box {
//           width: 100%; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px;
//           padding: 16px 20px; box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
//           box-shadow: 0 4px 20px rgba(0,0,0,0.03); overflow: hidden; position: relative;
//           transition: all 0.3s ease;
//         }
//         .jdp-header { display: flex; justify-content: space-between; align-items: center; }
//         .jdp-title { font-size: 15px; font-weight: bold; color: #0f172a; display: flex; align-items: center; gap: 8px; }
//         .jdp-header-actions { display: flex; align-items: center; gap: 8px; }
//         .jdp-btn {
//           padding: 5px 10px; border-radius: 8px; font-size: 12px; font-weight: 600;
//           cursor: pointer; border: 1px solid #cbd5e1; background: #ffffff; color: #334155;
//           transition: all 0.2s ease; display: inline-flex; align-items: center; gap: 4px; user-select: none;
//         }
//         .jdp-btn:hover { background: #2563eb; color: #ffffff; border-color: #2563eb; }
//         .jdp-btn-active { background: #eff6ff; border-color: #3b82f6; color: #2563eb; }

//         #jdp-filter-panel {
//           background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px;
//           padding: 12px 16px; margin-top: 12px; display: none; flex-direction: column; gap: 10px;
//         }
//         #jdp-filter-panel.show { display: flex; }
//         .jdp-filter-row { display: flex; align-items: center; gap: 10px; font-size: 12px; color: #334155; }
//         .jdp-filter-label { font-weight: bold; width: 80px; flex-shrink: 0; color: #475569; }
//         .jdp-input {
//           flex: 1; padding: 5px 8px; border: 1px solid #cbd5e1; border-radius: 6px;
//           font-size: 12px; outline: none; transition: border-color 0.2s;
//         }
//         .jdp-input:focus { border-color: #2563eb; }
//         .jdp-checkbox-group { display: flex; gap: 10px; align-items: center; }
//         .jdp-checkbox-label { display: flex; align-items: center; gap: 4px; cursor: pointer; user-select: none; }

//         .jdp-card-stage {
//           /* ⚡ 修复"卡片超出看不见"：.jdp-card 是 absolute 定位，不会撑大这里的
//              自动高度；.jdp-card 现在 max-height 到 640px，这里的 min-height
//              必须真正大于等于"卡片高度 + top 偏移"，否则会被外层 #jdp-gallery-box
//              的 overflow:hidden 从底部裁掉。 */
//           width: 100%; min-height: 680px; position: relative;
//           display: flex; align-items: flex-start; justify-content: center;
//           padding-top: 10px; margin-top: 12px; box-sizing: border-box; transition: all 0.3s ease;
//           cursor: grab; touch-action: pan-y; /* 允许纵向滚动，横向交给拖拽手势 */
//         }
//         .jdp-card-stage.dragging { cursor: grabbing; }
//         .jdp-card-stage.dragging .jdp-card { transition: none; } /* 拖拽过程中关掉过渡动画，跟手 */
//         #jdp-gallery-box.is-folded .jdp-card-stage {
//           height: 0 !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; overflow: hidden; opacity: 0; pointer-events: none;
//         }

//         .jdp-arrow {
//           position: absolute; top: 220px; transform: translateY(-50%); z-index: 50;
//           width: 44px; height: 44px; background: #ffffff; border: 1px solid #e2e8f0;
//           border-radius: 50%; display: flex; align-items: center; justify-content: center;
//           font-size: 18px; color: #475569; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.08);
//           transition: all 0.2s ease; user-select: none;
//         }
//         .jdp-arrow:hover { background: #2563eb; color: #fff; border-color: #2563eb; transform: translateY(-50%) scale(1.1); }
//         .jdp-arrow.left { left: 10px; }
//         .jdp-arrow.right { right: 10px; }

//         /* ------- 卡片尺寸/结构参照 content_backend.js 的设计 ------- */
//         .jdp-card {
//           position: absolute; width: 680px; background: #ffffff; top: 10px;
//           border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; box-sizing: border-box;
//           display: flex; flex-direction: column; justify-content: space-between;
//           cursor: pointer; transition: all 0.45s cubic-bezier(0.25, 1, 0.5, 1);
//           box-shadow: 0 4px 12px rgba(0,0,0,0.03); pointer-events: auto;
//           /* ⚡ 修复"文字太多卡片显示不全"：卡片本身要有高度上限 + overflow:hidden，
//              下面 .jdp-card-body 的 overflow-y:auto 才有约束边界能真正生效滚动，
//              否则父级没有高度限制，子级的 flex:1 + overflow-y:auto 形同虚设，
//              卡片会无限撑高、内容被裁切或溢出。 */
//           max-height: 1000px; overflow: hidden;
//         }
//         .jdp-card.active {
//           transform: translateX(0) scale(1); z-index: 30; opacity: 1;
//           border-color: #93c5fd; box-shadow: 0 20px 35px -10px rgba(37, 99, 235, 0.15), 0 8px 15px -6px rgba(0,0,0,0.05);
//         }
//         .jdp-card.prev { transform: translateX(-360px) scale(0.82); z-index: 20; opacity: 0.5; max-height: 400px; overflow: hidden; }
//         .jdp-card.next { transform: translateX(360px) scale(0.82); z-index: 20; opacity: 0.5; max-height: 400px; overflow: hidden; }
//         .jdp-card.hidden-left { transform: translateX(-580px) scale(0.6); z-index: 10; opacity: 0; pointer-events: none; }
//         .jdp-card.hidden-right { transform: translateX(580px) scale(0.6); z-index: 10; opacity: 0; pointer-events: none; }

//         .jdp-card-header {
//           border-bottom: 1px solid #f1f5f9; padding-bottom: 12px; margin-bottom: 14px;
//           display: flex; justify-content: space-between; align-items: flex-start;
//         }
//         .jdp-card-title { font-size: 18px; font-weight: bold; color: #0f172a; line-height: 1.3; }
//         .jdp-card-salary { font-size: 20px; font-weight: bold; color: #ef4444; margin-top: 4px; }

//         /* 职责/要求两个区块常驻显示（不再是可展开的抽屉），参照 content_backend.js
//            的 .jdp-section 设计；这里改名成 .jdp-card-section* 避免跟深度报告
//            弹窗里同名的 .jdp-section（技能碰撞/AI诊断那部分）撞车 */
//         .jdp-card-body {
//           display: flex; flex-direction: column; gap: 14px; margin-bottom: 14px; overflow-y: auto; flex: 1;
//           /* ⚡ 修复"职责/要求超出卡片"：flex 子项默认 min-height:auto，
//              意味着它拒绝收缩到比自身内容更小，overflow-y:auto 就永远不会真正
//              生效——内容只会把卡片撑高，被外层 .jdp-card 的 overflow:hidden
//              直接裁掉，而不是产生滚动条。必须显式设 min-height:0 才能让
//              flex 子项真正被压缩到父级剩余空间内，滚动条才会出现。 */
//           min-height: 0;
//         }
//         .jdp-card-section { background: #f8fafc; padding: 14px; border-radius: 10px; border-left: 4px solid #2563eb; max-height:260px;overflow-y:hidden}
//         .jdp-card-section.req { border-left-color: #10b981; }
//         .jdp-card-section-label { font-size: 13px; font-weight: bold; color: #475569; margin-bottom: 8px; }
//         .jdp-card-section-content {
//           font-size: 13px; line-height: 1.6; color: #334155; white-space: pre-line; word-break: break-all;
//           /* 每个区块单独限高+独立滚动，避免"职责"特别长的时候把"要求"完全挤出
//              可视范围之外——用户至少能同时看到两个区块的标题和一部分内容 */
//           max-height: 220px; overflow-y: auto;
//         }
//         .jdp-card-footer { font-size: 11px; color: #94a3b8; text-align: center; padding-top: 8px; border-top: 1px dashed #e2e8f0; }
//         .jdp-empty-tips { padding: 60px 0; text-align: center; color: #64748b; font-size: 14px; }

//         .linkedin-fast-highlight {
//           outline: 3px solid #2563eb !important; box-shadow: 0 0 15px rgba(37, 99, 235, 0.6) !important; transition: all 0.3s ease;
//         }

//         /* ------- 整合时补充：动作按钮 / 深度报告弹窗（原先渲染出来但没样式/没绑定） ------- */
//         .jdp-btn-group { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
//         .jdp-action-btn {
//           padding: 4px 10px; background: #10b981; color: #fff; border-radius: 6px;
//           font-size: 11px; font-weight: bold; border: none; cursor: pointer; transition: all 0.2s ease;
//         }
//         .jdp-action-btn:hover { background: #059669; }
//         .jdp-open-link-btn {
//           padding: 4px 10px; background: #2563eb; color: #fff; border-radius: 6px;
//           font-size: 11px; font-weight: bold; border: none; cursor: pointer; transition: all 0.2s ease;
//         }
//         .jdp-open-link-btn:hover { background: #1d4ed8; }
//         .jdp-refresh-btn {
//           padding: 4px 8px; background: #f1f5f9; color: #475569; border-radius: 6px;
//           font-size: 12px; font-weight: bold; border: 1px solid #cbd5e1; cursor: pointer; transition: all 0.2s ease;
//         }
//         .jdp-refresh-btn:hover { background: #e2e8f0; }
//         .jdp-refresh-btn.spinning { animation: jdp-spin 0.8s linear infinite; pointer-events: none; opacity: 0.6; }
//         .jdp-card-match {
//           padding: 4px 10px; border-radius: 8px; cursor: pointer; font-size: 11px;
//           border: 1px solid #cbd5e1; background: #f8fafc; transition: all 0.2s ease; text-align: center;
//         }
//         .jdp-card-match:hover { transform: translateY(-1px); box-shadow: 0 4px 10px rgba(0,0,0,0.08); }
//         .pulse-animation { animation: jdp-pulse 1.4s ease-in-out infinite; }
//         @keyframes jdp-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

//         .jdp-modal-backdrop {
//           position: fixed; inset: 0; background: rgba(15, 23, 42, 0.55); z-index: 999999;
//           display: flex; align-items: center; justify-content: center;
//           font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
//         }
//         .jdp-modal-content {
//           width: 560px; max-width: 92vw; max-height: 82vh; background: #fff; border-radius: 16px;
//           overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,0.3);
//         }
//         .jdp-modal-header { padding: 16px 20px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
//         .jdp-modal-header h3 { margin: 0; font-size: 16px; color: #0f172a; }
//         .jdp-modal-header .subtitle { margin: 4px 0 0; font-size: 12px; color: #64748b; }
//         .jdp-modal-close { background: transparent; border: none; font-size: 22px; color: #94a3b8; cursor: pointer; line-height: 1; }
//         .jdp-modal-close:hover { color: #334155; }
//         .jdp-modal-body { padding: 16px 20px; overflow-y: auto; flex: 1; }
//         .jdp-modal-footer { padding: 12px 20px; border-top: 1px solid #e2e8f0; display: flex; justify-content: flex-end; }
//         .jdp-btn-primary { background: #2563eb; color: #fff; border: none; padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; }
//         .jdp-btn-primary:hover { background: #1d4ed8; }
//         .jdp-btn-secondary { background: #fff; color: #334155; border: 1px solid #cbd5e1; padding: 6px 12px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; }
//         .jdp-btn-secondary:hover { background: #f1f5f9; }
//         .jdp-spinner { width: 34px; height: 34px; border: 3px solid #e2e8f0; border-top-color: #2563eb; border-radius: 50%; animation: jdp-spin 0.8s linear infinite; }
//         @keyframes jdp-spin { to { transform: rotate(360deg); } }
//         .jdp-hero-card { display: flex; align-items: center; gap: 16px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; }
//         .score-circle { width: 64px; height: 64px; border-radius: 50%; background: #2563eb; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; flex-shrink: 0; }
//         .score-circle .score-val { font-size: 20px; font-weight: bold; line-height: 1; }
//         .score-circle .score-unit { font-size: 10px; opacity: 0.85; }
//         .score-meta h4 { margin: 0 0 4px; font-size: 14px; color: #0f172a; }
//         .quota-badge { font-size: 11px; color: #64748b; }
//         .jdp-alert-box { margin-top: 10px; padding: 10px 12px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; font-size: 12px; color: #92400e; }
//         .jdp-grid-subscores { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 14px; }
//         .subscore-card { background: #f8fafc; border-radius: 8px; padding: 8px; text-align: center; border: 1px solid #e2e8f0; }
//         .subscore-card .title { display: block; font-size: 10px; color: #64748b; margin-bottom: 4px; }
//         .subscore-card .score { display: block; font-size: 14px; font-weight: bold; color: #0f172a; }
//         .jdp-section { margin-top: 16px; }
//         .jdp-section .sec-title { font-size: 13px; font-weight: bold; color: #1e293b; margin: 0 0 8px; }
//         .jdp-tags-wrapper { display: flex; flex-wrap: wrap; gap: 6px; }
//         .jdp-tag { font-size: 11px; padding: 3px 8px; border-radius: 999px; }
//         .jdp-tag.tag-success { background: #ecfdf5; color: #059669; }
//         .jdp-tag.tag-danger { background: #fef2f2; color: #b91c1c; }
//         .text-muted { font-size: 12px; color: #94a3b8; }
//         .insight-item { margin-bottom: 10px; }
//         .insight-label { display: block; font-size: 12px; font-weight: bold; margin-bottom: 4px; }
//         .insight-label.text-green { color: #059669; }
//         .insight-label.text-orange { color: #b45309; }
//         .insight-label.text-blue { color: #2563eb; }
//         .insight-item ul { margin: 0; padding-left: 18px; font-size: 12px; color: #334155; line-height: 1.6; }
//         .jdp-error-box h4 { margin: 0 0 8px; }
//       </style>

//        <div id="jdp-gallery-box">
//       <div class="jdp-header">
//         <div class="jdp-title">🎴 ${t('panelTitle')}</div>
//         <div class="jdp-header-actions">
//           <button class="jdp-btn" id="jdp-btn-toggle-filter">${t('toggleFilter')}</button>
// <button class="jdp-btn" id="jdp-group-prev">${t('groupPrev')}</button>
// <span style="font-size:13px; color:#64748b; font-weight:bold;" id="jdp-counter">0 / 0</span>
// <button class="jdp-btn" id="jdp-group-next">${t('groupNext')}</button>
// <button class="jdp-btn jdp-btn-active" id="jdp-btn-toggle-fold">${t('toggleFoldCollapse')}</button>
//         </div>
//       </div>

//       <div id="jdp-filter-panel">
//         <div class="jdp-filter-row">
//           <span class="jdp-filter-label">🚫 ${t('filterExcludeLabel')}</span>
//           <input type="text" class="jdp-input" id="jdp-filter-exclude" placeholder="${t('filterExcludePlaceholder')}" value="${filterConfig.excludeKeywords}">
//         </div>
        
//         <div class="jdp-filter-row">
//           <span class="jdp-filter-label">🎯${t('filterIncludeLabel')}</span>
//           <input type="text" class="jdp-input" id="jdp-filter-include" placeholder="${t('filterIncludePlaceholder')}" value="${filterConfig.includeKeywords}">
//         </div>

//         <div class="jdp-filter-row">
//           <span class="jdp-filter-label">🏢 ${t('filterCompanyTypeLabel')}</span>
//           <div class="jdp-checkbox-group">
//             ${t('companyTypes').map(type => `
//               <label class="jdp-checkbox-label">
//                 <input type="checkbox" class="jdp-filter-type" value="${type}" ${filterConfig.companyTypes.includes(type) ? 'checked' : ''}>
//                 ${type}
//               </label>
//             `).join('')}
//           </div>
//         </div>
//       </div>

//       <div class="jdp-card-stage" id="jdp-stage">
//         <div class="jdp-arrow left" id="jdp-btn-left">❮</div>
//         <div class="jdp-arrow right" id="jdp-btn-right">❯</div>
//         <div id="jdp-cards-container" style="width:100%; display:flex; justify-content:center;"></div>
//       </div>
//     </div>
//     `;

//     const foldBtn0 = wrapper.querySelector('#jdp-btn-toggle-fold');
//     const galleryBox0 = wrapper.querySelector('#jdp-gallery-box');
//     foldBtn0.onclick = () => {
//       const isFolded = galleryBox0.classList.toggle('is-folded');
//       foldBtn0.innerText = isFolded ? t("toggleFoldExpand"):t("toggleFoldCollapse");
//       foldBtn0.classList.toggle('jdp-btn-active', !isFolded);
//     };

//     galleryWrapperInstance = wrapper;
//     bindUIEvents(wrapper);
//     return galleryWrapperInstance;
//   }

//   function bindUIEvents(wrapper) {
//     const toggleFilterBtn = wrapper.querySelector('#jdp-btn-toggle-filter');
//     const filterPanel = wrapper.querySelector('#jdp-filter-panel');

//     toggleFilterBtn.onclick = () => {
//       filterPanel.classList.toggle('show');
//       toggleFilterBtn.classList.toggle('jdp-btn-active');
//     };

//     // ⚡ 头部"上一组/下一组"：组级翻页（见下方 switchGroup）——
//     //    LinkedIn 这类真分页站点会去点站点自己的翻页按钮；BOSS 这类滚动加载站点
//     //    在本地已抓取数据里按 15 条一组跳，不够一组就顺带触发滚动懒加载。
//     wrapper.querySelector('#jdp-group-prev').onclick = () => switchGroup('prev');
//     wrapper.querySelector('#jdp-group-next').onclick = () => switchGroup('next');
//     // 舞台两侧的小箭头：保留逐条单步浏览（点击触发，不是滚轮），方便在同一组内查看其他卡片
//     wrapper.querySelector('#jdp-btn-left').onclick = () => switchCardIndex(state.currentIndex - 1);
//     wrapper.querySelector('#jdp-btn-right').onclick = () => switchCardIndex(state.currentIndex + 1);

//     const excludeInput = wrapper.querySelector('#jdp-filter-exclude');
//     const includeInput = wrapper.querySelector('#jdp-filter-include');
//     const handleFilterChange = () => {
//       state.filterConfig.excludeKeywords = excludeInput.value.trim();
//       state.filterConfig.includeKeywords = includeInput.value.trim();
//       applyFiltersAndRender();
//     };
//     excludeInput.oninput = handleFilterChange;
//     includeInput.oninput = handleFilterChange;
//     // ⚡ 按要求去掉了滚轮切卡片——原来这里有个 wrapper.addEventListener('wheel', ...)，
//     //    直接删掉，滚轮滚动现在就是正常的页面滚动，不会被拦截。

//     bindCardSwipeGesture(wrapper);
//   }

//   // ⚡ 卡片加滑动：在舞台区域支持横向拖拽/触摸滑动切卡，不用非得点箭头。
//   // 用 Pointer Events 统一处理鼠标拖拽和触摸滑动。拖动距离超过阈值才判定为
//   // 一次"滑动切换"，没超过阈值就当作普通点击放行——用 state._justDragged
//   // 这个短暂标记告诉卡片自己的 onclick 处理器"这是一次拖拽的尾巴，别当点击处理"。
//   function bindCardSwipeGesture(wrapper) {
//     const stage = wrapper.querySelector('#jdp-stage');
//     if (!stage) return;
//     const DRAG_THRESHOLD = 60;
//     let isDragging = false;
//     let startX = 0;
//     let startY = 0;
//     let dragDistance = 0;

//     stage.addEventListener('pointerdown', (e) => {
//       if (e.button !== undefined && e.button !== 0) return; // 只响应左键/触摸
//       isDragging = true;
//       dragDistance = 0;
//       startX = e.clientX;
//       startY = e.clientY;
//       stage.classList.add('dragging');
//     });

//     stage.addEventListener('pointermove', (e) => {
//       if (!isDragging) return;
//       const dx = e.clientX - startX;
//       const dy = e.clientY - startY;
//       if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) e.preventDefault(); // 横向拖动时阻止页面滚动
//       dragDistance = dx;
//     }, { passive: false });

//     const endDrag = () => {
//       if (!isDragging) return;
//       isDragging = false;
//       stage.classList.remove('dragging');
//       if (Math.abs(dragDistance) > DRAG_THRESHOLD) {
//         if (dragDistance < 0) switchCardIndex(state.currentIndex + 1);
//         else switchCardIndex(state.currentIndex - 1);
//         state._justDragged = true;
//         setTimeout(() => { state._justDragged = false; }, 80);
//       }
//       dragDistance = 0;
//     };
//     window.addEventListener('pointerup', endDrag);
//     window.addEventListener('pointercancel', endDrag);
//   }

//   function mountGalleryToFilterBar() {
//     // ⚡ 关键修复：如果看板已经挂载好且还在 DOM 里，直接跳过，不重新跑
//     //    findBestFilterBar()/隐藏 toolbar 这套逻辑。
//     //    之前 initObserver 里每次 DOM 变化(防抖 300ms)都会调用 runPipeline()，
//     //    而 runPipeline() 开头就是 mountGalleryToFilterBar()——LinkedIn 是重度
//     //    SPA，DOM 变化极其频繁，这导致每 300ms 就重新查一次 toolbar 节点、
//     //    重新对（可能是新引用的）toolbar 设置 display:none，看板也跟着被反复
//     //    detach/insert，就是"领英显示不正常"的根因。这里加一个前置短路即可
//     //    一次性堵住所有调用方（startSPAGuard 的定时器、initObserver 的 mutation
//     //    回调），不用逐个改调用点。
//     const existing = document.getElementById('jdp-gallery-wrapper');
//     if (existing && document.body.contains(existing)) return true;

//     if (!window.location.href.includes('/jobs')) {
//       console.warn('⚠️ 当前非筛选页面，跳过提取');
//       return false;
//     }
//     const toolbar = findBestFilterBar();
//     if (!toolbar) return false;

//     if (window.location.href.includes('linkedin.com')) {
//       toolbar.style.setProperty('display', 'none', 'important');
//     }
     

//     const wrapper = getOrCreateGalleryWrapper();
//     if (toolbar.nextElementSibling !== wrapper) {
//       if (window.location.href.includes('www.zhaopin.com')) {
//       // toolbar.style.setProperty('display', 'none', 'important');
//       const listcontainer=document.querySelector('.job-list-container, .jobs-split-page__content');
//       listcontainer.prepend(wrapper);
//     }else{
//       toolbar.insertAdjacentElement('afterend', wrapper);
    
//       console.log('💥 [JDP Gallery] 看板已挂载并锁定显示区域！');
//     }
      
//     }
//     return true;
//   }

//   // ==========================================
//   // UI 渲染与数据绑定引擎 (Gallery Renderer) —— 来自 test.js，修了几处绑定 bug
//   // ==========================================
//   function applyFiltersAndRender() {
//     const { excludeKeywords, includeKeywords, companyTypes } = state.filterConfig;
//     const excludes = excludeKeywords.split(/[,，]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
//     const includes = includeKeywords.split(/[,，]/).map((s) => s.trim().toLowerCase()).filter(Boolean);

//     // ⚡ 记住重新过滤前正在看的是哪条记录（按对象引用，不是按下标）——
//     // 详情异步加载完成后会重新触发一次过滤（见下面 ensureRecordDetail 的改动），
//     // 如果列表因为过滤结果变化而重新排列，只按下标保持 currentIndex 会导致
//     // 用户正在看的卡片被悄悄换成别的职位。这里过滤完之后优先找回同一条记录。
//     const currentRecord = state.filteredDatalist[state.currentIndex];

//     state.filteredDatalist = state.rawDatalist.filter((item) => {
//       // ⚡ 修复"数据未加载出来时按正文过滤不准确"：详情还没加载完的卡片，
//       // fullText 还是"⏳ 详情获取中..."这种占位文案，拿它去匹配关键词只会
//       // 产生两种错误的结果——包含关键词的过滤会把还没加载完的职位直接排除掉
//       // （即使它真实内容其实符合条件，永远没机会被展示、也就永远没机会真正
//       // 加载详情，等于死锁）；排除关键词则会让本该被排除的职位在加载完之前
//       // 一直混在列表里。所以详情没加载完之前，只用标题/公司/地点这些立刻能拿
//       // 到的字段过滤，不牵扯占位文案；等详情真正加载完，ensureRecordDetail
//       // 会重新触发一次过滤，到时候这条记录会被正确地重新纳入判断。
//       const basicContent = `${item.title} ${item.company} ${item.location}`.toLowerCase();
//       const fullContent = item._detailLoaded ? `${basicContent} ${item.fullText}`.toLowerCase() : basicContent;
//       if (excludes.some((kw) => fullContent.includes(kw))) return false;
//       if (includes.length > 0 && !includes.every((kw) => fullContent.includes(kw))) return false;
//       if (companyTypes && companyTypes.length > 0 && !companyTypes.some((type) => fullContent.includes(type.toLowerCase()))) return false;
//       return true;
//     });

//     if (state.pendingGroupJump === 'end') {
//       // 上一次点了"下一组"但本地数据不够/需要等真实翻页加载出新内容，
//       // 现在新数据到了，跳到新数据所在的那一组
//       state.pendingGroupJump = null;
//       state.currentGroupStart = Math.max(0, state.filteredDatalist.length - GROUP_SIZE);
//       state.currentIndex = state.currentGroupStart;
//     } else if (currentRecord && state.filteredDatalist.includes(currentRecord)) {
//       // 之前正在看的这条记录还在，跟着它走，位置不因为过滤结果变化而跳动
//       state.currentIndex = state.filteredDatalist.indexOf(currentRecord);
//     } else if (state.currentIndex >= state.filteredDatalist.length) {
//       state.currentIndex = 0;
//       state.currentGroupStart = 0;
//     }
//     renderGalleryCards();
//     ensureDetailsAroundCurrent();
//   }

//   function switchCardIndex(targetIndex) {
//     if (state.filteredDatalist.length === 0) return;
//     if (targetIndex < 0) targetIndex = state.filteredDatalist.length - 1;
//     if (targetIndex >= state.filteredDatalist.length) targetIndex = 0;

//     state.currentIndex = targetIndex;
//     renderGalleryCards();
//     ensureDetailsAroundCurrent();
//   }

//   // ⚡ 组级翻页：优先去点站点自己的翻页按钮（LinkedIn 这类），点不到就退回到
//   //    在本地已抓取数据里按 GROUP_SIZE(15) 条跳一组（BOSS 这类滚动加载列表）。
//   function switchGroup(direction) {
//     const clickedRealButton = findAndClickPaginationBtn(direction);
//     if (clickedRealButton) {
//       if (direction === 'next') {
//         // 真实翻页按钮点了，新一页数据会经 runPipeline 自动进来，
//         // 到时候 applyFiltersAndRender 的 pendingGroupJump 逻辑会自动跳过去
//         state.pendingGroupJump = 'end';
//       } else {
//         state.currentGroupStart = Math.max(0, state.currentGroupStart - GROUP_SIZE);
//         state.currentIndex = state.currentGroupStart;
//         renderGalleryCards();
//         ensureDetailsAroundCurrent();
//       }
//       return;
//     }

//     if (direction === 'next') {
//       const nextStart = state.currentGroupStart + GROUP_SIZE;
//       if (nextStart < state.filteredDatalist.length) {
//         state.currentGroupStart = nextStart;
//         state.currentIndex = nextStart;
//         renderGalleryCards();
//         ensureDetailsAroundCurrent();
//       } else {
//         // 本地数据不够凑够下一组，滚动触发站点自己的懒加载，等新卡片进来后自动跳过去
//         state.pendingGroupJump = 'end';
//         triggerLazyLoadScroll();
//       }
//     } else {
//       state.currentGroupStart = Math.max(0, state.currentGroupStart - GROUP_SIZE);
//       state.currentIndex = state.currentGroupStart;
//       renderGalleryCards();
//       ensureDetailsAroundCurrent();
//     }
//   }

//   function triggerLazyLoadScroll() {
//     const lastItem = state.filteredDatalist[state.filteredDatalist.length - 1];
//     if (lastItem && lastItem.rawNode) {
//     //   lastItem.rawNode.scrollIntoView({ behavior: 'smooth', block: 'end' });
//     } else {
//       window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
//     }
//   }

//   // 找站点自己的翻页按钮并点击（LinkedIn 的"下一页"等）。找不到返回 false，
//   // 调用方据此判断要不要退回本地分组逻辑。
//   function findAndClickPaginationBtn(direction) {
//     const isNext = direction === 'next';
//     const attrSelector = isNext
//       ? '[aria-label*="next" i], [aria-label*="下一页" i], [title*="下一页" i], [title*="next" i], .btn-next, .pagination-next, .next-page, .pager-next'
//       : '[aria-label*="prev" i], [aria-label*="上一页" i], [title*="上一页" i], [title*="prev" i], .btn-prev, .pagination-prev, .prev-page, .pager-prev';

//     let target = document.querySelector(attrSelector);
//     if (!target) {
//       const candidates = Array.from(document.querySelectorAll('button, li, a, div[role="button"]'));
//       target = candidates.find((el) => {
//         if (el.closest && el.closest('#jdp-gallery-wrapper')) return false; // 排除我们自己的按钮
//         const html = el.innerHTML.toLowerCase();
//         const txt = (el.innerText || '').trim().toLowerCase();
//         const textMatched = isNext ? /^(下一页|>|›|next)$/.test(txt) : /^(上一页|<|‹|prev)$/.test(txt);
//         if (textMatched) return true;
//         return isNext
//           ? (html.includes('arrow-right') || html.includes('chevron-right') || html.includes('right-icon') || html.includes('icon-next'))
//           : (html.includes('arrow-left') || html.includes('chevron-left') || html.includes('left-icon') || html.includes('icon-prev'));
//       });
//     }
//     if (target && !(target.closest && target.closest('#jdp-gallery-wrapper'))) {
//       target.click();
//       return true;
//     }
//     return false;
//   }



//   // ⚡ "只改变数据结果而不是整个UI"：以前 renderGalleryCards 每次调用都会
//   // container.innerHTML='' 再把 state.filteredDatalist 全量重建成 DOM——
//   // BOSS 这种 25+ 条的列表，实际可见的最多 3 张（prev/active/next），
//   // 其余 20 多张 hidden-left/hidden-right 卡片是完全不可见的，但每次任何数据
//   // 变化（切卡、后台加载完成、筛选变化）都要把这 25 张全部拆掉重建一遍——
//   // 这是真实的性能浪费，也是卡顿感的一部分来源。
//   // 现在只渲染 currentIndex 前后各 1 张（最多 3 个 DOM 节点），用 Map 记住
//   // "这个 item.id 对应哪个 cardEl"：还在窗口内的卡片只做局部内容更新（换
//   // class、更新文字），不重建 DOM 结构、不重新绑定事件；只有真正进入/离开
//   // 可见窗口的卡片才创建/移除 DOM 节点。
//   const renderedCardElements = new Map(); // item.id -> cardEl

//   function buildCardElement(item) {
//     const cardEl = document.createElement('div');
//     cardEl.dataset.jobId = item.id;
//     // const hasResp = Boolean(item.respText==="⏳ 详情获取中..." );
//     // const hasReq = Boolean(item.reqText==="⏳ 详情获取中...");
//     // console.log(hasResp,item.respText)
//     // console.log(hasReq,item.reqText)

//     cardEl.innerHTML = `
    
//       <div>
//         <div class="jdp-card-header">
//           <div>
//             <div class="jdp-card-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
//             <div class="jdp-card-meta" style="font-size:12px; color:#64748b; margin-top:4px;">🏢 ${escapeHtml(item.company)} · 📍 ${escapeHtml(item.location)}</div>
//             <div class="jdp-card-salary">${escapeHtml(item.rawSalary)}</div>
//           </div>
//           <div class="jdp-btn-group">
//             <div class="jdp-card-match loading-state" data-job-id="${item.id}" title="${t('matchResumeing')}">
//               <span class="score-text pulse-animation">${t('evaluating')}</span>
//             </div>
//             <button type="button" class="jdp-action-btn">${t('actionApply')}</button>
//             <button type="button" class="jdp-open-link-btn">${t('actionOpenLink')}</button>
//             <button type="button" class="jdp-refresh-btn" title="${t('refreshTitle')}">🔄</button>
//           </div>
//         </div>
//       <div class="jdp-card-body">
//         <div class="jdp-card-section" >
//           <div class="jdp-card-section-label">${t('sectionResp')} (Responsibilities)</div>
//           <div class="jdp-card-section-content jdp-resp-box">${escapeHtml(item.respText?.trim())}</div>
//         </div>
//         <div class="jdp-card-section req" >
//           <div class="jdp-card-section-label">${t('sectionReq')}</div>
//           <div class="jdp-card-section-content jdp-req-box">${escapeHtml(item.reqText?.trim())}</div>
//         </div>
//         <!-- 保留完整文本供深度报告兜底拼接用，不在卡片上占视觉空间 -->
//         <div class="job-detail-text" style="display:none;">${escapeHtml(item.fullText)}</div>
//       </div>

        
//       </div>

//       <div class="jdp-card-footer">
//         <span>${t('showlabel')}</span>
//       </div>
//     `;

//     // ⚡ 事件绑定只在创建时做一次；这些卡片会被后续的 updateCardElementContent
//     // 反复复用，所以处理函数一律通过 cardEl.dataset.jobId 现查 state.rawDatalist
//     // 拿最新的 item/idx，不能闭包捕获（闭包捕获的话，卡片被复用给同一个 id
//     // 但列表位置/内容更新后，闭包里的旧值就会跟界面实际状态脱节）。
//     const actBtn = cardEl.querySelector('.jdp-action-btn');
//     actBtn.onclick = (e) => {
//       e.stopPropagation();
//       const curItem = state.rawDatalist.find((r) => r.id === cardEl.dataset.jobId);
//       if (!curItem) return;
//       const triggered = triggerNativeActionBtn(curItem.rawNode);
//       if (!triggered && curItem.url) window.open(curItem.url, '_blank');
//     };

//     const linkBtn = cardEl.querySelector('.jdp-open-link-btn');
//     linkBtn.onclick = (e) => {
//       e.stopPropagation();
//       const curItem = state.rawDatalist.find((r) => r.id === cardEl.dataset.jobId);
//       if (curItem && curItem.url) window.open(curItem.url, '_blank');
//     };

//     const refreshBtn = cardEl.querySelector('.jdp-refresh-btn');
//     refreshBtn.onclick = async (e) => {
//       e.stopPropagation();
//       const curItem = state.rawDatalist.find((r) => r.id === cardEl.dataset.jobId);
//       if (!curItem) return;
//       refreshBtn.classList.add('spinning');
//       detailCache.delete(String(curItem.id));
//       // ⚡ 也把"点击风险名单"里的这张卡摘掉：用户主动点刷新，说明他愿意再试一次
//       // 真实点击。不摘的话 'click' 策略会一直被跳过，直接掉到 fetch——这正是
//       // 你看到的"点刷新还是走 request"的原因之一。
//       clickRiskyCardIds.delete(String(curItem.id));
//       saveClickRiskyCardIds(clickRiskyCardIds);
//       curItem._detailLoaded = false;
//       curItem._detailLoading = false;
//       curItem._detailLoadingClick = false;
//       curItem._detailLoadingPrefetch = false;
//       curItem.fullText = t('reloading');
//       curItem.respText = t('reloading');
//       curItem.reqText = t('reloading');
//       updateCardElementContent(cardEl, curItem);
//       try {
//         await ensureRecordDetail(curItem, { allowClick: true });
//       } finally {
//         // ⚡ 修复"数据刷新完还一直转"：原来只 add('spinning') 从不 remove，
//         // 加上现在卡片 DOM 是复用的(窗口化渲染)，这个 class 会永久留在节点上。
//         refreshBtn.classList.remove('spinning');
//         const latest = state.rawDatalist.find((r) => r.id === cardEl.dataset.jobId);
//         if (latest) updateCardElementContent(cardEl, latest);
//       }
//     };

//     cardEl.onclick = () => {
//       if (state._justDragged) return; // 拖拽尾巴触发的点击，不当成"切到这张卡"
//       const idx = state.filteredDatalist.findIndex((r) => r.id === cardEl.dataset.jobId);
//       if (idx >= 0 && state.currentIndex !== idx) switchCardIndex(idx);
//     };

//     return cardEl;
//   }

//   // 局部更新：只改文字内容和 class，不碰 DOM 结构、不重新绑定事件
//   function updateCardElementContent(cardEl, item) {
//     cardEl.dataset.jobId = item.id;
//     const titleEl = cardEl.querySelector('.jdp-card-title');
//     if (titleEl) { titleEl.textContent = item.title; titleEl.title = item.title; }
//     const metaEl = cardEl.querySelector('.jdp-card-meta');
//     if (metaEl) metaEl.textContent = `🏢 ${item.company} · 📍 ${item.location}`;
//     const salaryEl = cardEl.querySelector('.jdp-card-salary');
//     if (salaryEl) salaryEl.textContent = item.rawSalary;
//     const matchDiv = cardEl.querySelector('.jdp-card-match');
//     if (matchDiv) matchDiv.dataset.jobId = item.id;
//     const respBox = cardEl.querySelector('.jdp-resp-box');
//     if (respBox) respBox.textContent = item.respText;
//     const reqBox = cardEl.querySelector('.jdp-req-box');
//     if (reqBox) reqBox.textContent = item.reqText;
//     const fullTextBox = cardEl.querySelector('.job-detail-text');
//     if (fullTextBox) fullTextBox.textContent = item.fullText;
//   }

//   function renderGalleryCards() {
//     const container = document.getElementById('jdp-cards-container');
//     const counter = document.getElementById('jdp-counter');
//     if (!container || !counter) return;

//     const list = state.filteredDatalist;
//     const groupNo = Math.floor(state.currentGroupStart / GROUP_SIZE) + 1;
//     counter.innerText = list.length > 0 ? `${state.currentIndex + 1} / ${list.length}（${t('number')}${groupNo} ${t('group')}）` : '0 / 0';

//     if (list.length === 0) {
//       container.innerHTML = `<div class="jdp-empty-tips">${t('emptyList')}</div>`;
//       renderedCardElements.clear();
//       return;
//     }

//     state.rawDatalist.forEach((item) => {
//       if (item.rawNode && item.rawNode.classList) item.rawNode.classList.remove('linkedin-fast-highlight');
//     });
//     const activeItem = list[state.currentIndex];
//     if (activeItem && activeItem.rawNode && activeItem.rawNode.classList) {
//       activeItem.rawNode.classList.add('linkedin-fast-highlight');
//     }
//     // ⚡ "页面中心视角仍是我们的卡片，尽量减少抖动"：
//     // 不再滚动到真实的原生列表项（那样视角会跳到侧边栏，且每次切换都强制
//     // smooth-scroll 一次，构成用户描述的"抖动"）。改成只在我们自己的悬浮
//     // 看板已经不在可视区域内时才滚动它回来，正常切换时如果看板本来就在
//     // 视口里，什么都不做——这是抖动的根本消除方式：没必要的滚动直接不触发。
//     const galleryWrapperEl = document.getElementById('jdp-gallery-wrapper');
//     if (galleryWrapperEl) {
//       const wrapRect = galleryWrapperEl.getBoundingClientRect();
//       const isWrapperVisible = wrapRect.top >= 0 && wrapRect.bottom <= window.innerHeight;
//       if (!isWrapperVisible) {
//         galleryWrapperEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
//       }
//     }

//     // ⚡ 只渲染当前索引前后各 1 张，不再重建整份列表
//     const windowIndices = [state.currentIndex - 1, state.currentIndex, state.currentIndex + 1]
//       .filter((i) => i >= 0 && i < list.length);
//     const windowIds = new Set(windowIndices.map((i) => list[i].id));

//     // 移除已经滑出窗口的旧卡片节点
//     for (const [id, el] of renderedCardElements) {
//       if (!windowIds.has(id)) {
//         el.remove();
//         renderedCardElements.delete(id);
//       }
//     }

//     windowIndices.forEach((idx) => {
//       const item = list[idx];
//       let cardClass = 'jdp-card hidden-right';
//       if (idx === state.currentIndex) cardClass = 'jdp-card active';
//       else if (idx === state.currentIndex - 1) cardClass = 'jdp-card prev';
//       else if (idx === state.currentIndex + 1) cardClass = 'jdp-card next';

//       let cardEl = renderedCardElements.get(item.id);
//       if (cardEl) {
//         // ⚡ 已经在窗口里了：只换 class 定位置、更新文字，不重建 DOM
//         cardEl.className = cardClass;
//         updateCardElementContent(cardEl, item);
//       } else {
//         cardEl = buildCardElement(item);
//         cardEl.className = cardClass;
//         renderedCardElements.set(item.id, cardEl);
//         container.appendChild(cardEl);
//       }
//     });
//   }

//   function escapeHtml(str) {
//     if (!str) return '';
//     return String(str)
//       .replace(/&/g, '&amp;')
//       .replace(/</g, '&lt;')
//       .replace(/>/g, '&gt;')
//       .replace(/"/g, '&quot;');
//   }

//   // "沟通/投递"按钮触发器：在原生卡片节点里找语义相近的按钮点掉
//   function triggerNativeActionBtn(rawCardNode) {
//     if (!rawCardNode) return false;
//     const actionKeywordsRegex = /^(立即沟通|聊一聊|立即投递|投递简历|投递|应聘|立即申请|申请|Easy Apply|Apply Now|Apply)$/i;
//     const clickableElements = Array.from(rawCardNode.querySelectorAll('button, a, div[role="button"], span.btn, div.btn'));
//     let targetBtn = clickableElements.find((el) => actionKeywordsRegex.test((el.innerText || '').trim()));
//     if (!targetBtn) {
//       targetBtn = clickableElements.find((el) => /沟通|聊一聊|投递|应聘|apply/.test((el.innerText || '').trim().toLowerCase()));
//     }
//     if (targetBtn) { targetBtn.click(); return true; }
//     return false;
//   }

//   // ==========================================
//   // 11. 深度报告弹窗系统 —— 来自 test.js，原样保留，只修了一处参数错位 bug
//   // ==========================================
//   async function getUserInfo(key) {
//     const data = await chrome.storage.local.get([key]);
//     if (!data) {
//       console.warn('未登录或未存储 用户信息，返回 null');
//       return null;
//     }
//     console.log(data[key])
//     return data[key].data.user_id;
//   }

//   document.addEventListener('click', async (e) => {
//     const matchCard = e.target.closest('.jdp-card-match');
//     if (!matchCard) return;

//     e.stopPropagation();
//     e.preventDefault();

//     const jobCard = matchCard.closest('.jdp-card') || matchCard.closest('.job-card');
//     if (!jobCard) return;

//     const jobId = matchCard.dataset.jobId || jobCard.dataset.jobId || matchCard.getAttribute('data-job-id') || jobCard.getAttribute('data-job-id');
//     if (!jobId) {
//       console.warn('⚠️ 当前点击的卡片未找到有效的 data-job-id', jobCard);
//     }

//     const titleEl = jobCard.querySelector('.jdp-card-title') || jobCard.querySelector('.job-title');
//     const jobTitle = titleEl?.innerText?.trim() || jobCard.getAttribute('data-job-title') || '目标岗位';

//     const respText = jobCard.querySelector('.jdp-resp-box')?.innerText?.trim() || '';
//     const reqText = jobCard.querySelector('.jdp-req-box')?.innerText?.trim() || '';
//     const legacyJd = jobCard.querySelector('.job-detail-text')?.innerText?.trim() || '';
//     const cleanedJd = [respText, reqText].filter(Boolean).join('\n\n') || legacyJd || jobTitle;

//     console.log(`🚀 [触发深度报告] jobId: ${jobId}, title: ${jobTitle}`);
//     fetchAndShowReport(jobId, jobTitle, false, cleanedJd);
//   });

//   // async function fetchAndShowReport(jobId, jobTitle = '目标岗位', forceRefresh = false, cleanedJd) {
//   //   const cacheKey = `jdp_report_${jobId}`;
//   //   const userId = await getUserInfo('user_info');

//   //   if (!forceRefresh) {
//   //     const cachedStr = localStorage.getItem(cacheKey);
//   //     if (cachedStr) {
//   //       try {
//   //         const cachedData = JSON.parse(cachedStr);
//   //         const now = Date.now();
//   //         if (cachedData.timestamp && (now - cachedData.timestamp < REPORT_CACHE_TTL)) {
//   //           // ⚡ 修复点：原来这里漏传了 jobTitle，把 cleanedJd 错位塞进了 jobTitle 的位置
//   //           updateReportModalContent(cachedData.report, cachedData.remainingQuota, true, jobId, jobTitle, cleanedJd);
//   //           return;
//   //         }
//   //         localStorage.removeItem(cacheKey);
//   //       } catch (e) {
//   //         localStorage.removeItem(cacheKey);
//   //       }
//   //     }
//   //   }

//   //   showReportModalLoading(jobTitle);

//   //   try {
//   //     const response = await fetch(`${API_BASE_URL}/api/match/detailed-report`, {
//   //       method: 'POST',
//   //       headers: { 'Content-Type': 'application/json' },
//   //       body: JSON.stringify({ user_id: userId, job_id: jobId, job_title: jobTitle, cleaned_jd: cleanedJd })
//   //     });

//   //     const resData = await response.json().catch(() => ({}));

//   //     if (response.status === 429) {
//   //       updateReportModalError(resData.detail || '请求过于频繁，请稍后再试', jobId, jobTitle, cleanedJd);
//   //       return;
//   //     }
//   //     if (!response.ok) {
//   //       updateReportModalError(resData.detail || '生成深度报告失败，请稍后再试', jobId, jobTitle, cleanedJd);
//   //       return;
//   //     }

//   //     const report = resData.data;
//   //     const remainingQuota = resData.remaining_quota;

//   //     localStorage.setItem(cacheKey, JSON.stringify({ report, remainingQuota, timestamp: Date.now() }));
//   //     updateReportModalContent(report, remainingQuota, false, jobId, jobTitle, cleanedJd);
//   //   } catch (err) {
//   //     console.error('网络请求异常:', err);
//   //     updateReportModalError('网络断开或服务器响应超时', jobId, jobTitle, cleanedJd);
//   //   }
//   // }

//   // function getOrCreateReportModal() {
//   //   let modal = document.getElementById('jdp-report-modal');
//   //   if (!modal) {
//   //     modal = document.createElement('div');
//   //     modal.id = 'jdp-report-modal';
//   //     modal.className = 'jdp-modal-backdrop';
//   //     modal.innerHTML = `
//   //       <div class="jdp-modal-content">
//   //         <div class="jdp-modal-header">
//   //           <div style="display: flex; justify-content: space-between; align-items: center;">
//   //             <h3>⚡ AI 岗位匹配评估报告</h3>
//   //             <p class="subtitle" id="jdp-modal-job-title">正在分析岗位匹配度...</p>
//   //             <button type="button" class="jdp-btn-secondary" id="jdp-modal-refresh-btn" style="display:none; margin-right: 2px;">🔄 重新诊断</button>
//   //           </div>
//   //           <button type="button" class="jdp-modal-close" id="jdp-modal-close-x" title="关闭">&times;</button>
//   //         </div>
//   //         <div class="jdp-modal-body" id="jdp-modal-body"></div>
//   //         <div class="jdp-modal-footer">
//   //           <button type="button" class="jdp-btn-primary jdp-btn-close-action" id="jdp-modal-close-btn">关闭报告</button>
//   //         </div>
//   //       </div>
//   //     `;
//   //     document.body.appendChild(modal);

//   //     const closeBtns = modal.querySelectorAll('#jdp-modal-close-x, #jdp-modal-close-btn');
//   //     closeBtns.forEach((btn) => btn.addEventListener('click', closeReportModal));
//   //     modal.addEventListener('click', (e) => { if (e.target === modal) closeReportModal(); });
//   //   }
//   //   return modal;
//   // }

//   // function closeReportModal() {
//   //   const modal = document.getElementById('jdp-report-modal');
//   //   if (modal) modal.remove();
//   // }

//   // function showReportModalLoading(jobTitle = '目标岗位') {
//   //   getOrCreateReportModal();
//   //   document.getElementById('jdp-modal-job-title').innerText = `${t('Targetposition')}${jobTitle}`;
//   //   document.getElementById('jdp-modal-refresh-btn').style.display = 'none';

//   //   const bodyEl = document.getElementById('jdp-modal-body');
//   //   bodyEl.innerHTML = `
//   //     <div class="jdp-loading-container" style="text-align: center; padding: 30px 10px;">
//   //       <div class="jdp-spinner" style="margin: 0 auto 15px;"></div>
//   //       <p style="font-weight: 600; color: #1e293b; margin-bottom: 5px;">AI 正在深度解析简历与 JD...</p>
//   //       <p style="font-size: 12px; color: #64748b;">提取硬性要求、碰撞技能交集与核查短板中</p>
//   //     </div>
//   //     <div class="jdp-skeleton-wrapper" style="opacity: 0.6;">
//   //       <div class="jdp-hero-card" style="height: 80px; background: #f1f5f9; border: none;"></div>
//   //       <div class="jdp-grid-subscores" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 15px;">
//   //         <div style="height: 60px; background: #f1f5f9; border-radius: 8px;"></div>
//   //         <div style="height: 60px; background: #f1f5f9; border-radius: 8px;"></div>
//   //         <div style="height: 60px; background: #f1f5f9; border-radius: 8px;"></div>
//   //         <div style="height: 60px; background: #f1f5f9; border-radius: 8px;"></div>
//   //       </div>
//   //     </div>
//   //   `;
//   // }

//   // function updateReportModalContent(report, remainingQuota, fromCache, jobId, jobTitle, cleanedJd) {
//   //   getOrCreateReportModal();

//   //   const { total_score = 0, sub_scores = {}, details = {}, job_title = jobTitle || '未知岗位' } = report || {};
//   //   const { matched_skills = [], missing_skills = [], hard_warnings = [], insights = {} } = details;

//   //   document.getElementById('jdp-modal-job-title').innerText = `目标岗位：${job_title}`;

//   //   const refreshBtn = document.getElementById('jdp-modal-refresh-btn');
//   //   if (refreshBtn) {
//   //     refreshBtn.style.display = 'inline-block';
//   //     refreshBtn.innerText = '🔄 重新诊断';
//   //     refreshBtn.onclick = () => {
//   //       localStorage.removeItem(`jdp_report_${jobId}`);
//   //       fetchAndShowReport(jobId, jobTitle, true, cleanedJd);
//   //     };
//   //   }

//   //   const warningsHtml = hard_warnings.length > 0
//   //     ? `<div class="jdp-alert-box">⚠️ <b>硬性门槛预警：</b>${hard_warnings.join('；')}</div>`
//   //     : '';
//   //   const matchedTags = matched_skills.map((s) => `<span class="jdp-tag tag-success">✓ ${s}</span>`).join('');
//   //   const missingTags = missing_skills.map((s) => `<span class="jdp-tag tag-danger">✕ ${s}</span>`).join('');

//   //   const bodyEl = document.getElementById('jdp-modal-body');
//   //   bodyEl.innerHTML = `
//   //     <div class="jdp-hero-card">
//   //       <div class="score-circle">
//   //         <span class="score-val">${total_score}</span>
//   //         <span class="score-unit">分</span>
//   //       </div>
//   //       <div class="score-meta">
//   //         <h4>${total_score >= 80 ? '🔥 极高匹配度' : total_score >= 60 ? '👍 匹配度良好' : '⚠️ 匹配度较低'}</h4>
//   //         <span class="quota-badge">
//   //           ${fromCache ? '⚡ 5分钟内缓存' : `今日剩余 AI 报告额度: ${remainingQuota ?? '无限制'} 次`}
//   //         </span>
//   //       </div>
//   //     </div>

//   //     ${warningsHtml}

//   //     <div class="jdp-grid-subscores">
//   //       <div class="subscore-card"><span class="title">硬门槛 (20%)</span><span class="score">${sub_scores.hard ?? 0}分</span></div>
//   //       <div class="subscore-card"><span class="title">必备技能 (30%)</span><span class="score">${sub_scores.must_skill ?? 0}分</span></div>
//   //       <div class="subscore-card"><span class="title">加分项 (15%)</span><span class="score">${sub_scores.bonus_skill ?? 0}分</span></div>
//   //       <div class="subscore-card"><span class="title">业务契合 (35%)</span><span class="score">${sub_scores.business ?? 0}分</span></div>
//   //     </div>

//   //     <div class="jdp-section">
//   //       <h5 class="sec-title">🎯 技能重合与缺失</h5>
//   //       <div class="jdp-tags-wrapper">
//   //         ${matchedTags}
//   //         ${missingTags}
//   //         ${matched_skills.length === 0 && missing_skills.length === 0 ? '<span class="text-muted">暂无技能碰撞数据</span>' : ''}
//   //       </div>
//   //     </div>

//   //     <div class="jdp-section">
//   //       <h5 class="sec-title">💡 AI 智能诊断</h5>
//   //       <div class="insight-item">
//   //         <span class="insight-label text-green">🌟 匹配亮点</span>
//   //         <ul>${(insights.highlights || []).map((h) => `<li>${h}</li>`).join('')}</ul>
//   //       </div>
//   //       <div class="insight-item">
//   //         <span class="insight-label text-orange">⚠️ 潜在风险/短板</span>
//   //         <ul>${(insights.risks || []).map((r) => `<li>${r}</li>`).join('')}</ul>
//   //       </div>
//   //       <div class="insight-item">
//   //         <span class="insight-label text-blue">📝 简历优化建议</span>
//   //         <ul>${(insights.gaps || []).map((g) => `<li>${g}</li>`).join('')}</ul>
//   //       </div>
//   //     </div>
//   //   `;
//   // }

//   // function updateReportModalError(errorMessage, jobId, jobTitle, cleanedJd) {
//   //   getOrCreateReportModal();

//   //   const refreshBtn = document.getElementById('jdp-modal-refresh-btn');
//   //   if (refreshBtn) {
//   //     refreshBtn.style.display = 'inline-block';
//   //     refreshBtn.innerText = '🔄 重试请求';
//   //     refreshBtn.onclick = () => fetchAndShowReport(jobId, jobTitle, true, cleanedJd);
//   //   }

//   //   const bodyEl = document.getElementById('jdp-modal-body');
//   //   bodyEl.innerHTML = `
//   //     <div class="jdp-error-box" style="text-align: center; padding: 40px 10px;">
//   //       <div style="font-size: 40px; margin-bottom: 10px;">⚠️</div>
//   //       <h4 style="color: #ef4444; margin-bottom: 8px;">报告生成失败</h4>
//   //       <p style="color: #64748b; font-size: 14px; max-width: 80%; margin: 0 auto;">
//   //         ${errorMessage || '服务器繁忙或网络异常，请稍后再试。'}
//   //       </p>
//   //     </div>
//   //   `;
//   // }

//   async function fetchAndShowReport(jobId, jobTitle = t('Targetposition'), forceRefresh = false, cleanedJd) {
//   const cacheKey = `jdp_report_${jobId}`;
//   const userId = await getUserInfo('user_info');

//   if (!forceRefresh) {
//     const cachedStr = localStorage.getItem(cacheKey);
//     if (cachedStr) {
//       try {
//         const cachedData = JSON.parse(cachedStr);
//         const now = Date.now();
//         if (cachedData.timestamp && (now - cachedData.timestamp < REPORT_CACHE_TTL)) {
//           updateReportModalContent(cachedData.report, cachedData.remainingQuota, true, jobId, jobTitle, cleanedJd);
//           return;
//         }
//         localStorage.removeItem(cacheKey);
//       } catch (e) {
//         localStorage.removeItem(cacheKey);
//       }
//     }
//   }

//   showReportModalLoading(jobTitle);

//   try {
//     const response = await fetch(`${API_BASE_URL}/api/match/detailed-report`, {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({ user_id: userId, job_id: jobId, job_title: jobTitle, cleaned_jd: cleanedJd })
//     });

//     const resData = await response.json().catch(() => ({}));

//     if (response.status === 429) {
//       updateReportModalError(resData.detail || t('rateLimitErrorMsg'), jobId, jobTitle, cleanedJd);
//       return;
//     }
//     if (!response.ok) {
//       updateReportModalError(resData.detail || t('reportFailedErrorMsg'), jobId, jobTitle, cleanedJd);
//       return;
//     }

//     const report = resData.data;
//     const remainingQuota = resData.remaining_quota;

//     localStorage.setItem(cacheKey, JSON.stringify({ report, remainingQuota, timestamp: Date.now() }));
//     updateReportModalContent(report, remainingQuota, false, jobId, jobTitle, cleanedJd);
//   } catch (err) {
//     console.error('网络请求异常:', err);
//     updateReportModalError(t('networkErrorMsg'), jobId, jobTitle, cleanedJd);
//   }
// }

// function getOrCreateReportModal() {
//   let modal = document.getElementById('jdp-report-modal');
//   if (!modal) {
//     modal = document.createElement('div');
//     modal.id = 'jdp-report-modal';
//     modal.className = 'jdp-modal-backdrop';
//     modal.innerHTML = `
//       <div class="jdp-modal-content">
//         <div class="jdp-modal-header">
//           <div style="display: flex; justify-content: space-between; align-items: center;">
//             <h3>${t('reportModalTitle')}</h3>
//             <p class="subtitle" id="jdp-modal-job-title">${t('reportModalAnalyzing')}</p>
//             <button type="button" class="jdp-btn-secondary" id="jdp-modal-refresh-btn" style="display:none; margin-right: 2px;">${t('reportModalRefreshBtn')}</button>
//           </div>
//           <button type="button" class="jdp-modal-close" id="jdp-modal-close-x" title="${t('reportModalCloseX')}">&times;</button>
//         </div>
//         <div class="jdp-modal-body" id="jdp-modal-body"></div>
//         <div class="jdp-modal-footer">
//           <button type="button" class="jdp-btn-primary jdp-btn-close-action" id="jdp-modal-close-btn">${t('reportModalCloseBtn')}</button>
//         </div>
//       </div>
//     `;
//     document.body.appendChild(modal);

//     const closeBtns = modal.querySelectorAll('#jdp-modal-close-x, #jdp-modal-close-btn');
//     closeBtns.forEach((btn) => btn.addEventListener('click', closeReportModal));
//     modal.addEventListener('click', (e) => { if (e.target === modal) closeReportModal(); });
//   }
//   return modal;
// }

// function closeReportModal() {
//   const modal = document.getElementById('jdp-report-modal');
//   if (modal) modal.remove();
// }

// function showReportModalLoading(jobTitle = t('Targetposition')) {
//   getOrCreateReportModal();
//   document.getElementById('jdp-modal-job-title').innerText = `${t('Targetposition')}${jobTitle}`;
//   document.getElementById('jdp-modal-refresh-btn').style.display = 'none';

//   const bodyEl = document.getElementById('jdp-modal-body');
//   bodyEl.innerHTML = `
//     <div class="jdp-loading-container" style="text-align: center; padding: 30px 10px;">
//       <div class="jdp-spinner" style="margin: 0 auto 15px;"></div>
//       <p style="font-weight: 600; color: #1e293b; margin-bottom: 5px;">${t('reportLoadingTitle')}</p>
//       <p style="font-size: 12px; color: #64748b;">${t('reportLoadingSub')}</p>
//     </div>
//     <div class="jdp-skeleton-wrapper" style="opacity: 0.6;">
//       <div class="jdp-hero-card" style="height: 80px; background: #f1f5f9; border: none;"></div>
//       <div class="jdp-grid-subscores" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 15px;">
//         <div style="height: 60px; background: #f1f5f9; border-radius: 8px;"></div>
//         <div style="height: 60px; background: #f1f5f9; border-radius: 8px;"></div>
//         <div style="height: 60px; background: #f1f5f9; border-radius: 8px;"></div>
//         <div style="height: 60px; background: #f1f5f9; border-radius: 8px;"></div>
//       </div>
//     </div>
//   `;
// }

// function updateReportModalContent(report, remainingQuota, fromCache, jobId, jobTitle, cleanedJd) {
//   getOrCreateReportModal();

//   const { total_score = 0, sub_scores = {}, details = {}, job_title = jobTitle || t('unknownJob') } = report || {};
//   const { matched_skills = [], missing_skills = [], hard_warnings = [], insights = {} } = details;

//   document.getElementById('jdp-modal-job-title').innerText = `${t('Targetposition')}${job_title}`;

//   const refreshBtn = document.getElementById('jdp-modal-refresh-btn');
//   if (refreshBtn) {
//     refreshBtn.style.display = 'inline-block';
//     refreshBtn.innerText = t('reportModalRefreshBtn');
//     refreshBtn.onclick = () => {
//       localStorage.removeItem(`jdp_report_${jobId}`);
//       fetchAndShowReport(jobId, jobTitle, true, cleanedJd);
//     };
//   }

//   const warningsHtml = hard_warnings.length > 0
//     ? `<div class="jdp-alert-box">${t('hardWarningLabel')}${hard_warnings.join('；')}</div>`
//     : '';
//   const matchedTags = matched_skills.map((s) => `<span class="jdp-tag tag-success">✓ ${s}</span>`).join('');
//   const missingTags = missing_skills.map((s) => `<span class="jdp-tag tag-danger">✕ ${s}</span>`).join('');

//   const matchDegreeText = total_score >= 80 
//     ? t('matchDegreeHigh') 
//     : total_score >= 60 
//       ? t('matchDegreeGood') 
//       : t('matchDegreeLow');

//   const quotaText = fromCache 
//     ? t('cachedNotice') 
//     : t('remainingQuota', { quota: remainingQuota ?? t('quotaUnlimited') });

//   const bodyEl = document.getElementById('jdp-modal-body');
//   bodyEl.innerHTML = `
//     <div class="jdp-hero-card">
//       <div class="score-circle">
//         <span class="score-val">${total_score}</span>
//         <span class="score-unit">${t('unitScore')}</span>
//       </div>
//       <div class="score-meta">
//         <h4>${matchDegreeText}</h4>
//         <span class="quota-badge">${quotaText}</span>
//       </div>
//     </div>

//     ${warningsHtml}

//     <div class="jdp-grid-subscores">
//       <div class="subscore-card"><span class="title">${t('subscoreHard')}</span><span class="score">${sub_scores.hard ?? 0}${t('unitScore')}</span></div>
//       <div class="subscore-card"><span class="title">${t('subscoreMustSkill')}</span><span class="score">${sub_scores.must_skill ?? 0}${t('unitScore')}</span></div>
//       <div class="subscore-card"><span class="title">${t('subscoreBonusSkill')}</span><span class="score">${sub_scores.bonus_skill ?? 0}${t('unitScore')}</span></div>
//       <div class="subscore-card"><span class="title">${t('subscoreBusiness')}</span><span class="score">${sub_scores.business ?? 0}${t('unitScore')}</span></div>
//     </div>

//     <div class="jdp-section">
//       <h5 class="sec-title">${t('secTitleSkills')}</h5>
//       <div class="jdp-tags-wrapper">
//         ${matchedTags}
//         ${missingTags}
//         ${matched_skills.length === 0 && missing_skills.length === 0 ? `<span class="text-muted">${t('noSkillData')}</span>` : ''}
//       </div>
//     </div>

//     <div class="jdp-section">
//       <h5 class="sec-title">${t('secTitleDiagnosis')}</h5>
//       <div class="insight-item">
//         <span class="insight-label text-green">${t('insightHighlights')}</span>
//         <ul>${(insights.highlights || []).map((h) => `<li>${h}</li>`).join('')}</ul>
//       </div>
//       <div class="insight-item">
//         <span class="insight-label text-orange">${t('insightRisks')}</span>
//         <ul>${(insights.risks || []).map((r) => `<li>${r}</li>`).join('')}</ul>
//       </div>
//       <div class="insight-item">
//         <span class="insight-label text-blue">${t('insightGaps')}</span>
//         <ul>${(insights.gaps || []).map((g) => `<li>${g}</li>`).join('')}</ul>
//       </div>
//     </div>
//   `;
// }

// function updateReportModalError(errorMessage, jobId, jobTitle, cleanedJd) {
//   getOrCreateReportModal();

//   const refreshBtn = document.getElementById('jdp-modal-refresh-btn');
//   if (refreshBtn) {
//     refreshBtn.style.display = 'inline-block';
//     refreshBtn.innerText = t('reportModalRetryBtn');
//     refreshBtn.onclick = () => fetchAndShowReport(jobId, jobTitle, true, cleanedJd);
//   }

//   const bodyEl = document.getElementById('jdp-modal-body');
//   bodyEl.innerHTML = `
//     <div class="jdp-error-box" style="text-align: center; padding: 40px 10px;">
//       <div style="font-size: 40px; margin-bottom: 10px;">⚠️</div>
//       <h4 style="color: #ef4444; margin-bottom: 8px;">${t('reportErrorTitle')}</h4>
//       <p style="color: #64748b; font-size: 14px; max-width: 80%; margin: 0 auto;">
//         ${errorMessage || t('reportErrorDefaultMsg')}
//       </p>
//     </div>
//   `;
// }

//   // ==========================================
//   // 12. 启动
//   // ==========================================
//   runPipeline();
//   initObserver();
//   startSPAGuard();
//   console.log('🚀 JDP Gallery 三合一整合版已启动：引擎=content_test.js / UI=test.js / 匹配分与深度报告=补全自 content_backend.js');
// })();

(function () {
  'use strict';


  if (window.__jdpIntegratedInjected) return;
  window.__jdpIntegratedInjected = true;

  // const API_BASE_URL = "http://127.0.0.1:3000";
  const API_BASE_URL = "https://job-helper.zhitree.top";
  const REPORT_CACHE_TTL = 5 * 60 * 1000;

  // =====================================================================
  // "点击风险卡片"崩溃检测：某些卡片点击后站点自己的 JS 会主动整页刷新
  // （不是浏览器原生跳转，e.preventDefault() 拦不住这种命令式跳转/reload），
  // 一旦发生，我们的脚本实例跟页面一起被销毁，代码根本执行不到"记录一下"
  // 这一步。这里用 sessionStorage（能扛过页面刷新）做一次简单的崩溃检测：
  // 点击前先写"即将点击这张卡"的标记，点击流程正常结束（不管成功还是超时）
  // 就清掉标记；脚本重新注入时如果发现标记还在，说明上次点了之后就没有
  // 下文了，基本可以断定是那次点击导致了整页刷新——记下这张卡"点击有风险"，
  // 以后遇到直接跳过点击、只走 fetch。
  // =====================================================================
  const CLICK_RISK_STORAGE_KEY = 'jdp_click_risk_cardids';
  const PENDING_CLICK_STORAGE_KEY = 'jdp_pending_click';

  function loadClickRiskyCardIds() {
    try {
      const raw = sessionStorage.getItem(CLICK_RISK_STORAGE_KEY);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch (e) { return new Set(); }
  }
  function saveClickRiskyCardIds(set) {
    try { sessionStorage.setItem(CLICK_RISK_STORAGE_KEY, JSON.stringify(Array.from(set))); } catch (e) { /* ignore */ }
  }
  function markPendingClick(cardId) {
    try { sessionStorage.setItem(PENDING_CLICK_STORAGE_KEY, JSON.stringify({ cardId: String(cardId), ts: Date.now() })); } catch (e) { /* ignore */ }
  }
  function clearPendingClick() {
    try { sessionStorage.removeItem(PENDING_CLICK_STORAGE_KEY); } catch (e) { /* ignore */ }
  }

  const clickRiskyCardIds = loadClickRiskyCardIds();
  (function detectCrashFromLastClick() {
    try {
      const raw = sessionStorage.getItem(PENDING_CLICK_STORAGE_KEY);
      if (raw) {
        const { cardId, ts } = JSON.parse(raw);
        // 只采信比较新鲜的残留标记（15秒内）——太久之前的更可能是用户自己手动
        // 刷新/关闭标签页等无关原因留下的，不该被误判成"点击导致的"
        if (cardId && Date.now() - ts < 15000) {
          clickRiskyCardIds.add(cardId);
          saveClickRiskyCardIds(clickRiskyCardIds);
          console.warn(`⚠️ [content.js] 检测到上次点击卡片(${cardId})后页面被整体刷新，已标记为"点击风险"，以后跳过点击改走 fetch 兜底`);
        }
      }
    } catch (e) { /* ignore */ }
    clearPendingClick();
  })();

  // =====================================================================
  // 0. 站点识别 & Hint 配置（未知站点会落到 'generic'，用纯通用兜底跑）
  // =====================================================================
  const SITE = location.host.includes('zhipin.com')
    ? 'boss'
    : location.host.includes('linkedin.com')
      ? 'linkedin'
      : (location.host.includes('zhaopin.com') || location.host.includes('zhilian.com'))
        ? 'zhaopin'
        : 'generic';

  // ⚡ 预取窗口大小：默认只看当前卡片后面 2 张(next1/next2)，BOSS 允许拉大到 15。
  // BOSS 是"一批 15 条一次性加载完"的滚动列表，且现在点击优先(免费流量)，
  // 只有点击不安全时才会用到限频的 fetch——把整批提前排进预取队列的代价
  // 没有想象中大，真正消耗限频名额的只是"点击不安全的那几张"。
  // 注意这不是"一次性瞬间拉完 15 条"：受限频约束，真正跑完一批仍然需要时间
  // （每次 fetch 间隔 ~8~11 秒），只是提前把它们排进队列，让后台在你阅读
  // 当前卡片的这段时间里有机会提前处理掉，而不是等你翻到了才现排队。
  // ⚡ BOSS 预取彻底关掉网络请求：BOSS 上唯一安全的取数手段是"点击当前卡片"
  // （点击触发的是站点自己的流量），而预取按设计又绝不允许点击——这意味着
  // BOSS 的预取只剩"主动 fetch"一条路，而那恰恰是触发风控的路径，也是你测到
  // 的"5 秒才发出 detail"的真正来源（预取流水线被 8 秒限频器卡着，它的响应
  // 又被我们自己的 hook 拦一遍再发出来，跟点击毫无关系）。
  // 结论：BOSS 上预取没有安全的实现方式，直接关掉，只保留"当前卡片点击"。
  const PREFETCH_LOOKAHEAD = SITE === 'boss' ? 0 : 2;
  const PREFETCH_ALLOW_NETWORK = SITE !== 'boss';
  // 只有这两个站点在 injected.js 里实现了真正的 JSON 详情接口；
  // 其它站点走 'fetch' 策略必然拿到 null，不该为它付限频等待的代价。
  const SITE_HAS_JSON_API = SITE === 'boss' || SITE === 'linkedin' || SITE === 'zhaopin';
  // BOSS、智联(zhaopin)都是滚动懒加载列表：页面本身没有可点击的"下一页/上一页"
  // 按钮，翻到本地数据末尾后，是靠用户/页面把列表往下滚动触发站点自己的懒加载来
  // 拿到下一批数据的——这跟 LinkedIn 这类有真实分页按钮的站点是两套完全不同的
  // 机制。这里显式声明，好让 switchGroup 直接跳过"找按钮点击"这一步，避免通用
  // 按钮探测逻辑在这些站点上误命中页面里其它无关的"下一步"类按钮（引导浮层、
  // 轮播箭头等），也省掉一次没有意义的全页 DOM 扫描。
  const SITE_USES_SCROLL_PAGINATION = SITE === 'boss' || SITE === 'zhaopin';

  // 已知站点的"加速配置"：每个字段都可选。没写的字段自动落到下面的通用兜底实现。
  const SITE_HINTS = {
    boss: {
      listSelectors: '.rec-job-list .card-area, .job-list-container .card-area, .job-card-wrapper, .job-card-box, .job-card-wrap',
      linkPattern: /\/job_detail\/([^\/\?]+)\.html/,
      extractCardId(cardNode) {
        const link = cardNode.tagName === 'A' ? cardNode : cardNode.querySelector('a[href*="/job_detail/"]');
        if (!link) return null;
        const href = link.getAttribute('href') || link.href || '';
        const m = href.match(this.linkPattern);
        return m ? m[1] : null; // encryptJobId，BOSS 详情接口强依赖这个，通用兜底拿不到
      },
      rightPaneSelectors: '.job-sider-detail, .jobs-search__job-details--container, .job-detail-outer, [class*="sider-detail"], [class*="job-detail"]',
      descSelectors: '.job-sec-text, .show-more-less-html__markup, .job-detail-section, [class*="sec-text"], [class*="description"]',
      titleSelectors: '.job-name, .job-title, [class*="job-name"], [class*="title"]',
      panelScopeGuard: () => window.location.href.includes('/web/geek/jobs'),
      clickTargetSelector: '.job-card-left, .card-area, .job-info, .job-card-body'
    },
    linkedin: {
      listSelectors: '.job-card-container, .jobs-search-results__list-item, div[data-job-id], .scaffold-layout__list-item, .job-card-list',
      rightPaneSelectors: '.jobs-search__job-details--container, .jobs-search__right-rail, .scaffold-layout__detail, .job-view-layout, main [class*="detail"]',
      descSelectors: '.show-more-less-html__markup, .jobs-description__content, .jobs-description, [class*="description"]',
      titleSelectors: 'h1, h2, .job-details-jobs-unified-top-card__job-title, [class*="title"]',
      panelScopeGuard: () => window.location.href.includes('/jobs'),
      clickTargetSelector: 'a, .job-card-list__title, .job-card-container__link'
      // extractCardId 不配置：LinkedIn 的通用 extractJobIdUniversal 已经足够准，不用单独写
    },
    zhaopin: {
      // 通过 window.__jdpDiag 诊断日志确认——通用兜底(locateJdContainer)
      // 在智联的实际结构上找不到面板，state/dom 两路因此同时失效。
      // 其余字段（title/desc/clickTarget）先不配置，落到通用兜底：
      // getDescNode 在没有 descSelectors 时直接用整个 rightPaneNode 的
      // innerText，getTitleFromPane 落到 locateTitleGeneric——先用最小
      // 改动把 dom/state 两路的根因堵上，其余字段等这个先跑通了、
      // 如果还有问题（比如标题提取不准）再针对性补。
      rightPaneSelectors: '.job-detail-card__body, .job-detail-card, [class*="job-detail"], [class*="position-detail"], [class*="detail-card"]',
      descSelectors: '.job-detail-card__body, [class*="description"], [class*="describe"], [class*="responsibility"], [class*="job-content"], [class*="detail-content"]',
      titleSelectors: '.job-detail-card__title, .job-name, h1, h2, [class*="job-title"], [class*="position-title"]',
      clickTargetSelector: '.joblist-box__item, .job-card, .job-item, [class*="joblist"], [class*="job-card"], [class*="position"], [class*="job-name"], [class*="job-title"]',
      preferCardClick: true,
      disablePageFetch: true,
      extractCardId(cardNode) {
        const attrNames = [
          'data-job-number', 'data-number', 'data-job-id', 'data-jobid',
          'data-position-id', 'data-position-number', 'data-zp-job-number',
          'jobid', 'job-id', 'number', 'positionid', 'position-id'
        ];
        for (const attrName of attrNames) {
          const el = cardNode.hasAttribute?.(attrName) ? cardNode : cardNode.querySelector(`[${attrName}]`);
          const val = el?.getAttribute(attrName);
          if (val && /^[A-Za-z0-9_-]{6,40}$/.test(val)) return val;
        }
        const html = cardNode.outerHTML || '';
        const patterns = [
          /(?:jobNumber|job_number|jobId|jobID|positionId|positionID|positionNumber|number)["']?\s*[:=]\s*["']?([A-Za-z0-9_-]{6,40})/i,
          /(?:jobNumber|jobId|positionId|number)=([A-Za-z0-9_-]{6,40})/i,
          /\/jobs?\/detail\/([A-Za-z0-9_-]{6,40})/i
        ];
        for (const pattern of patterns) {
          const match = html.match(pattern);
          if (match) return match[1];
        }
        return null;
      }
    }
    // 'generic' 站点（Indeed / Glassdoor / 未来任何新站点）：完全不配置，
    // 全部字段落到下面的通用兜底实现，开箱直接跑。
  };
  const adapter = SITE_HINTS[SITE] || {};


  // =====================================================================
  // 1. 数据池：被动监听得到的数据 + 主动兜底缓存
  //    - listDataMap  : 网络监听到的"列表级"基础字段（BOSS 的 joblist.json 等）
  //    - detailCache  : 已解析完成的"详情级"完整数据（三种策略中任一种成功后写入）
  //    - detailWaiters: 正在等待网络监听回填详情的 Promise resolver
  // =====================================================================
  const listDataMap = new Map();     // matchKey -> { securityId, lid, salaryDesc, ... } (仅 BOSS 会填充)
  const detailCache = new Map();     // cardId -> 完整详情对象
  const detailWaiters = new Map();   // matchKey -> resolve 函数（等待 injected.js 的监听回传）
  const processedJobIds = new Set();

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || msg.site !== SITE) return;

    if (msg.type === 'JOB_HOOK_LIST') {
      let count = 0;
      (msg.data || []).forEach((item) => {
        const key = item.encryptJobId || item.jobId || item.jobID || item.number || item.jobNumber || item.positionId || item.positionNumber || item.id;
        if (key) { listDataMap.set(String(key), item); count++; }
      });
      if (count > 0) console.log(`⚡ [content.js] 监听到列表数据 ${count} 条，Map 共 ${listDataMap.size} 条`);
    }

    if (msg.type === 'JOB_HOOK_DETAIL') {
      const detail = msg.data;
      if (!detail || !detail.matchKey) return;
      detailCache.set(String(detail.matchKey), { ...detail, source: 'Network Intercept (triggered by click)' });
      // 如果有人正在等待这条详情（模拟点击流程中），立刻唤醒
      const waiter = detailWaiters.get(String(detail.matchKey));
      if (waiter) { waiter(detail); detailWaiters.delete(String(detail.matchKey)); }
    }
    if (msg.type === 'ZHILIAN_INTERCEPTED_DATA') {
      const detail = msg.data;
      console.log("zhilian",detail)
      if (!detail || !detail.matchKey) return;
      detailCache.set(String(detail.matchKey), { ...detail, source: 'Network Intercept (triggered by click)' });
      // 如果有人正在等待这条详情（模拟点击流程中），立刻唤醒
      const waiter = detailWaiters.get(String(detail.matchKey));
      if (waiter) { waiter(detail); detailWaiters.delete(String(detail.matchKey)); }
    }
  });

  // =====================================================================
  // 2. 通用聚类算法（主用于任意左右分栏列表定位）
  //    —— 完全站点无关，不依赖 class 名，靠几何特征识别"重复卡片组"
  // =====================================================================
  function calculateStdDev(array) {
    if (array.length <= 1) return 0;
    const mean = array.reduce((a, b) => a + b, 0) / array.length;
    const variance = array.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / array.length;
    return Math.sqrt(variance);
  }

  const NOISE_KEYWORDS = [
    '这些结果有帮助吗', '您的反馈可以帮助我们', '无障碍模式提示',
    '改进搜索结果', 'Was this helpful', 'Help us improve', 'Accessibility feedback'
  ];
  function isNoiseElement(element) {
    if (!element) return true;
    const text = (element.innerText || element.textContent || '').trim();
    return NOISE_KEYWORDS.some((k) => text.includes(k));
  }

  function isFooterOrSystemNoise(node) {
    if (!node || !(node instanceof HTMLElement)) return true;
    if (node.tagName === 'FOOTER' || node.closest('footer')) return true;
    const text = (node.innerText || node.textContent || '').trim();
    const footerKeywords = [
      'LinkedIn Corporation', '©', '无障碍模式', '隐私政策', '帮助中心', '广告设置',
      '商业服务', '获取领英 APP', 'Accessibility', 'Privacy Policy', 'User Agreement',"上一页","下一步","Previous","Next"
    ];
    if (footerKeywords.some((kw) => text.includes(kw))) return true;
    const links = Array.from(node.querySelectorAll('a[href]'));
    const systemUrlPrefixes = ['about.linkedin.com', '/accessibility/', '/help/linkedin', '/ad/start', '/mobile/'];
    return links.some((a) => systemUrlPrefixes.some((u) => a.href.includes(u)));
  }

  function isValidContentCard(node) {
    const dom = node.node || node;
    if (!dom || !(dom instanceof HTMLElement)) return false;
    const text = (dom.innerText || dom.textContent || '').trim();
    if (text.length < 10) return false;
    const html = dom.outerHTML.toLowerCase();
    if (html.includes('aria-label="feedback"') || html.includes('feedback-container')) return false;
    const hasLink = dom.querySelector('a[href]') !== null;
    const childCount = dom.querySelectorAll('*').length;
    if (!hasLink && childCount < 5) return false;
    return true;
  }

  function findCandidateCards() {
    const allNodes = document.querySelectorAll('div, li, article, section');
    const candidates = [];
    const maxLeftBoundary = window.innerWidth * 0.45; // 只在左侧列表区域找卡片

    allNodes.forEach((node) => {
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const text = (node.innerText || '').trim();
      const isPositionValid = rect.left >= 0 && rect.left + rect.width <= maxLeftBoundary;
      const isSizeValid = rect.width >= 140 && rect.width <= 600 && rect.height >= 35 && rect.height <= 300;
      const isTextValid = text.length >= 10 && text.length <= 400;

      if (isPositionValid && isSizeValid && isTextValid) {
        const hasPointer = window.getComputedStyle(node).cursor === 'pointer' || !!node.querySelector('*[style*="pointer"]');
        candidates.push({ node, rect, textLength: text.length, hasPointer });
      }
    });
    return candidates;
  }

  function normalizeToStructuralCard(candidate) {
    let current = candidate.node;
    while (current.parentElement && current.parentElement.childElementCount === 1 && current.parentElement !== document.body) {
      current = current.parentElement;
    }
    return current;
  }

  function analyzeAndScoreGroups(candidates) {
    const groupsMap = new Map();
    candidates.forEach((item) => {
      const structuralNode = normalizeToStructuralCard(item);
      const parent = structuralNode.parentElement;
      if (!parent) return;
      if (!groupsMap.has(parent)) groupsMap.set(parent, []);
      const group = groupsMap.get(parent);
      if (!group.some((g) => g.node === structuralNode)) {
        group.push({ node: structuralNode, rect: structuralNode.getBoundingClientRect(), textLength: item.textLength, hasPointer: item.hasPointer });
      }
    });

    const scoredGroups = [];
    groupsMap.forEach((items) => {
      if (items.length < 3) return;
      const lefts = items.map((i) => i.rect.left);
      const widths = items.map((i) => i.rect.width);
      const leftStdDev = calculateStdDev(lefts);
      const widthStdDev = calculateStdDev(widths);
      const avgLeft = lefts.reduce((a, b) => a + b, 0) / lefts.length;

      items.sort((a, b) => a.rect.top - b.rect.top);
      let isYMonotonic = true;
      for (let i = 1; i < items.length; i++) {
        if (items[i].rect.top <= items[i - 1].rect.top) { isYMonotonic = false; break; }
      }

      let score = 0;
      score += items.length >= 5 ? 50 + items.length * 2 : items.length * 5;
      if (leftStdDev < 15) score += 30;
      if (widthStdDev < 20) score += 20;
      if (isYMonotonic) score += 25;
      if (avgLeft < window.innerWidth * 0.5) {
        score += (1 - avgLeft / (window.innerWidth * 0.5)) * 40;
      } else {
        score -= 30;
      }

      scoredGroups.push({ items: items.map((i) => i.node), itemCount: items.length, score });
    });

    scoredGroups.sort((a, b) => b.score - a.score);
    return scoredGroups;
  }

  const MIN_CLUSTER_SCORE = 60; // 低于这个分，认为聚类不可信，走 selector 兜底

  function locateByClustering() {
    const candidates = findCandidateCards()
      .filter((c) => !isNoiseElement(c.node))
      .filter((c) => isValidContentCard(c))
      .filter((c) => !isFooterOrSystemNoise(c.node));

    const scoredGroups = analyzeAndScoreGroups(candidates);
    if (!scoredGroups.length || scoredGroups[0].score < MIN_CLUSTER_SCORE) return [];
    return scoredGroups[0].items;
  }

  // ---- 次选兜底：站点已知 selector（聚类失败/得分过低时使用；generic 站点没配置，天然跳过） ----
  function locateBySelector() {
    if (!adapter.listSelectors) return [];
    return Array.from(document.querySelectorAll(adapter.listSelectors));
  }

  function deduplicateJobCards(cardNodes) {
    const uniqueCards = [];
    const seenKeys = new Set();
    cardNodes.forEach((card) => {
      const id = resolveCardId(card);
      if (id && !seenKeys.has(id)) { seenKeys.add(id); uniqueCards.push(card); }
    });
    return uniqueCards;
  }

  function getTargetJobCards() {
    let cards = locateByClustering();
    let usedMethod = 'clustering';
    if (cards.length === 0) {
      cards = locateBySelector();
      usedMethod = 'selector-fallback';
    }
    if (cards.length > 0) console.log(`📋 [content.js] 列表定位方式: ${usedMethod}, 共 ${cards.length} 张卡片`);
    return deduplicateJobCards(cards);
  }

  // =====================================================================
  // 3. 通用 ID 提取 —— 三级兜底，任何站点都能拿到一个稳定 ID
  //    a) 站点 hint 的 extractCardId（比如 BOSS 需要 encryptJobId，通用方法拿不到）
  //    b) extractJobIdUniversal：常见 data-* 属性 / href 模式识别
  //    c) hashString：都识别不到时，用卡片链接或文本内容算一个稳定哈希当 ID，
  //       保证 generic 站点也能做去重/缓存，只是不会有 securityId 这类专属字段
  // =====================================================================
  function hashString(str) {
    str = String(str || '');
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0, ch; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
  }

  function extractJobIdUniversal(cardNode) {
    if (!cardNode || !(cardNode instanceof HTMLElement)) return null;
    const EXACT_ATTRS = ['data-job-id', 'data-occludable-job-id', 'data-entity-urn', 'componentkey', 'data-jobid', 'jobid', 'id'];
    for (const attrName of EXACT_ATTRS) {
      const el = cardNode.hasAttribute?.(attrName) ? cardNode : cardNode.querySelector(`[${attrName}]`);
      if (el) {
        const val = el.getAttribute(attrName);
        const idMatch = val ? val.match(/(\d{6,12})/) : null;
        if (idMatch) return idMatch[1];
      }
    }
    const links = cardNode.querySelectorAll('a[href]');
    for (const a of links) {
      const match = a.href.match(/(?:currentJobId=|\/jobs\/view\/|\/job_detail\/|\/position\/|\/job\/|\/viewjob|jk=)([\w\-]+)/i);
      if (match) {
        const cleanId = match[1].match(/([\w\-]{6,20})/);
        if (cleanId) return cleanId[1];
      }
    }
    const html = cardNode.outerHTML;
    const SEMANTIC_PATTERNS = [/urn:li:jobPosting:(\d+)/, /job-card-component-ref-(\d+)/, /job[_\-]?id["']?\s*[:=]\s*["']?(\d+)/i, /data-job-id=["'](\d+)["']/i];
    for (const pattern of SEMANTIC_PATTERNS) {
      const match = html.match(pattern);
      if (match) return match[1];
    }
    return null;
  }

  // 终极兜底：任何站点都用得了，靠"链接地址"或"卡片文本"算一个稳定哈希当 ID。
  // 换页/重渲染只要链接和文字不变，哈希就不变，可以正常去重和走缓存。
  function stableHashId(cardNode) {
    const firstLink = cardNode.querySelector?.('a[href]');
    const seed = firstLink ? firstLink.href.split('?')[0] : (cardNode.innerText || '').slice(0, 80);
    return 'h_' + hashString(seed);
  }

  function resolveCardId(cardNode) {
    if (adapter.extractCardId) {
      const hinted = adapter.extractCardId(cardNode);
      if (hinted) return hinted;
    }
    return extractJobIdUniversal(cardNode) || stableHashId(cardNode);
  }

  // 重新扫描页面，找一个 cardId 匹配、且仍然挂在文档里的活节点——用于
  // state.engineCards 里的快照引用已经脱离文档时的恢复兜底（见 ensureJobDetail）。
  // 只在这种边缘情况下才会调用，不是热路径，重新跑一次聚类扫描可以接受。
  function findLiveNodeByCardId(cardId) {
    const cardNodes = getTargetJobCards();
    for (const node of cardNodes) {
      if (resolveCardId(node) === cardId) return node;
    }
    return null;
  }

  // =====================================================================
  // 4. 卡片基础信息提取（DOM 兜底 + listDataMap 命中增强）
  // =====================================================================
  const UI_NOISE_PATTERNS = [
    /无障碍(模式|浏览|操作|说明|声明|元素)/i, /accessibility\s*(mode|statement|menu|link|skip)/i,
    /skip\s*to\s*(main\s*)?content/i, /screen\s*reader/i, /这些结果有帮助吗/i,
    /did\s*you\s*find\s*this\s*helpful/i, /反馈/i, /feedback/i, /展开(全文)?/i, /收起/i,
    /show\s*(more|less)/i, /see\s*(more|less)/i, /page\s*\d+\s*of\s*\d+/i, /第\s*\d+\s*页/i, /cookie/i
  ];
  function isNoiseLine(lineText) {
    if (!lineText || lineText.trim().length === 0) return true;
    const clean = lineText.trim();
    if (clean.length < 2 && !/\d/.test(clean)) return true;
    return UI_NOISE_PATTERNS.some((p) => p.test(clean));
  }
  const SALARY_PATTERN = /(?:(?:USD|EUR|GBP|RMB|HKD|SGD|CAD|AUD|\$|¥|€|£|￥)\s*)?\d+[\d,.]*\s*(?:[kKmMwW]|万|千)?.*?(?:[-~—–到至]\s*\d+[\d,.]*\s*(?:[kKmMwW]|万|千)?)?/;
  const LOCATION_PATTERN = /(现场办公|远程|混合|湾区|市|省|国|Area|Remote|On-site|Hybrid|\(.+\))/i;

  function extractBasicInfoFromDom(cardNode) {
    const rawText = cardNode.innerText || '';
    const lines = rawText.split('\n').map((l) => l.trim()).filter((l) => !isNoiseLine(l));
    let salary = '';
    let location = '';
    const rest = [];
    lines.forEach((line) => {
      if (!salary && SALARY_PATTERN.test(line) && /\d/.test(line)) salary = line;
      else if (!location && LOCATION_PATTERN.test(line)) location = line;
      else rest.push(line);
    });
    return {
      title: rest[0] || '',
      company: rest[1] || '',
      salary: salary || t('salary'),
      location: location || '',
    };
  }

  function extractBasicInfo(cardNode, cardId) {
    // 优先命中网络监听到的列表数据（比如 BOSS 的 securityId/lid，DOM 里根本拿不到）
    const hooked = cardId ? listDataMap.get(String(cardId)) : null;
    const domInfo = extractBasicInfoFromDom(cardNode);
    if (hooked) {
      return {
        cardId,
        title: hooked.jobName || hooked.name || hooked.title || hooked.jobTitle || hooked.positionName || domInfo.title,
        salary: hooked.salaryDesc || hooked.salary || hooked.salaryReal || hooked.salary60 || domInfo.salary,
        company: hooked.brandName || hooked.companyName || hooked.company?.name || (typeof hooked.company === 'string' ? hooked.company : '') || domInfo.company,
        location: hooked.cityName || hooked.workCity || hooked.city?.display || (typeof hooked.city === 'string' ? hooked.city : '') || hooked.areaDistrict || hooked.location || domInfo.location,
        securityId: hooked.securityId || '',
        lid: hooked.lid || '',
        source: 'List Intercept + DOM'
      };
    }
    return { cardId, ...domInfo, securityId: '', lid: '', source: 'DOM Parsing' };
  }

  // =====================================================================
  // 4b. JD 文本清洗管线：cleanText → normalizeAndMergeLines → parseJdSmart
  //     DOM 兜底路径拿到的 rawText 必须过一遍这个管线才能用；
  //     网络监听路径（injected.js）已经在源头跑过 parseJdSmart，这里不用重复。
  // =====================================================================
  function cleanText(str) {
    if (!str) return '';
    const tailNoisePattern = /(?:去App|随时沟通|点击查看地图|查看更多信息|微信扫码|Easy Apply|Apply now).*$/i;
    // BOSS/Indeed 等站点右侧面板里常见的"地点 上海市""完整的职位描述"这类
    // UI 标签/小节引导语，混着 &nbsp; 这种没转义的 HTML 实体一起出现在
    // innerText/textContent 里。
    // ⚡ 修复：这些标签经常不是独占一行，而是跟正文其他内容挤在同一行里
    // （比如 innerText 把相邻的行内元素拼在了一起，"地点 上海市完整的职位描述
    // 岗位职责..."全连成一行）——之前用 ^...$ 锚定整行匹配，只要标签不是
    // 独占一行就永远匹配不上，这就是清理不掉的原因。改成不锚定的替换：
    // 不管这些词组出现在行首、行中还是整行，一律原地替换掉，再看剩下的
    // 内容是否还有意义，而不是要求整行必须严格等于某个标签。
    const uiInlineNoisePattern = /(地点[:：]?\s*[\u4e00-\u9fa5]{1,10}(市|区|省)?|完整的职位描述|职位描述如下|查看完整职位描述|Full\s+Job\s+Description)/gi;
    return str
      .replace(/&nbsp;/gi, ' ')
      .split('\n')
      .map((line) => {
        let cleaned = line.trim().replace(tailNoisePattern, '').trim();
        cleaned = cleaned.replace(uiInlineNoisePattern, ' ').replace(/[ \t]{2,}/g, ' ').trim();
        return cleaned;
      })
      .filter((line) => line && line.length >= 2 && !line.includes('🎯 JD 智能解析'))
      .join('\n')
      .trim();
  }

  // DOM 抽取的文本经常被节点拆成很多短行（一句话被拆成三四行），
  // 这里按"上一行是否以终止标点结尾/是否是列表项"做启发式合并，还原成自然段落。
  // ============================================================================
  // 优化版 parseJdSmart —— 针对 LinkedIn / Indeed 英文 JD "照单全收" 的问题
  //
  // 四个改动：
  //  [根因] normalizeAndMergeLines 会把不带冒号的英文小标题并进下一行，
  //         标题特征被彻底破坏 → 打分全军覆没 → 退化成"全文塞进 responsibilities"。
  //         现在识别到"疑似小标题"的行一律不参与合并。
  //  [词表] 按真实 JD 写作规范扩充（Essential Duties / Basic Qualifications /
  //         What You'll Bring / Nice-to-Haves 等），并区分 required vs preferred。
  //  [新增] 停止小节(STOP_SECTIONS)：Benefits / EEO / About Us 这类尾部样板段落
  //         以前会被并进最后一个小节，现在遇到即截断。
  //  [判定] 英文标题的结构特征另算：Title Case / ALL CAPS / 独立短行 / 后接列表。
  // ============================================================================

  // ============================================================================
  // 合并版 JD 解析：DOM 有状态遍历(element 感知打分) + 文本兜底
  //
  // 架构取自你的 parseJdSmartMultiSignal：按渲染顺序遍历块 → 遇标题切换当前小节 →
  // 其余内容归入当前小节。这个结构比"先压成文本再按位置切片"更好，因为打分时
  // element 还在手上，className/id/tagName 都能用。
  //
  // 在此基础上修掉三个实测失分点，并补上纯文本路径：
  //   [修] \b 对中文无效 + 全角冒号未处理 → 中文标题一个都识别不出
  //   [修] 无停止小节 → Benefits/EEO/公司介绍 一路污染最后一个小节
  //   [修] unspecified(前言) 被丢弃 → 岗位概述整段消失
  //   [补] parseJdSmartText：API 返回的是 JSON/纯文本时没有 DOM，必须有这条路
  // ============================================================================

  // ============================================================================
  // 合并版 JD 解析：DOM 有状态遍历(element 感知打分) + 文本兜底
  //
  // 架构取自你的 parseJdSmartMultiSignal：按渲染顺序遍历块 → 遇标题切换当前小节 →
  // 其余内容归入当前小节。这个结构比"先压成文本再按位置切片"更好，因为打分时
  // element 还在手上，className/id/tagName 都能用。
  //
  // 在此基础上修掉三个实测失分点，并补上纯文本路径：
  //   [修] \b 对中文无效 + 全角冒号未处理 → 中文标题一个都识别不出
  //   [修] 无停止小节 → Benefits/EEO/公司介绍 一路污染最后一个小节
  //   [修] unspecified(前言) 被丢弃 → 岗位概述整段消失
  //   [补] parseJdSmartText：API 返回的是 JSON/纯文本时没有 DOM，必须有这条路
  // ============================================================================

  // ============================================================================
  // 合并版 JD 解析：DOM 有状态遍历(element 感知打分) + 文本兜底
  //
  // 架构取自你的 parseJdSmartMultiSignal：按渲染顺序遍历块 → 遇标题切换当前小节 →
  // 其余内容归入当前小节。这个结构比"先压成文本再按位置切片"更好，因为打分时
  // element 还在手上，className/id/tagName 都能用。
  //
  // 在此基础上修掉三个实测失分点，并补上纯文本路径：
  //   [修] \b 对中文无效 + 全角冒号未处理 → 中文标题一个都识别不出
  //   [修] 无停止小节 → Benefits/EEO/公司介绍 一路污染最后一个小节
  //   [修] unspecified(前言) 被丢弃 → 岗位概述整段消失
  //   [补] parseJdSmartText：API 返回的是 JSON/纯文本时没有 DOM，必须有这条路
  // ============================================================================

  // ============================================================================
  // 合并版 JD 解析：DOM 有状态遍历(element 感知打分) + 文本兜底
  //
  // 架构取自你的 parseJdSmartMultiSignal：按渲染顺序遍历块 → 遇标题切换当前小节 →
  // 其余内容归入当前小节。这个结构比"先压成文本再按位置切片"更好，因为打分时
  // element 还在手上，className/id/tagName 都能用。
  //
  // 在此基础上修掉三个实测失分点，并补上纯文本路径：
  //   [修] \b 对中文无效 + 全角冒号未处理 → 中文标题一个都识别不出
  //   [修] 无停止小节 → Benefits/EEO/公司介绍 一路污染最后一个小节
  //   [修] unspecified(前言) 被丢弃 → 岗位概述整段消失
  //   [补] parseJdSmartText：API 返回的是 JSON/纯文本时没有 DOM，必须有这条路
  // ============================================================================

 const SECTION_VOCAB = [
    {
      type: 'responsibilities',
      tiers: [
        { weight: 0.85, phrases: [
          '岗位职责', '工作职责', '职责描述', '主要职责', '核心职责', '工作内容',
          '岗位描述', '职位描述', '职位职责', '工作内容及职责', '职责范围', '工作任务',
          'Responsibilities', 'Key Responsibilities', 'Primary Responsibilities',
          'Core Responsibilities', 'Main Responsibilities', 'Job Responsibilities',
          'Duties and Responsibilities', 'Essential Duties', 'Essential Functions',
          "What You'll Build"
        ] },
        { weight: 0.65, phrases: [
          "What you'll do", 'What you will do', "What You'll Be Doing","What You'll Build",
          'Your Day-to-Day', 'About the Role', 'Role Overview', 'Role Summary',
          '主要工作', '主要负责', '负责内容', '你将负责', '工作重点', '负责',
          '我们在找', '我们在招', '负责搭建',
        ] },
      ],
    },
    {
      type: 'requirements',
      tiers: [
        { weight: 0.85, phrases: [
          '任职要求', '任职资格', '岗位要求', '招聘条件', '职位要求', '能力要求',
          '任职条件', '基本要求', '资格要求', '技能要求', '经验要求', '学历要求', '硬性要求',
          'Requirements', 'Job Requirements', 'Qualifications', 'Basic Qualifications',
          'Minimum Qualifications', 'Required Qualifications', 'Required Skills',
          'Required Experience', 'Technical Requirements', 'Candidate Profile',
          'Non-Negotiables', 'What We Need From You',
        ] },
        { weight: 0.65, phrases: [
          "What we're looking for", 'Who You Are', "What You'll Bring", 'What You Need',
          'Must Have', 'Must-have', 'Key Skills', '你需要具备', '我们需要你', '我们希望你',
        ] },
      ],
    },
    {
      type: 'preferred',
      tiers: [
        { weight: 0.85, phrases: [
          '加分项', '优先条件', '优先考虑', '加分技能', '优先经验',
          'Preferred Qualifications', 'Preferred Experience', 'Preferred Skills',
          'Additional Qualifications', 'Nice to Have', 'Nice-to-have', 'Bonus Points',
          'Strong Signal',
        ] },
        { weight: 0.65, phrases: [
          '具备以下者优先', '有相关经验者优先', '属于加分项',
          'Bonus points for', 'A plus', 'Would be a plus', 'Strong plus',
        ] },
      ],
    },
    // 以下两类是"停止小节"：命中后正文收集结束，不再归入前三类
    {
      type: 'benefits',
      tiers: [{ weight: 0.85, phrases: [
        '福利待遇', '员工福利', '薪酬福利', '公司福利', '员工待遇',
        'Benefits', 'Employee Benefits', 'Perks', 'What We Offer', 'Total Rewards',
        'What You Get',
      ] }],
    },
    {
      type: 'compensation',
      tiers: [{ weight: 0.85, phrases: [
        '薪资范围', '薪酬待遇', '年薪', '月薪',
        'Salary', 'Compensation', 'Salary Range', 'Pay Range', 'Base Salary',
      ] }],
    },
    {
      type: 'other',
      tiers: [{ weight: 0.85, phrases: [
        '公司简介', '关于我们', '企业文化', 'About Us', 'About the Company',
        'Our Story', 'Why Join Us', 'Equal Opportunity', 'EEO', 'How to Apply',
        'What This Is Not',
      ] }],
    },
  ];

  // const STOP_SECTIONS = new Set(['benefits', 'compensation', 'other']);
   const STOP_SECTIONS = new Set([
    '福利待遇','薪资福利','公司简介','关于我们','企业文化','工作地点','投递方式','我们提供',
    'Benefits','What We Offer','Perks','Perks and Benefits','Compensation','Salary','Pay Range',
    'Working Conditions','Work Environment','Physical Requirements',
    'EEO Statement','Equal Opportunity','Equal Employment Opportunity','EEO',
    'About Us','About the Company','Our Story','Our Mission','Why Join Us','Who We Are',
    'How to Apply','Application Process','Next Steps','Disclaimer','Legal',"What We Offer"
  ])

  // ⚡ 归一化：把真实页面里的各种写法变体收敛到同一形态再匹配。
  // 实测这一步能解决一大半漏判——弯引号、全角括号、连字符/&、多余空白。
  function normalizeForMatch(s) {
    return String(s || '')
      .replace(/[\u2018\u2019\u02bc]/g, "'")      // 弯引号 → 直引号
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/[\u2010-\u2015\u2212]/g, '-')      // 各种破折号 → 连字符
      .replace(/[（）]/g, (m) => (m === '（' ? '(' : ')'))
      .replace(/\s*&\s*/g, ' and ')                // & → and
      .replace(/-/g, ' ')                          // 连字符与空格等价
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  // 中文短语足够独特（"岗位职责"几乎不可能出现在非标题语境的正文短行里），
  // 直接用包含匹配，不再要求特定的前后缀字符——之前要求前缀必须是空白/项目符号，
  // 导致"一、岗位职责""1.岗位职责""（一）岗位职责"这类编号标题全部漏判。
  function matchPhrase(normText, phrase) {
    const p = normalizeForMatch(phrase);
    if (/[\u4e00-\u9fa5]/.test(p)) return normText.includes(p);
    // 英文：词边界匹配，并容忍词尾复数
    const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\b)${esc}(?:e?s)?(?:\\b|[:：]|$)`, 'i').test(normText);
  }

  // ⚡ 核心词正则（你提的思路）：词表覆盖不到的写法用"含核心词"兜底。
  // 权重压得低，单独出现过不了阈值，必须叠加排版/DOM 证据才成立——
  // 这样既能捞回"主要负责""职位职责"这类变体，又不会把正文里提到
  // "负责"的普通句子误判成标题。
  const CORE_PATTERNS = [
    { type: 'responsibilities', weight: 22, re: /(职责|负责|工作内容|responsibilit|duties|what you.{0,4}(ll|will) do)/i },
    { type: 'requirements',     weight: 22, re: /(要求|资格|条件|qualificat|requirement|what (we|you).{0,4}(re |ll )?(looking|bring|have))/i },
    { type: 'bonus',            weight: 22, re: /(加分|优先|preferred|nice to have|bonus|desirable|a plus)/i },
  ];

  // 最长匹配优先：解决 "Preferred Qualifications" 被 "Qualifications" 抢走
  // 判成 requirements 的问题（同权重时，命中的短语越长越具体，应该赢）。
  function matchVocab(text) {
    const normText = normalizeForMatch(text);
    let best = { type: null, keywordScore: 0, len: 0 };
    for (const cfg of SECTION_VOCAB) {
      for (const tier of cfg.tiers) {
        for (const p of tier.phrases) {
          if (!matchPhrase(normText, p)) continue;
          const len = normalizeForMatch(p).length;
          if (tier.weight > best.keywordScore || (tier.weight === best.keywordScore && len > best.len)) {
            best = { type: cfg.type, keywordScore: tier.weight, len };
          }
        }
      }
    }
    if (!best.type) {
      for (const c of CORE_PATTERNS) {
        if (c.re.test(normText) && c.weight > best.keywordScore) {
          best = { type: c.type, keywordScore: c.weight, len: 0 };
        }
      }
    }
    return best;
  }

  function isStopSection(text) {
    const t = text.trim().replace(/[:：\s]+$/, '').toLowerCase();
    return STOP_SECTIONS.some((w) => t === w.toLowerCase());
  }

  // ---------------------------------------------------------------------------
  // 多维打分：DOM 维度 + 排版维度 + 语义维度
  // ---------------------------------------------------------------------------
  function assessSectionHeader(element, text) {
    const isCJKText = /[\u4e00-\u9fa5]/.test(text);

    // 一票否决：项目符号开头的绝不是标题
    if (/^[*•▪◦●\-–]\s+/.test(text)) return { isHeader: false, score: 0, type: null };

    // ⚡ 数字编号不再一律否决。"1.岗位职责" 是标题，"1.负责推荐算法设计" 是列表项，
    // 两者的区别不在编号而在长度：标题短、列表项长。以前一刀切否决，导致中文
    // JD 里极常见的 "1.岗位职责" "2.任职资格" 全被判成列表项而漏掉。
    const numbered = /^\d+[.、)）]\s*\S/.test(text) || /^[一二三四五六七八九十]+[、.]\s*\S/.test(text);
    const bare = text.replace(/^[（(]?[\d一二三四五六七八九十]+[）)]?[.、)）]?\s*/, '');
    if (numbered && bare.length > (isCJKText ? 12 : 30)) {
      return { isHeader: false, score: 0, type: null };
    }

    let domScore = 0;
    if (element && element.tagName) {
      const tag = element.tagName.toLowerCase();
      // className 在 SVG 元素上是对象，统一转字符串
      const cls = typeof element.className === 'string' ? element.className : (element.getAttribute?.('class') || '');
      const idName = element.id || '';
      if (/^h[1-3]$/.test(tag)) domScore += 35;
      else if (/^h[4-6]$/.test(tag)) domScore += 25;
      else if (tag === 'b' || tag === 'strong') domScore += 20;
      else if (tag === 'dt') domScore += 20;
      // ⚡ class/id 语义信号——这是纯文本路径拿不到的证据，也是不同平台
      // "职责和要求 class 不一样"时最可靠的线索
      if (/header|title|section|heading|caption|label|subtitle/i.test(cls + ' ' + idName)) domScore += 30;
      // 反向信号：一看就是正文/描述容器
      if (/(desc|content|body|text|paragraph)/i.test(cls + ' ' + idName) && !/title|header|heading/i.test(cls + ' ' + idName)) domScore -= 10;
    }

    let layoutScore = 0;
    const isCJK = isCJKText;
    if (/[:：]\s*$/.test(text)) layoutScore += 25;
    if (text.length <= (isCJK ? 20 : 40)) layoutScore += 20;
    if (!isCJK && text === text.toUpperCase() && /[A-Z]{3,}/.test(text)) layoutScore += 18;
    if (/[.。]$/.test(text) && !/[:：]$/.test(text)) layoutScore -= 20;
    if (text.length > (isCJK ? 40 : 80)) layoutScore -= 40;
    // 叙述句特征
    if (/(?:we\s+are|you\s+will|our\s+team|looking\s+for\s+a|我们正在|如果你)/i.test(text) && text.length > 30) layoutScore -= 35;

    const { type, keywordScore } = matchVocab(text);
    const totalScore = domScore + layoutScore + keywordScore;
    const headingLen = isCJKText ? 22 : 50;
    const isHeader = (totalScore >= 60 && keywordScore > 0)
      || (domScore >= 35 && keywordScore >= 25 && text.length <= headingLen);
    return { isHeader, type, score: totalScore };
  }

  // ---------------------------------------------------------------------------
  // 按渲染顺序拆块。相比原版修了两处：
  //   - <li> 单独成块（原版 UL 的子元素是 LI，不在 some() 的标签清单里，
  //     导致整个 UL 被当成一个叶子块，所有列表项糊成一坨）
  //   - 直系文本节点不再丢失（原版 else 分支只遍历 element.children）
  // ---------------------------------------------------------------------------
  const LEAFY = /^(P|LI|H[1-6]|DT|DD|TD|TH|BLOCKQUOTE)$/i;
  const CONTAINER = /^(DIV|SECTION|ARTICLE|UL|OL|DL|TABLE|TBODY|TR|MAIN|SPAN|BODY)$/i;

  function getVisualTextBlocks(node) {
    const blocks = [];
    const walk = (el) => {
      if (!el || !el.tagName) return;
      const tag = el.tagName;
      if (/^(SCRIPT|STYLE|NOSCRIPT|SVG)$/i.test(tag)) return;

      if (LEAFY.test(tag)) {
        const t = (el.textContent || '').trim();
        if (t) blocks.push({ element: el, text: t });
        return;
      }
      if (/^(H[1-6]|STRONG|B)$/i.test(tag)) {
        const t = (el.textContent || '').trim();
        if (t) blocks.push({ element: el, text: t });
        return;
      }
      if (CONTAINER.test(tag)) {
        // 先看有没有值得下钻的子元素；没有就把自己整体作为一块
        const hasElementChild = el.children && el.children.length > 0;
        if (!hasElementChild) {
          const t = (el.textContent || '').trim();
          if (t) blocks.push({ element: el, text: t });
          return;
        }
        // 有子元素：逐个 childNode 处理，直系文本节点也要保留（原版会丢）
        for (const child of Array.from(el.childNodes)) {
          if (child.nodeType === 3) { // TEXT_NODE
            const t = (child.nodeValue || '').trim();
            if (t) blocks.push({ element: el, text: t });
          } else if (child.nodeType === 1) {
            walk(child);
          }
        }
        return;
      }
      // 其它标签(如 <a>/<em>)：并入父级由父级处理，这里只兜底取文本
      const t = (el.textContent || '').trim();
      if (t) blocks.push({ element: el, text: t });
    };
    walk(node);
    return blocks;
  }

  // ---------------------------------------------------------------------------
  // 主入口（DOM 路径）
  // ---------------------------------------------------------------------------
  function parseJdFromDom(containerNode) {
    // ⚡ 块内换行必须再拆一层。很多站点(含 LinkedIn 的 description 容器)把整段 JD
    // 放在一个文本节点里、只用 \n 分行，getVisualTextBlocks 会把它当成"一个块"，
    // assessSectionHeader 拿一整坨去判定当然不是标题 → 全部落进 intro →
    // 最终全塞进 responsibilities。这正是"页面上全显示到职责"的直接原因。
    const blocks = [];
    for (const b of getVisualTextBlocks(containerNode)) {
      if (b.text.includes('\n')) {
        for (const line of b.text.split('\n')) {
          const t = line.trim();
          if (t) blocks.push({ element: b.element, text: t, __split: true });
        }
      } else {
        blocks.push(b);
      }
    }
    const buckets = { intro: [], responsibilities: [], requirements: [], bonus: [] };
    let current = 'intro'; // ⚡ 第一个标题之前的内容不再丢弃，归入 intro

    for (const blk of blocks) {
      const { element, text } = blk;
      const blockIsSplit = !!blk.__split;
      const t = text.trim();
      if (!t) continue;

      // 停止小节：只认"看起来像标题"的短行，且必须已经进入过真实小节
      // （开头的 About Us / 公司简介 是开场白，不是结尾样板）
      if (current !== 'intro' && t.length <= 40 && isStopSection(t)) break;

      const a = assessSectionHeader(blockIsSplit ? null : element, t);
      if (a.isHeader && a.type) { current = a.type; continue; }
      buckets[current].push(t);
    }

    // intro 并入 responsibilities 前部（岗位概述本质上属于"做什么"）
    const resp = [...buckets.intro, ...buckets.responsibilities].join('\n').trim();
    return {
      responsibilities: resp,
      requirements: buckets.requirements.join('\n').trim(),
      bonus: buckets.bonus.join('\n').trim(),
      fullCleanText: blocks.map((b) => b.text).join('\n').trim(),
    };
  }

  // ---------------------------------------------------------------------------
  // 纯文本路径（API/JSON 返回时没有 DOM，这条必须保留）
  // 复用同一套词表和停止小节，保证两条路结论一致。
  // ---------------------------------------------------------------------------
  function looksLikeHeadingLine(s) {
    s = s.trim();
    if (!s || s.length > 60) return false;
    if (/^##\s/.test(s) || /[:：]$/.test(s) || /^【.+】$/.test(s) || /^#+\s/.test(s)) return true;
    const isCJK = /[\u4e00-\u9fa5]/.test(s);
    if (!isCJK && s.length <= 45 && !/[.!?]$/.test(s)) {
      if (s === s.toUpperCase() && /[A-Z]{3,}/.test(s)) return true;
      const w = s.split(/\s+/);
      const small = ['a','an','the','and','or','of','to','for','in','you','we','your','our','will','be','with'];
      if (w.length <= 6 && w.every((x) => !/^[a-z]/.test(x) || small.includes(x.toLowerCase()))) return true;
    }
    return isCJK && s.length <= 20 && !/[。！？]$/.test(s);
  }

  function normalizeAndMergeLines(text) {
    const lines = text.split('\n');
    const bullet = /^([•▪◦●\-*]|[\d一二三四五六七八九十]+[.、)）])\s*/;
    const out = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) { out.push(''); continue; }
      const prev = out[out.length - 1];
      const canMerge = prev
        && !bullet.test(line) && !looksLikeHeadingLine(line)
        && !/[。！？.!?:：；;]$/.test(prev) && !bullet.test(prev) && !looksLikeHeadingLine(prev)
        && /^[a-z(,;)]/.test(line); // 只有小写开头才算折行续写
      if (canMerge) out[out.length - 1] = prev + ' ' + line;
      else out.push(line);
    }
    return out.filter(Boolean).join('\n');
  }

  function parseJdFromText(rawText) {
    const result = { responsibilities: '', requirements: '', bonus: '', fullCleanText: '' };
    if (!rawText || typeof rawText !== 'string') return result;
    const text = normalizeAndMergeLines(
      rawText.replace(/\r\n?/g, '\n').replace(/\u3000/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
    );
    result.fullCleanText = text.replace(/^##\s+/gm, '');

    const buckets = { intro: [], responsibilities: [], requirements: [], bonus: [] };
    let current = 'intro';
    for (const raw of text.split('\n')) {
      const t = raw.trim();
      if (!t) continue;
      const bare = t.replace(/^##\s+/, '');
      // ⚡ 停止小节只在"已经进入过真实小节"之后才生效。JD 以 "About Us"/"公司简介"
      // 开头极其常见，那是开场介绍标题，不是结尾样板；以前一律 break，导致
      // 整份 JD 从第一行就被丢弃，最后靠兜底把全文塞进职责（表现为完全不切分）。
      if (current !== 'intro' && bare.length <= 40 && isStopSection(bare)) break;

      // ⚡ 统一走标定过的 assessSectionHeader（element 传 null 即纯文本+排版+语义）。
      // 之前这里是另一套弱判定（looksLikeHeadingLine + keywordScore>=15），
      // 阈值远低于 DOM 路径，结果把 "1、负责推荐算法的设计" 这种列表项当成标题
      // 吞掉，正文反而丢了。两条路必须共用同一套判定，结论才会一致。
      const a = assessSectionHeader(null, bare);
      if (a.isHeader && a.type) { current = a.type; continue; }
      buckets[current].push(bare);
    }
    result.responsibilities = [...buckets.intro, ...buckets.responsibilities].join('\n').trim();
    result.requirements = buckets.requirements.join('\n').trim();
    result.bonus = buckets.bonus.join('\n').trim();
    if (!result.responsibilities && !result.requirements && !result.bonus) {
      result.responsibilities = result.fullCleanText;
    }
    return result;
  }

  // 统一入口：有 DOM 走 DOM，没有就走文本
  // function parseJdSmart(input) {
  //   if (input && typeof input === 'object' && input.nodeType === 1) return parseJdFromDom(input);
  //   const result = { responsibilities: '', requirements: '', bonus: '', fullCleanText: '' };
  //   const jdresult=window.JdParsed.parseJd(input);
  //    result.responsibilities = [...jdresult.responsibilities].join('\n').trim();
  //   result.requirements = jdresult.requirements.join('\n').join(jdresult.preferred).trim();
  //   result.bonus = jdresult.preferred.join('\n').trim();
  //   result.fullCleanText=[...jdresult.responsibilities].join('\n').join(jdresult.requirements).join("\n").join(jdresult.preferred);
  //   console.log("responsibilities",jdresult.responsibilities,"requirements",jdresult.requirements)
  //   return result;
  // }
function parseJdSmart(input) {
  if (input && typeof input === 'object' && input.nodeType === 1) return parseJdFromDom(input);
  
  const result = { responsibilities: '', requirements: '', bonus: '', fullCleanText: '' };
  const jdresult = window.JdParsed.parseJd(input);

  // 防错处理：确保即使某些字段不存在也不会崩溃（默认为空数组）
  const resp = jdresult.responsibilities || [];
  const req = jdresult.requirements || [];
  const pref = jdresult.preferred || [];

  // 1. 职责
  result.responsibilities = resp.join('\n').trim();

  // 2. 要求（将 requirements 与 preferred 两个数组合并后再 join）
  result.requirements = [...req, ...pref].join('\n').trim();

  // 3. 加分项/福利
  result.bonus = pref.join('\n').trim();

  // 4. 完整清洗文本（合并所有数组后统一 join）
  result.fullCleanText = [...resp, ...req, ...pref].join('\n').trim();

  console.log("responsibilities", resp, "requirements", req);
  return result;
}

//   function parseJdSmart(formattedText) {
//     if (!formattedText || typeof formattedText !== 'string') {
//       return { responsibilities: '', requirements: '', bonus: '', fullCleanText: '' };
//     }
//     const cleanedNewlines = formattedText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
//     const SECTION_RULES = [
//       { type: 'responsibilities', pattern: /(?:^|\n)\s*(?:[#*->\s\d.、\-[\]【】()]+)*(?:岗位职责|工作职责|职责描述|岗位描述|工作内容|职责|Responsibilities|Key\s+Responsibilities|What\s+you(?:'ll|\s+will)\s+do|Duties|Role\s+(?:&|and)\s+Responsibilities|Position\s+Summary|Overview)(?:[#*:\s\-[\]【】()]+)*(?=\n|$)/im },
//       { type: 'requirements', pattern: /(?:^|\n)\s*(?:[#*->\s\d.、\-[\]【】()]+)*(?:任职要求|任职资格|岗位要求|招聘条件|要求|Qualifications|Requirements|Basic\s+Qualifications|Minimum\s+Qualifications|What\s+(?:we're|we\s+are)\s+looking\s+for|Who\s+You\s+Are)(?:[#*:\s\-[\]【】()]+)*(?=\n|$)/im },
//       { type: 'bonus', pattern: /(?:^|\n)\s*(?:[#*->\s\d.、\-[\]【】()]+)*(?:加分项|优先条件|优先考虑|拟优先|Preferred\s+Qualifications|Nice\s+to\s+have|Bonus\s+Points?|Desirable(?:\s+Skills)?)(?:[#*:\s\-[\]【】()]+)*(?=\n|$)/im }
//     ];
//     const detected = [];
//     SECTION_RULES.forEach(({ type, pattern }) => {
//       const m = pattern.exec(cleanedNewlines);
//       if (m) detected.push({ type, startIndex: m.index, headerLength: m[0].length });
//     });
//     detected.sort((a, b) => a.startIndex - b.startIndex);

//     const result = { responsibilities: '', requirements: '', bonus: '', fullCleanText: cleanedNewlines };
//     if (!detected.length) { result.responsibilities = cleanedNewlines; return result; }

//     detected.forEach((s, idx) => {
//       const start = s.startIndex + s.headerLength;
//       const end = idx + 1 < detected.length ? detected[idx + 1].startIndex : cleanedNewlines.length;
//       const chunk = cleanedNewlines.slice(start, end).trim();
//       result[s.type] = result[s.type] ? result[s.type] + '\n' + chunk : chunk;
//     });
//     if (detected[0].startIndex > 50) {
//       const intro = cleanedNewlines.slice(0, detected[0].startIndex).trim();
//       if (intro) result.responsibilities = intro + (result.responsibilities ? '\n\n' + result.responsibilities : '');
//     }
//     return result;
//   }

  function refineDomExtractedText(rawText) {
    const cleaned = cleanText(rawText);
    const formatted = normalizeAndMergeLines(cleaned);
    return parseJdSmart(formatted);
    // return parseJdFromText(formatted);
  }

  // ⚡ DOM 路径优先：拿得到面板元素时直接走 parseJdFromDom——打分阶段
  // element 还在手上，tagName/className/id 都能当证据用（不同平台"职责和
  // 要求 class 不一样"时最有价值）。DOM 路径结果为空才退回文本路径。
  // 一份解析结果"分没分开"的判据：只有职责有内容、要求和加分全空，
  // 基本就是没切开(整份 JD 被当成一段)，不能算成功。
  function isDumpResult(r) {
    if (!r) return true;
    const resp = (r.responsibilities || '').length;
    const rest = (r.requirements || '').length + (r.bonus || '').length;
    return rest === 0 && resp > 0;
  }

// function refineFromPaneElement(paneEl, rawTextFallback) {
//     let domResult = null;
//     if (paneEl && paneEl.nodeType === 1) {
//       try {
//         const clone = paneEl.cloneNode(true);
//         clone.querySelectorAll('#job-fast-carousel-panel, [id^="jdp-"], [class^="jdp-"]').forEach((w) => w.remove());
//         // domToStructuredText 保留标题/列表结构（"## "/"• " 标记），
//         // 喂给统一的新引擎——不再单独维护 parseJdFromDom 那条路。
//         const r = refineDomExtractedText(domToStructuredText(clone));
//         if (r && (r.responsibilities || r.requirements || r.bonus)) domResult = r;
//       } catch (e) { /* DOM 结构不可预期，异常一律降级到文本路径 */ }
//     }
//     if (domResult && !isDumpResult(domResult)) return domResult;
//     const textResult = refineDomExtractedText(rawTextFallback || '');
//     if (!isDumpResult(textResult)) return textResult;
//     return domResult || textResult;
// }

  // =====================================================================
  // 4c. 通用右侧详情面板定位 —— 关键词锚点 + 向上溯源
  //     从"JD 特征词"出发找容器，比单纯几何位置+密度打分更准：
  //     先在全页找含有"岗位职责/Responsibilities"等锚点词的文本节点，
  //     向上找到第一个"文本量够大、宽度够大、且落在中右侧"的祖先容器，
  //     多个候选按 关键词命中数 + 文本长度 + 文本密度 打分，取最高分。
  //     完全找不到锚点词（比如站点用图片/自定义术语描述职责）时，
  //     才退化到 findFallbackContainer 的纯几何+密度打分兜底。
  //     优先级：站点 hint selector（更准、更快）→ 关键词锚点通用兜底
  // =====================================================================
  const JD_ANCHOR_PATTERN = /(岗位职责|工作职责|职责描述|岗位描述|工作内容|任职要求|任职资格|岗位要求|招聘条件|加分项|优先条件|职位描述|职位信息|Responsibilities|Requirements|Qualifications|What\s+you.{0,10}do|What\s+we.{0,15}looking\s+for|Job\s+Description|About\s+the\s+role|About\s+this\s+role)/i;

  // ⚡ 结构信号加分：class/id/相邻标题这些"结构层面"的线索，跟纯关键词文本
  // 匹配是互补关系——很多站点会用语义化 class 命名 JD 容器（job-description、
  // jobDescription、jd-content 等），这是比"扫到几个关键词"更直接的信号；
  // 另外候选容器内部/紧邻位置如果能找到一个像标题的元素（h1~h4/strong/b 且
  // 文本命中 JD_ANCHOR_PATTERN），说明这块确实是被一个语义化标题引出的正文，
  // 而不是页面里偶然堆了几个关键词的杂项区域。这个函数在 className/id/
  // querySelector/textContent 上工作，对"实时渲染的 DOM"和"fetch 回来解析出的
  // 游离文档"都适用（不依赖任何需要渲染布局的 API）。
  const SEMANTIC_CLASS_PATTERN = /(job[-_]?desc|jobdescription|description[-_]?content|jd[-_]?content|jd[-_]?body|posting[-_]?content|posting[-_]?body|position[-_]?desc|job[-_]?detail|content[-_]?description)/i;

  function hasNearbyHeadingContext(element) {
    const inner = element.querySelector && element.querySelector('h1, h2, h3, h4, h5, strong, b');
    if (inner && JD_ANCHOR_PATTERN.test(inner.textContent || '')) return true;
    const prevSibling = element.previousElementSibling;
    if (prevSibling && JD_ANCHOR_PATTERN.test((prevSibling.textContent || '').slice(0, 60))) return true;
    return false;
  }

  function computeStructuralBonus(element) {
    let bonus = 0;
    const classAndId = `${element.className || ''} ${element.id || ''}`;
    if (SEMANTIC_CLASS_PATTERN.test(classAndId)) bonus += 80;
    if (hasNearbyHeadingContext(element)) bonus += 30;
    return bonus;
  }

  function findFallbackContainer() {
    const blocks = document.querySelectorAll('div, section, article, main');
    const rightBoundary = window.innerWidth * 0.25;
    const MAX_TEXT_LEN = 6000; // 同样加体量上限，避免兜底路径也框出近乎整页的范围
    let best = null;
    let bestScore = -Infinity;
    blocks.forEach((node) => {
      const rect = node.getBoundingClientRect();
      if (rect.width < 200 || rect.height < 150) return;
      if (rect.left < rightBoundary) return;
      const text = (node.innerText || '').trim();
      if (text.length < 120 || text.length > MAX_TEXT_LEN) return;
      const childTagsCount = node.querySelectorAll('*').length;
      const density = text.length / (childTagsCount + 1);
      const score = text.length * 0.2 + density * 5 + computeStructuralBonus(node);
      if (score > bestScore) { bestScore = score; best = node; }
    });
    return best;
  }

  // 常见语义化 JD 容器 selector——网站开发者自己留下的最直接结构信号，
  // 命中且内容体量合理时直接用，比"扫全页文本节点找关键词"更快也更准。
  const SEMANTIC_JD_SELECTORS = '[class*="job-description" i], [class*="jobDescription" i], [class*="jd-content" i], [class*="jd-body" i], [id*="jobDescription" i], [id*="job-description" i], [class*="posting-requirements" i], [class*="description-content" i], [class*="job-detail" i],[class*="job-intro-container"]';


  function locateJdContainer() { 
    // ⚡ 结构优先快速路径：先按语义化 class/id 直接查，命中且内容体量合理就
    // 直接用，不用再跑一遍关键词锚点扫描全页文本节点。
    const semanticCandidates = Array.from(document.querySelectorAll(SEMANTIC_JD_SELECTORS));
    for (const el of semanticCandidates) {
      const text = el.innerText || '';
      const rect = el.getBoundingClientRect();
      if (text.length > 120 && text.length < 6000 && rect.width > 200) {
        console.log('⚡ [content.js] 命中语义化 class/id，直接使用:', el.className || el.id);
        return el;
      }
    }

    const viewWidth = window.innerWidth;
    const candidates = [];
    const seenElements = new Set();
    // ⚡ 修复"英文JD基本全页都提取"：根因是下面打分公式里 matches.length * 100
    // 线性放大，一个包含"相似职位/侧栏推荐"的大容器如果碰巧堆了好几个
    // "Responsibilities/Requirements"字样（每个推荐职位摘要都会各出现一次），
    // 关键词命中数量反而比真正紧凑的 JD 正文块更多，导致大容器在打分上"赢"了，
    // 越大越容易赢，最后框选出接近整页的范围。这里加三处硬约束：
    //   1. 体量硬上限（文本长度/子节点数）——超过直接放弃该候选，不参与打分
    //   2. 关键词命中数量封顶（超过 4 次边际收益归零）——避免"数量堆砌"跑赢
    //   3. 体量惩罚项——候选越大越扣分，让"刚好框住正文"的紧凑容器更有竞争力
    const MAX_TEXT_LEN = 6000;
    const MAX_CHILD_COUNT = 400;

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    let textNode;
    while ((textNode = walker.nextNode())) {
      if (!JD_ANCHOR_PATTERN.test(textNode.nodeValue)) continue;
      let parent = textNode.parentElement;
      while (parent && parent !== document.body && parent !== document.documentElement) {
        const rect = parent.getBoundingClientRect();
        const text = parent.innerText || '';
        // 启发式：文本够长(>120字) + 宽度够大(>200px) + 落在中右侧(左边界 > 25%视口宽)
        if (text.length > 120 && rect.width > 200 && rect.left > viewWidth * 0.25) {
          const childTagsCount = parent.querySelectorAll('*').length;

          if (text.length > MAX_TEXT_LEN || childTagsCount > MAX_CHILD_COUNT) {
            // 太大了，大概率把整版列表/侧栏也框进来了，放弃这条锚点
            break;
          }
          if (seenElements.has(parent)) { break; } // 同一个容器已经算过一次，跳过避免重复加分
          seenElements.add(parent);

          const density = text.length / (childTagsCount + 1);
          const matches = text.match(new RegExp(JD_ANCHOR_PATTERN, 'gi')) || [];
          const matchBonus = Math.min(matches.length, 4) * 60; // 命中次数封顶，防止"数量堆砌"跑赢
          const sizePenalty = Math.max(0, text.length - 800) * 0.05; // 体量惩罚，越大扣越多
          const structuralBonus = computeStructuralBonus(parent); // class/id/相邻标题结构信号

          candidates.push({
            element: parent,
            score: matchBonus + text.length * 0.1 + density * 5 - sizePenalty + structuralBonus
          });
          break; // 找到第一层合格容器就停止向上溯源，避免过度扩大到 body
        }
        parent = parent.parentElement;
      }
    }
    if (candidates.length === 0) {
      console.warn('⚠️ [content.js] 未找到 JD 关键词锚点，启动全屏几何+密度兜底...');
      return findFallbackContainer();
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].element;
  }

  // 标题通常是 JD 容器的"兄弟/祖先"而不是内部元素（锚点词溯源只框住了描述正文），
  // 所以先在容器内找，找不到再沿祖先链往上找同级标题，最后退化到全页右侧第一个 h1/h2。
  function locateTitleGeneric(jdContainer) {
    if (jdContainer) {
      const inner = jdContainer.querySelector('h1, h2, h3');
      if (inner) return inner.innerText.trim();
      let node = jdContainer;
      for (let i = 0; i < 4 && node && node.parentElement; i++) {
        const parent = node.parentElement;
        const sibling = parent.querySelector(':scope > h1, :scope > h2, :scope > h3');
        if (sibling) return sibling.innerText.trim();
        node = parent;
      }
    }
    const rightBoundary = window.innerWidth * 0.25;
    const headings = document.querySelectorAll('h1, h2');
    for (const h of headings) {
      const rect = h.getBoundingClientRect();
      if (rect.width > 0 && rect.left > rightBoundary) return h.innerText.trim();
    }
    return '';
  }

  function getRightPaneNode() {
    if (adapter.rightPaneSelectors) {
      const el = document.querySelector(adapter.rightPaneSelectors);
      if (el) return el;
    }
    const fallback = locateJdContainer();
    // 诊断用：控制台执行 window.__jdpDiag = true 后能看到每次调用实际
    // 找没找到面板、找到的元素是什么——智联没有专门的 adapter 配置，
    // 走的就是这条通用兜底，先确认它到底有没有命中，命中的是不是对的
    // 元素，比继续猜哪个环节出问题更直接。
    if (window.__jdpDiag) {
      console.log('%c[JDP-DIAG] getRightPaneNode (通用兜底)', 'color:#e91e63',
        fallback ? { tag: fallback.tagName, className: fallback.className, textLen: (fallback.textContent || '').length }
                 : '没有找到任何候选面板');
    }
    return fallback;
  }

  function getTitleFromPane(paneNode) {
    if (adapter.titleSelectors) {
      const el = paneNode?.querySelector(adapter.titleSelectors);
      if (el) return el.innerText.trim();
    }
    return locateTitleGeneric(paneNode);
  }

  function getDescNode(paneNode) {
    if (adapter.descSelectors) {
      const el = paneNode?.querySelector(adapter.descSelectors);
      if (el) return el;
    }
    return paneNode; // 通用兜底：locateJdContainer 已经把范围收窄到 JD 正文区块，直接取整块 innerText
  }

  function getClickTarget(cardNode) {
    if (adapter.clickTargetSelector) {
      const el = cardNode.matches?.(adapter.clickTargetSelector)
        ? cardNode
        : cardNode.querySelector(adapter.clickTargetSelector);
      if (el) return el;
      if (adapter.preferCardClick) return cardNode;
    }
    return cardNode.querySelector('a[href]') || cardNode; // 通用兜底：点卡片里第一个链接，没有就点卡片本身
  }

  // =====================================================================
  // 5. 详情提取：三级策略 —— 模拟点击(+监听) → 主动 fetch(限频兜底)
  // =====================================================================

  // ---- 两级节流器 ----
  // clickStagger: 控制"模拟点击"本身的节奏（第一/二级），比 fetch 兜底宽松很多，
  //               因为点击本身是"像真人一样操作"，不是密集主动请求。
  // directFetchLimiter: 只用来节流第三级"主动 fetch 兜底"，这条路才是真正容易触发风控的。
  const clickStagger = {
    lastClickAt: 0,
    // ⚡ 900 → 250：这个等待发生在【点击之前】，是纯粹叠加在用户感知延迟上的
    // 成本。它的本意是"避免连点太快"，但现在只有当前卡片才会点击(预取不点)，
    // 而用户手动切卡的节奏本身就远慢于此，900ms 属于白等。降到 250ms 仍然能
    // 防住"程序化连点"，但把点击路径的总耗时直接砍掉约 0.9 秒。
    minIntervalMs: 250,
    // ⚡ 可中断的等待：以前这里是一整段不可打断的 setTimeout，如果排队等点击的
    // 这段时间里用户已经切到别的卡片，这次等待还是会傻等满 900~1500ms 才轮到
    // 处理——而且点完之后还要再等最多 4.5s 的 DOM/网络观察窗口，全程没有任何
    // 机制能让"已经不相关的点击"提前让路。isStale() 每 150ms 被轮询一次，
    // 一旦发现过期就立刻放弃，不再傻等完整个等待窗口。
    async wait(isStale) {
      const now = Date.now();
      const elapsed = now - this.lastClickAt;
      const jitter = 200 + Math.random() * 400;
      let waitMs = Math.max(0, this.minIntervalMs + jitter - elapsed);
      const step = 150;
      while (waitMs > 0) {
        if (isStale && isStale()) return false; // 排队期间已经过期，放弃这次点击
        const chunk = Math.min(step, waitMs);
        await new Promise((r) => setTimeout(r, chunk));
        waitMs -= chunk;
      }
      this.lastClickAt = Date.now();
      return true;
    }
  };
  const directFetchLimiter = {
    lastCallAt: 0,
    // ⚡ 之前是 4000ms，实测你这边即使有这个间隔，请求 job/detail.json 还是会
    // 触发风控——说明这个接口对请求频率的容忍度比我们最初估计的更低。调大到
    // 8000ms 起步是个更保守的默认值，但这个数字终究是拍出来的，不是测出来的；
    // 如果你这边实测下来还是偶发触发，就继续往上调，反过来如果观察一段时间
    // 完全没触发过，也可以适当往下调，找到你这边站点实际能接受的下限。
    minIntervalMs: 3000,
    async wait() {
      const now = Date.now();
      const elapsed = now - this.lastCallAt;
      const jitter = 1000 + Math.random() * 1000;
      const waitMs = Math.max(0, this.minIntervalMs + jitter - elapsed);
      if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
      this.lastCallAt = Date.now();
    }
  };

  let directFetchRequestSeq = 0;
  function directFetchDetail(matchKey, meta) {
    return new Promise((resolve) => {
      const requestId = String(++directFetchRequestSeq);
      const timer = setTimeout(() => {
        document.removeEventListener('RESP_DIRECT_FETCH_JOB', handler);
        resolve(null);
      }, 2000);

      function handler(e) {
        const detail = e.detail || {};
        if (detail.requestId !== requestId) return;
        clearTimeout(timer);
        document.removeEventListener('RESP_DIRECT_FETCH_JOB', handler);
        resolve(detail.data || null);
      }
      document.addEventListener('RESP_DIRECT_FETCH_JOB', handler);
      document.dispatchEvent(new CustomEvent('REQ_DIRECT_FETCH_JOB', { detail: { matchKey, meta, requestId } }));
    });
  }

  // =====================================================================
  // ⚡ 第四级通用兜底：Indeed 这类站点没有已知的 JSON API，directFetchDetail
  // 必然拿不到东西。既然拿不到接口数据，就退而求其次——直接 fetch 这张卡片
  // 链接指向的详情页 HTML，解析出正文，复用前面已经验证过的
  // JD_ANCHOR_PATTERN 关键词锚点算法定位正文块，再走同一套 cleanText→
  // normalizeAndMergeLines→parseJdSmart 管线切分职责/要求。
  // 这条路径完全站点无关，不依赖任何特定网站的接口格式，是"通用方案"。
  // =====================================================================

  // 从卡片里挑出真正指向详情页的链接：卡片里通常还有配图、公司 logo、分享/
  // 收藏按钮这类无关链接，要过滤掉，只信任"同源 + 非图片/功能性路径 + 不是
  // 纯图标包裹"的候选，多个候选时优先选文本最长的（职位标题本身通常就是
  // 卡片里文本最长的可点击链接）。
  function extractDetailPageUrl(cardNode) {
    if (!cardNode) return null;
    const links = Array.from(cardNode.querySelectorAll('a[href]'));
    const candidates = links
      .map((a) => ({ el: a, href: a.href }))
      .filter(({ href, el }) => {
        if (!href) return false;
        if (/^(javascript:|mailto:|tel:|#)/i.test(href)) return false;
        if (/\.(png|jpe?g|gif|svg|webp|ico|pdf)(\?|#|$)/i.test(href)) return false; // 排除图片/文件类链接
        if (/\b(share|login|signin|signup|logout|apply|help|about|privacy|terms|company\/)\b/i.test(href)) return false; // 排除功能性/非详情链接
        try {
          const u = new URL(href, location.href);
          if (u.host !== location.host) return false; // 只信任同源，避免抓到外链广告/追踪重定向
        } catch (e) { return false; }
        const hasMeaningfulText = (el.innerText || '').trim().length > 1;
        const onlyWrapsImage = el.children.length === 1 && el.children[0].tagName === 'IMG' && !hasMeaningfulText;
        return !onlyWrapsImage; // 排除纯图片包裹的链接（配图/logo）
      });
    if (!candidates.length) return null;
    candidates.sort((a, b) => (b.el.innerText || '').length - (a.el.innerText || '').length);
    return candidates[0].href;
  }

  // 和 locateJdContainer 同一套打分逻辑（关键词命中封顶 + 体量硬上限 + 体量惩罚），
  // 但去掉了所有依赖渲染布局的几何判断（rect.left/rect.width）——因为 fetch 回来
  // 的 HTML 用 DOMParser 解析出的是游离文档，没有真正渲染过，getBoundingClientRect
  // 永远是 0，innerText 也拿不到有效值，只能退回到用 textContent 做纯文本层面的判断。
  function locateJdContainerInDoc(doc) {
    // ⚡ 结构优先快速路径，跟 locateJdContainer 同一套 selector，逻辑一致
    const semanticCandidates = Array.from(doc.querySelectorAll(SEMANTIC_JD_SELECTORS));
    for (const el of semanticCandidates) {
      const text = (el.textContent || '').trim();
      if (text.length > 120 && text.length < 8000) return el;
    }

    const candidates = [];
    const seenElements = new Set();
    const MAX_TEXT_LEN = 8000;
    const MAX_CHILD_COUNT = 500;
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null, false);
    let textNode;
    while ((textNode = walker.nextNode())) {
      if (!JD_ANCHOR_PATTERN.test(textNode.nodeValue)) continue;
      let parent = textNode.parentElement;
      while (parent && parent !== doc.body) {
        const text = (parent.textContent || '').trim();
        if (text.length > 120) {
          const childTagsCount = parent.querySelectorAll('*').length;
          if (text.length > MAX_TEXT_LEN || childTagsCount > MAX_CHILD_COUNT) break;
          if (seenElements.has(parent)) break;
          seenElements.add(parent);
          const density = text.length / (childTagsCount + 1);
          const matches = text.match(new RegExp(JD_ANCHOR_PATTERN, 'gi')) || [];
          const matchBonus = Math.min(matches.length, 4) * 60;
          const sizePenalty = Math.max(0, text.length - 800) * 0.05;
          const structuralBonus = computeStructuralBonus(parent); // 同一套 class/id/相邻标题结构信号，fetch 回来的游离文档也适用
          candidates.push({ element: parent, score: matchBonus + text.length * 0.1 + density * 5 - sizePenalty + structuralBonus });
          break;
        }
        parent = parent.parentElement;
      }
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].element;
  }

  // 原来（4636-4675行）先 parseJdFromDom，找不到/不满意再退化成 jdContainer.textContent
// 或 doc.body.textContent（纯文本、丢结构），改成统一走 domToStructuredText：
async function fetchAndParseDetailPage(cardNode) {
    const url = extractDetailPageUrl(cardNode);
    if (!url) return null;
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return null;
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      doc.querySelectorAll('script, style, noscript, nav, footer, header, aside, svg, iframe, form').forEach((el) => el.remove());

      const jdContainer = locateJdContainerInDoc(doc);
      const structuredText = domToStructuredText(jdContainer || doc.body);
      if (!structuredText || structuredText.length < 100) return null;

      const parsed = refineDomExtractedText(structuredText);
      if (!parsed.responsibilities && !parsed.requirements && !parsed.fullCleanText) return null;

      const titleEl = doc.querySelector('h1');
      return { title: titleEl ? titleEl.textContent.trim() : '', ...parsed, source: 'Detail Page Fetch (parsed HTML)' };
    } catch (e) {
      console.warn('[content.js] 拉取/解析详情页失败:', e);
      return null;
    }
}


  // ---- 第一级 + 第二级：模拟点击，同时监听 (a) 网络拦截 (b) 右侧 DOM 变化 ----
  // 干净读取右侧面板文本：clone 之后剔除插件自己的悬浮面板/自定义节点，
  // 避免我们自己的 UI（比如 #job-fast-carousel-panel）污染 JD 文本对比。
  // ⚡ 结构化文本提取：不再用 innerText。
  // innerText 会把 <li> 的项目符号丢掉（那些 • 是 CSS ::marker 生成的，不在文本里），
  // 也会把 <h3>/<strong> 这类小标题降级成普通文字——DOM 里明明存在的结构信号
  // 全被抹平了，后面只能靠纯文本特征去猜，这正是"简单 JD 也识别不出来"的上游原因。
  // 这里改成遍历 DOM，把结构直接翻译成文本标记：
  //   <li>            → "• " 前缀（恢复列表项身份）
  //   <h1>~<h6>       → "## " 前缀（明确的小标题）
  //   独立成段的 <strong>/<b> → "## " 前缀（很多站点用加粗当小标题）
  //   <br>/<p>/<div>  → 换行
  // 这样打分算法拿到的是"带结构标记的文本"，而不是被压平的一坨。
  const BLOCK_TAGS = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'TR', 'UL', 'OL', 'TABLE', 'HEADER', 'FOOTER']);
  const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

  function domToStructuredText(root) {
    const out = [];
    const walk = (node) => {
      if (!node) return;
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.nodeValue.replace(/\s+/g, ' ');
        if (t.trim()) out.push(t);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'SVG') return;

      if (tag === 'BR') { out.push('\n'); return; }

      if (tag === 'LI') {
        out.push('\n• ');
        Array.from(node.childNodes).forEach(walk);
        out.push('\n');
        return;
      }
      if (HEADING_TAGS.has(tag)) {
        out.push('\n## ');
        Array.from(node.childNodes).forEach(walk);
        out.push('\n');
        return;
      }
      // 加粗元素如果自己独占一段（父节点里没有别的实质文本），当小标题处理
      if ((tag === 'STRONG' || tag === 'B')) {
        const own = (node.innerText || node.textContent || '').trim();
        const parentText = (node.parentElement?.innerText || node.parentElement?.textContent || '').trim();
        if (own && parentText && own.length >= parentText.length - 2 && own.length <= 60) {
          out.push('\n## ');
          Array.from(node.childNodes).forEach(walk);
          out.push('\n');
          return;
        }
      }
      if (BLOCK_TAGS.has(tag)) out.push('\n');
      Array.from(node.childNodes).forEach(walk);
      if (BLOCK_TAGS.has(tag)) out.push('\n');
    };
    walk(root);
    return out.join('')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // ⚡ 轻量版：只做变化检测用。
  // 上一轮把 extractCleanRightPaneText 改成了 cloneNode(true) + domToStructuredText
  // 的完整 JS 递归遍历——但它被 120ms 的轮询每 tick 调一次，等于每秒克隆并
  // 递归遍历整个右侧面板 8 次。面板节点动辄上千个，这就是"刷新变慢"的原因。
  // 变化检测其实只需要知道"文本变没变、稳没稳"，用原生 innerText 足够快，
  // 昂贵的结构化解析留到真正要出结果时再做一次。
  function quickPaneSnapshot() {
    const rightPane = getRightPaneNode();
    if (!rightPane) return null;
    if (rightPane.id === 'job-fast-carousel-panel' || rightPane.closest('#job-fast-carousel-panel') === rightPane) return null;
    return { rightPane, rawText: (rightPane.innerText || '').trim() };
  }

  function extractCleanRightPaneText() {
    const rightPane = getRightPaneNode();
    if (!rightPane) return null;
    if (rightPane.id === 'job-fast-carousel-panel' || rightPane.closest('#job-fast-carousel-panel') === rightPane) {
      return null; // 通用几何/关键词兜底极端情况下选中了我们自己的悬浮面板，直接跳过
    }
    const clone = rightPane.cloneNode(true);
    clone.querySelectorAll('#job-fast-carousel-panel, [id^="jdp-"], [class^="jdp-"]').forEach((w) => w.remove());
    let rawText = '';
    try { rawText = domToStructuredText(clone); } catch (e) { rawText = ''; }
    // 结构化提取万一异常/结果异常短，退回 innerText，保证不比以前更差
    if (!rawText || rawText.length < 40) rawText = (clone.innerText || '').trim();
    return { rightPane, rawText };
  }

  // ⚡ "冷启动直读"只应该在页面刚加载、我们自己还一次点击都没做过的时候用一次，
  //    不能每次调用都重新判断——BOSS 这类站点点完一次之后 URL 上可能会持续带着
  //    securityId 参数(不会被替换掉)，导致"URL 包含 matchKey"这个判断在后续每次
  //    点击不同卡片时都可能因为 URL 参数堆积而误判命中，直接跳过真实点击去读一份
  //    早就过期的内容——这正是"点击中文详情策略失效"的根因。加一个会话级只用一次
  //    的开关，从根上避免这个判断被反复触发。
  let coldStartDirectReadUsed = false;

  // 稳定性读取：不是读一次就信，而是等右侧内容连续 stableWindowMs 没有再变化
  // 才认为是真正加载完成的正文——避免把"加载过程中的一句摘要/骨架文案"
  // （比如领英过渡态里一闪而过的简短摘要）当成完整详情接受下来。
  function waitForStableRightPane({ timeout = 2000, stableWindowMs = 450 } = {}) {
    return new Promise((resolve) => {
      let lastText = null;
      let stableTimer = null;
      let finished = false;
      const finish = (result) => {
        if (finished) return;
        finished = true;
        clearTimeout(stableTimer);
        clearTimeout(hardTimeout);
        observer.disconnect();
        resolve(result);
      };
      const check = () => {
        const extracted = quickPaneSnapshot();
        const rawText = extracted?.rawText || '';
        if (rawText.length <= 20 || /加载中|loading/i.test(rawText.slice(0, 80))) { lastText = null; return; }
        if (rawText === lastText) return; // 已经在等这份内容稳定，不用重设定时器
        lastText = rawText;
        clearTimeout(stableTimer);
        stableTimer = setTimeout(() => {
          // const parsed = refineFromPaneElement(extracted && extracted.rightPane, rawText);
         const parsed = refineDomExtractedText(rawText);
         console.log("after",parsed)
          if (parsed.responsibilities || parsed.requirements || parsed.fullCleanText) {
            finish({ rightPane: extracted.rightPane, rawText, parsed });
          }
        }, stableWindowMs);
      };
      const observer = new MutationObserver(check);
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      check();
      const hardTimeout = setTimeout(() => finish(null), timeout);
    });
  }

  // ⚡ 你提的"直接读 Vue state/props"——实现在这里，作为轮询里的快路径。
  // BOSS 是 Vue 应用，右侧详情面板的数据在组件实例内部，通常比 DOM 更早可用
  // （数据到了但还没渲染完），而且是结构化的、不用做文本清洗，质量也更高。
  // Vue 2 在 DOM 元素上挂 __vue__，Vue 3 挂 __vueParentComponent。
  // ⚠️ 生产构建是否暴露这些内部字段没有保证（Vue 3 的 __vueParentComponent 在
  // 部分构建下会被裁掉），所以这里只当"能拿到就赚了"的快路径，拿不到就静默
  // 返回 null，正常走后面的 DOM 轮询，不影响原有链路。
  // 用 window.__jdpDiag = true 可以看到它每次尝试的结果。
  const JD_STATE_KEYS = ['postDescription', 'jobDescription', 'description', 'jobDesc', 'positionDesc'];

  function pickJdFromStateObject(obj, depth = 0, seen = new Set()) {
    if (!obj || typeof obj !== 'object' || depth > 4 || seen.has(obj)) return null;
    seen.add(obj);
    for (const k of JD_STATE_KEYS) {
      const v = obj[k];
      if (typeof v === 'string' && v.length > 100) {
        return { text: v, title: obj.jobName || obj.title || obj.jobTitle || '' };
      }
    }
    for (const key in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
      if (key.startsWith('$') || key.startsWith('_')) continue; // 跳过框架内部循环引用
      const v = obj[key];
      if (v && typeof v === 'object') {
        const sub = pickJdFromStateObject(v, depth + 1, seen);
        if (sub) return sub;
      }
    }
    return null;
  }

  function readDetailFromFrameworkState() {
    try {
      const pane = getRightPaneNode();
      if (!pane) return null;
      // 从右侧面板节点向上找挂着组件实例的祖先
      let el = pane;
      for (let i = 0; i < 8 && el; i++) {
        const v2 = el.__vue__;                    // Vue 2
        const v3 = el.__vueParentComponent;       // Vue 3
        const buckets = [];
        if (v2) buckets.push(v2.$data, v2.$props, v2);
        if (v3) buckets.push(v3.props, v3.setupState, v3.data, v3.ctx);
        for (const b of buckets) {
          const hit = pickJdFromStateObject(b);
          if (hit && hit.text) {
            const cleaned = refineDomExtractedText(hit.text.replace(/<[^>]+>/g, '\n'));
            if (cleaned.responsibilities || cleaned.requirements || cleaned.fullCleanText) {
              if (window.__jdpDiag) console.log('%c[JDP-DIAG]', 'color:#0a66c2', '✅ 直接从框架 state 读到 JD，跳过 DOM 等待');
              return { title: hit.title || cardTitleFallback(), ...cleaned };
            }
          }
        }
        el = el.parentElement;
      }
    } catch (e) { /* 框架内部结构不可预期，任何异常都静默降级到 DOM 轮询 */ }
    return null;
  }
  function cardTitleFallback() { return ''; }

  async function simulateClickAndListen(cardNode, matchKey, basicInfo, options = {}) {

    const { timeout = 2000, generation } = options;
    const tEnterFn = Date.now();
    if (adapter.panelScopeGuard && !adapter.panelScopeGuard()) return null;

    // ⚡ 代际过期检查：每次 ensureDetailsAroundCurrent 被调用（也就是"当前卡片"
    // 变了）都会让 activeGeneration 自增。如果这次点击任务携带的 generation
    // 跟当前最新的对不上，说明用户早就切到别的卡片去了，这次点击已经没有意义。
    const isStale = () => generation !== undefined && generation !== activeGeneration;
    if (isStale()) return null;

    // ⚡ 冷启动直读：只在本次会话第一次调用、且是 LinkedIn（currentJobId= 这个
    // URL 参数会被整体替换，不会像 BOSS 的 securityId 那样持续堆积在 URL 上，
    // 判断更可靠）时才尝试。不再是单次读取即信，而是等内容稳定下来才接受，
    // 避免把加载过程中的过渡态短文本当成正文。
    if (!coldStartDirectReadUsed && SITE === 'linkedin' && matchKey) {
      coldStartDirectReadUsed = true; // 不管这次成不成功，都只尝试这一次
      const urlMatched = new RegExp(`[=/]${matchKey}(?:[&/]|$)`).test(location.href);
      if (urlMatched) {
        console.log(`⚡ [content.js] URL 已指向该职位(${matchKey})，尝试冷启动直读（等待内容稳定）`);
        const stable = await waitForStableRightPane({ timeout: 1500 });
        if (stable) {
          const newHeaderTitle = getTitleFromPane(stable.rightPane);
          return { title: basicInfo.title || newHeaderTitle, ...stable.parsed, matchKey, source: 'URL-matched Stable Read' };
        }
        console.log('⚡ [content.js] 冷启动直读未等到稳定内容，回退到正常点击流程');
      }
    }

    // 节流：控制"点击"本身的节奏，避免后台预取和当前卡片渲染同时/过快连点。
    // ⚡ 可中断——排队等待期间用户切到别的卡片，直接放弃这次点击，不浪费
    // 一次真实点击(也不占用后续的 4.5s 观察窗口去等一个没人关心的结果)。
    const proceeded = await clickStagger.wait(isStale);
    if (!proceeded || isStale()) {
      console.log(`⚡ [content.js] 排队等待点击期间已经切到别的卡片，放弃这次点击: ${matchKey || basicInfo.cardId}`);
      return null;
    }
    // ⚡ 分段计时：把"点击路径到底慢在哪一段"直接打出来，不用再猜。
    // 输出形如: ⏱ [耗时] card=xxx | 节流等待 260ms | 站点响应 780ms | 合计 1040ms
    const tClickStart = Date.now();
    const tStaggerCost = tClickStart - tEnterFn;

    const cardTitle = basicInfo.title || '';
    const before = quickPaneSnapshot();
    const oldDescText = before?.rawText || '';

    cardNode.style.outline = '2px solid #00bebd';
    // cardNode.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const clickableTarget = getClickTarget(cardNode);
    // ⚡ 修复"读取失败刷新会导致整页刷新(BOSS)"：原来这里只拦截了
    // a[target="_blank"] 的默认跳转——但那种链接本来就是开新标签页，不会导致
    // 当前页面刷新，真正的风险反而是没有 target="_blank" 的普通 <a href>：
    // 如果 getClickTarget 选中的元素本身就是（或包在）这样一个链接里，
    // 站点自己的 SPA 拦截逻辑万一没接管这次模拟点击（比如用 element.click()
    // 触发的是非可信事件，某些框架的点击拦截逻辑对这种事件处理不一致），
    // 浏览器就会执行链接的默认行为——同标签页整页跳转/刷新。我们的模拟点击
    // 目的自始至终都是"让站点自己更新右侧详情面板"，从来不需要真的发生页面
    // 跳转，所以这里直接无条件阻止默认动作，不再区分是不是 target="_blank"。
    const preventJump = (e) => { e.preventDefault(); };
    clickableTarget.addEventListener('click', preventJump, { capture: true, once: true });
    // ⚡ 崩溃检测的"落笔"点：点击前记一笔"即将点这张卡"，正常流程结束时
    // （不管成功还是超时）都会调 clearPendingClick() 擦掉它。如果这次点击
    // 导致了整页刷新，脚本会跟着页面一起被销毁，代码走不到 clearPendingClick()，
    // 标记就会留在 sessionStorage 里，被下次脚本重新注入时的检测逻辑读到。
    markPendingClick(matchKey || basicInfo.cardId);
    // ⚡ 通用"点击相关性捕获"：告诉 injected.js"接下来这个窗口内出现的 JD 形状
    // 响应，都算这张卡的"。这样即使站点的详情接口 URL 我们不认识、payload 里的
    // ID 字段名我们也不知道，只要它在点击后返回了一段像 JD 的正文，就能正确
    // 归属到这张卡片上——这是不依赖任何站点专属知识的兜底机制。
    document.dispatchEvent(new CustomEvent('REQ_BEGIN_CAPTURE', {
      detail: { cardId: String(matchKey || basicInfo.cardId) }
    }));
    clickableTarget.click();
    // console.log("点击监听")
    return new Promise((resolve) => {
      let isFinished = false;
      let staleCheckTimer = null;
      let pendingBest = null;      // { rank, srcName, payload } —— 优先级仲裁用
      let graceTimer = null;
      const pollTimers = [];
      const cleanup = () => { cardNode.style.outline = ''; };
      const finalize = () => {
        isFinished = true;
        if (staleCheckTimer) clearInterval(staleCheckTimer);
        if (graceTimer) clearTimeout(graceTimer);
        pollTimers.forEach((t) => { clearInterval(t); clearTimeout(t); });
        if (matchKey) detailWaiters.delete(String(matchKey));
        cleanup();
        clearPendingClick();
        // 关闭捕获窗口：injected.js 会把窗口内攒到的最佳候选(如果有)发出来。
        // 注意这个发出来的结果不一定被本次 Promise 接住(可能已经 resolve 了)，
        // 但它一定会经 JOB_HOOK_DETAIL 走进 detailCache，不会浪费。
        document.dispatchEvent(new CustomEvent('REQ_END_CAPTURE'));
      };

      // ⚡ 优先级仲裁：三个信号源(state/network/dom)是同一次点击的三个观察面，
      // 天然在赛跑。这里不再"谁先到用谁"，而是按 CLICK_SOURCE_PRIORITY 仲裁：
      // 低优先级的源先到时，先扣住不 resolve，等 SOURCE_GRACE_MS 看高优先级的
      // 会不会追上；追上就用高优先级的，没追上再用先到的那个。
      // 代价是最多 SOURCE_GRACE_MS(250ms) 的额外延迟，换取按平台配置的数据质量。
      const sourcePriority = CLICK_SOURCE_PRIORITY[SITE] || CLICK_SOURCE_PRIORITY.generic;

      const settleWith = (srcName, payload) => {
        const total = Date.now() - tEnterFn;
        const siteCost = Date.now() - tClickStart;
        console.log(`⏱ [耗时] card=${matchKey || basicInfo.cardId} | 节流 ${tStaggerCost}ms | 站点响应+检测 ${siteCost}ms | 合计 ${total}ms | 来源 ${srcName}`);
        finalize();
        resolve(payload);
      };

      // 任何一个源拿到数据都走这里，由它决定是立刻采用还是再等一会儿
      const offerSource = (srcName, payload) => {
        if (isFinished) return;
        const rank = sourcePriority.indexOf(srcName);
        const effRank = rank < 0 ? 999 : rank;

        if (effRank === 0) { // 最高优先级到了，没有等待的理由
          clearTimeout(graceTimer);
          settleWith(srcName, payload);
          return;
        }
        // 记下当前最好的候选（rank 越小越好）
        if (!pendingBest || effRank < pendingBest.rank) {
          pendingBest = { rank: effRank, srcName, payload };
        }
        if (graceTimer) return; // 宽限窗口已经在跑了
        graceTimer = setTimeout(() => {
          if (isFinished || !pendingBest) return;
          settleWith(pendingBest.srcName, pendingBest.payload);
        }, SOURCE_GRACE_MS);
      };

      // ⚡ 点已经点出去了，没法收回，但"等结果"这件事可以提前放弃——真实的
      // 网络响应/DOM 变化到达时依然会正常写入 detailCache（被动监听那条路径
      // 不依赖这个 Promise 有没有人还在等），所以提前放弃等待不会丢数据，
      // 只是不再占着车道等一个用户已经不关心的结果，车道能立刻去处理真正
      // 当前的那张卡片。
      if (generation !== undefined) {
        staleCheckTimer = setInterval(() => {
          if (isFinished || !isStale()) return;
          finalize();
          console.log(`⚡ [content.js] 等待点击结果期间已经切到别的卡片，提前放弃等待(数据仍会被动写入缓存): ${matchKey || basicInfo.cardId}`);
          resolve(null);
        }, 200);
      }

      // (a) 监听网络拦截：click 触发的真实站内请求会被 injected.js 捕获并广播
      if (matchKey) {
        detailWaiters.set(String(matchKey), (detail) => {
          offerSource('network', { ...detail, matchKey, source: 'Simulated Click + Network Intercept' });
        });
      }

      // (b) 同时用 MutationObserver 兜底解析右侧面板 DOM
      //     标题匹配只做软校验（打日志），不再作为硬性拦截条件——
      //     generic 站点的标题定位本身是启发式兜底，命中率有限，卡死会导致
      //     DOM 兜底路径基本永远失败。真正判断"数据是否可用"靠：内容确实变了 +
      //     长度够 + 不是加载中占位符。
      const checkDom = () => {
        try {
          const extracted = extractCleanRightPaneText();
          if (!extracted) return null;
          const { rightPane, rawText } = extracted;
          const isDescUpdated = oldDescText ? rawText !== oldDescText : true;
          const looksLikeLoading = rawText.length < 80 && /加载中|loading/i.test(rawText);
          if (!isDescUpdated || rawText.length <= 20 || looksLikeLoading) return null;

          const newHeaderTitle = getTitleFromPane(rightPane);
          const isTitleMatched = !cardTitle || !newHeaderTitle || newHeaderTitle.includes(cardTitle) || cardTitle.includes(newHeaderTitle);
          if (!isTitleMatched) {
            console.log('[content.js] 标题未完全匹配，仍采用当前内容（软校验，不拦截）：', { cardTitle, newHeaderTitle });
          }

          // const parsed = refineFromPaneElement(rightPane, rawText);
          const parsed =refineDomExtractedText(rawText);
          if (parsed.responsibilities || parsed.requirements || parsed.fullCleanText) {
            return { title:  cardTitle, ...parsed };
          }
        } catch (err) { console.warn('解析右侧面板异常:', err); }
        return null;
      };

      // ⚡ 性能根因修复：原来这里是"每次 DOM 变化就重置 350ms 防抖计时器"。
      // 问题在于 observe 的是 document.body + subtree:true，捕获的是【整个页面】
      // 的所有变化——BOSS 页面上聊天挂件、埋点、懒加载图片、动画都在持续制造
      // mutation，甚至【我们自己的 renderGalleryCards 更新看板 DOM 也会触发它】。
      // 只要页面上的 mutation 间隔小于 350ms，这个计时器就永远在被重置、
      // 永远等不到"安静 350ms"这个条件，checkDom() 根本没机会执行，最后只能
      // 硬等 4500ms 超时。这就是"页面明明 1 秒就刷新好了，我们却要 5 秒"的答案。
      //
      // 改成固定间隔轮询 + 内容稳定判定，不再有"重置"语义。
      // state 源不需要等稳定（结构化数据到了就是到了）；dom 源需要连续两次一致。
      const POLL_MS = 120;
      const STABLE_TICKS = 2; // 连续 2 次(240ms)内容不变即认为稳定
      let lastSeenText = null;
      let stableCount = 0;
      let stateOffered = false;

      const pollTimer = setInterval(() => {        if (isFinished) return;

        // 源① state：直接读框架内部状态（Vue/React），最快、最干净
        if (!stateOffered) {
          const fromState = readDetailFromFrameworkState();
          if (fromState) {
            stateOffered = true;
            offerSource('state', { ...fromState, matchKey, source: 'Framework State Read' });
            if (isFinished) return;
          }
        }

        // 源② dom：轮询右侧面板文本
        const extracted = quickPaneSnapshot();
        const rawText = extracted?.rawText || '';
        const isDescUpdated = oldDescText ? rawText !== oldDescText : true;
        const looksLikeLoading = rawText.length < 80 && /加载中|loading/i.test(rawText);
        if (!isDescUpdated || rawText.length <= 20 || looksLikeLoading) { stableCount = 0; return; }

        if (rawText === lastSeenText) {
          stableCount++;
          if (stableCount >= STABLE_TICKS) {
            const parsed = checkDom();
            if (parsed) offerSource('dom', { ...parsed, matchKey, source: 'Simulated Click + DOM Parse' });
          }
        } else {
          lastSeenText = rawText;
          stableCount = 0;
        }
      }, POLL_MS);
      pollTimers.push(pollTimer);

      // ⚡ 提前 flush 捕获窗口：让 injected.js 里攒着的低置信度候选也有机会在
      // 本次观察窗口内被采纳，而不是等到 finalize() 之后才发出来（那时 Promise
      // 已经结束，等于白攒）。高置信度候选在 injected.js 侧是立即发出的，
      // 这里只是给"分数不够高但确实只有它"的情况一个兜底机会。
      const flushTimer = setTimeout(() => {
        if (isFinished) return;
        document.dispatchEvent(new CustomEvent('REQ_END_CAPTURE'));
      }, Math.max(600, timeout - 1200));
      pollTimers.push(flushTimer);

      setTimeout(() => {
        if (isFinished) return;
        finalize();
        resolve(null); // 点击+监听都没拿到，交给第三级 fetch 兜底
      }, timeout);
    });
  }

  // ---- 总调度：按 点击→监听→fetch 顺序尝试，命中即缓存 ----
  // ⚡ 新增 allowClick 开关：只有"当前正在看的这张卡"才允许模拟点击。
  //   原因见 ensureDetailsAroundCurrent 的注释——点击会改变站点自己右侧面板的
  //   选中状态，连续点击多张卡片做预取，等于快速切换站点自己的选中项，
  //   站点自身的异步响应/渲染很容易跟不上、乱序，这是"当前卡片显示的详情
  //   其实是后面第 N 张卡片内容"这类错位读取的根源。预取阶段完全不点击，
  //   只走被动缓存命中 + 主动 fetch，牺牲一点预取命中率换取正确性，且不
  //   依赖任何站点特有的时序假设，是通用方案而不是专门适配某一个站点。
  // =====================================================================
  // 站点级详情获取策略——每个站点声明自己的优先级顺序，按需调整，不用改核心逻辑。
  //   'click'     —— 模拟点击 + 被动监听（同一动作两个观察面：网络拦截优先，
  //                   DOM兜底），触发的是站点自己会发生的流量，不算额外请求
  //   'fetch'     —— 主动调用站点已知的 JSON API（BOSS 的 job/detail.json、
  //                   LinkedIn 的 voyager API），是我们自己额外发起的请求，
  //                   受 directFetchLimiter 限频
  //   'pageFetch' —— 没有已知 JSON API 时，直接 fetch 详情页 HTML 解析正文，
  //                   同样受限频
  // 'click' 策略内部会自动处理"点击风险名单"和"节点已脱离文档"两种不安全场景
  // （不安全就直接判定这一级不适用，跳到下一级），不需要在策略顺序表里手动排除。
  // =====================================================================
  // =====================================================================
  // 按平台配置取数优先级
  //   SITE_STRATEGY_ORDER  —— 大策略顺序（cache 永远最先，在 ensureJobDetail 里）
  //   CLICK_SOURCE_PRIORITY —— 'click' 这一级内部三个信号源谁优先：
  //       'state'   = 直接读框架内部状态(Vue/React)，最快、最干净
  //       'network' = 点击触发站点自己的 XHR，被 injected.js 拦截
  //       'dom'     = 轮询右侧面板 DOM 文本
  //     三者是同一次点击的三个观察面，天然在赛跑。优先级的作用是：当低优先级
  //     的源先到时，先等 SOURCE_GRACE_MS 看看高优先级的会不会跟上，跟上就用
  //     高优先级的结果；没跟上再用低优先级的——用很小的延迟换数据质量。
  // =====================================================================
  const SITE_STRATEGY_ORDER = {
    // BOSS：缓存 → 点击(页面读取优先) → fetch 兜底。
    // 点击是唯一安全路径(站点自己的流量)，fetch 是风控高危，只在点击拿不到时用。
    boss: ['click', 'fetch'],
    // LinkedIn：接口优先。页面刷新慢、接口限制少，voyager API 已验证可行。
    linkedin: ['fetch', 'click', 'pageFetch'],
    // 智联：当前卡优先模拟点击 + 拦截站内详情接口；预取如果拿得到岗位 number 再走接口。
    // 卡片里的 a 经常是公司页，禁用 pageFetch，避免把公司页当详情页解析。
    zhaopin: ['click', 'fetch'],
    // generic：拦截优先 → 页面提取 → api → (url 兜底已并入 pageFetch)
    generic: ['click', 'pageFetch', 'fetch']
  };

  const CLICK_SOURCE_PRIORITY = {
    boss: ['state', 'dom', 'network'],       // BOSS 是 Vue，能直读状态最快；其次页面读取；拦截兜底
    linkedin: ['network', 'state', 'dom'],  // LinkedIn：拦截 > React 数据 > 页面读取
    zhaopin: ['network', 'dom', 'state'],   // 智联：接口/捕获最可靠，DOM 作为兜底
    generic: ['network', 'dom', 'state']    // 未知站点：拦截最可靠，其次页面提取
  };

  const SOURCE_GRACE_MS = 250; // 低优先级源先到时，给高优先级源的追赶窗口

  async function tryDetailStrategy(strategyName, cardNode, basicInfo, matchKey, ctx) {
    if (strategyName === 'click') {
      if (!ctx.allowClick || ctx.isClickRisky) return { detail: null, cardNode }; // 这一级不适用，交给下一级
      let targetNode = cardNode;
      if (!document.body.contains(targetNode)) {
        console.warn(`⚠️ [content.js] 卡片节点已从页面脱离(可能被站点自己的虚拟滚动回收)，尝试重新定位: ${ctx.cacheKey}`);
        const freshNode = findLiveNodeByCardId(basicInfo.cardId);
        if (!freshNode) {
          console.warn(`⚠️ [content.js] 页面上确实找不到这张卡片了，跳过点击: ${ctx.cacheKey}`);
          return { detail: null, cardNode };
        }
        targetNode = freshNode;
        const engineCardEntry = (state.engineCards || []).find((c) => c.cardId === basicInfo.cardId);
        if (engineCardEntry) engineCardEntry.node = freshNode; // 同步更新快照，避免下次又用回旧引用
      }
      const detail = await simulateClickAndListen(targetNode, matchKey, basicInfo, { generation: ctx.generation });
      console.log(SITE,detail)
      return { detail, cardNode: targetNode };
    }
    if (strategyName === 'fetch') {
      // ⚡ 本站点根本没有已知 JSON API 时，这一级必然返回 null——
      // injected.js 的 directFetchDetail 只实现了 boss/linkedin，generic 直接
      // return null。以前这里仍然会先付 directFetchLimiter 的 9~10 秒空等，
      // 再拿到一个注定的 null，是 Indeed 单卡片要二十多秒的主要来源。
      // 现在直接跳过，把时间让给真正可行的 pageFetch。
      if (!SITE_HAS_JSON_API) return { detail: null, cardNode };
      // 预取模式下如果本站点不允许预取走网络（BOSS），这一级直接跳过。
      if (!ctx.allowClick && !PREFETCH_ALLOW_NETWORK) return { detail: null, cardNode };
      if (SITE === 'boss' && !basicInfo.securityId) return { detail: null, cardNode }; // 没有 securityId，接口打不通，省一次无意义的限频等待
      if (SITE === 'zhaopin' && (!matchKey || /^h_/.test(String(matchKey)))) return { detail: null, cardNode }; // 智联没有岗位 number 时无法主动拉详情
      await directFetchLimiter.wait();
      const meta = { lid: basicInfo.lid };
      const fetched = await directFetchDetail(matchKey, meta);
      console.log(SITE,fetched)
      return { detail: fetched ? { ...fetched, source: 'Direct Fetch (JSON API)' } : null, cardNode };
    }
    if (strategyName === 'pageFetch') {
      if (adapter.disablePageFetch) return { detail: null, cardNode };
      if (!ctx.allowClick && !PREFETCH_ALLOW_NETWORK) return { detail: null, cardNode };
      await directFetchLimiter.wait();
      const pageDetail = await fetchAndParseDetailPage(cardNode);
      return { detail: pageDetail, cardNode };
    }
    return { detail: null, cardNode };
  }

  async function ensureJobDetail(cardNode, basicInfo, options = {}) {
    const { allowClick = true, generation } = options;
    const matchKey = SITE === 'boss' ? (basicInfo.securityId || basicInfo.cardId) : basicInfo.cardId;
    const cacheKey = String(basicInfo.cardId || matchKey);
    // ⚡ 失败结果不再当作"永久命中"——见 requestDetail/runLane 的
    //   同步改动，以及下面 detailCache.set 的说明
    const cached = detailCache.get(cacheKey);
    if (cached && cached.source !== 'Failed') return cached;

    // ⚡ 点击风险名单：这张卡之前点击后触发过"没有清掉 pending 标记就没了下文"
    // （大概率是整页刷新），策略顺序里的 'click' 会自动跳过，不需要在这里特殊处理。
    const isClickRisky = allowClick && clickRiskyCardIds.has(String(cacheKey));
    if (isClickRisky) {
      console.warn(`⚠️ [content.js] 卡片 ${cacheKey} 在点击风险名单里(上次点击后页面被整体刷新过)，策略顺序会跳过点击`);
    }

    const ctx = { allowClick, isClickRisky, cacheKey, generation };
    const strategyOrder = SITE_STRATEGY_ORDER[SITE] || SITE_STRATEGY_ORDER.generic;

    // ⚡ 基准测试模式：控制台执行 window.__jdpBench = true 打开。
    // 打开后会【并行】跑 fetch 和 click 两条路，把各自耗时和成败都打出来，
    // 用先返回的那个结果。这样"LinkedIn 上到底接口快还是拦截快"就有实测数据，
    // 不用靠猜。测完记得关掉——并行会让请求量翻倍。
    if (window.__jdpBench && allowClick) {
      const t0 = Date.now();
      const mark = (name) => (r) => {
        console.log(`🏁 [BENCH] ${cacheKey} | ${name} ${r && r.detail ? '成功' : '失败/空'} 耗时 ${Date.now() - t0}ms`);
        return { name, ...r };
      };
      const racers = [
        tryDetailStrategy('fetch', cardNode, basicInfo, matchKey, ctx).then(mark('fetch(API)')),
        tryDetailStrategy('click', cardNode, basicInfo, matchKey, ctx).then(mark('click(拦截/状态/DOM)'))
      ];
      const settled = await Promise.allSettled(racers);
      const winner = settled.map((s) => s.value).find((v) => v && v.detail);
      if (winner) {
        console.log(`🏁 [BENCH] ${cacheKey} | 采用: ${winner.name}`);
        const result0 = { ...basicInfo, ...winner.detail };
        detailCache.set(cacheKey, result0);
        return result0;
      }
    }

    let detail = null;
    for (const strategyName of strategyOrder) {
      console.log(`⏳ [content.js] 按策略顺序尝试 [${strategyName}]: ${cacheKey}`);
      const result = await tryDetailStrategy(strategyName, cardNode, basicInfo, matchKey, ctx);
      cardNode = result.cardNode; // 'click' 策略如果重新定位过节点，后续策略沿用最新引用
      if (result.detail) { detail = result.detail; break; }
    }

    if (!detail) {
      detail = {
        fullCleanText: allowClick
          ? `⚠️ 已按 [${strategyOrder.join(' → ')}] 顺序尝试均未获取到详情，请稍后重试或手动点击该卡片`
          : '⏳ 该卡片尚未加载，切换到它时会自动重新获取',
        source: 'Failed'
      };
    }

    const existingAfterAttempt = detailCache.get(cacheKey);
    if (existingAfterAttempt && existingAfterAttempt.source !== 'Failed' && detail.source === 'Failed') {
      return existingAfterAttempt;
    }

    const result = { ...basicInfo, ...detail };
    // ⚡ 失败/待加载的结果依然写缓存（这样 UI 有占位文案可以显示），但用
    //   source==='Failed' 这个标记区分，requestDetail/runLane 命中
    //   缓存时会专门跳过这类标记，重新触发一次流程，而不是永远读到失败占位
    detailCache.set(cacheKey, result);
    return result;
  }
  // =====================================================================
  // 桥接层 A：详情请求队列 —— 拆成两条独立车道，不再共用一条队列
  //   activeLane   ：只处理 allowClick:true 的任务（当前卡片），一次只有一个
  //   prefetchLane ：只处理 allowClick:false 的任务（预取），纯 fetch，不点击
  // 拆开的原因：以前是一条共享队列，如果用户切卡时正好有一个"慢"的预取 fetch
  // 任务在处理中（directFetchLimiter 内部有 4~5 秒的限频等待），当前卡片的
  // 点击请求哪怕设了 priority 提到队首，也得等这个正在处理中的任务彻底结束——
  // 这正是"读取时间变慢"的原因。点击和纯 fetch 之间并不存在真正的资源冲突
  // （点击操作 DOM，fetch 只是发网络请求），完全可以并行跑，拆成两条车道后
  // 当前卡片的点击不会再被别的卡片的预取 fetch 卡住。
  // =====================================================================
  const activeLane = [];
  const prefetchLane = [];
  let activeLaneRunning = false;
  let prefetchLaneRunning = false;

  function findEngineCardById(cardId) {
    return (state.engineCards || []).find((c) => c.cardId === cardId) || null;
  }

  function requestDetail(cardId, { priority = false, allowClick = true, generation } = {}) {
    const cached = detailCache.get(String(cardId));
    if (cached && cached.source !== 'Failed') return Promise.resolve(cached);
    const engineCard = findEngineCardById(cardId);
    if (!engineCard) return Promise.resolve(null);

    const lane = allowClick ? activeLane : prefetchLane;
    const existing = lane.find((t) => t.cardId === cardId);
    if (existing) {
      if (generation !== undefined) existing.generation = generation; // 换成最新的代际号，旧的失效判断跟着更新
      if (priority) {
        const idx = lane.indexOf(existing);
        if (idx > 0) { lane.splice(idx, 1); lane.unshift(existing); }
      }
      return new Promise((resolve) => existing.resolvers.push(resolve));
    }

    // 如果这张卡之前作为"预取"任务还排在 prefetchLane 里没处理完，
    // 而这次是要当"当前卡片"点击查看——从 prefetchLane 里摘掉，
    // 改投到 activeLane，避免同一张卡片同时占两条车道
    if (allowClick) {
      const idxInPrefetch = prefetchLane.findIndex((t) => t.cardId === cardId);
      if (idxInPrefetch >= 0) {
        const promoted = prefetchLane.splice(idxInPrefetch, 1)[0];
        promoted.allowClick = true;
        promoted.generation = generation;
        return new Promise((resolve) => {
          promoted.resolvers.push(resolve);
          if (priority) activeLane.unshift(promoted); else activeLane.push(promoted);
          runActiveLane();
        });
      }
    }

    return new Promise((resolve) => {
      const task = { cardId, resolvers: [resolve], allowClick, generation };
      if (priority) lane.unshift(task); else lane.push(task);
      if (allowClick) runActiveLane(); else runPrefetchLane();
    });
  }

  async function runLane(lane) {
    while (lane.length) {
      const { cardId, resolvers, allowClick, generation } = lane.shift();

      // ⚡ 修复"预取只有前几张有效，第4张开始要等"：
      // 预取(allowClick:false)最终都要落到 directFetchLimiter 限频的 fetch 上，
      // 那个限频器强制两次请求间隔 ~4.5~5.5 秒。如果用户切卡片的速度比这个快，
      // prefetchLane 里会越积越多——排在后面的任务，轮到它处理时用户可能早就
      // 切过去好几张了，这张卡对当前视图已经没有意义，但它依然会老老实实占用
      // 一次限频名额，把真正还需要的后续卡片继续往后挤。这里在真正消耗限频
      // 名额之前先检查一下：这张卡是不是还在 currentIndex+1..+PREFETCH_LOOKAHEAD 的预取窗口内，
      // 不在了就直接丢弃(不占用限频名额)，省下来的名额留给真正还需要的卡片。
      // 丢弃不等于永久放弃——record._detailLoaded 还是 false，等用户真的翻到
      // 这张卡附近时，ensureDetailsAroundCurrent 会重新把它排进来。
      if (!allowClick) {
        const idx = state.filteredDatalist.findIndex((r) => r.id === cardId);
        const stillRelevant = idx >= 0 && idx > state.currentIndex && idx <= state.currentIndex + PREFETCH_LOOKAHEAD;
        if (!stillRelevant) {
          resolvers.forEach((r) => r(null));
          continue;
        }
      } else {
        // ⚡ 修复"快速连续切卡时，中途经过的卡片会被逐个真实点击、请求停不下来"：
        // 快速切换时，每一张短暂路过的卡片都会在切过去的瞬间被当成"当前卡片"
        // 塞进 activeLane 排队（虽然靠 priority 插队到前面优先处理，但更早排队
        // 的那些并不会被移出队列）。如果不做限制，队列会在你早就停下来之后，
        // 还在后台把路过的每一张都点一遍——既没有意义（你已经不关心那些卡片
        // 了），又会不必要地增加撞上"点击导致整页刷新"这类站点异常行为的次数
        // （越是快速划过的卡片，越可能对应站点自己已经虚拟滚动回收掉的节点，
        // 恰恰是最容易触发这种问题的）。这里只在这张卡此刻仍然是
        // state.currentIndex 指向的那条记录时，才值得真正点它。
        const curRecord = state.filteredDatalist[state.currentIndex];
        const stillCurrent = curRecord && curRecord.id === cardId;
        if (!stillCurrent) {
          resolvers.forEach((r) => r(null));
          continue;
        }
      }

      const cached = detailCache.get(String(cardId));
      if (cached && cached.source !== 'Failed') { resolvers.forEach((r) => r(cached)); continue; }
      const engineCard = findEngineCardById(cardId);
      if (!engineCard) { resolvers.forEach((r) => r(null)); continue; }
      let result = null;
      try { result = await ensureJobDetail(engineCard.node, engineCard.basicInfo, { allowClick, generation }); } catch (e) { console.warn('详情提取异常:', e); }
      resolvers.forEach((r) => r(result));
    }
  }

  async function runActiveLane() {
    if (activeLaneRunning) return;
    activeLaneRunning = true;
    await runLane(activeLane);
    activeLaneRunning = false;
  }

  async function runPrefetchLane() {
    if (prefetchLaneRunning) return;
    prefetchLaneRunning = true;
    await runLane(prefetchLane);
    prefetchLaneRunning = false;
  }


  // =====================================================================
  // 桥接层 B：引擎"发现卡片" → UI"渲染记录"
  //   - runPipeline: 扫描 DOM，新卡片先以占位文案推入 state.rawDatalist 立即渲染，
  //     详情异步补齐，不阻塞列表出现的速度
  //   - ensureRecordDetail: 对单条记录发起详情提取，完成后原地更新并按需重渲染；
  //     失败的结果不会被当成"已加载"锁死，下次切回这张卡会自动重新尝试
  //   - ensureDetailsAroundCurrent: 当前卡片(允许点击) + 预取后面 2 张(只读缓存/fetch)
  // =====================================================================
  async function ensureRecordDetail(record, options = {}) {
    const { allowClick = true, generation } = options;
    if (!record || record._detailLoaded) return;
    const loadingField = allowClick ? '_detailLoadingClick' : '_detailLoadingPrefetch';
    if (record[loadingField]) return;
    if (!allowClick && record._detailLoadingClick) return;
    record[loadingField] = true;
    record._detailLoading = true;
    const isPriority = state.filteredDatalist[state.currentIndex] === record;
    const detail = await requestDetail(record.id, { priority: isPriority, allowClick, generation });
    record[loadingField] = false;
    record._detailLoading = Boolean(record._detailLoadingClick || record._detailLoadingPrefetch);
    if (!detail) return;

    const isFailed = detail.source === 'Failed';
    if (isFailed && record._detailLoaded) return;
    // ⚡ 失败/待加载不算"已加载完成"——_detailLoaded 保持 false，下次这条记录
    //   再被 ensureDetailsAroundCurrent 碰到（比如用户切走再切回来）时，
    //   最上面的 guard 不会拦住它，会重新发起一次请求，而不是永远显示缓存里
    //   的失败占位文案
    record._detailLoaded = !isFailed;
    record.title = detail.title || record.title;
    record.fullText = detail.fullCleanText || record.fullText;
    record.respText = detail.responsibilities || (isFailed ? detail.fullCleanText : t('respisNull'));
    record.reqText = detail.requirements || (isFailed ? '' : t('reqisNull'));

    // ⚡ 详情刚加载完成时，如果当前有生效的关键词过滤，需要重新跑一次过滤——
    // 这条记录之前是按"标题/公司/地点"这些基础字段过滤的（见 applyFiltersAndRender
    // 的说明），现在正文有了，可能应该被排除关键词命中、或者本来因为没命中
    // 包含关键词而被排除的记录现在应该被纳入。只有真正拿到内容（非失败）才需要
    // 重新过滤，失败占位文案不该参与关键词匹配。
    const hasActiveFilter = state.filterConfig.excludeKeywords.trim() || state.filterConfig.includeKeywords.trim();
    if (!isFailed && hasActiveFilter) {
      applyFiltersAndRender();
      return;
    }

    // 只有这条记录仍在可见范围（active/prev/next）才重渲染，避免无意义整卡片刷新
    const visibleWindow = state.filteredDatalist.slice(Math.max(0, state.currentIndex - 1), state.currentIndex + 2);
    if (visibleWindow.includes(record)) renderGalleryCards();
  }

  // ⚡ 代际计数器：每次"当前卡片"发生变化就自增，携带旧代际号的点击任务
  // 一旦发现自己的代际号跟最新的对不上，就知道自己已经过期，可以提前放弃
  // 排队/等待，而不是傻等完整个点击+观察周期才被发现"其实早就没用了"。
  // 这是修"快速连续切卡时请求会堵塞"的关键——不只是"不再发起新的过时请求"，
  // 而是"已经在进行中的过时请求也能提前让路"。
  let activeGeneration = 0;

  // ⚡ 防抖：切换频繁时，中途路过的卡片从一开始就不发起请求，而不是发起了
  // 又靠 isStale() 很快中止。isStale 那套解决的是"已经在等的请求能不能
  // 尽快让路"，这里解决的是更早一步的"要不要一开始就发起"——两者不冲突，
  // 一起用效果更好：真正快速划过的卡片，完全不占用限频名额/请求开销。
  const ENSURE_DETAILS_DEBOUNCE_MS = 400;
  let ensureDetailsDebounceTimer = null;

  function ensureDetailsAroundCurrent() {
    // 代际号立刻自增，不防抖——这一步只是把"上一个还没写完的旧请求"标记
    // 成过期，让它尽快通过 isStale() 检查提前放弃等待，晚了只会让旧请求
    // 多占一会儿车道，没有任何好处。
    activeGeneration++;
    const myGeneration = activeGeneration;

    if (ensureDetailsDebounceTimer) clearTimeout(ensureDetailsDebounceTimer);
    ensureDetailsDebounceTimer = setTimeout(() => {
      ensureDetailsDebounceTimer = null;
      const list = state.filteredDatalist;
      if (!list.length) return;
      const cur = list[state.currentIndex];
      // 只有真正在看的这张卡允许模拟点击，带上当前代际号
      if (cur) ensureRecordDetail(cur, { allowClick: true, generation: myGeneration });
      // 预取后面 PREFETCH_LOOKAHEAD 张：绝不模拟点击，只走被动缓存命中 + 主动
      // fetch —— 见 ensureJobDetail 的策略顺序注释，这是修掉"current+2"这类
      // 错位读取的关键改动。BOSS 这个数字比其它站点大很多，见上面常量定义。
      // 预取任务不点击，不需要代际取消（runLane 里已经有基于位置的 stillRelevant
      // 检查在做同样的事）。
      // ⚡ 这个循环天然就是"滑动窗口"：ensureRecordDetail 内部一进来就检查
      // record._detailLoaded，已经加载过的（比如上一次窗口就覆盖到了）
      // 直接跳过，不会重复请求——正常翻页时窗口只往前挪一格，新进窗口的
      // 只有最后那一张，实际每次只有1个新请求，不是重新请求整个窗口。
      for (let i = 1; i <= PREFETCH_LOOKAHEAD; i++) {
        const next = list[state.currentIndex + i];
        if (next) ensureRecordDetail(next, { allowClick: false });
      }
    }, ENSURE_DETAILS_DEBOUNCE_MS);
  }

  async function runPipeline() {
    mountGalleryToFilterBar();

    const cardNodes = getTargetJobCards();
    if (!cardNodes.length) return;

    // 引擎侧卡片索引：requestDetail 通过 cardId 在这里查找 DOM 节点 + basicInfo
    state.engineCards = cardNodes.map((node) => {
      const cardId = resolveCardId(node);
      const basicInfo = extractBasicInfo(node, cardId);
      return { node, basicInfo, cardId };
    });

    let addedNew = false;
    state.engineCards.forEach(({ node, basicInfo, cardId }) => {
      if (processedJobIds.has(cardId)) return;
      processedJobIds.add(cardId);
      addedNew = true;

      const linkEl = node.tagName === 'A' ? node : node.querySelector('a[href]');
      let targetUrl = linkEl ? linkEl.href : (node.baseURI || '');
      // ⚡ 修复"点击领英详情页打开的还是筛选页"：LinkedIn 卡片里抓到的 <a href>
      // 通常是 /jobs/search/?currentJobId=xxx 这种"搜索页+选中态"的链接格式，
      // 新开一个标签页打开时上下文（筛选条件/滚动位置）都不在，看起来就是一个
      // 空的筛选页。LinkedIn 其实有一个真正独立的单职位详情页格式
      // /jobs/view/{id}/，cardId 对 LinkedIn 来说就是这个数字 ID，直接拼出
      // 干净的详情页链接，不依赖卡片里抓到的原始 href。
      if (SITE === 'linkedin' && /^\d+$/.test(String(cardId))) {
        targetUrl = `https://www.linkedin.com/jobs/view/${cardId}/`;
      }

      state.rawDatalist.push({
        id: cardId,
        title: basicInfo.title || '未知职位',
        rawSalary: basicInfo.salary || t('salary'),
        url: targetUrl,
        rawNode: node,
        location: basicInfo.location || '暂无地点',
        company: basicInfo.company || '未知公司',
        fullText: t('detaileloding'),
        respText: t('detaileloding'),
        reqText: t('detaileloding'),
        _detailLoaded: false,
        _detailLoading: false,
        _detailLoadingClick: false,
        _detailLoadingPrefetch: false
      });
    });

    if (addedNew) applyFiltersAndRender();
  }

  function initObserver() {
    let debounce = null;
    const observer = new MutationObserver((mutations) => {
      const isSelfMutation = mutations.every((m) => m.target.closest && m.target.closest('#jdp-gallery-wrapper'));
      if (isSelfMutation) return;
      clearTimeout(debounce);
      debounce = setTimeout(() => runPipeline(), 300);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.__jdpObserver = observer;
  }

  function startSPAGuard() {
    // 只在看板真的从 DOM 里消失时才重新挂载+抓取，不无条件每 tick 都跑——
    // 这正是上次帮你定位的"universal_layout 正常 / test 不正常"那个 bug 的教训。
    setInterval(() => {
      const wrapper = document.getElementById('jdp-gallery-wrapper');
      if (!wrapper || !document.body.contains(wrapper)) {
        mountGalleryToFilterBar();
        runPipeline();
      }
    }, 1500);
  }

  // =====================================================================
  // UI 全局状态（来自 test.js；engineCards 是桥接层新增字段；
  //   processedJobIds 复用引擎那份，不重复声明）
  // =====================================================================
  const state = {
    rawDatalist: [],
    filteredDatalist: [],
    currentIndex: 0,
    currentGroupStart: 0,   // 当前显示的这一组第一张卡片在 filteredDatalist 里的下标
    pendingGroupJump: null, // 'end' = 一旦有新卡片入列，组起点自动跳到新数据处
    engineCards: [],
    filterConfig: {
      excludeKeywords: '外包,996',
      includeKeywords: '',
      companyTypes: []
    }
  };
  const GROUP_SIZE = 15;

  // ==========================================
  // UI 挂载与结构生成 (Gallery UI Builder) —— 来自 test.js，原样保留
  // ==========================================
  let galleryWrapperInstance = null;

  function findFilterCandidates() {
    const selector = [
      '[role="toolbar"]', '[role="search"]', 'form',
      '[class*="filter" i]', '[class*="condition" i]', '[class*="search-bar" i]', '[class*="select-bar" i]'
    ].join(',');

    let candidates = Array.from(document.querySelectorAll(selector));
    if (candidates.length === 0) {
      candidates = Array.from(document.querySelectorAll('div, section, nav')).filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.top >= 0 && rect.top <= 500 && rect.height > 20 && rect.height < 200;
      });
    }
    return candidates;
  }

  function getFilterItems(node) {
    if (!node) return [];
    const nativeElements = Array.from(node.querySelectorAll('button, select, input, [role="button"], [role="radio"]'));
    const customDivItems = Array.from(node.querySelectorAll('div, span, a')).filter((child) => {
      const text = child.innerText ? child.innerText.trim() : '';
      if (!text || text.length > 10) return false;
      const hasIcon = child.querySelector('svg, i, em, [class*="icon" i], [class*="arrow" i], [class*="caret" i]');
      const hasActionAttr = child.hasAttribute('ka') || child.hasAttribute('data-event') || child.onclick;
      const className = (child.className || '').toString().toLowerCase();
      const hasItemClass = ['label', 'item', 'option', 'btn', 'select', 'active'].some((cls) => className.includes(cls));
      return hasIcon || hasActionAttr || hasItemClass;
    });
    return Array.from(new Set([...nativeElements, ...customDivItems]));
  }

  function findBestFilterBar() {
    const candidates = findFilterCandidates();
    if (!candidates || candidates.length === 0) return null;

    const scoredList = candidates.map((node) => {
      let score = 0;
      const text = (node.innerText || '').toLowerCase();
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0 || rect.height > 400) return { node, score: -999 };

      if (node.getAttribute('role') === 'toolbar') score += 50;
      if (node.getAttribute('role') === 'search') score += 30;
      const className = (node.className || '').toString().toLowerCase();
      if (className.includes('filter')) score += 25;
      if (className.includes('condition')) score += 25;

      const items = getFilterItems(node);
      score += items.length * 8;

      const keywords = ['城市', '经验', '学历', '薪资', '公司', '规模', '行业', 'filter', 'salary', 'experience'];
      keywords.forEach((kw) => { if (text.includes(kw)) score += 6; });

      if (rect.top >= 0 && rect.top <= 450) score += 20;
      if (text.length > 600) score -= 40;
      return { node, score };
    });

    scoredList.sort((a, b) => b.score - a.score);
    return scoredList[0] && scoredList[0].score >= 20 ? scoredList[0].node : null;
  }

  function getOrCreateGalleryWrapper(filterConfig = { excludeKeywords: '', includeKeywords: '', companyTypes: [] }) {
    if (galleryWrapperInstance) return galleryWrapperInstance;

    const wrapper = document.createElement('div');
    wrapper.id = 'jdp-gallery-wrapper';
    wrapper.style.cssText = `
      width: 100% !important; max-width: 1200px !important; clear: both !important;
      margin: 12px auto 20px auto !important; box-sizing: border-box !important;
      display: block !important; position: relative !important; float: none !important;
      z-index: 99 !important;
    `;

    wrapper.innerHTML = `
      <style>
        #jdp-gallery-box {
          width: 100%; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px;
          padding: 16px 20px; box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          box-shadow: 0 4px 20px rgba(0,0,0,0.03); overflow: hidden; position: relative;
          transition: all 0.3s ease;
        }
        .jdp-header { display: flex; justify-content: space-between; align-items: center; }
        .jdp-title { font-size: 15px; font-weight: bold; color: #0f172a; display: flex; align-items: center; gap: 8px; }
        .jdp-header-actions { display: flex; align-items: center; gap: 8px; }
        .jdp-btn {
          padding: 5px 10px; border-radius: 8px; font-size: 12px; font-weight: 600;
          cursor: pointer; border: 1px solid #cbd5e1; background: #ffffff; color: #334155;
          transition: all 0.2s ease; display: inline-flex; align-items: center; gap: 4px; user-select: none;
        }
        .jdp-btn:hover { background: #2563eb; color: #ffffff; border-color: #2563eb; }
        .jdp-btn-active { background: #eff6ff; border-color: #3b82f6; color: #2563eb; }

        #jdp-filter-panel {
          background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px;
          padding: 12px 16px; margin-top: 12px; display: none; flex-direction: column; gap: 10px;
        }
        #jdp-filter-panel.show { display: flex; }
        .jdp-filter-row { display: flex; align-items: center; gap: 10px; font-size: 12px; color: #334155; }
        .jdp-filter-label { font-weight: bold; width: 80px; flex-shrink: 0; color: #475569; }
        .jdp-input {
          flex: 1; padding: 5px 8px; border: 1px solid #cbd5e1; border-radius: 6px;
          font-size: 12px; outline: none; transition: border-color 0.2s;
        }
        .jdp-input:focus { border-color: #2563eb; }
        .jdp-checkbox-group { display: flex; gap: 10px; align-items: center; }
        .jdp-checkbox-label { display: flex; align-items: center; gap: 4px; cursor: pointer; user-select: none; }

        .jdp-card-stage {
          /* ⚡ 修复"卡片超出看不见"：.jdp-card 是 absolute 定位，不会撑大这里的
             自动高度；.jdp-card 现在 max-height 到 640px，这里的 min-height
             必须真正大于等于"卡片高度 + top 偏移"，否则会被外层 #jdp-gallery-box
             的 overflow:hidden 从底部裁掉。 */
          width: 100%; min-height: 680px; position: relative;
          display: flex; align-items: flex-start; justify-content: center;
          padding-top: 10px; margin-top: 12px; box-sizing: border-box; transition: all 0.3s ease;
          cursor: grab; touch-action: pan-y; /* 允许纵向滚动，横向交给拖拽手势 */
        }
        .jdp-card-stage.dragging { cursor: grabbing; }
        .jdp-card-stage.dragging .jdp-card { transition: none; } /* 拖拽过程中关掉过渡动画，跟手 */
        #jdp-gallery-box.is-folded .jdp-card-stage {
          height: 0 !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; overflow: hidden; opacity: 0; pointer-events: none;
        }

        .jdp-arrow {
          position: absolute; top: 220px; transform: translateY(-50%); z-index: 50;
          width: 44px; height: 44px; background: #ffffff; border: 1px solid #e2e8f0;
          border-radius: 50%; display: flex; align-items: center; justify-content: center;
          font-size: 18px; color: #475569; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.08);
          transition: all 0.2s ease; user-select: none;
        }
        .jdp-arrow:hover { background: #2563eb; color: #fff; border-color: #2563eb; transform: translateY(-50%) scale(1.1); }
        .jdp-arrow.left { left: 10px; }
        .jdp-arrow.right { right: 10px; }

        /* ------- 卡片尺寸/结构参照 content_backend.js 的设计 ------- */
        .jdp-card {
          position: absolute; width: 680px; background: #ffffff; top: 10px;
          border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; box-sizing: border-box;
          display: flex; flex-direction: column; justify-content: space-between;
          cursor: pointer; transition: all 0.45s cubic-bezier(0.25, 1, 0.5, 1);
          box-shadow: 0 4px 12px rgba(0,0,0,0.03); pointer-events: auto;
          /* ⚡ 修复"文字太多卡片显示不全"：卡片本身要有高度上限 + overflow:hidden，
             下面 .jdp-card-body 的 overflow-y:auto 才有约束边界能真正生效滚动，
             否则父级没有高度限制，子级的 flex:1 + overflow-y:auto 形同虚设，
             卡片会无限撑高、内容被裁切或溢出。 */
          max-height: 1000px; overflow: hidden;
        }
        .jdp-card.active {
          transform: translateX(0) scale(1); z-index: 30; opacity: 1;
          border-color: #93c5fd; box-shadow: 0 20px 35px -10px rgba(37, 99, 235, 0.15), 0 8px 15px -6px rgba(0,0,0,0.05);
        }
        .jdp-card.prev { transform: translateX(-360px) scale(0.82); z-index: 20; opacity: 0.5; max-height: 400px; overflow: hidden; }
        .jdp-card.next { transform: translateX(360px) scale(0.82); z-index: 20; opacity: 0.5; max-height: 400px; overflow: hidden; }
        .jdp-card.hidden-left { transform: translateX(-580px) scale(0.6); z-index: 10; opacity: 0; pointer-events: none; }
        .jdp-card.hidden-right { transform: translateX(580px) scale(0.6); z-index: 10; opacity: 0; pointer-events: none; }

        .jdp-card-header {
          border-bottom: 1px solid #f1f5f9; padding-bottom: 12px; margin-bottom: 14px;
          display: flex; justify-content: space-between; align-items: flex-start;
        }
        .jdp-card-title { font-size: 18px; font-weight: bold; color: #0f172a; line-height: 1.3; }
        .jdp-card-salary { font-size: 20px; font-weight: bold; color: #ef4444; margin-top: 4px; }

        /* 职责/要求两个区块常驻显示（不再是可展开的抽屉），参照 content_backend.js
           的 .jdp-section 设计；这里改名成 .jdp-card-section* 避免跟深度报告
           弹窗里同名的 .jdp-section（技能碰撞/AI诊断那部分）撞车 */
        .jdp-card-body {
          display: flex; flex-direction: column; gap: 14px; margin-bottom: 14px; overflow-y: auto; flex: 1;
          /* ⚡ 修复"职责/要求超出卡片"：flex 子项默认 min-height:auto，
             意味着它拒绝收缩到比自身内容更小，overflow-y:auto 就永远不会真正
             生效——内容只会把卡片撑高，被外层 .jdp-card 的 overflow:hidden
             直接裁掉，而不是产生滚动条。必须显式设 min-height:0 才能让
             flex 子项真正被压缩到父级剩余空间内，滚动条才会出现。 */
          min-height: 0;
        }
        .jdp-card-section { background: #f8fafc; padding: 14px; border-radius: 10px; border-left: 4px solid #2563eb; max-height:260px;overflow-y:hidden}
        .jdp-card-section.req { border-left-color: #10b981; }
        .jdp-card-section-label { font-size: 13px; font-weight: bold; color: #475569; margin-bottom: 8px; }
        .jdp-card-section-content {
          font-size: 13px; line-height: 1.6; color: #334155; white-space: pre-line; word-break: break-all;
          /* 每个区块单独限高+独立滚动，避免"职责"特别长的时候把"要求"完全挤出
             可视范围之外——用户至少能同时看到两个区块的标题和一部分内容 */
          max-height: 220px; overflow-y: auto;
        }
        .jdp-card-footer { font-size: 11px; color: #94a3b8; text-align: center; padding-top: 8px; border-top: 1px dashed #e2e8f0; }
        .jdp-empty-tips { padding: 60px 0; text-align: center; color: #64748b; font-size: 14px; }

        .linkedin-fast-highlight {
          outline: 3px solid #2563eb !important; box-shadow: 0 0 15px rgba(37, 99, 235, 0.6) !important; transition: all 0.3s ease;
        }

        /* ------- 整合时补充：动作按钮 / 深度报告弹窗（原先渲染出来但没样式/没绑定） ------- */
        .jdp-btn-group { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
        .jdp-action-btn {
          padding: 4px 10px; background: #10b981; color: #fff; border-radius: 6px;
          font-size: 11px; font-weight: bold; border: none; cursor: pointer; transition: all 0.2s ease;
        }
        .jdp-action-btn:hover { background: #059669; }
        .jdp-open-link-btn {
          padding: 4px 10px; background: #2563eb; color: #fff; border-radius: 6px;
          font-size: 11px; font-weight: bold; border: none; cursor: pointer; transition: all 0.2s ease;
        }
        .jdp-open-link-btn:hover { background: #1d4ed8; }
        .jdp-refresh-btn {
          padding: 4px 8px; background: #f1f5f9; color: #475569; border-radius: 6px;
          font-size: 12px; font-weight: bold; border: 1px solid #cbd5e1; cursor: pointer; transition: all 0.2s ease;
        }
        .jdp-refresh-btn:hover { background: #e2e8f0; }
        .jdp-refresh-btn.spinning { animation: jdp-spin 0.8s linear infinite; pointer-events: none; opacity: 0.6; }
        .jdp-card-match {
          padding: 4px 10px; border-radius: 8px; cursor: pointer; font-size: 11px;
          border: 1px solid #cbd5e1; background: #f8fafc; transition: all 0.2s ease; text-align: center;
        }
        .jdp-card-match:hover { transform: translateY(-1px); box-shadow: 0 4px 10px rgba(0,0,0,0.08); }
        .pulse-animation { animation: jdp-pulse 1.4s ease-in-out infinite; }
        @keyframes jdp-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

        .jdp-modal-backdrop {
          position: fixed; inset: 0; background: rgba(15, 23, 42, 0.55); z-index: 999999;
          display: flex; align-items: center; justify-content: center;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        .jdp-modal-content {
          width: 560px; max-width: 92vw; max-height: 82vh; background: #fff; border-radius: 16px;
          overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
        .jdp-modal-header { padding: 16px 20px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
        .jdp-modal-header h3 { margin: 0; font-size: 16px; color: #0f172a; }
        .jdp-modal-header .subtitle { margin: 4px 0 0; font-size: 12px; color: #64748b; }
        .jdp-modal-close { background: transparent; border: none; font-size: 22px; color: #94a3b8; cursor: pointer; line-height: 1; }
        .jdp-modal-close:hover { color: #334155; }
        .jdp-modal-body { padding: 16px 20px; overflow-y: auto; flex: 1; }
        .jdp-modal-footer { padding: 12px 20px; border-top: 1px solid #e2e8f0; display: flex; justify-content: flex-end; }
        .jdp-btn-primary { background: #2563eb; color: #fff; border: none; padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; }
        .jdp-btn-primary:hover { background: #1d4ed8; }
        .jdp-btn-secondary { background: #fff; color: #334155; border: 1px solid #cbd5e1; padding: 6px 12px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; }
        .jdp-btn-secondary:hover { background: #f1f5f9; }
        .jdp-spinner { width: 34px; height: 34px; border: 3px solid #e2e8f0; border-top-color: #2563eb; border-radius: 50%; animation: jdp-spin 0.8s linear infinite; }
        @keyframes jdp-spin { to { transform: rotate(360deg); } }
        .jdp-hero-card { display: flex; align-items: center; gap: 16px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; }
        .score-circle { width: 64px; height: 64px; border-radius: 50%; background: #2563eb; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; flex-shrink: 0; }
        .score-circle .score-val { font-size: 20px; font-weight: bold; line-height: 1; }
        .score-circle .score-unit { font-size: 10px; opacity: 0.85; }
        .score-meta h4 { margin: 0 0 4px; font-size: 14px; color: #0f172a; }
        .quota-badge { font-size: 11px; color: #64748b; }
        .jdp-alert-box { margin-top: 10px; padding: 10px 12px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; font-size: 12px; color: #92400e; }
        .jdp-grid-subscores { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 14px; }
        .subscore-card { background: #f8fafc; border-radius: 8px; padding: 8px; text-align: center; border: 1px solid #e2e8f0; }
        .subscore-card .title { display: block; font-size: 10px; color: #64748b; margin-bottom: 4px; }
        .subscore-card .score { display: block; font-size: 14px; font-weight: bold; color: #0f172a; }
        .jdp-section { margin-top: 16px; }
        .jdp-section .sec-title { font-size: 13px; font-weight: bold; color: #1e293b; margin: 0 0 8px; }
        .jdp-tags-wrapper { display: flex; flex-wrap: wrap; gap: 6px; }
        .jdp-tag { font-size: 11px; padding: 3px 8px; border-radius: 999px; }
        .jdp-tag.tag-success { background: #ecfdf5; color: #059669; }
        .jdp-tag.tag-danger { background: #fef2f2; color: #b91c1c; }
        .text-muted { font-size: 12px; color: #94a3b8; }
        .insight-item { margin-bottom: 10px; }
        .insight-label { display: block; font-size: 12px; font-weight: bold; margin-bottom: 4px; }
        .insight-label.text-green { color: #059669; }
        .insight-label.text-orange { color: #b45309; }
        .insight-label.text-blue { color: #2563eb; }
        .insight-item ul { margin: 0; padding-left: 18px; font-size: 12px; color: #334155; line-height: 1.6; }
        .jdp-error-box h4 { margin: 0 0 8px; }
      </style>

       <div id="jdp-gallery-box">
      <div class="jdp-header">
        <div class="jdp-title">🎴 ${t('panelTitle')}</div>
        <div class="jdp-header-actions">
          <button class="jdp-btn" id="jdp-btn-toggle-filter">${t('toggleFilter')}</button>
<button class="jdp-btn" id="jdp-group-prev">${t('groupPrev')}</button>
<span style="font-size:13px; color:#64748b; font-weight:bold;" id="jdp-counter">0 / 0</span>
<button class="jdp-btn" id="jdp-group-next">${t('groupNext')}</button>
<button class="jdp-btn jdp-btn-active" id="jdp-btn-toggle-fold">${t('toggleFoldCollapse')}</button>
        </div>
      </div>

      <div id="jdp-filter-panel">
        <div class="jdp-filter-row">
          <span class="jdp-filter-label">🚫 ${t('filterExcludeLabel')}</span>
          <input type="text" class="jdp-input" id="jdp-filter-exclude" placeholder="${t('filterExcludePlaceholder')}" value="${filterConfig.excludeKeywords}">
        </div>
        
        <div class="jdp-filter-row">
          <span class="jdp-filter-label">🎯${t('filterIncludeLabel')}</span>
          <input type="text" class="jdp-input" id="jdp-filter-include" placeholder="${t('filterIncludePlaceholder')}" value="${filterConfig.includeKeywords}">
        </div>

        <div class="jdp-filter-row">
          <span class="jdp-filter-label">🏢 ${t('filterCompanyTypeLabel')}</span>
          <div class="jdp-checkbox-group">
            ${t('companyTypes').map(type => `
              <label class="jdp-checkbox-label">
                <input type="checkbox" class="jdp-filter-type" value="${type}" ${filterConfig.companyTypes.includes(type) ? 'checked' : ''}>
                ${type}
              </label>
            `).join('')}
          </div>
        </div>
      </div>

      <div class="jdp-card-stage" id="jdp-stage">
        <div class="jdp-arrow left" id="jdp-btn-left">❮</div>
        <div class="jdp-arrow right" id="jdp-btn-right">❯</div>
        <div id="jdp-cards-container" style="width:100%; display:flex; justify-content:center;"></div>
      </div>
    </div>
    `;

    const foldBtn0 = wrapper.querySelector('#jdp-btn-toggle-fold');
    const galleryBox0 = wrapper.querySelector('#jdp-gallery-box');
    foldBtn0.onclick = () => {
      const isFolded = galleryBox0.classList.toggle('is-folded');
      foldBtn0.innerText = isFolded ? t("toggleFoldExpand"):t("toggleFoldCollapse");
      foldBtn0.classList.toggle('jdp-btn-active', !isFolded);
    };

    galleryWrapperInstance = wrapper;
    bindUIEvents(wrapper);
    return galleryWrapperInstance;
  }

  function bindUIEvents(wrapper) {
    const toggleFilterBtn = wrapper.querySelector('#jdp-btn-toggle-filter');
    const filterPanel = wrapper.querySelector('#jdp-filter-panel');

    toggleFilterBtn.onclick = () => {
      filterPanel.classList.toggle('show');
      toggleFilterBtn.classList.toggle('jdp-btn-active');
    };

    // ⚡ 头部"上一组/下一组"：组级翻页（见下方 switchGroup）——
    //    LinkedIn 这类真分页站点会去点站点自己的翻页按钮；BOSS 这类滚动加载站点
    //    在本地已抓取数据里按 15 条一组跳，不够一组就顺带触发滚动懒加载。
    wrapper.querySelector('#jdp-group-prev').onclick = () => switchGroup('prev');
    wrapper.querySelector('#jdp-group-next').onclick = () => switchGroup('next');
    // 舞台两侧的小箭头：保留逐条单步浏览（点击触发，不是滚轮），方便在同一组内查看其他卡片
    wrapper.querySelector('#jdp-btn-left').onclick = () => switchCardIndex(state.currentIndex - 1);
    wrapper.querySelector('#jdp-btn-right').onclick = () => switchCardIndex(state.currentIndex + 1);

    const excludeInput = wrapper.querySelector('#jdp-filter-exclude');
    const includeInput = wrapper.querySelector('#jdp-filter-include');
    const handleFilterChange = () => {
      state.filterConfig.excludeKeywords = excludeInput.value.trim();
      state.filterConfig.includeKeywords = includeInput.value.trim();
      applyFiltersAndRender();
    };
    excludeInput.oninput = handleFilterChange;
    includeInput.oninput = handleFilterChange;
    // ⚡ 按要求去掉了滚轮切卡片——原来这里有个 wrapper.addEventListener('wheel', ...)，
    //    直接删掉，滚轮滚动现在就是正常的页面滚动，不会被拦截。

    bindCardSwipeGesture(wrapper);
  }

  // ⚡ 卡片加滑动：在舞台区域支持横向拖拽/触摸滑动切卡，不用非得点箭头。
  // 用 Pointer Events 统一处理鼠标拖拽和触摸滑动。拖动距离超过阈值才判定为
  // 一次"滑动切换"，没超过阈值就当作普通点击放行——用 state._justDragged
  // 这个短暂标记告诉卡片自己的 onclick 处理器"这是一次拖拽的尾巴，别当点击处理"。
  function bindCardSwipeGesture(wrapper) {
    const stage = wrapper.querySelector('#jdp-stage');
    if (!stage) return;
    const DRAG_THRESHOLD = 60;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let dragDistance = 0;

    stage.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return; // 只响应左键/触摸
      isDragging = true;
      dragDistance = 0;
      startX = e.clientX;
      startY = e.clientY;
      stage.classList.add('dragging');
    });

    stage.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) e.preventDefault(); // 横向拖动时阻止页面滚动
      dragDistance = dx;
    }, { passive: false });

    const endDrag = () => {
      if (!isDragging) return;
      isDragging = false;
      stage.classList.remove('dragging');
      if (Math.abs(dragDistance) > DRAG_THRESHOLD) {
        if (dragDistance < 0) switchCardIndex(state.currentIndex + 1);
        else switchCardIndex(state.currentIndex - 1);
        state._justDragged = true;
        setTimeout(() => { state._justDragged = false; }, 80);
      }
      dragDistance = 0;
    };
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
  }

  function mountGalleryToFilterBar() {
    // ⚡ 关键修复：如果看板已经挂载好且还在 DOM 里，直接跳过，不重新跑
    //    findBestFilterBar()/隐藏 toolbar 这套逻辑。
    //    之前 initObserver 里每次 DOM 变化(防抖 300ms)都会调用 runPipeline()，
    //    而 runPipeline() 开头就是 mountGalleryToFilterBar()——LinkedIn 是重度
    //    SPA，DOM 变化极其频繁，这导致每 300ms 就重新查一次 toolbar 节点、
    //    重新对（可能是新引用的）toolbar 设置 display:none，看板也跟着被反复
    //    detach/insert，就是"领英显示不正常"的根因。这里加一个前置短路即可
    //    一次性堵住所有调用方（startSPAGuard 的定时器、initObserver 的 mutation
    //    回调），不用逐个改调用点。
    const existing = document.getElementById('jdp-gallery-wrapper');
    if (existing && document.body.contains(existing)) return true;

    if (!window.location.href.includes('/jobs')) {
      console.warn('⚠️ 当前非筛选页面，跳过提取');
      return false;
    }
    const toolbar = findBestFilterBar();
    if (!toolbar) return false;

    if (window.location.href.includes('linkedin.com')) {
      toolbar.style.setProperty('display', 'none', 'important');
    }
     

    const wrapper = getOrCreateGalleryWrapper();
    if (toolbar.nextElementSibling !== wrapper) {
      if (window.location.href.includes('www.zhaopin.com')) {
      // toolbar.style.setProperty('display', 'none', 'important');
      const listcontainer=document.querySelector('.job-list-container, .jobs-split-page__content');
      listcontainer.prepend(wrapper);
    }else{
      toolbar.insertAdjacentElement('afterend', wrapper);
    
      console.log('💥 [JDP Gallery] 看板已挂载并锁定显示区域！');
    }
      
    }
    return true;
  }

  // ==========================================
  // UI 渲染与数据绑定引擎 (Gallery Renderer) —— 来自 test.js，修了几处绑定 bug
  // ==========================================
  function applyFiltersAndRender() {
    const { excludeKeywords, includeKeywords, companyTypes } = state.filterConfig;
    const excludes = excludeKeywords.split(/[,，]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    const includes = includeKeywords.split(/[,，]/).map((s) => s.trim().toLowerCase()).filter(Boolean);

    // ⚡ 记住重新过滤前正在看的是哪条记录（按对象引用，不是按下标）——
    // 详情异步加载完成后会重新触发一次过滤（见下面 ensureRecordDetail 的改动），
    // 如果列表因为过滤结果变化而重新排列，只按下标保持 currentIndex 会导致
    // 用户正在看的卡片被悄悄换成别的职位。这里过滤完之后优先找回同一条记录。
    const currentRecord = state.filteredDatalist[state.currentIndex];

    state.filteredDatalist = state.rawDatalist.filter((item) => {
      // ⚡ 修复"数据未加载出来时按正文过滤不准确"：详情还没加载完的卡片，
      // fullText 还是"⏳ 详情获取中..."这种占位文案，拿它去匹配关键词只会
      // 产生两种错误的结果——包含关键词的过滤会把还没加载完的职位直接排除掉
      // （即使它真实内容其实符合条件，永远没机会被展示、也就永远没机会真正
      // 加载详情，等于死锁）；排除关键词则会让本该被排除的职位在加载完之前
      // 一直混在列表里。所以详情没加载完之前，只用标题/公司/地点这些立刻能拿
      // 到的字段过滤，不牵扯占位文案；等详情真正加载完，ensureRecordDetail
      // 会重新触发一次过滤，到时候这条记录会被正确地重新纳入判断。
      const basicContent = `${item.title} ${item.company} ${item.location}`.toLowerCase();
      const fullContent = item._detailLoaded ? `${basicContent} ${item.fullText}`.toLowerCase() : basicContent;
      if (excludes.some((kw) => fullContent.includes(kw))) return false;
      if (includes.length > 0 && !includes.every((kw) => fullContent.includes(kw))) return false;
      if (companyTypes && companyTypes.length > 0 && !companyTypes.some((type) => fullContent.includes(type.toLowerCase()))) return false;
      return true;
    });

    if (state.pendingGroupJump === 'end') {
      // 上一次点了"下一组"但本地数据不够/需要等真实翻页加载出新内容，
      // 现在新数据到了，跳到新数据所在的那一组
      state.pendingGroupJump = null;
      state.currentGroupStart = Math.max(0, state.filteredDatalist.length - GROUP_SIZE);
      state.currentIndex = state.currentGroupStart;
    } else if (currentRecord && state.filteredDatalist.includes(currentRecord)) {
      // 之前正在看的这条记录还在，跟着它走，位置不因为过滤结果变化而跳动
      state.currentIndex = state.filteredDatalist.indexOf(currentRecord);
    } else if (state.currentIndex >= state.filteredDatalist.length) {
      state.currentIndex = 0;
      state.currentGroupStart = 0;
    }
    renderGalleryCards();
    ensureDetailsAroundCurrent();
  }

  function switchCardIndex(targetIndex) {
    if (state.filteredDatalist.length === 0) return;
    if (targetIndex < 0) targetIndex = state.filteredDatalist.length - 1;
    if (targetIndex >= state.filteredDatalist.length) targetIndex = 0;

    state.currentIndex = targetIndex;
    renderGalleryCards();
    ensureDetailsAroundCurrent();
  }

  // ⚡ 组级翻页：优先去点站点自己的翻页按钮（LinkedIn 这类），点不到就退回到
  //    在本地已抓取数据里按 GROUP_SIZE(15) 条跳一组（BOSS 这类滚动加载列表）。
  function switchGroup(direction) {
    // ⚡ 修复：BOSS 这类滚动懒加载站点没有真实的翻页按钮可点，之前这里对所有站点
    // 都无条件先尝试"找按钮点击"，在 BOSS 页面上这一步要么找不到（浪费一次全页
    // 扫描），要么有小概率误命中页面上其它无关的"下一步"类按钮——现在按
    // SITE_USES_SCROLL_PAGINATION 分流，BOSS 直接跳过按钮探测，走下面的本地分组
    // + 滚动触发懒加载逻辑。
    const clickedRealButton = !SITE_USES_SCROLL_PAGINATION && findAndClickPaginationBtn(direction);
    if (clickedRealButton) {
      if (direction === 'next') {
        // 真实翻页按钮点了，新一页数据会经 runPipeline 自动进来，
        // 到时候 applyFiltersAndRender 的 pendingGroupJump 逻辑会自动跳过去
        state.pendingGroupJump = 'end';
      } else {
        state.currentGroupStart = Math.max(0, state.currentGroupStart - GROUP_SIZE);
        state.currentIndex = state.currentGroupStart;
        renderGalleryCards();
        ensureDetailsAroundCurrent();
      }
      return;
    }

    if (direction === 'next') {
      const nextStart = state.currentGroupStart + GROUP_SIZE;
      if (nextStart < state.filteredDatalist.length) {
        state.currentGroupStart = nextStart;
        state.currentIndex = nextStart;
        renderGalleryCards();
        ensureDetailsAroundCurrent();
      } else {
        // ⚡ 三次修复：上一版改成纯被动等待（只设 pendingGroupJump，什么都不滚），
        // 实测在 BOSS 上不生效——说明真正的问题不是"要不要主动滚"，而是
        // "滚了什么"：第一版用 rawNode.scrollIntoView()，它会连带滚动包括
        // window 在内的所有祖先滚动容器，把看板也带着一起跑了，这才是抖动的
        // 真正来源。BOSS 这类站点常见结构是左侧列表自己有 overflow-y:auto、
        // 独立滚动，右侧详情区固定不动——真正该滚的是列表自己这层容器的
        // scrollTop，完全不经过 window，看板（在列表容器之外）的可视位置
        // 不会被牵动，自然不会抖。找不到这样一层独立容器时（说明是整页一起
        // 滚的站点），才退而求其次滚一小段 window，而不是纯等待或者一次跳到底。
        state.pendingGroupJump = 'end';
        triggerLazyLoadScroll();
      }
    } else {
      state.currentGroupStart = Math.max(0, state.currentGroupStart - GROUP_SIZE);
      state.currentIndex = state.currentGroupStart;
      renderGalleryCards();
      ensureDetailsAroundCurrent();
    }
  }

  // 找 node 往上最近的一个"自己能独立纵向滚动"的祖先容器（比如左侧列表自己
  // overflow-y:auto、右侧详情面板固定不动的那种分栏布局）。找到就返回它；
  // 一直找到 body/html 都没有，说明这个站点是整页一起滚的，返回 null。
  function findScrollableAncestor(node) {
    let el = node && node.parentElement;
    while (el && el !== document.body && el !== document.documentElement) {
      const style = window.getComputedStyle(el);
      const canScrollY = (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflowY === 'overlay')
        && el.scrollHeight > el.clientHeight + 4; // +4 容错，避免 1px 级别的四舍五入误判
      if (canScrollY) return el;
      el = el.parentElement;
    }
    return null;
  }

  function triggerLazyLoadScroll() {
    const lastItem = state.filteredDatalist[state.filteredDatalist.length - 1];
    const anchorNode = (lastItem && lastItem.rawNode && document.body.contains(lastItem.rawNode))
      ? lastItem.rawNode
      : null;
    if (!anchorNode) return;

    const innerContainer = findScrollableAncestor(anchorNode);
    if (innerContainer) {
      // 只动列表自己的 scrollTop，不经过 window，看板位置不受影响。
      innerContainer.scrollTop = innerContainer.scrollHeight;
      console.log('⚡ [content.js] 懒加载触发：滚动列表自身的独立容器', innerContainer);
    } else {
      // 没有独立容器可滚，只能退回整页滚动——挪一段(60%视口高度)而不是一次
      // 跳到底，减小对看板可视位置的影响。
      window.scrollBy({ top: Math.round(window.innerHeight * 0.6), behavior: 'smooth' });
      console.log('⚡ [content.js] 懒加载触发：未找到独立滚动容器，整页滚动一段距离作为兜底');
    }
  }

  // 找站点自己的翻页按钮并点击（LinkedIn 的"下一页"等）。找不到返回 false，
  // 调用方据此判断要不要退回本地分组逻辑。
  function findAndClickPaginationBtn(direction) {
    const isNext = direction === 'next';
    const attrSelector = isNext
      ? '[aria-label*="next" i], [aria-label*="下一页" i], [title*="下一页" i], [title*="next" i], .btn-next, .pagination-next, .next-page, .pager-next'
      : '[aria-label*="prev" i], [aria-label*="上一页" i], [title*="上一页" i], [title*="prev" i], .btn-prev, .pagination-prev, .prev-page, .pager-prev';

    let target = document.querySelector(attrSelector);
    if (!target) {
      const candidates = Array.from(document.querySelectorAll('button, li, a, div[role="button"]'));
      target = candidates.find((el) => {
        if (el.closest && el.closest('#jdp-gallery-wrapper')) return false; // 排除我们自己的按钮
        const html = el.innerHTML.toLowerCase();
        const txt = (el.innerText || '').trim().toLowerCase();
        const textMatched = isNext ? /^(下一页|>|›|next)$/.test(txt) : /^(上一页|<|‹|prev)$/.test(txt);
        if (textMatched) return true;
        return isNext
          ? (html.includes('arrow-right') || html.includes('chevron-right') || html.includes('right-icon') || html.includes('icon-next'))
          : (html.includes('arrow-left') || html.includes('chevron-left') || html.includes('left-icon') || html.includes('icon-prev'));
      });
    }
    if (target && !(target.closest && target.closest('#jdp-gallery-wrapper'))) {
      target.click();
      return true;
    }
    return false;
  }



  // ⚡ "只改变数据结果而不是整个UI"：以前 renderGalleryCards 每次调用都会
  // container.innerHTML='' 再把 state.filteredDatalist 全量重建成 DOM——
  // BOSS 这种 25+ 条的列表，实际可见的最多 3 张（prev/active/next），
  // 其余 20 多张 hidden-left/hidden-right 卡片是完全不可见的，但每次任何数据
  // 变化（切卡、后台加载完成、筛选变化）都要把这 25 张全部拆掉重建一遍——
  // 这是真实的性能浪费，也是卡顿感的一部分来源。
  // 现在只渲染 currentIndex 前后各 1 张（最多 3 个 DOM 节点），用 Map 记住
  // "这个 item.id 对应哪个 cardEl"：还在窗口内的卡片只做局部内容更新（换
  // class、更新文字），不重建 DOM 结构、不重新绑定事件；只有真正进入/离开
  // 可见窗口的卡片才创建/移除 DOM 节点。
  const renderedCardElements = new Map(); // item.id -> cardEl

  function buildCardElement(item) {
    const cardEl = document.createElement('div');
    cardEl.dataset.jobId = item.id;
    // const hasResp = Boolean(item.respText==="⏳ 详情获取中..." );
    // const hasReq = Boolean(item.reqText==="⏳ 详情获取中...");
    // console.log(hasResp,item.respText)
    // console.log(hasReq,item.reqText)

    cardEl.innerHTML = `
    
      <div>
        <div class="jdp-card-header">
          <div>
            <div class="jdp-card-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
            <div class="jdp-card-meta" style="font-size:12px; color:#64748b; margin-top:4px;">🏢 ${escapeHtml(item.company)} · 📍 ${escapeHtml(item.location)}</div>
            <div class="jdp-card-salary">${escapeHtml(item.rawSalary)}</div>
          </div>
          <div class="jdp-btn-group">
            <div class="jdp-card-match loading-state" data-job-id="${item.id}" title="${t('matchResumeing')}">
              <span class="score-text pulse-animation">${t('evaluating')}</span>
            </div>
            <button type="button" class="jdp-action-btn">${t('actionApply')}</button>
            <button type="button" class="jdp-open-link-btn">${t('actionOpenLink')}</button>
            <button type="button" class="jdp-refresh-btn" title="${t('refreshTitle')}">🔄</button>
          </div>
        </div>
      <div class="jdp-card-body">
        <div class="jdp-card-section" >
          <div class="jdp-card-section-label">${t('sectionResp')} (Responsibilities)</div>
          <div class="jdp-card-section-content jdp-resp-box">${escapeHtml(item.respText?.trim())}</div>
        </div>
        <div class="jdp-card-section req" >
          <div class="jdp-card-section-label">${t('sectionReq')}</div>
          <div class="jdp-card-section-content jdp-req-box">${escapeHtml(item.reqText?.trim())}</div>
        </div>
        <!-- 保留完整文本供深度报告兜底拼接用，不在卡片上占视觉空间 -->
        <div class="job-detail-text" style="display:none;">${escapeHtml(item.fullText)}</div>
      </div>

        
      </div>

      <div class="jdp-card-footer">
        <span>${t('showlabel')}</span>
      </div>
    `;

    // ⚡ 事件绑定只在创建时做一次；这些卡片会被后续的 updateCardElementContent
    // 反复复用，所以处理函数一律通过 cardEl.dataset.jobId 现查 state.rawDatalist
    // 拿最新的 item/idx，不能闭包捕获（闭包捕获的话，卡片被复用给同一个 id
    // 但列表位置/内容更新后，闭包里的旧值就会跟界面实际状态脱节）。
    const actBtn = cardEl.querySelector('.jdp-action-btn');
    actBtn.onclick = (e) => {
      e.stopPropagation();
      const curItem = state.rawDatalist.find((r) => r.id === cardEl.dataset.jobId);
      if (!curItem) return;
      const triggered = triggerNativeActionBtn(curItem.rawNode);
      if (!triggered && curItem.url) window.open(curItem.url, '_blank');
    };

    const linkBtn = cardEl.querySelector('.jdp-open-link-btn');
    linkBtn.onclick = (e) => {
      e.stopPropagation();
      const curItem = state.rawDatalist.find((r) => r.id === cardEl.dataset.jobId);
      if (curItem && curItem.url) window.open(curItem.url, '_blank');
    };

    const refreshBtn = cardEl.querySelector('.jdp-refresh-btn');
    refreshBtn.onclick = async (e) => {
      e.stopPropagation();
      const curItem = state.rawDatalist.find((r) => r.id === cardEl.dataset.jobId);
      if (!curItem) return;
      refreshBtn.classList.add('spinning');
      detailCache.delete(String(curItem.id));
      // ⚡ 也把"点击风险名单"里的这张卡摘掉：用户主动点刷新，说明他愿意再试一次
      // 真实点击。不摘的话 'click' 策略会一直被跳过，直接掉到 fetch——这正是
      // 你看到的"点刷新还是走 request"的原因之一。
      clickRiskyCardIds.delete(String(curItem.id));
      saveClickRiskyCardIds(clickRiskyCardIds);
      curItem._detailLoaded = false;
      curItem._detailLoading = false;
      curItem._detailLoadingClick = false;
      curItem._detailLoadingPrefetch = false;
      curItem.fullText = t('reloading');
      curItem.respText = t('reloading');
      curItem.reqText = t('reloading');
      updateCardElementContent(cardEl, curItem);
      try {
        await ensureRecordDetail(curItem, { allowClick: true });
      } finally {
        // ⚡ 修复"数据刷新完还一直转"：原来只 add('spinning') 从不 remove，
        // 加上现在卡片 DOM 是复用的(窗口化渲染)，这个 class 会永久留在节点上。
        refreshBtn.classList.remove('spinning');
        const latest = state.rawDatalist.find((r) => r.id === cardEl.dataset.jobId);
        if (latest) updateCardElementContent(cardEl, latest);
      }
    };

    cardEl.onclick = () => {
      if (state._justDragged) return; // 拖拽尾巴触发的点击，不当成"切到这张卡"
      const idx = state.filteredDatalist.findIndex((r) => r.id === cardEl.dataset.jobId);
      if (idx >= 0 && state.currentIndex !== idx) switchCardIndex(idx);
    };

    return cardEl;
  }

  // 局部更新：只改文字内容和 class，不碰 DOM 结构、不重新绑定事件
  function updateCardElementContent(cardEl, item) {
    cardEl.dataset.jobId = item.id;
    const titleEl = cardEl.querySelector('.jdp-card-title');
    if (titleEl) { titleEl.textContent = item.title; titleEl.title = item.title; }
    const metaEl = cardEl.querySelector('.jdp-card-meta');
    if (metaEl) metaEl.textContent = `🏢 ${item.company} · 📍 ${item.location}`;
    const salaryEl = cardEl.querySelector('.jdp-card-salary');
    if (salaryEl) salaryEl.textContent = item.rawSalary;
    const matchDiv = cardEl.querySelector('.jdp-card-match');
    if (matchDiv) matchDiv.dataset.jobId = item.id;
    const respBox = cardEl.querySelector('.jdp-resp-box');
    if (respBox) respBox.textContent = item.respText;
    const reqBox = cardEl.querySelector('.jdp-req-box');
    if (reqBox) reqBox.textContent = item.reqText;
    const fullTextBox = cardEl.querySelector('.job-detail-text');
    if (fullTextBox) fullTextBox.textContent = item.fullText;
  }

  function renderGalleryCards() {
    const container = document.getElementById('jdp-cards-container');
    const counter = document.getElementById('jdp-counter');
    if (!container || !counter) return;

    const list = state.filteredDatalist;
    const groupNo = Math.floor(state.currentGroupStart / GROUP_SIZE) + 1;
    counter.innerText = list.length > 0 ? `${state.currentIndex + 1} / ${list.length}（${t('number')}${groupNo} ${t('group')}）` : '0 / 0';

    if (list.length === 0) {
      container.innerHTML = `<div class="jdp-empty-tips">${t('emptyList')}</div>`;
      renderedCardElements.clear();
      return;
    }

    state.rawDatalist.forEach((item) => {
      if (item.rawNode && item.rawNode.classList) item.rawNode.classList.remove('linkedin-fast-highlight');
    });
    const activeItem = list[state.currentIndex];
    if (activeItem && activeItem.rawNode && activeItem.rawNode.classList) {
      activeItem.rawNode.classList.add('linkedin-fast-highlight');
    }
    // ⚡ "页面中心视角仍是我们的卡片，尽量减少抖动"：
    // 不再滚动到真实的原生列表项（那样视角会跳到侧边栏，且每次切换都强制
    // smooth-scroll 一次，构成用户描述的"抖动"）。改成只在我们自己的悬浮
    // 看板已经不在可视区域内时才滚动它回来，正常切换时如果看板本来就在
    // 视口里，什么都不做——这是抖动的根本消除方式：没必要的滚动直接不触发。
    const galleryWrapperEl = document.getElementById('jdp-gallery-wrapper');
    if (galleryWrapperEl) {
      const wrapRect = galleryWrapperEl.getBoundingClientRect();
      // ⚡ 修复抖动的另一半根因：看板卡片舞台 min-height 就有 680px，加上头部/
      // 筛选面板，整块经常比很多笔记本屏幕的可视高度还高。原来这里要求"整块
      // 完全落在视口内"(top>=0 且 bottom<=视口高度) 才算可见，对这种情况永远
      // 是 false，等于每次 renderGalleryCards 都会强制 recenter 一次——这才是
      // 上一组/下一组、甚至普通切卡都会持续抖动的真正原因，跟懒加载滚动那次
      // 改动无关，原来的代码里本来就有。改成"只要还有一部分露在视口里就不用管"
      // （真正的部分可见/相交判断），只有整块都完全滚出视口之外才需要拉回来。
      const isWrapperVisible = wrapRect.bottom > 0 && wrapRect.top < window.innerHeight;
      if (!isWrapperVisible) {
        galleryWrapperEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    // ⚡ 只渲染当前索引前后各 1 张，不再重建整份列表
    const windowIndices = [state.currentIndex - 1, state.currentIndex, state.currentIndex + 1]
      .filter((i) => i >= 0 && i < list.length);
    const windowIds = new Set(windowIndices.map((i) => list[i].id));

    // 移除已经滑出窗口的旧卡片节点
    for (const [id, el] of renderedCardElements) {
      if (!windowIds.has(id)) {
        el.remove();
        renderedCardElements.delete(id);
      }
    }

    windowIndices.forEach((idx) => {
      const item = list[idx];
      let cardClass = 'jdp-card hidden-right';
      if (idx === state.currentIndex) cardClass = 'jdp-card active';
      else if (idx === state.currentIndex - 1) cardClass = 'jdp-card prev';
      else if (idx === state.currentIndex + 1) cardClass = 'jdp-card next';

      let cardEl = renderedCardElements.get(item.id);
      if (cardEl) {
        // ⚡ 已经在窗口里了：只换 class 定位置、更新文字，不重建 DOM
        cardEl.className = cardClass;
        updateCardElementContent(cardEl, item);
      } else {
        cardEl = buildCardElement(item);
        cardEl.className = cardClass;
        renderedCardElements.set(item.id, cardEl);
        container.appendChild(cardEl);
      }
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // "沟通/投递"按钮触发器：在原生卡片节点里找语义相近的按钮点掉
  function triggerNativeActionBtn(rawCardNode) {
    if (!rawCardNode) return false;
    const actionKeywordsRegex = /^(立即沟通|聊一聊|立即投递|投递简历|投递|应聘|立即申请|申请|Easy Apply|Apply Now|Apply)$/i;
    const clickableElements = Array.from(rawCardNode.querySelectorAll('button, a, div[role="button"], span.btn, div.btn'));
    let targetBtn = clickableElements.find((el) => actionKeywordsRegex.test((el.innerText || '').trim()));
    if (!targetBtn) {
      targetBtn = clickableElements.find((el) => /沟通|聊一聊|投递|应聘|apply/.test((el.innerText || '').trim().toLowerCase()));
    }
    if (targetBtn) { targetBtn.click(); return true; }
    return false;
  }

  // ==========================================
  // 11. 深度报告弹窗系统 —— 来自 test.js，原样保留，只修了一处参数错位 bug
  // ==========================================
  async function getUserInfo(key) {
    const data = await chrome.storage.local.get([key]);
    if (!data) {
      console.warn('未登录或未存储 用户信息，返回 null');
      return null;
    }
    console.log(data[key])
    return data[key].data.user_id;
  }

  document.addEventListener('click', async (e) => {
    const matchCard = e.target.closest('.jdp-card-match');
    if (!matchCard) return;

    e.stopPropagation();
    e.preventDefault();

    const jobCard = matchCard.closest('.jdp-card') || matchCard.closest('.job-card');
    if (!jobCard) return;

    const jobId = matchCard.dataset.jobId || jobCard.dataset.jobId || matchCard.getAttribute('data-job-id') || jobCard.getAttribute('data-job-id');
    if (!jobId) {
      console.warn('⚠️ 当前点击的卡片未找到有效的 data-job-id', jobCard);
    }

    const titleEl = jobCard.querySelector('.jdp-card-title') || jobCard.querySelector('.job-title');
    const jobTitle = titleEl?.innerText?.trim() || jobCard.getAttribute('data-job-title') || '目标岗位';

    const respText = jobCard.querySelector('.jdp-resp-box')?.innerText?.trim() || '';
    const reqText = jobCard.querySelector('.jdp-req-box')?.innerText?.trim() || '';
    const legacyJd = jobCard.querySelector('.job-detail-text')?.innerText?.trim() || '';
    const cleanedJd = [respText, reqText].filter(Boolean).join('\n\n') || legacyJd || jobTitle;

    console.log(`🚀 [触发深度报告] jobId: ${jobId}, title: ${jobTitle}`);
    fetchAndShowReport(jobId, jobTitle, false, cleanedJd);
  });

  // async function fetchAndShowReport(jobId, jobTitle = '目标岗位', forceRefresh = false, cleanedJd) {
  //   const cacheKey = `jdp_report_${jobId}`;
  //   const userId = await getUserInfo('user_info');

  //   if (!forceRefresh) {
  //     const cachedStr = localStorage.getItem(cacheKey);
  //     if (cachedStr) {
  //       try {
  //         const cachedData = JSON.parse(cachedStr);
  //         const now = Date.now();
  //         if (cachedData.timestamp && (now - cachedData.timestamp < REPORT_CACHE_TTL)) {
  //           // ⚡ 修复点：原来这里漏传了 jobTitle，把 cleanedJd 错位塞进了 jobTitle 的位置
  //           updateReportModalContent(cachedData.report, cachedData.remainingQuota, true, jobId, jobTitle, cleanedJd);
  //           return;
  //         }
  //         localStorage.removeItem(cacheKey);
  //       } catch (e) {
  //         localStorage.removeItem(cacheKey);
  //       }
  //     }
  //   }

  //   showReportModalLoading(jobTitle);

  //   try {
  //     const response = await fetch(`${API_BASE_URL}/api/match/detailed-report`, {
  //       method: 'POST',
  //       headers: { 'Content-Type': 'application/json' },
  //       body: JSON.stringify({ user_id: userId, job_id: jobId, job_title: jobTitle, cleaned_jd: cleanedJd })
  //     });

  //     const resData = await response.json().catch(() => ({}));

  //     if (response.status === 429) {
  //       updateReportModalError(resData.detail || '请求过于频繁，请稍后再试', jobId, jobTitle, cleanedJd);
  //       return;
  //     }
  //     if (!response.ok) {
  //       updateReportModalError(resData.detail || '生成深度报告失败，请稍后再试', jobId, jobTitle, cleanedJd);
  //       return;
  //     }

  //     const report = resData.data;
  //     const remainingQuota = resData.remaining_quota;

  //     localStorage.setItem(cacheKey, JSON.stringify({ report, remainingQuota, timestamp: Date.now() }));
  //     updateReportModalContent(report, remainingQuota, false, jobId, jobTitle, cleanedJd);
  //   } catch (err) {
  //     console.error('网络请求异常:', err);
  //     updateReportModalError('网络断开或服务器响应超时', jobId, jobTitle, cleanedJd);
  //   }
  // }

  // function getOrCreateReportModal() {
  //   let modal = document.getElementById('jdp-report-modal');
  //   if (!modal) {
  //     modal = document.createElement('div');
  //     modal.id = 'jdp-report-modal';
  //     modal.className = 'jdp-modal-backdrop';
  //     modal.innerHTML = `
  //       <div class="jdp-modal-content">
  //         <div class="jdp-modal-header">
  //           <div style="display: flex; justify-content: space-between; align-items: center;">
  //             <h3>⚡ AI 岗位匹配评估报告</h3>
  //             <p class="subtitle" id="jdp-modal-job-title">正在分析岗位匹配度...</p>
  //             <button type="button" class="jdp-btn-secondary" id="jdp-modal-refresh-btn" style="display:none; margin-right: 2px;">🔄 重新诊断</button>
  //           </div>
  //           <button type="button" class="jdp-modal-close" id="jdp-modal-close-x" title="关闭">&times;</button>
  //         </div>
  //         <div class="jdp-modal-body" id="jdp-modal-body"></div>
  //         <div class="jdp-modal-footer">
  //           <button type="button" class="jdp-btn-primary jdp-btn-close-action" id="jdp-modal-close-btn">关闭报告</button>
  //         </div>
  //       </div>
  //     `;
  //     document.body.appendChild(modal);

  //     const closeBtns = modal.querySelectorAll('#jdp-modal-close-x, #jdp-modal-close-btn');
  //     closeBtns.forEach((btn) => btn.addEventListener('click', closeReportModal));
  //     modal.addEventListener('click', (e) => { if (e.target === modal) closeReportModal(); });
  //   }
  //   return modal;
  // }

  // function closeReportModal() {
  //   const modal = document.getElementById('jdp-report-modal');
  //   if (modal) modal.remove();
  // }

  // function showReportModalLoading(jobTitle = '目标岗位') {
  //   getOrCreateReportModal();
  //   document.getElementById('jdp-modal-job-title').innerText = `${t('Targetposition')}${jobTitle}`;
  //   document.getElementById('jdp-modal-refresh-btn').style.display = 'none';

  //   const bodyEl = document.getElementById('jdp-modal-body');
  //   bodyEl.innerHTML = `
  //     <div class="jdp-loading-container" style="text-align: center; padding: 30px 10px;">
  //       <div class="jdp-spinner" style="margin: 0 auto 15px;"></div>
  //       <p style="font-weight: 600; color: #1e293b; margin-bottom: 5px;">AI 正在深度解析简历与 JD...</p>
  //       <p style="font-size: 12px; color: #64748b;">提取硬性要求、碰撞技能交集与核查短板中</p>
  //     </div>
  //     <div class="jdp-skeleton-wrapper" style="opacity: 0.6;">
  //       <div class="jdp-hero-card" style="height: 80px; background: #f1f5f9; border: none;"></div>
  //       <div class="jdp-grid-subscores" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 15px;">
  //         <div style="height: 60px; background: #f1f5f9; border-radius: 8px;"></div>
  //         <div style="height: 60px; background: #f1f5f9; border-radius: 8px;"></div>
  //         <div style="height: 60px; background: #f1f5f9; border-radius: 8px;"></div>
  //         <div style="height: 60px; background: #f1f5f9; border-radius: 8px;"></div>
  //       </div>
  //     </div>
  //   `;
  // }

  // function updateReportModalContent(report, remainingQuota, fromCache, jobId, jobTitle, cleanedJd) {
  //   getOrCreateReportModal();

  //   const { total_score = 0, sub_scores = {}, details = {}, job_title = jobTitle || '未知岗位' } = report || {};
  //   const { matched_skills = [], missing_skills = [], hard_warnings = [], insights = {} } = details;

  //   document.getElementById('jdp-modal-job-title').innerText = `目标岗位：${job_title}`;

  //   const refreshBtn = document.getElementById('jdp-modal-refresh-btn');
  //   if (refreshBtn) {
  //     refreshBtn.style.display = 'inline-block';
  //     refreshBtn.innerText = '🔄 重新诊断';
  //     refreshBtn.onclick = () => {
  //       localStorage.removeItem(`jdp_report_${jobId}`);
  //       fetchAndShowReport(jobId, jobTitle, true, cleanedJd);
  //     };
  //   }

  //   const warningsHtml = hard_warnings.length > 0
  //     ? `<div class="jdp-alert-box">⚠️ <b>硬性门槛预警：</b>${hard_warnings.join('；')}</div>`
  //     : '';
  //   const matchedTags = matched_skills.map((s) => `<span class="jdp-tag tag-success">✓ ${s}</span>`).join('');
  //   const missingTags = missing_skills.map((s) => `<span class="jdp-tag tag-danger">✕ ${s}</span>`).join('');

  //   const bodyEl = document.getElementById('jdp-modal-body');
  //   bodyEl.innerHTML = `
  //     <div class="jdp-hero-card">
  //       <div class="score-circle">
  //         <span class="score-val">${total_score}</span>
  //         <span class="score-unit">分</span>
  //       </div>
  //       <div class="score-meta">
  //         <h4>${total_score >= 80 ? '🔥 极高匹配度' : total_score >= 60 ? '👍 匹配度良好' : '⚠️ 匹配度较低'}</h4>
  //         <span class="quota-badge">
  //           ${fromCache ? '⚡ 5分钟内缓存' : `今日剩余 AI 报告额度: ${remainingQuota ?? '无限制'} 次`}
  //         </span>
  //       </div>
  //     </div>

  //     ${warningsHtml}

  //     <div class="jdp-grid-subscores">
  //       <div class="subscore-card"><span class="title">硬门槛 (20%)</span><span class="score">${sub_scores.hard ?? 0}分</span></div>
  //       <div class="subscore-card"><span class="title">必备技能 (30%)</span><span class="score">${sub_scores.must_skill ?? 0}分</span></div>
  //       <div class="subscore-card"><span class="title">加分项 (15%)</span><span class="score">${sub_scores.bonus_skill ?? 0}分</span></div>
  //       <div class="subscore-card"><span class="title">业务契合 (35%)</span><span class="score">${sub_scores.business ?? 0}分</span></div>
  //     </div>

  //     <div class="jdp-section">
  //       <h5 class="sec-title">🎯 技能重合与缺失</h5>
  //       <div class="jdp-tags-wrapper">
  //         ${matchedTags}
  //         ${missingTags}
  //         ${matched_skills.length === 0 && missing_skills.length === 0 ? '<span class="text-muted">暂无技能碰撞数据</span>' : ''}
  //       </div>
  //     </div>

  //     <div class="jdp-section">
  //       <h5 class="sec-title">💡 AI 智能诊断</h5>
  //       <div class="insight-item">
  //         <span class="insight-label text-green">🌟 匹配亮点</span>
  //         <ul>${(insights.highlights || []).map((h) => `<li>${h}</li>`).join('')}</ul>
  //       </div>
  //       <div class="insight-item">
  //         <span class="insight-label text-orange">⚠️ 潜在风险/短板</span>
  //         <ul>${(insights.risks || []).map((r) => `<li>${r}</li>`).join('')}</ul>
  //       </div>
  //       <div class="insight-item">
  //         <span class="insight-label text-blue">📝 简历优化建议</span>
  //         <ul>${(insights.gaps || []).map((g) => `<li>${g}</li>`).join('')}</ul>
  //       </div>
  //     </div>
  //   `;
  // }

  // function updateReportModalError(errorMessage, jobId, jobTitle, cleanedJd) {
  //   getOrCreateReportModal();

  //   const refreshBtn = document.getElementById('jdp-modal-refresh-btn');
  //   if (refreshBtn) {
  //     refreshBtn.style.display = 'inline-block';
  //     refreshBtn.innerText = '🔄 重试请求';
  //     refreshBtn.onclick = () => fetchAndShowReport(jobId, jobTitle, true, cleanedJd);
  //   }

  //   const bodyEl = document.getElementById('jdp-modal-body');
  //   bodyEl.innerHTML = `
  //     <div class="jdp-error-box" style="text-align: center; padding: 40px 10px;">
  //       <div style="font-size: 40px; margin-bottom: 10px;">⚠️</div>
  //       <h4 style="color: #ef4444; margin-bottom: 8px;">报告生成失败</h4>
  //       <p style="color: #64748b; font-size: 14px; max-width: 80%; margin: 0 auto;">
  //         ${errorMessage || '服务器繁忙或网络异常，请稍后再试。'}
  //       </p>
  //     </div>
  //   `;
  // }

  async function fetchAndShowReport(jobId, jobTitle = t('Targetposition'), forceRefresh = false, cleanedJd) {
  const cacheKey = `jdp_report_${jobId}`;
  const userId = await getUserInfo('user_info');

  if (!forceRefresh) {
    const cachedStr = localStorage.getItem(cacheKey);
    if (cachedStr) {
      try {
        const cachedData = JSON.parse(cachedStr);
        const now = Date.now();
        if (cachedData.timestamp && (now - cachedData.timestamp < REPORT_CACHE_TTL)) {
          updateReportModalContent(cachedData.report, cachedData.remainingQuota, true, jobId, jobTitle, cleanedJd);
          return;
        }
        localStorage.removeItem(cacheKey);
      } catch (e) {
        localStorage.removeItem(cacheKey);
      }
    }
  }

  showReportModalLoading(jobTitle);

  try {
    const response = await fetch(`${API_BASE_URL}/api/match/detailed-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, job_id: jobId, job_title: jobTitle, cleaned_jd: cleanedJd })
    });

    const resData = await response.json().catch(() => ({}));

    if (response.status === 429) {
      updateReportModalError(resData.detail || t('rateLimitErrorMsg'), jobId, jobTitle, cleanedJd);
      return;
    }
    if (!response.ok) {
      updateReportModalError(resData.detail || t('reportFailedErrorMsg'), jobId, jobTitle, cleanedJd);
      return;
    }

    const report = resData.data;
    const remainingQuota = resData.remaining_quota;

    localStorage.setItem(cacheKey, JSON.stringify({ report, remainingQuota, timestamp: Date.now() }));
    updateReportModalContent(report, remainingQuota, false, jobId, jobTitle, cleanedJd);
  } catch (err) {
    console.error('网络请求异常:', err);
    updateReportModalError(t('networkErrorMsg'), jobId, jobTitle, cleanedJd);
  }
}

function getOrCreateReportModal() {
  let modal = document.getElementById('jdp-report-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'jdp-report-modal';
    modal.className = 'jdp-modal-backdrop';
    modal.innerHTML = `
      <div class="jdp-modal-content">
        <div class="jdp-modal-header">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <h3>${t('reportModalTitle')}</h3>
            <p class="subtitle" id="jdp-modal-job-title">${t('reportModalAnalyzing')}</p>
            <button type="button" class="jdp-btn-secondary" id="jdp-modal-refresh-btn" style="display:none; margin-right: 2px;">${t('reportModalRefreshBtn')}</button>
          </div>
          <button type="button" class="jdp-modal-close" id="jdp-modal-close-x" title="${t('reportModalCloseX')}">&times;</button>
        </div>
        <div class="jdp-modal-body" id="jdp-modal-body"></div>
        <div class="jdp-modal-footer">
          <button type="button" class="jdp-btn-primary jdp-btn-close-action" id="jdp-modal-close-btn">${t('reportModalCloseBtn')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const closeBtns = modal.querySelectorAll('#jdp-modal-close-x, #jdp-modal-close-btn');
    closeBtns.forEach((btn) => btn.addEventListener('click', closeReportModal));
    modal.addEventListener('click', (e) => { if (e.target === modal) closeReportModal(); });
  }
  return modal;
}

function closeReportModal() {
  const modal = document.getElementById('jdp-report-modal');
  if (modal) modal.remove();
}

function showReportModalLoading(jobTitle = t('Targetposition')) {
  getOrCreateReportModal();
  document.getElementById('jdp-modal-job-title').innerText = `${t('Targetposition')}${jobTitle}`;
  document.getElementById('jdp-modal-refresh-btn').style.display = 'none';

  const bodyEl = document.getElementById('jdp-modal-body');
  bodyEl.innerHTML = `
    <div class="jdp-loading-container" style="text-align: center; padding: 30px 10px;">
      <div class="jdp-spinner" style="margin: 0 auto 15px;"></div>
      <p style="font-weight: 600; color: #1e293b; margin-bottom: 5px;">${t('reportLoadingTitle')}</p>
      <p style="font-size: 12px; color: #64748b;">${t('reportLoadingSub')}</p>
    </div>
    <div class="jdp-skeleton-wrapper" style="opacity: 0.6;">
      <div class="jdp-hero-card" style="height: 80px; background: #f1f5f9; border: none;"></div>
      <div class="jdp-grid-subscores" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 15px;">
        <div style="height: 60px; background: #f1f5f9; border-radius: 8px;"></div>
        <div style="height: 60px; background: #f1f5f9; border-radius: 8px;"></div>
        <div style="height: 60px; background: #f1f5f9; border-radius: 8px;"></div>
        <div style="height: 60px; background: #f1f5f9; border-radius: 8px;"></div>
      </div>
    </div>
  `;
}

function updateReportModalContent(report, remainingQuota, fromCache, jobId, jobTitle, cleanedJd) {
  getOrCreateReportModal();

  const { total_score = 0, sub_scores = {}, details = {}, job_title = jobTitle || t('unknownJob') } = report || {};
  const { matched_skills = [], missing_skills = [], hard_warnings = [], insights = {} } = details;

  document.getElementById('jdp-modal-job-title').innerText = `${t('Targetposition')}${job_title}`;

  const refreshBtn = document.getElementById('jdp-modal-refresh-btn');
  if (refreshBtn) {
    refreshBtn.style.display = 'inline-block';
    refreshBtn.innerText = t('reportModalRefreshBtn');
    refreshBtn.onclick = () => {
      localStorage.removeItem(`jdp_report_${jobId}`);
      fetchAndShowReport(jobId, jobTitle, true, cleanedJd);
    };
  }

  const warningsHtml = hard_warnings.length > 0
    ? `<div class="jdp-alert-box">${t('hardWarningLabel')}${hard_warnings.join('；')}</div>`
    : '';
  const matchedTags = matched_skills.map((s) => `<span class="jdp-tag tag-success">✓ ${s}</span>`).join('');
  const missingTags = missing_skills.map((s) => `<span class="jdp-tag tag-danger">✕ ${s}</span>`).join('');

  const matchDegreeText = total_score >= 80 
    ? t('matchDegreeHigh') 
    : total_score >= 60 
      ? t('matchDegreeGood') 
      : t('matchDegreeLow');

  const quotaText = fromCache 
    ? t('cachedNotice') 
    : t('remainingQuota', { quota: remainingQuota ?? t('quotaUnlimited') });

  const bodyEl = document.getElementById('jdp-modal-body');
  bodyEl.innerHTML = `
    <div class="jdp-hero-card">
      <div class="score-circle">
        <span class="score-val">${total_score}</span>
        <span class="score-unit">${t('unitScore')}</span>
      </div>
      <div class="score-meta">
        <h4>${matchDegreeText}</h4>
        <span class="quota-badge">${quotaText}</span>
      </div>
    </div>

    ${warningsHtml}

    <div class="jdp-grid-subscores">
      <div class="subscore-card"><span class="title">${t('subscoreHard')}</span><span class="score">${sub_scores.hard ?? 0}${t('unitScore')}</span></div>
      <div class="subscore-card"><span class="title">${t('subscoreMustSkill')}</span><span class="score">${sub_scores.must_skill ?? 0}${t('unitScore')}</span></div>
      <div class="subscore-card"><span class="title">${t('subscoreBonusSkill')}</span><span class="score">${sub_scores.bonus_skill ?? 0}${t('unitScore')}</span></div>
      <div class="subscore-card"><span class="title">${t('subscoreBusiness')}</span><span class="score">${sub_scores.business ?? 0}${t('unitScore')}</span></div>
    </div>

    <div class="jdp-section">
      <h5 class="sec-title">${t('secTitleSkills')}</h5>
      <div class="jdp-tags-wrapper">
        ${matchedTags}
        ${missingTags}
        ${matched_skills.length === 0 && missing_skills.length === 0 ? `<span class="text-muted">${t('noSkillData')}</span>` : ''}
      </div>
    </div>

    <div class="jdp-section">
      <h5 class="sec-title">${t('secTitleDiagnosis')}</h5>
      <div class="insight-item">
        <span class="insight-label text-green">${t('insightHighlights')}</span>
        <ul>${(insights.highlights || []).map((h) => `<li>${h}</li>`).join('')}</ul>
      </div>
      <div class="insight-item">
        <span class="insight-label text-orange">${t('insightRisks')}</span>
        <ul>${(insights.risks || []).map((r) => `<li>${r}</li>`).join('')}</ul>
      </div>
      <div class="insight-item">
        <span class="insight-label text-blue">${t('insightGaps')}</span>
        <ul>${(insights.gaps || []).map((g) => `<li>${g}</li>`).join('')}</ul>
      </div>
    </div>
  `;
}

function updateReportModalError(errorMessage, jobId, jobTitle, cleanedJd) {
  getOrCreateReportModal();

  const refreshBtn = document.getElementById('jdp-modal-refresh-btn');
  if (refreshBtn) {
    refreshBtn.style.display = 'inline-block';
    refreshBtn.innerText = t('reportModalRetryBtn');
    refreshBtn.onclick = () => fetchAndShowReport(jobId, jobTitle, true, cleanedJd);
  }

  const bodyEl = document.getElementById('jdp-modal-body');
  bodyEl.innerHTML = `
    <div class="jdp-error-box" style="text-align: center; padding: 40px 10px;">
      <div style="font-size: 40px; margin-bottom: 10px;">⚠️</div>
      <h4 style="color: #ef4444; margin-bottom: 8px;">${t('reportErrorTitle')}</h4>
      <p style="color: #64748b; font-size: 14px; max-width: 80%; margin: 0 auto;">
        ${errorMessage || t('reportErrorDefaultMsg')}
      </p>
    </div>
  `;
}

  // ==========================================
  // 12. 启动
  // ==========================================
  runPipeline();
  initObserver();
  startSPAGuard();
  console.log('🚀 JDP Gallery 三合一整合版已启动：引擎=content_test.js / UI=test.js / 匹配分与深度报告=补全自 content_backend.js');
})();