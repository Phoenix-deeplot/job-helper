// // // /**
// // //  * ==============================================================================
// // //  * injected.js — 运行在页面主环境 (MAIN World)
// // //  *
// // //  * 本版相对上一版的关键修复与新增：
// // //  *   [修复] XHR hook 读 responseText 在 responseType='json'/'blob' 时会抛
// // //  *          DOMException，被 catch 静默吞掉 → 拦截永远不触发（"只有直接请求，
// // //  *          没有拦截"的根因）。现在按 responseType 分支取值。
// // //  *   [修复] BOSS 详情接口 URL 从写死 /job/detail.json 放宽成多模式匹配，
// // //  *          并保留"内容形状"兜底，避免站点换路径就全线失效。
// // //  *   [修复] matchKey 取不到时不再静默丢弃，走多级兜底（URL → payload → 点击相关性）。
// // //  *   [新增] 诊断模式：把流经的、疑似职位相关的 JSON 响应打到控制台，
// // //  *          让你能直接看到 BOSS 真实的详情接口叫什么、字段长什么样。
// // //  *   [新增] 通用"点击相关性捕获"：content.js 点击前开一个捕获窗口，窗口内
// // //  *          出现的 JD 形状响应直接归属给刚点击的那张卡——不需要知道站点的
// // //  *          ID 字段名/位置，这是真正站点无关的机制。
// // //  * ==============================================================================
// // //  */
// // // (function () {
// // //   'use strict';
// // //   if (window.__jobHookInjected) return;
// // //   window.__jobHookInjected = true;

// // //   // ---------------------------------------------------------------------
// // //   // 0. 站点识别 & 诊断开关
// // //   // ---------------------------------------------------------------------
// // //   const SITE = location.host.includes('zhipin.com')
// // //     ? 'boss'
// // //     : location.host.includes('linkedin.com')
// // //       ? 'linkedin'
// // //       : 'generic';

// // //   // 诊断模式：控制台执行 window.__jdpDiag = true 即可打开（不用改代码重装插件），
// // //   // 打开后会把所有"疑似职位相关"的响应 URL + 字段结构打出来。
// // //   // 排查"到底哪个接口才是详情接口"时非常有用。
// // //   const diag = (...args) => { if (window.__jdpDiag) console.log('%c[JDP-DIAG]', 'color:#0a66c2;font-weight:bold', ...args); };
// // //   window.__jdpDiag = window.__jdpDiag || false;

// // //   // ---------------------------------------------------------------------
// // //   // 1. JD 文本解析（与 content.js 保持同一套语义，避免两边结果不一致）
// // //   // ---------------------------------------------------------------------
// // //   // ============================================================================
// // //   // 优化版 parseJdSmart —— 针对 LinkedIn / Indeed 英文 JD "照单全收" 的问题
// // //   //
// // //   // 四个改动：
// // //   //  [根因] normalizeAndMergeLines 会把不带冒号的英文小标题并进下一行，
// // //   //         标题特征被彻底破坏 → 打分全军覆没 → 退化成"全文塞进 responsibilities"。
// // //   //         现在识别到"疑似小标题"的行一律不参与合并。
// // //   //  [词表] 按真实 JD 写作规范扩充（Essential Duties / Basic Qualifications /
// // //   //         What You'll Bring / Nice-to-Haves 等），并区分 required vs preferred。
// // //   //  [新增] 停止小节(STOP_SECTIONS)：Benefits / EEO / About Us 这类尾部样板段落
// // //   //         以前会被并进最后一个小节，现在遇到即截断。
// // //   //  [判定] 英文标题的结构特征另算：Title Case / ALL CAPS / 独立短行 / 后接列表。
// // //   // ============================================================================

// // //   // ============================================================================
// // //   // 合并版 JD 解析：DOM 有状态遍历(element 感知打分) + 文本兜底
// // //   //
// // //   // 架构取自你的 parseJdSmartMultiSignal：按渲染顺序遍历块 → 遇标题切换当前小节 →
// // //   // 其余内容归入当前小节。这个结构比"先压成文本再按位置切片"更好，因为打分时
// // //   // element 还在手上，className/id/tagName 都能用。
// // //   //
// // //   // 在此基础上修掉三个实测失分点，并补上纯文本路径：
// // //   //   [修] \b 对中文无效 + 全角冒号未处理 → 中文标题一个都识别不出
// // //   //   [修] 无停止小节 → Benefits/EEO/公司介绍 一路污染最后一个小节
// // //   //   [修] unspecified(前言) 被丢弃 → 岗位概述整段消失
// // //   //   [补] parseJdSmartText：API 返回的是 JSON/纯文本时没有 DOM，必须有这条路
// // //   // ============================================================================

// // //   // ============================================================================
// // //   // 合并版 JD 解析：DOM 有状态遍历(element 感知打分) + 文本兜底
// // //   //
// // //   // 架构取自你的 parseJdSmartMultiSignal：按渲染顺序遍历块 → 遇标题切换当前小节 →
// // //   // 其余内容归入当前小节。这个结构比"先压成文本再按位置切片"更好，因为打分时
// // //   // element 还在手上，className/id/tagName 都能用。
// // //   //
// // //   // 在此基础上修掉三个实测失分点，并补上纯文本路径：
// // //   //   [修] \b 对中文无效 + 全角冒号未处理 → 中文标题一个都识别不出
// // //   //   [修] 无停止小节 → Benefits/EEO/公司介绍 一路污染最后一个小节
// // //   //   [修] unspecified(前言) 被丢弃 → 岗位概述整段消失
// // //   //   [补] parseJdSmartText：API 返回的是 JSON/纯文本时没有 DOM，必须有这条路
// // //   // ============================================================================

// // //   // ============================================================================
// // //   // 合并版 JD 解析：DOM 有状态遍历(element 感知打分) + 文本兜底
// // //   //
// // //   // 架构取自你的 parseJdSmartMultiSignal：按渲染顺序遍历块 → 遇标题切换当前小节 →
// // //   // 其余内容归入当前小节。这个结构比"先压成文本再按位置切片"更好，因为打分时
// // //   // element 还在手上，className/id/tagName 都能用。
// // //   //
// // //   // 在此基础上修掉三个实测失分点，并补上纯文本路径：
// // //   //   [修] \b 对中文无效 + 全角冒号未处理 → 中文标题一个都识别不出
// // //   //   [修] 无停止小节 → Benefits/EEO/公司介绍 一路污染最后一个小节
// // //   //   [修] unspecified(前言) 被丢弃 → 岗位概述整段消失
// // //   //   [补] parseJdSmartText：API 返回的是 JSON/纯文本时没有 DOM，必须有这条路
// // //   // ============================================================================

// // //   const SECTION_VOCAB = [
// // //     {
// // //       type: 'responsibilities',
// // //       tiers: [
// // //         { weight: 50, phrases: ['岗位职责','工作职责','职责描述','主要职责','工作内容','岗位描述','职位描述',
// // //             'Responsibilities','Key Responsibilities','Primary Responsibilities','Core Responsibilities',
// // //             'Duties and Responsibilities','Essential Duties','Essential Functions','Essential Job Functions','Key Accountabilities','Responsibility','职位职责','工作内容及职责'] },
// // //         { weight: 40, phrases: ["What you'll do",'What you will do',"What You'll Be Doing",'About the Role',
// // //             'About this Role','About the job','Role Overview','Role Summary','Job Summary','Job Purpose',
// // //             'The Role','Your Impact','Duties','你将负责','主要工作','主要负责','负责内容'] },
// // //         { weight: 25, phrases: ['职责','Tasks','任务'] },
// // //       ],
// // //     },
// // //     {
// // //       type: 'requirements',
// // //       tiers: [
// // //         { weight: 50, phrases: ['任职要求','任职资格','岗位要求','招聘条件','职位要求','能力要求','岗位条件',
// // //             'Requirements','Qualifications','Job Requirements','Basic Qualifications','Minimum Qualifications',
// // //             'Required Qualifications','Key Qualifications','Skills and Qualifications','Education and Experience','Requirement','Qualification','技能要求','能力要求'] },
// // //         { weight: 40, phrases: ["What we're looking for",'What we are looking for','Who You Are',
// // //             "What You'll Bring",'What You Bring','Skills & Experience','Required Skills','Must Have','Must-haves',
// // //             '你需要具备','我们需要你'] },
// // //         { weight: 25, phrases: ['要求','资格','Skills'] },
// // //       ],
// // //     },
// // //     {
// // //       type: 'bonus',
// // //       tiers: [
// // //         { weight: 50, phrases: ['加分项','优先条件','优先考虑','加分技能',
// // //             'Preferred Qualifications','Additional Qualifications','Preferred Experience','Preferred Skills',
// // //             'Nice to have','Nice-to-haves','Bonus Points','Desirable Skills'] },
// // //         { weight: 40, phrases: ['具备以下者优先','有以下经验优先','Bonus points if you have','A plus if','An asset','Desirable'] },
// // //         { weight: 25, phrases: ['加分','Preferred'] },
// // //       ],
// // //     },
// // //   ];

// // //   // 停止小节：命中即结束正文收集，后面的内容全部丢弃
// // //   const STOP_SECTIONS = [
// // //     '福利待遇','薪资福利','公司简介','关于我们','企业文化','工作地点','投递方式','我们提供',
// // //     'Benefits','What We Offer','Perks','Perks and Benefits','Compensation','Salary','Pay Range',
// // //     'Working Conditions','Work Environment','Physical Requirements',
// // //     'EEO Statement','Equal Opportunity','Equal Employment Opportunity','EEO',
// // //     'About Us','About the Company','Our Story','Our Mission','Why Join Us','Who We Are',
// // //     'How to Apply','Application Process','Next Steps','Disclaimer','Legal',
// // //   ];

// // //   // ⚡ 归一化：把真实页面里的各种写法变体收敛到同一形态再匹配。
// // //   // 实测这一步能解决一大半漏判——弯引号、全角括号、连字符/&、多余空白。
// // //   function normalizeForMatch(s) {
// // //     return String(s || '')
// // //       .replace(/[\u2018\u2019\u02bc]/g, "'")      // 弯引号 → 直引号
// // //       .replace(/[\u201c\u201d]/g, '"')
// // //       .replace(/[\u2010-\u2015\u2212]/g, '-')      // 各种破折号 → 连字符
// // //       .replace(/[（）]/g, (m) => (m === '（' ? '(' : ')'))
// // //       .replace(/\s*&\s*/g, ' and ')                // & → and
// // //       .replace(/-/g, ' ')                          // 连字符与空格等价
// // //       .replace(/\s+/g, ' ')
// // //       .trim()
// // //       .toLowerCase();
// // //   }

// // //   // 中文短语足够独特（"岗位职责"几乎不可能出现在非标题语境的正文短行里），
// // //   // 直接用包含匹配，不再要求特定的前后缀字符——之前要求前缀必须是空白/项目符号，
// // //   // 导致"一、岗位职责""1.岗位职责""（一）岗位职责"这类编号标题全部漏判。
// // //   function matchPhrase(normText, phrase) {
// // //     const p = normalizeForMatch(phrase);
// // //     if (/[\u4e00-\u9fa5]/.test(p)) return normText.includes(p);
// // //     // 英文：词边界匹配，并容忍词尾复数
// // //     const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// // //     return new RegExp(`(?:^|\\b)${esc}(?:e?s)?(?:\\b|[:：]|$)`, 'i').test(normText);
// // //   }

// // //   // ⚡ 核心词正则（你提的思路）：词表覆盖不到的写法用"含核心词"兜底。
// // //   // 权重压得低，单独出现过不了阈值，必须叠加排版/DOM 证据才成立——
// // //   // 这样既能捞回"主要负责""职位职责"这类变体，又不会把正文里提到
// // //   // "负责"的普通句子误判成标题。
// // //   const CORE_PATTERNS = [
// // //     { type: 'responsibilities', weight: 22, re: /(职责|负责|工作内容|responsibilit|duties|what you.{0,4}(ll|will) do)/i },
// // //     { type: 'requirements',     weight: 22, re: /(要求|资格|条件|qualificat|requirement|what (we|you).{0,4}(re |ll )?(looking|bring|have))/i },
// // //     { type: 'bonus',            weight: 22, re: /(加分|优先|preferred|nice to have|bonus|desirable|a plus)/i },
// // //   ];

// // //   // 最长匹配优先：解决 "Preferred Qualifications" 被 "Qualifications" 抢走
// // //   // 判成 requirements 的问题（同权重时，命中的短语越长越具体，应该赢）。
// // //   function matchVocab(text) {
// // //     const normText = normalizeForMatch(text);
// // //     let best = { type: null, keywordScore: 0, len: 0 };
// // //     for (const cfg of SECTION_VOCAB) {
// // //       for (const tier of cfg.tiers) {
// // //         for (const p of tier.phrases) {
// // //           if (!matchPhrase(normText, p)) continue;
// // //           const len = normalizeForMatch(p).length;
// // //           if (tier.weight > best.keywordScore || (tier.weight === best.keywordScore && len > best.len)) {
// // //             best = { type: cfg.type, keywordScore: tier.weight, len };
// // //           }
// // //         }
// // //       }
// // //     }
// // //     if (!best.type) {
// // //       for (const c of CORE_PATTERNS) {
// // //         if (c.re.test(normText) && c.weight > best.keywordScore) {
// // //           best = { type: c.type, keywordScore: c.weight, len: 0 };
// // //         }
// // //       }
// // //     }
// // //     return best;
// // //   }

// // //   function isStopSection(text) {
// // //     const t = text.trim().replace(/[:：\s]+$/, '').toLowerCase();
// // //     return STOP_SECTIONS.some((w) => t === w.toLowerCase());
// // //   }

// // //   // ---------------------------------------------------------------------------
// // //   // 多维打分：DOM 维度 + 排版维度 + 语义维度
// // //   // ---------------------------------------------------------------------------
// // //   function assessSectionHeader(element, text) {
// // //     const isCJKText = /[\u4e00-\u9fa5]/.test(text);

// // //     // 一票否决：项目符号开头的绝不是标题
// // //     if (/^[*•▪◦●\-–]\s+/.test(text)) return { isHeader: false, score: 0, type: null };

// // //     // ⚡ 数字编号不再一律否决。"1.岗位职责" 是标题，"1.负责推荐算法设计" 是列表项，
// // //     // 两者的区别不在编号而在长度：标题短、列表项长。以前一刀切否决，导致中文
// // //     // JD 里极常见的 "1.岗位职责" "2.任职资格" 全被判成列表项而漏掉。
// // //     const numbered = /^\d+[.、)）]\s*\S/.test(text) || /^[一二三四五六七八九十]+[、.]\s*\S/.test(text);
// // //     const bare = text.replace(/^[（(]?[\d一二三四五六七八九十]+[）)]?[.、)）]?\s*/, '');
// // //     if (numbered && bare.length > (isCJKText ? 12 : 30)) {
// // //       return { isHeader: false, score: 0, type: null };
// // //     }

// // //     let domScore = 0;
// // //     if (element && element.tagName) {
// // //       const tag = element.tagName.toLowerCase();
// // //       // className 在 SVG 元素上是对象，统一转字符串
// // //       const cls = typeof element.className === 'string' ? element.className : (element.getAttribute?.('class') || '');
// // //       const idName = element.id || '';
// // //       if (/^h[1-3]$/.test(tag)) domScore += 35;
// // //       else if (/^h[4-6]$/.test(tag)) domScore += 25;
// // //       else if (tag === 'b' || tag === 'strong') domScore += 20;
// // //       else if (tag === 'dt') domScore += 20;
// // //       // ⚡ class/id 语义信号——这是纯文本路径拿不到的证据，也是不同平台
// // //       // "职责和要求 class 不一样"时最可靠的线索
// // //       if (/header|title|section|heading|caption|label|subtitle/i.test(cls + ' ' + idName)) domScore += 30;
// // //       // 反向信号：一看就是正文/描述容器
// // //       if (/(desc|content|body|text|paragraph)/i.test(cls + ' ' + idName) && !/title|header|heading/i.test(cls + ' ' + idName)) domScore -= 10;
// // //     }

// // //     let layoutScore = 0;
// // //     const isCJK = isCJKText;
// // //     if (/[:：]\s*$/.test(text)) layoutScore += 25;
// // //     if (text.length <= (isCJK ? 20 : 40)) layoutScore += 20;
// // //     if (!isCJK && text === text.toUpperCase() && /[A-Z]{3,}/.test(text)) layoutScore += 18;
// // //     if (/[.。]$/.test(text) && !/[:：]$/.test(text)) layoutScore -= 20;
// // //     if (text.length > (isCJK ? 40 : 80)) layoutScore -= 40;
// // //     // 叙述句特征
// // //     if (/(?:we\s+are|you\s+will|our\s+team|looking\s+for\s+a|我们正在|如果你)/i.test(text) && text.length > 30) layoutScore -= 35;

// // //     const { type, keywordScore } = matchVocab(text);
// // //     const totalScore = domScore + layoutScore + keywordScore;
// // //     const headingLen = isCJKText ? 22 : 50;
// // //     const isHeader = (totalScore >= 60 && keywordScore > 0)
// // //       || (domScore >= 35 && keywordScore >= 25 && text.length <= headingLen);
// // //     return { isHeader, type, score: totalScore };
// // //   }

// // //   // ---------------------------------------------------------------------------
// // //   // 按渲染顺序拆块。相比原版修了两处：
// // //   //   - <li> 单独成块（原版 UL 的子元素是 LI，不在 some() 的标签清单里，
// // //   //     导致整个 UL 被当成一个叶子块，所有列表项糊成一坨）
// // //   //   - 直系文本节点不再丢失（原版 else 分支只遍历 element.children）
// // //   // ---------------------------------------------------------------------------
// // //   const LEAFY = /^(P|LI|H[1-6]|DT|DD|TD|TH|BLOCKQUOTE)$/i;
// // //   const CONTAINER = /^(DIV|SECTION|ARTICLE|UL|OL|DL|TABLE|TBODY|TR|MAIN|SPAN|BODY)$/i;

// // //   function getVisualTextBlocks(node) {
// // //     const blocks = [];
// // //     const walk = (el) => {
// // //       if (!el || !el.tagName) return;
// // //       const tag = el.tagName;
// // //       if (/^(SCRIPT|STYLE|NOSCRIPT|SVG)$/i.test(tag)) return;

// // //       if (LEAFY.test(tag)) {
// // //         const t = (el.textContent || '').trim();
// // //         if (t) blocks.push({ element: el, text: t });
// // //         return;
// // //       }
// // //       if (/^(H[1-6]|STRONG|B)$/i.test(tag)) {
// // //         const t = (el.textContent || '').trim();
// // //         if (t) blocks.push({ element: el, text: t });
// // //         return;
// // //       }
// // //       if (CONTAINER.test(tag)) {
// // //         // 先看有没有值得下钻的子元素；没有就把自己整体作为一块
// // //         const hasElementChild = el.children && el.children.length > 0;
// // //         if (!hasElementChild) {
// // //           const t = (el.textContent || '').trim();
// // //           if (t) blocks.push({ element: el, text: t });
// // //           return;
// // //         }
// // //         // 有子元素：逐个 childNode 处理，直系文本节点也要保留（原版会丢）
// // //         for (const child of Array.from(el.childNodes)) {
// // //           if (child.nodeType === 3) { // TEXT_NODE
// // //             const t = (child.nodeValue || '').trim();
// // //             if (t) blocks.push({ element: el, text: t });
// // //           } else if (child.nodeType === 1) {
// // //             walk(child);
// // //           }
// // //         }
// // //         return;
// // //       }
// // //       // 其它标签(如 <a>/<em>)：并入父级由父级处理，这里只兜底取文本
// // //       const t = (el.textContent || '').trim();
// // //       if (t) blocks.push({ element: el, text: t });
// // //     };
// // //     walk(node);
// // //     return blocks;
// // //   }

// // //   // ---------------------------------------------------------------------------
// // //   // 主入口（DOM 路径）
// // //   // ---------------------------------------------------------------------------
// // //   function parseJdFromDom(containerNode) {
// // //     const blocks = getVisualTextBlocks(containerNode);
// // //     const buckets = { intro: [], responsibilities: [], requirements: [], bonus: [] };
// // //     let current = 'intro'; // ⚡ 第一个标题之前的内容不再丢弃，归入 intro

// // //     for (const { element, text } of blocks) {
// // //       const t = text.trim();
// // //       if (!t) continue;

// // //       // 停止小节：只认"看起来像标题"的短行，且必须已经进入过真实小节
// // //       // （开头的 About Us / 公司简介 是开场白，不是结尾样板）
// // //       if (current !== 'intro' && t.length <= 40 && isStopSection(t)) break;

// // //       const a = assessSectionHeader(element, t);
// // //       if (a.isHeader && a.type) { current = a.type; continue; }
// // //       buckets[current].push(t);
// // //     }

// // //     // intro 并入 responsibilities 前部（岗位概述本质上属于"做什么"）
// // //     const resp = [...buckets.intro, ...buckets.responsibilities].join('\n').trim();
// // //     return {
// // //       responsibilities: resp,
// // //       requirements: buckets.requirements.join('\n').trim(),
// // //       bonus: buckets.bonus.join('\n').trim(),
// // //       fullCleanText: blocks.map((b) => b.text).join('\n').trim(),
// // //     };
// // //   }

// // //   // ---------------------------------------------------------------------------
// // //   // 纯文本路径（API/JSON 返回时没有 DOM，这条必须保留）
// // //   // 复用同一套词表和停止小节，保证两条路结论一致。
// // //   // ---------------------------------------------------------------------------
// // //   function looksLikeHeadingLine(s) {
// // //     s = s.trim();
// // //     if (!s || s.length > 60) return false;
// // //     if (/^##\s/.test(s) || /[:：]$/.test(s) || /^【.+】$/.test(s) || /^#+\s/.test(s)) return true;
// // //     const isCJK = /[\u4e00-\u9fa5]/.test(s);
// // //     if (!isCJK && s.length <= 45 && !/[.!?]$/.test(s)) {
// // //       if (s === s.toUpperCase() && /[A-Z]{3,}/.test(s)) return true;
// // //       const w = s.split(/\s+/);
// // //       const small = ['a','an','the','and','or','of','to','for','in','you','we','your','our','will','be','with'];
// // //       if (w.length <= 6 && w.every((x) => !/^[a-z]/.test(x) || small.includes(x.toLowerCase()))) return true;
// // //     }
// // //     return isCJK && s.length <= 20 && !/[。！？]$/.test(s);
// // //   }

// // //   function normalizeAndMergeLines(text) {
// // //     const lines = text.split('\n');
// // //     const bullet = /^([•▪◦●\-*]|[\d一二三四五六七八九十]+[.、)）])\s*/;
// // //     const out = [];
// // //     for (const raw of lines) {
// // //       const line = raw.trim();
// // //       if (!line) { out.push(''); continue; }
// // //       const prev = out[out.length - 1];
// // //       const canMerge = prev
// // //         && !bullet.test(line) && !looksLikeHeadingLine(line)
// // //         && !/[。！？.!?:：；;]$/.test(prev) && !bullet.test(prev) && !looksLikeHeadingLine(prev)
// // //         && /^[a-z(,;)]/.test(line); // 只有小写开头才算折行续写
// // //       if (canMerge) out[out.length - 1] = prev + ' ' + line;
// // //       else out.push(line);
// // //     }
// // //     return out.filter(Boolean).join('\n');
// // //   }

// // //   function parseJdFromText(rawText) {
// // //     const result = { responsibilities: '', requirements: '', bonus: '', fullCleanText: '' };
// // //     if (!rawText || typeof rawText !== 'string') return result;
// // //     const text = normalizeAndMergeLines(
// // //       rawText.replace(/\r\n?/g, '\n').replace(/\u3000/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
// // //     );
// // //     result.fullCleanText = text.replace(/^##\s+/gm, '');

// // //     const buckets = { intro: [], responsibilities: [], requirements: [], bonus: [] };
// // //     let current = 'intro';
// // //     for (const raw of text.split('\n')) {
// // //       const t = raw.trim();
// // //       if (!t) continue;
// // //       const bare = t.replace(/^##\s+/, '');
// // //       // ⚡ 停止小节只在"已经进入过真实小节"之后才生效。JD 以 "About Us"/"公司简介"
// // //       // 开头极其常见，那是开场介绍标题，不是结尾样板；以前一律 break，导致
// // //       // 整份 JD 从第一行就被丢弃，最后靠兜底把全文塞进职责（表现为完全不切分）。
// // //       if (current !== 'intro' && bare.length <= 40 && isStopSection(bare)) break;

// // //       // ⚡ 统一走标定过的 assessSectionHeader（element 传 null 即纯文本+排版+语义）。
// // //       // 之前这里是另一套弱判定（looksLikeHeadingLine + keywordScore>=15），
// // //       // 阈值远低于 DOM 路径，结果把 "1、负责推荐算法的设计" 这种列表项当成标题
// // //       // 吞掉，正文反而丢了。两条路必须共用同一套判定，结论才会一致。
// // //       const a = assessSectionHeader(null, bare);
// // //       if (a.isHeader && a.type) { current = a.type; continue; }
// // //       buckets[current].push(bare);
// // //     }
// // //     result.responsibilities = [...buckets.intro, ...buckets.responsibilities].join('\n').trim();
// // //     result.requirements = buckets.requirements.join('\n').trim();
// // //     result.bonus = buckets.bonus.join('\n').trim();
// // //     if (!result.responsibilities && !result.requirements && !result.bonus) {
// // //       result.responsibilities = result.fullCleanText;
// // //     }
// // //     return result;
// // //   }

// // //   // 统一入口：有 DOM 走 DOM，没有就走文本
// // //   function parseJdSmart(input) {
// // //     if (input && typeof input === 'object' && input.nodeType === 1) return parseJdFromDom(input);
// // //     return parseJdFromText(String(input || ''));
// // //   }

// // //   // HTML 正文清洗：BOSS 的 postDescription 有时带 <br>/&nbsp; 等实体
// // //   function htmlToText(html) {
// // //     if (!html || typeof html !== 'string') return '';
// // //     if (!/[<&]/.test(html)) return html;
// // //     return html
// // //       .replace(/<\s*br\s*\/?\s*>/gi, '\n')
// // //       .replace(/<\s*\/\s*(p|div|li|tr)\s*>/gi, '\n')
// // //       .replace(/<[^>]+>/g, '')
// // //       .replace(/&nbsp;/gi, ' ')
// // //       .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
// // //       .replace(/&amp;/g, '&').replace(/&quot;/g, '"');
// // //   }

// // //   // ---------------------------------------------------------------------
// // //   // 2. 通用："点击相关性捕获窗口"
// // //   //    content.js 在模拟点击前派发 REQ_BEGIN_CAPTURE，我们打开一个短窗口；
// // //   //    窗口内任何"形状像 JD"的响应，直接归属给刚点击的那张卡片。
// // //   //    这样就不需要从 payload 里猜 ID 字段名——这是能真正跨站点复用的关键。
// // //   // ---------------------------------------------------------------------
// // //   let activeCapture = null; // { cardId, startedAt, best: {score, detail} | null }

// // //   document.addEventListener('REQ_BEGIN_CAPTURE', (e) => {
// // //     const { cardId } = e.detail || {};
// // //     if (!cardId) return;
// // //     activeCapture = { cardId: String(cardId), startedAt: Date.now(), best: null };
// // //     diag('捕获窗口已开启, cardId =', cardId);
// // //   });

// // //   document.addEventListener('REQ_END_CAPTURE', () => {
// // //     if (!activeCapture) return;
// // //     // 窗口关闭时，如果期间攒到了候选，把得分最高的那个作为该卡片的详情发出去
// // //     if (activeCapture.best) {
// // //       diag('捕获窗口关闭，采用最佳候选, score =', activeCapture.best.score);
// // //       window.postMessage({
// // //         type: 'JOB_HOOK_DETAIL', site: SITE,
// // //         data: { ...activeCapture.best.detail, matchKey: activeCapture.cardId, source: 'Click-Correlated Capture' }
// // //       }, '*');
// // //     }
// // //     activeCapture = null;
// // //   });

// // //   // JD 形状打分：文本越长、越命中 JD 关键词、越像自然语言，分越高。
// // //   // 用来在捕获窗口内出现多个候选时挑出最像职位详情的那一个，
// // //   // 也用来把埋点/推荐位这类"碰巧也很长"的响应排除掉。
// // //   const JD_KEYWORD_PATTERN = /(岗位职责|工作职责|任职要求|任职资格|岗位要求|职位描述|工作内容|加分项|Responsibilities|Requirements|Qualifications|Job\s+Description|What\s+you.{0,10}do)/gi;

// // //   function scoreJdText(text) {
// // //     if (!text || text.length < 150) return 0;
// // //     const kwHits = (text.match(JD_KEYWORD_PATTERN) || []).length;
// // //     const hasSentences = /[。！？.!?]/.test(text);
// // //     if (!kwHits && !hasSentences) return 0;

// // //     // ⚡ 提高识别度：除了关键词命中，再叠加几个"这看起来确实是 JD 正文"的结构特征。
// // //     // 目的是把"碰巧很长的自然语言"（公司简介、用户协议、推荐位文案）跟真正的
// // //     // 职位描述区分开——JD 的典型形态是"分条列举的要求/职责"。
// // //     let structureBonus = 0;
// // //     // 项目符号/编号列表：JD 几乎必有
// // //     const bulletLines = (text.match(/(?:^|\n)\s*(?:[•·▪●\-*]|\d+[.、)）])\s*\S/g) || []).length;
// // //     if (bulletLines >= 3) structureBonus += 120;
// // //     else if (bulletLines >= 1) structureBonus += 40;
// // //     // 年限/学历/技能这类硬性要求措辞
// // //     if (/(\d+\s*[-~到]?\s*\d*\s*年(以上)?(工作)?经验|本科|硕士|博士|大专|years?\s+of\s+experience|bachelor|master's|degree)/i.test(text)) structureBonus += 80;
// // //     // 负面信号：明显是公司介绍/协议条款而不是岗位描述
// // //     if (/(公司简介|关于我们|企业文化|发展历程|隐私政策|用户协议|Cookie|About\s+Us|Privacy\s+Policy|Terms\s+of\s+Service)/i.test(text)
// // //         && kwHits === 0) structureBonus -= 150;

// // //     return Math.min(kwHits, 5) * 100 + Math.min(text.length, 4000) * 0.05 + structureBonus;
// // //   }

// // //   // 递归找 payload 里最像 JD 正文的那个字符串字段
// // //   function findBestJdTextInPayload(node, depth = 0, seen = new Set()) {
// // //     if (!node || typeof node !== 'object' || depth > 6 || seen.has(node)) return null;
// // //     seen.add(node);
// // //     let best = null;
// // //     for (const key in node) {
// // //       if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
// // //       const val = node[key];
// // //       if (typeof val === 'string') {
// // //         const text = htmlToText(val);
// // //         const score = scoreJdText(text);
// // //         if (score > 0 && (!best || score > best.score)) {
// // //           best = { score, text, key, container: node };
// // //         }
// // //       } else if (val && typeof val === 'object') {
// // //         const sub = findBestJdTextInPayload(val, depth + 1, seen);
// // //         if (sub && (!best || sub.score > best.score)) best = sub;
// // //       }
// // //     }
// // //     return best;
// // //   }

// // //   const TITLE_LIKE_KEYS = ['jobName', 'title', 'jobTitle', 'positionName', 'name', 'headline'];
// // //   function guessTitle(container) {
// // //     if (!container) return '';
// // //     for (const k of TITLE_LIKE_KEYS) {
// // //       if (typeof container[k] === 'string' && container[k].length < 100) return container[k];
// // //     }
// // //     return '';
// // //   }

// // //   // 捕获窗口内的候选收集：不立刻发出，先攒着比分数，窗口关闭时发最佳的那个
// // //   // ⚡ 高置信度候选立刻发出，不等窗口关闭。
// // //   // 之前的设计是"窗口内攒着，REQ_END_CAPTURE 时发最佳的那个"——但 content.js
// // //   // 侧的 REQ_END_CAPTURE 是在 finalize() 里派发的，而 finalize() 只在已经
// // //   // resolve/超时时才跑，等于候选永远晚一拍，network 这个源在观察窗口内根本
// // //   // 没机会赢，白白掉到更慢的 pageFetch。现在改成：分数够高(明显就是 JD)就
// // //   // 立即发出，让等待中的 Promise 当场接住；分数不够高的才留到窗口关闭时兜底。
// // //   const CONFIDENT_SCORE = 260; // 约等于"命中 2 个以上 JD 关键词 + 有列表结构"

// // //   function offerToCapture(json) {
// // //     if (!activeCapture) return false;
// // //     const best = findBestJdTextInPayload(json);
// // //     if (!best) return false;

// // //     const detail = { title: guessTitle(best.container), ...parseJdSmart(best.text) };

// // //     if (best.score >= CONFIDENT_SCORE) {
// // //       diag('捕获窗口内命中高置信度候选，立即发出, score =', best.score, 'key =', best.key);
// // //       window.postMessage({
// // //         type: 'JOB_HOOK_DETAIL', site: SITE,
// // //         data: { ...detail, matchKey: activeCapture.cardId, source: 'Click-Correlated Capture' }
// // //       }, '*');
// // //       activeCapture.best = null; // 已经发过了，窗口关闭时不用再发一遍
// // //       return true;
// // //     }

// // //     if (activeCapture.best && activeCapture.best.score >= best.score) return true;
// // //     activeCapture.best = { score: best.score, detail };
// // //     diag('捕获窗口内收到低置信度候选(暂存), score =', best.score, 'key =', best.key);
// // //     return true;
// // //   }

// // //   // ---------------------------------------------------------------------
// // //   // 3. BOSS 专属规则（优先级最高，因为字段结构确定，解析最准）
// // //   // ---------------------------------------------------------------------
// // //   // ⚡ URL 放宽：不再写死 /job/detail.json。BOSS 换路径/换域名前缀的情况很常见，
// // //   //    这里覆盖常见几种，再由 payload 结构做二次确认（zpData.jobInfo 存在才算数）。
// // //   const BOSS_DETAIL_URL = /\/(job\/detail|jobdetail|job\/card|geek\/job\/detail)\.json/i;
// // //   const BOSS_LIST_URL = /\/(joblist|job\/list|geek\/joblist)\.json/i;

// // //   function parseBossDetail(json, url) {
// // //     const jobInfo = json?.zpData?.jobInfo;
// // //     if (!jobInfo) return null;

// // //     // matchKey 多级兜底：URL query 的 securityId 最可靠（跟 content.js 发起
// // //     // 点击时用的是同一个值），其次 payload 里的各种 id，最后交给点击相关性。
// // //     let matchKey = '';
// // //     try { matchKey = new URL(url, location.origin).searchParams.get('securityId') || ''; } catch (e) {}
// // //     if (!matchKey) matchKey = jobInfo.encryptJobId || jobInfo.encryptId || jobInfo.securityId || '';
// // //     if (!matchKey && activeCapture) matchKey = activeCapture.cardId;

// // //     const rawDesc = htmlToText(jobInfo.postDescription || '');
// // //     return {
// // //       matchKey,
// // //       title: jobInfo.jobName || '',
// // //       salary: jobInfo.salaryDesc || '',
// // //       company: json.zpData.brandComInfo?.brandName || '',
// // //       location: jobInfo.locationName || '',
// // //       ...parseJdSmart(rawDesc)
// // //     };
// // //   }

// // //   function notifyList(list) {
// // //     if (!Array.isArray(list) || list.length === 0) return;
// // //     window.postMessage({ type: 'JOB_HOOK_LIST', site: SITE, data: list }, '*');
// // //   }

// // //   function notifyDetail(detail) {
// // //     if (!detail) return;
// // //     if (!detail.matchKey) {
// // //       // ⚡ 以前这里直接 return，静默丢弃。现在至少留个诊断痕迹，
// // //       //    并且如果捕获窗口开着，就把它归属给当前点击的卡片。
// // //       if (activeCapture) {
// // //         detail = { ...detail, matchKey: activeCapture.cardId, source: 'Click-Correlated Fallback' };
// // //         diag('详情缺少 matchKey，按点击相关性归属给', activeCapture.cardId);
// // //       } else {
// // //         diag('⚠️ 拿到详情但没有 matchKey，且没有捕获窗口，只能丢弃');
// // //         return;
// // //       }
// // //     }
// // //     window.postMessage({ type: 'JOB_HOOK_DETAIL', site: SITE, data: detail }, '*');
// // //   }

// // //   // ---------------------------------------------------------------------
// // //   // 4. LinkedIn / generic 的内容特征扫描（沿用上一版思路）
// // //   // ---------------------------------------------------------------------
// // //   const LINKEDIN_PAYLOAD_HINT = /fsd_jobPosting|jobPostingUrn|"description":\s*\{\s*"text"/;

// // //   function extractJobIdFromUrn(urn) {
// // //     if (typeof urn !== 'string') return null;
// // //     const m = urn.match(/(?:fsd_jobPosting|jobPosting):(\d+)/);
// // //     return m ? m[1] : null;
// // //   }

// // //   function scanLinkedInPayloadForJobPosting(node, results, seen, depth = 0) {
// // //     if (!node || typeof node !== 'object' || seen.has(node) || depth > 8) return;
// // //     seen.add(node);
// // //     const entityUrn = node.entityUrn || node['*entityUrn'] || node.jobPostingUrn || '';
// // //     const jobId = extractJobIdFromUrn(entityUrn) || (node.jobPostingId ? String(node.jobPostingId) : null);
// // //     const rawDesc = typeof node.description === 'string'
// // //       ? node.description
// // //       : (node.description && typeof node.description.text === 'string' ? node.description.text : '');
// // //     if (jobId && rawDesc) results.push({ matchKey: jobId, title: node.title || '', rawDesc: htmlToText(rawDesc) });
// // //     for (const key in node) {
// // //       if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
// // //       const val = node[key];
// // //       if (val && typeof val === 'object') scanLinkedInPayloadForJobPosting(val, results, seen, depth + 1);
// // //     }
// // //   }

// // //   // ---------------------------------------------------------------------
// // //   // 5. 统一响应处理入口
// // //   // ---------------------------------------------------------------------
// // //   function handleResponse(url, payloadText, payloadObj) {
// // //     let json = payloadObj;
// // //     if (!json) {
// // //       if (!payloadText || payloadText.length < 50) return;
// // //       // 便宜的预筛，避免对每个响应都 JSON.parse
// // //       if (payloadText[0] !== '{' && payloadText[0] !== '[') return;
// // //       try { json = JSON.parse(payloadText); } catch (e) { return; }
// // //     }
// // //     if (!json || typeof json !== 'object') return;

// // //     // ---- 诊断：把疑似职位相关的响应打出来，帮你定位真实接口 ----
// // //     if (window.__jdpDiag) {
// // //       const probe = findBestJdTextInPayload(json);
// // //       if (probe) {
// // //         diag('疑似含 JD 正文的响应:', { url, 字段名: probe.key, 分数: probe.score, 前120字: probe.text.slice(0, 120) });
// // //       }
// // //     }

// // //     // ---- BOSS 专属规则优先 ----
// // //     if (SITE === 'boss') {
// // //       if (BOSS_LIST_URL.test(url)) {
// // //         const list = json?.zpData?.jobList;
// // //         if (list) { diag('命中列表接口', url, '条数', list.length); notifyList(list); }
// // //       }
// // //       // URL 命中 或 payload 结构命中（换路径也不会失效）
// // //       if (BOSS_DETAIL_URL.test(url) || json?.zpData?.jobInfo) {
// // //         const detail = parseBossDetail(json, url);
// // //         if (detail) {
// // //           diag('命中详情接口', url, 'matchKey =', detail.matchKey);
// // //           notifyDetail(detail);
// // //           return;
// // //         }
// // //       }
// // //     }

// // //     if (SITE === 'linkedin' && LINKEDIN_PAYLOAD_HINT.test(payloadText || JSON.stringify(json).slice(0, 20000))) {
// // //       const results = [];
// // //       scanLinkedInPayloadForJobPosting(json, results, new Set());
// // //       results.forEach((r) => notifyDetail({ matchKey: r.matchKey, title: r.title, ...parseJdSmart(r.rawDesc) }));
// // //       if (results.length) return;
// // //     }

// // //     // ---- 通用兜底：点击相关性捕获（所有站点都适用，包括 BOSS 规则没命中时）----
// // //     offerToCapture(json);
// // //   }

// // //   // ---------------------------------------------------------------------
// // //   // 6. Hook XHR —— ⚡ 修复 responseType 导致的静默失效
// // //   // ---------------------------------------------------------------------
// // //   const origOpen = XMLHttpRequest.prototype.open;
// // //   const origSend = XMLHttpRequest.prototype.send;

// // //   XMLHttpRequest.prototype.open = function (method, url) {
// // //     this.__hookUrl = url;
// // //     return origOpen.apply(this, arguments);
// // //   };

// // //   XMLHttpRequest.prototype.send = function () {
// // //     this.addEventListener('load', function () {
// // //       try {
// // //         const url = this.responseURL || this.__hookUrl || '';
// // //         const rt = this.responseType;
// // //         // ⚡ 关键修复：responseText 只在 responseType 为 '' 或 'text' 时可读，
// // //         // 其它情况（尤其是 'json'）读它会抛 DOMException，被 catch 吞掉后
// // //         // 表现为"拦截装了但永远不触发"。这里按类型分别取值。
// // //         if (rt === '' || rt === 'text') {
// // //           handleResponse(url, this.responseText, null);
// // //         } else if (rt === 'json') {
// // //           handleResponse(url, null, this.response);
// // //         }
// // //         // 'blob'/'arraybuffer'/'document' 不是 JSON 接口，直接忽略
// // //       } catch (e) {
// // //         diag('XHR 响应处理异常(已忽略):', e && e.message);
// // //       }
// // //     });
// // //     return origSend.apply(this, arguments);
// // //   };

// // //   // ---------------------------------------------------------------------
// // //   // 7. Hook fetch
// // //   // ---------------------------------------------------------------------
// // //   const origFetch = window.fetch;
// // //   if (typeof origFetch === 'function') {
// // //     window.fetch = function (input, init) {
// // //       const url = typeof input === 'string' ? input : (input && input.url) || '';
// // //       return origFetch.apply(this, arguments).then((res) => {
// // //         try {
// // //           res.clone().text().then((text) => handleResponse(url, text, null)).catch(() => {});
// // //         } catch (e) {}
// // //         return res;
// // //       });
// // //     };
// // //   }

// // //   // ---------------------------------------------------------------------
// // //   // 8. BOSS 首屏 SSR 数据
// // //   // ---------------------------------------------------------------------
// // //   if (SITE === 'boss') {
// // //     try {
// // //       if (window.__INITIAL_STATE__?.jobList) notifyList(window.__INITIAL_STATE__.jobList);
// // //     } catch (e) {}
// // //   }

// // //   // ---------------------------------------------------------------------
// // //   // 9. 主动兜底通道（保持原有行为不变）
// // //   // ---------------------------------------------------------------------
// // //   function getLinkedInCsrfToken() {
// // //     const m = document.cookie.match(/JSESSIONID="?([^";]+)"?/);
// // //     return m ? m[1] : '';
// // //   }

// // //   async function directFetchDetail(matchKey, meta) {
// // //     if (SITE === 'linkedin') {
// // //       const csrfToken = getLinkedInCsrfToken();
// // //       if (!csrfToken) return null;
// // //       try {
// // //         const res = await fetch(`https://www.linkedin.com/voyager/api/jobs/jobPostings/${matchKey}`, {
// // //           method: 'GET',
// // //           headers: {
// // //             'csrf-token': csrfToken,
// // //             'x-restli-protocol-version': '2.0.0',
// // //             'accept': 'application/vnd.linkedin.normalized+json+2.0.0, application/json, text/plain, */*',
// // //             'x-li-lang': 'zh_CN'
// // //           }
// // //         });
// // //         if (!res.ok) return null;
// // //         const json = await res.json();
// // //         const rawDesc = htmlToText(json?.description?.text || (typeof json?.description === 'string' ? json.description : ''));
// // //         return { matchKey: String(matchKey), title: json?.title || '', ...parseJdSmart(rawDesc) };
// // //       } catch (e) { return null; }
// // //     }

// // //     if (SITE === 'boss') {
// // //       const securityId = matchKey;
// // //       const lid = meta?.lid || '';
// // //       if (!securityId) return null;
// // //       try {
// // //         const apiUrl = `/wapi/zpgeek/job/detail.json?securityId=${encodeURIComponent(securityId)}&lid=${encodeURIComponent(lid)}`;
// // //         const res = await fetch(apiUrl, {
// // //           headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, text/plain, */*' }
// // //         });
// // //         if (!res.ok) return null;
// // //         const json = await res.json();
// // //         return parseBossDetail(json, apiUrl);
// // //       } catch (e) { return null; }
// // //     }
// // //     return null;
// // //   }

// // //   document.addEventListener('REQ_DIRECT_FETCH_JOB', async (e) => {
// // //     const { matchKey, meta, requestId } = e.detail || {};
// // //     const data = await directFetchDetail(matchKey, meta);
// // //     document.dispatchEvent(new CustomEvent('RESP_DIRECT_FETCH_JOB', { detail: { requestId, matchKey, data } }));
// // //   });

// // //   document.documentElement.dataset.injectReady = 'true';
// // //   document.dispatchEvent(new CustomEvent('INJECT_SCRIPT_READY'));
// // //   console.log(`✅ [injected.js] (${SITE}) 挂载完成。排查拦截问题请在控制台执行: window.__jdpDiag = true`);
// // // })();
// // /**
// //  * ==============================================================================
// //  * injected.js — 运行在页面主环境 (MAIN World)
// //  *
// //  * 本版相对上一版的关键修复与新增：
// //  *   [修复] XHR hook 读 responseText 在 responseType='json'/'blob' 时会抛
// //  *          DOMException，被 catch 静默吞掉 → 拦截永远不触发（"只有直接请求，
// //  *          没有拦截"的根因）。现在按 responseType 分支取值。
// //  *   [修复] BOSS 详情接口 URL 从写死 /job/detail.json 放宽成多模式匹配，
// //  *          并保留"内容形状"兜底，避免站点换路径就全线失效。
// //  *   [修复] matchKey 取不到时不再静默丢弃，走多级兜底（URL → payload → 点击相关性）。
// //  *   [新增] 诊断模式：把流经的、疑似职位相关的 JSON 响应打到控制台，
// //  *          让你能直接看到 BOSS 真实的详情接口叫什么、字段长什么样。
// //  *   [新增] 通用"点击相关性捕获"：content.js 点击前开一个捕获窗口，窗口内
// //  *          出现的 JD 形状响应直接归属给刚点击的那张卡——不需要知道站点的
// //  *          ID 字段名/位置，这是真正站点无关的机制。
// //  * ==============================================================================
// //  */
// // (function () {
// //   'use strict';
// //   if (window.__jobHookInjected) return;
// //   window.__jobHookInjected = true;

// //   // ---------------------------------------------------------------------
// //   // 0. 站点识别 & 诊断开关
// //   // ---------------------------------------------------------------------
// //   const SITE = location.host.includes('zhipin.com')
// //     ? 'boss'
// //     : location.host.includes('linkedin.com')
// //       ? 'linkedin'
// //       : (location.host.includes('zhaopin.com') || location.host.includes('zhilian.com'))
// //         ? 'zhaopin'
// //         : location.host.includes('51job.com')
// //         ? '51job'
// //         : 'generic';

// //   // 诊断模式：控制台执行 window.__jdpDiag = true 即可打开（不用改代码重装插件），
// //   // 打开后会把所有"疑似职位相关"的响应 URL + 字段结构打出来。
// //   // 排查"到底哪个接口才是详情接口"时非常有用。
// //   const diag = (...args) => { if (window.__jdpDiag) console.log('%c[JDP-DIAG]', 'color:#0a66c2;font-weight:bold', ...args); };
// //   window.__jdpDiag = window.__jdpDiag || false;

// //   // ---------------------------------------------------------------------
// //   // 1. JD 文本解析（与 content.js 保持同一套语义，避免两边结果不一致）
// //   // ---------------------------------------------------------------------
// //   // ============================================================================
// //   // 优化版 parseJdSmart —— 针对 LinkedIn / Indeed 英文 JD "照单全收" 的问题
// //   //
// //   // 四个改动：
// //   //  [根因] normalizeAndMergeLines 会把不带冒号的英文小标题并进下一行，
// //   //         标题特征被彻底破坏 → 打分全军覆没 → 退化成"全文塞进 responsibilities"。
// //   //         现在识别到"疑似小标题"的行一律不参与合并。
// //   //  [词表] 按真实 JD 写作规范扩充（Essential Duties / Basic Qualifications /
// //   //         What You'll Bring / Nice-to-Haves 等），并区分 required vs preferred。
// //   //  [新增] 停止小节(STOP_SECTIONS)：Benefits / EEO / About Us 这类尾部样板段落
// //   //         以前会被并进最后一个小节，现在遇到即截断。
// //   //  [判定] 英文标题的结构特征另算：Title Case / ALL CAPS / 独立短行 / 后接列表。
// //   // ============================================================================

// //   // ============================================================================
// //   // 合并版 JD 解析：DOM 有状态遍历(element 感知打分) + 文本兜底
// //   //
// //   // 架构取自你的 parseJdSmartMultiSignal：按渲染顺序遍历块 → 遇标题切换当前小节 →
// //   // 其余内容归入当前小节。这个结构比"先压成文本再按位置切片"更好，因为打分时
// //   // element 还在手上，className/id/tagName 都能用。
// //   //
// //   // 在此基础上修掉三个实测失分点，并补上纯文本路径：
// //   //   [修] \b 对中文无效 + 全角冒号未处理 → 中文标题一个都识别不出
// //   //   [修] 无停止小节 → Benefits/EEO/公司介绍 一路污染最后一个小节
// //   //   [修] unspecified(前言) 被丢弃 → 岗位概述整段消失
// //   //   [补] parseJdSmartText：API 返回的是 JSON/纯文本时没有 DOM，必须有这条路
// //   // ============================================================================

// //   // ============================================================================
// //   // 合并版 JD 解析：DOM 有状态遍历(element 感知打分) + 文本兜底
// //   //
// //   // 架构取自你的 parseJdSmartMultiSignal：按渲染顺序遍历块 → 遇标题切换当前小节 →
// //   // 其余内容归入当前小节。这个结构比"先压成文本再按位置切片"更好，因为打分时
// //   // element 还在手上，className/id/tagName 都能用。
// //   //
// //   // 在此基础上修掉三个实测失分点，并补上纯文本路径：
// //   //   [修] \b 对中文无效 + 全角冒号未处理 → 中文标题一个都识别不出
// //   //   [修] 无停止小节 → Benefits/EEO/公司介绍 一路污染最后一个小节
// //   //   [修] unspecified(前言) 被丢弃 → 岗位概述整段消失
// //   //   [补] parseJdSmartText：API 返回的是 JSON/纯文本时没有 DOM，必须有这条路
// //   // ============================================================================

// //   // ============================================================================
// //   // 合并版 JD 解析：DOM 有状态遍历(element 感知打分) + 文本兜底
// //   //
// //   // 架构取自你的 parseJdSmartMultiSignal：按渲染顺序遍历块 → 遇标题切换当前小节 →
// //   // 其余内容归入当前小节。这个结构比"先压成文本再按位置切片"更好，因为打分时
// //   // element 还在手上，className/id/tagName 都能用。
// //   //
// //   // 在此基础上修掉三个实测失分点，并补上纯文本路径：
// //   //   [修] \b 对中文无效 + 全角冒号未处理 → 中文标题一个都识别不出
// //   //   [修] 无停止小节 → Benefits/EEO/公司介绍 一路污染最后一个小节
// //   //   [修] unspecified(前言) 被丢弃 → 岗位概述整段消失
// //   //   [补] parseJdSmartText：API 返回的是 JSON/纯文本时没有 DOM，必须有这条路
// //   // ============================================================================

// //   // ============================================================================
// //   // 合并版 JD 解析：DOM 有状态遍历(element 感知打分) + 文本兜底
// //   //
// //   // 架构取自你的 parseJdSmartMultiSignal：按渲染顺序遍历块 → 遇标题切换当前小节 →
// //   // 其余内容归入当前小节。这个结构比"先压成文本再按位置切片"更好，因为打分时
// //   // element 还在手上，className/id/tagName 都能用。
// //   //
// //   // 在此基础上修掉三个实测失分点，并补上纯文本路径：
// //   //   [修] \b 对中文无效 + 全角冒号未处理 → 中文标题一个都识别不出
// //   //   [修] 无停止小节 → Benefits/EEO/公司介绍 一路污染最后一个小节
// //   //   [修] unspecified(前言) 被丢弃 → 岗位概述整段消失
// //   //   [补] parseJdSmartText：API 返回的是 JSON/纯文本时没有 DOM，必须有这条路
// //   // ============================================================================


  

// //   const SECTION_VOCAB = [
// //     {
// //       type: 'responsibilities',
// //       tiers: [
// //         { weight: 50, phrases: ['岗位职责','工作职责','职责描述','主要职责','工作内容','岗位描述','职位描述',
// //             'Responsibilities','Key Responsibilities','Primary Responsibilities','Core Responsibilities',
// //             'Duties and Responsibilities','Essential Duties','Essential Functions','Essential Job Functions','Key Accountabilities','Responsibility','职位职责','工作内容及职责'] },
// //         { weight: 40, phrases: ["What you'll do",'What you will do',"What You'll Be Doing",'About the Role',
// //             'About this Role','About the job','Role Overview','Role Summary','Job Summary','Job Purpose',
// //             'The Role','Your Impact','Duties','你将负责','主要工作','主要负责','负责内容'] },
// //         { weight: 25, phrases: ['职责','Tasks','任务'] },
// //       ],
// //     },
// //     {
// //       type: 'requirements',
// //       tiers: [
// //         { weight: 50, phrases: ['任职要求','任职资格','岗位要求','招聘条件','职位要求','能力要求','岗位条件',
// //             'Requirements','Qualifications','Job Requirements','Basic Qualifications','Minimum Qualifications',
// //             'Required Qualifications','Key Qualifications','Skills and Qualifications','Education and Experience','Requirement','Qualification','技能要求','能力要求'] },
// //         { weight: 40, phrases: ["What we're looking for",'What we are looking for','Who You Are',
// //             "What You'll Bring",'What You Bring','Skills & Experience','Required Skills','Must Have','Must-haves',
// //             '你需要具备','我们需要你'] },
// //         { weight: 25, phrases: ['要求','资格','Skills'] },
// //       ],
// //     },
// //     {
// //       type: 'bonus',
// //       tiers: [
// //         { weight: 50, phrases: ['加分项','优先条件','优先考虑','加分技能',
// //             'Preferred Qualifications','Additional Qualifications','Preferred Experience','Preferred Skills',
// //             'Nice to have','Nice-to-haves','Bonus Points','Desirable Skills'] },
// //         { weight: 40, phrases: ['具备以下者优先','有以下经验优先','Bonus points if you have','A plus if','An asset','Desirable'] },
// //         { weight: 25, phrases: ['加分','Preferred'] },
// //       ],
// //     },
// //   ];

// //   // 停止小节：命中即结束正文收集，后面的内容全部丢弃
// //   const STOP_SECTIONS = [
// //     '福利待遇','薪资福利','公司简介','关于我们','企业文化','工作地点','投递方式','我们提供',
// //     'Benefits','What We Offer','Perks','Perks and Benefits','Compensation','Salary','Pay Range',
// //     'Working Conditions','Work Environment','Physical Requirements',
// //     'EEO Statement','Equal Opportunity','Equal Employment Opportunity','EEO',
// //     'About Us','About the Company','Our Story','Our Mission','Why Join Us','Who We Are',
// //     'How to Apply','Application Process','Next Steps','Disclaimer','Legal',
// //   ];

// //   // ⚡ 归一化：把真实页面里的各种写法变体收敛到同一形态再匹配。
// //   // 实测这一步能解决一大半漏判——弯引号、全角括号、连字符/&、多余空白。
// //   function normalizeForMatch(s) {
// //     return String(s || '')
// //       .replace(/[\u2018\u2019\u02bc]/g, "'")      // 弯引号 → 直引号
// //       .replace(/[\u201c\u201d]/g, '"')
// //       .replace(/[\u2010-\u2015\u2212]/g, '-')      // 各种破折号 → 连字符
// //       .replace(/[（）]/g, (m) => (m === '（' ? '(' : ')'))
// //       .replace(/\s*&\s*/g, ' and ')                // & → and
// //       .replace(/-/g, ' ')                          // 连字符与空格等价
// //       .replace(/\s+/g, ' ')
// //       .trim()
// //       .toLowerCase();
// //   }

// //   // 中文短语足够独特（"岗位职责"几乎不可能出现在非标题语境的正文短行里），
// //   // 直接用包含匹配，不再要求特定的前后缀字符——之前要求前缀必须是空白/项目符号，
// //   // 导致"一、岗位职责""1.岗位职责""（一）岗位职责"这类编号标题全部漏判。
// //   function matchPhrase(normText, phrase) {
// //     const p = normalizeForMatch(phrase);
// //     if (/[\u4e00-\u9fa5]/.test(p)) return normText.includes(p);
// //     // 英文：词边界匹配，并容忍词尾复数
// //     const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// //     return new RegExp(`(?:^|\\b)${esc}(?:e?s)?(?:\\b|[:：]|$)`, 'i').test(normText);
// //   }

// //   // ⚡ 核心词正则（你提的思路）：词表覆盖不到的写法用"含核心词"兜底。
// //   // 权重压得低，单独出现过不了阈值，必须叠加排版/DOM 证据才成立——
// //   // 这样既能捞回"主要负责""职位职责"这类变体，又不会把正文里提到
// //   // "负责"的普通句子误判成标题。
// //   const CORE_PATTERNS = [
// //     { type: 'responsibilities', weight: 22, re: /(职责|负责|工作内容|responsibilit|duties|what you.{0,4}(ll|will) do)/i },
// //     { type: 'requirements',     weight: 22, re: /(要求|资格|条件|qualificat|requirement|what (we|you).{0,4}(re |ll )?(looking|bring|have))/i },
// //     { type: 'bonus',            weight: 22, re: /(加分|优先|preferred|nice to have|bonus|desirable|a plus)/i },
// //   ];

// //   // 最长匹配优先：解决 "Preferred Qualifications" 被 "Qualifications" 抢走
// //   // 判成 requirements 的问题（同权重时，命中的短语越长越具体，应该赢）。
// //   function matchVocab(text) {
// //     const normText = normalizeForMatch(text);
// //     let best = { type: null, keywordScore: 0, len: 0 };
// //     for (const cfg of SECTION_VOCAB) {
// //       for (const tier of cfg.tiers) {
// //         for (const p of tier.phrases) {
// //           if (!matchPhrase(normText, p)) continue;
// //           const len = normalizeForMatch(p).length;
// //           if (tier.weight > best.keywordScore || (tier.weight === best.keywordScore && len > best.len)) {
// //             best = { type: cfg.type, keywordScore: tier.weight, len };
// //           }
// //         }
// //       }
// //     }
// //     if (!best.type) {
// //       for (const c of CORE_PATTERNS) {
// //         if (c.re.test(normText) && c.weight > best.keywordScore) {
// //           best = { type: c.type, keywordScore: c.weight, len: 0 };
// //         }
// //       }
// //     }
// //     return best;
// //   }

// //   function isStopSection(text) {
// //     const t = text.trim().replace(/[:：\s]+$/, '').toLowerCase();
// //     return STOP_SECTIONS.some((w) => t === w.toLowerCase());
// //   }

// //   // ---------------------------------------------------------------------------
// //   // 多维打分：DOM 维度 + 排版维度 + 语义维度
// //   // ---------------------------------------------------------------------------
// //   function assessSectionHeader(element, text) {
// //     const isCJKText = /[\u4e00-\u9fa5]/.test(text);

// //     // 一票否决：项目符号开头的绝不是标题
// //     if (/^[*•▪◦●\-–]\s+/.test(text)) return { isHeader: false, score: 0, type: null };

// //     // ⚡ 数字编号不再一律否决。"1.岗位职责" 是标题，"1.负责推荐算法设计" 是列表项，
// //     // 两者的区别不在编号而在长度：标题短、列表项长。以前一刀切否决，导致中文
// //     // JD 里极常见的 "1.岗位职责" "2.任职资格" 全被判成列表项而漏掉。
// //     const numbered = /^\d+[.、)）]\s*\S/.test(text) || /^[一二三四五六七八九十]+[、.]\s*\S/.test(text);
// //     const bare = text.replace(/^[（(]?[\d一二三四五六七八九十]+[）)]?[.、)）]?\s*/, '');
// //     if (numbered && bare.length > (isCJKText ? 12 : 30)) {
// //       return { isHeader: false, score: 0, type: null };
// //     }

// //     let domScore = 0;
// //     if (element && element.tagName) {
// //       const tag = element.tagName.toLowerCase();
// //       // className 在 SVG 元素上是对象，统一转字符串
// //       const cls = typeof element.className === 'string' ? element.className : (element.getAttribute?.('class') || '');
// //       const idName = element.id || '';
// //       if (/^h[1-3]$/.test(tag)) domScore += 35;
// //       else if (/^h[4-6]$/.test(tag)) domScore += 25;
// //       else if (tag === 'b' || tag === 'strong') domScore += 20;
// //       else if (tag === 'dt') domScore += 20;
// //       // ⚡ class/id 语义信号——这是纯文本路径拿不到的证据，也是不同平台
// //       // "职责和要求 class 不一样"时最可靠的线索
// //       if (/header|title|section|heading|caption|label|subtitle/i.test(cls + ' ' + idName)) domScore += 30;
// //       // 反向信号：一看就是正文/描述容器
// //       if (/(desc|content|body|text|paragraph)/i.test(cls + ' ' + idName) && !/title|header|heading/i.test(cls + ' ' + idName)) domScore -= 10;
// //     }

// //     let layoutScore = 0;
// //     const isCJK = isCJKText;
// //     if (/[:：]\s*$/.test(text)) layoutScore += 25;
// //     if (text.length <= (isCJK ? 20 : 40)) layoutScore += 20;
// //     if (!isCJK && text === text.toUpperCase() && /[A-Z]{3,}/.test(text)) layoutScore += 18;
// //     if (/[.。]$/.test(text) && !/[:：]$/.test(text)) layoutScore -= 20;
// //     if (text.length > (isCJK ? 40 : 80)) layoutScore -= 40;
// //     // 叙述句特征
// //     if (/(?:we\s+are|you\s+will|our\s+team|looking\s+for\s+a|我们正在|如果你)/i.test(text) && text.length > 30) layoutScore -= 35;

// //     const { type, keywordScore } = matchVocab(text);
// //     const totalScore = domScore + layoutScore + keywordScore;
// //     const headingLen = isCJKText ? 22 : 50;
// //     const isHeader = (totalScore >= 60 && keywordScore > 0)
// //       || (domScore >= 35 && keywordScore >= 25 && text.length <= headingLen);
// //     return { isHeader, type, score: totalScore };
// //   }

// //   // ---------------------------------------------------------------------------
// //   // 按渲染顺序拆块。相比原版修了两处：
// //   //   - <li> 单独成块（原版 UL 的子元素是 LI，不在 some() 的标签清单里，
// //   //     导致整个 UL 被当成一个叶子块，所有列表项糊成一坨）
// //   //   - 直系文本节点不再丢失（原版 else 分支只遍历 element.children）
// //   // ---------------------------------------------------------------------------
// //   const LEAFY = /^(P|LI|H[1-6]|DT|DD|TD|TH|BLOCKQUOTE)$/i;
// //   const CONTAINER = /^(DIV|SECTION|ARTICLE|UL|OL|DL|TABLE|TBODY|TR|MAIN|SPAN|BODY)$/i;

// //   function getVisualTextBlocks(node) {
// //     const blocks = [];
// //     const walk = (el) => {
// //       if (!el || !el.tagName) return;
// //       const tag = el.tagName;
// //       if (/^(SCRIPT|STYLE|NOSCRIPT|SVG)$/i.test(tag)) return;

// //       if (LEAFY.test(tag)) {
// //         const t = (el.textContent || '').trim();
// //         if (t) blocks.push({ element: el, text: t });
// //         return;
// //       }
// //       if (/^(H[1-6]|STRONG|B)$/i.test(tag)) {
// //         const t = (el.textContent || '').trim();
// //         if (t) blocks.push({ element: el, text: t });
// //         return;
// //       }
// //       if (CONTAINER.test(tag)) {
// //         // 先看有没有值得下钻的子元素；没有就把自己整体作为一块
// //         const hasElementChild = el.children && el.children.length > 0;
// //         if (!hasElementChild) {
// //           const t = (el.textContent || '').trim();
// //           if (t) blocks.push({ element: el, text: t });
// //           return;
// //         }
// //         // 有子元素：逐个 childNode 处理，直系文本节点也要保留（原版会丢）
// //         for (const child of Array.from(el.childNodes)) {
// //           if (child.nodeType === 3) { // TEXT_NODE
// //             const t = (child.nodeValue || '').trim();
// //             if (t) blocks.push({ element: el, text: t });
// //           } else if (child.nodeType === 1) {
// //             walk(child);
// //           }
// //         }
// //         return;
// //       }
// //       // 其它标签(如 <a>/<em>)：并入父级由父级处理，这里只兜底取文本
// //       const t = (el.textContent || '').trim();
// //       if (t) blocks.push({ element: el, text: t });
// //     };
// //     walk(node);
// //     return blocks;
// //   }

// //   // ---------------------------------------------------------------------------
// //   // 主入口（DOM 路径）
// //   // ---------------------------------------------------------------------------
// //   function parseJdFromDom(containerNode) {
// //     // ⚡ 块内换行必须再拆一层。很多站点(含 LinkedIn 的 description 容器)把整段 JD
// //     // 放在一个文本节点里、只用 \n 分行，getVisualTextBlocks 会把它当成"一个块"，
// //     // assessSectionHeader 拿一整坨去判定当然不是标题 → 全部落进 intro →
// //     // 最终全塞进 responsibilities。这正是"页面上全显示到职责"的直接原因。
// //     const blocks = [];
// //     for (const b of getVisualTextBlocks(containerNode)) {
// //       if (b.text.includes('\n')) {
// //         for (const line of b.text.split('\n')) {
// //           const t = line.trim();
// //           if (t) blocks.push({ element: b.element, text: t, __split: true });
// //         }
// //       } else {
// //         blocks.push(b);
// //       }
// //     }
// //     const buckets = { intro: [], responsibilities: [], requirements: [], bonus: [] };
// //     let current = 'intro'; // ⚡ 第一个标题之前的内容不再丢弃，归入 intro

// //     for (const blk of blocks) {
// //       const { element, text } = blk;
// //       const blockIsSplit = !!blk.__split;
// //       const t = text.trim();
// //       if (!t) continue;

// //       // 停止小节：只认"看起来像标题"的短行，且必须已经进入过真实小节
// //       // （开头的 About Us / 公司简介 是开场白，不是结尾样板）
// //       if (current !== 'intro' && t.length <= 40 && isStopSection(t)) break;

// //       const a = assessSectionHeader(blockIsSplit ? null : element, t);
// //       if (a.isHeader && a.type) { current = a.type; continue; }
// //       buckets[current].push(t);
// //     }

// //     // intro 并入 responsibilities 前部（岗位概述本质上属于"做什么"）
// //     const resp = [...buckets.intro, ...buckets.responsibilities].join('\n').trim();
// //     return {
// //       responsibilities: resp,
// //       requirements: buckets.requirements.join('\n').trim(),
// //       bonus: buckets.bonus.join('\n').trim(),
// //       fullCleanText: blocks.map((b) => b.text).join('\n').trim(),
// //     };
// //   }

// //   // ---------------------------------------------------------------------------
// //   // 纯文本路径（API/JSON 返回时没有 DOM，这条必须保留）
// //   // 复用同一套词表和停止小节，保证两条路结论一致。
// //   // ---------------------------------------------------------------------------
// //   function looksLikeHeadingLine(s) {
// //     s = s.trim();
// //     if (!s || s.length > 60) return false;
// //     if (/^##\s/.test(s) || /[:：]$/.test(s) || /^【.+】$/.test(s) || /^#+\s/.test(s)) return true;
// //     const isCJK = /[\u4e00-\u9fa5]/.test(s);
// //     if (!isCJK && s.length <= 45 && !/[.!?]$/.test(s)) {
// //       if (s === s.toUpperCase() && /[A-Z]{3,}/.test(s)) return true;
// //       const w = s.split(/\s+/);
// //       const small = ['a','an','the','and','or','of','to','for','in','you','we','your','our','will','be','with'];
// //       if (w.length <= 6 && w.every((x) => !/^[a-z]/.test(x) || small.includes(x.toLowerCase()))) return true;
// //     }
// //     return isCJK && s.length <= 20 && !/[。！？]$/.test(s);
// //   }

// //   function normalizeAndMergeLines(text) {
// //     const lines = text.split('\n');
// //     const bullet = /^([•▪◦●\-*]|[\d一二三四五六七八九十]+[.、)）])\s*/;
// //     const out = [];
// //     for (const raw of lines) {
// //       const line = raw.trim();
// //       if (!line) { out.push(''); continue; }
// //       const prev = out[out.length - 1];
// //       const canMerge = prev
// //         && !bullet.test(line) && !looksLikeHeadingLine(line)
// //         && !/[。！？.!?:：；;]$/.test(prev) && !bullet.test(prev) && !looksLikeHeadingLine(prev)
// //         && /^[a-z(,;)]/.test(line); // 只有小写开头才算折行续写
// //       if (canMerge) out[out.length - 1] = prev + ' ' + line;
// //       else out.push(line);
// //     }
// //     return out.filter(Boolean).join('\n');
// //   }

// //   function parseJdFromText(rawText) {
// //     const result = { responsibilities: '', requirements: '', bonus: '', fullCleanText: '' };
// //     if (!rawText || typeof rawText !== 'string') return result;
// //     const text = normalizeAndMergeLines(
// //       rawText.replace(/\r\n?/g, '\n').replace(/\u3000/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
// //     );
// //     result.fullCleanText = text.replace(/^##\s+/gm, '');

// //     const buckets = { intro: [], responsibilities: [], requirements: [], bonus: [] };
// //     let current = 'intro';
// //     for (const raw of text.split('\n')) {
// //       const t = raw.trim();
// //       if (!t) continue;
// //       const bare = t.replace(/^##\s+/, '');
// //       // ⚡ 停止小节只在"已经进入过真实小节"之后才生效。JD 以 "About Us"/"公司简介"
// //       // 开头极其常见，那是开场介绍标题，不是结尾样板；以前一律 break，导致
// //       // 整份 JD 从第一行就被丢弃，最后靠兜底把全文塞进职责（表现为完全不切分）。
// //       if (current !== 'intro' && bare.length <= 40 && isStopSection(bare)) break;

// //       // ⚡ 统一走标定过的 assessSectionHeader（element 传 null 即纯文本+排版+语义）。
// //       // 之前这里是另一套弱判定（looksLikeHeadingLine + keywordScore>=15），
// //       // 阈值远低于 DOM 路径，结果把 "1、负责推荐算法的设计" 这种列表项当成标题
// //       // 吞掉，正文反而丢了。两条路必须共用同一套判定，结论才会一致。
// //       const a = assessSectionHeader(null, bare);
// //       if (a.isHeader && a.type) { current = a.type; continue; }
// //       buckets[current].push(bare);
// //     }
// //     result.responsibilities = [...buckets.intro, ...buckets.responsibilities].join('\n').trim();
// //     result.requirements = buckets.requirements.join('\n').trim();
// //     result.bonus = buckets.bonus.join('\n').trim();
// //     if (!result.responsibilities && !result.requirements && !result.bonus) {
// //       result.responsibilities = result.fullCleanText;
// //     }
// //     return result;
// //   }

// //   // 统一入口：有 DOM 走 DOM，没有就走文本
// //   //  function parseJdSmart(input) {
// //   //   if (input && typeof input === 'object' && input.nodeType === 1) return parseJdFromDom(input);
// //   //   const result = { responsibilities: '', requirements: '', bonus: '', fullCleanText: '' };
// //   //   const jdresult=window.JdParsed.parseJd(input);
// //   //    result.responsibilities = [...jdresult.responsibilities].join('\n').trim();
// //   //   result.requirements = jdresult.requirements.join('\n').join(jdresult.preferred).trim();
// //   //   result.bonus = jdresult.preferred.join('\n').trim();
// //   //   result.fullCleanText=[...jdresult.responsibilities].join('\n').join(jdresult.requirements).join("\n").join(jdresult.preferred);
// //   //   console.log("responsibilities",jdresult.responsibilities,"requirements",jdresult.requirements)
// //   //   return result;
// //   // }


// //   function parseJdSmart(input) {
// //   if (input && typeof input === 'object' && input.nodeType === 1) return parseJdFromDom(input);
  
// //   const result = { responsibilities: '', requirements: '', bonus: '', fullCleanText: '' };
// //   const jdresult = window.JdParsed.parseJd(input);

// //   // 防错处理：确保即使某些字段不存在也不会崩溃（默认为空数组）
// //   const resp = jdresult.responsibilities || [];
// //   const req = jdresult.requirements || [];
// //   const pref = jdresult.preferred || [];

// //   // 1. 职责
// //   result.responsibilities = resp.join('\n').trim();

// //   // 2. 要求（将 requirements 与 preferred 两个数组合并后再 join）
// //   result.requirements = [...req, ...pref].join('\n').trim();

// //   // 3. 加分项/福利
// //   result.bonus = pref.join('\n').trim();

// //   // 4. 完整清洗文本（合并所有数组后统一 join）
// //   result.fullCleanText = [...resp, ...req, ...pref].join('\n').trim();

// //   console.log("responsibilities", resp, "requirements", req);
// //   return result;
// // }
// //   // HTML 正文清洗：BOSS 的 postDescription 有时带 <br>/&nbsp; 等实体
// //   function htmlToText(html) {
// //     if (!html || typeof html !== 'string') return '';
// //     if (!/[<&]/.test(html)) return html;
// //     return html
// //       .replace(/<\s*br\s*\/?\s*>/gi, '\n')
// //       .replace(/<\s*\/\s*(p|div|li|tr)\s*>/gi, '\n')
// //       .replace(/<[^>]+>/g, '')
// //       .replace(/&nbsp;/gi, ' ')
// //       .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
// //       .replace(/&amp;/g, '&').replace(/&quot;/g, '"');
// //   }

// //   // ---------------------------------------------------------------------
// //   // 2. 通用："点击相关性捕获窗口"
// //   //    content.js 在模拟点击前派发 REQ_BEGIN_CAPTURE，我们打开一个短窗口；
// //   //    窗口内任何"形状像 JD"的响应，直接归属给刚点击的那张卡片。
// //   //    这样就不需要从 payload 里猜 ID 字段名——这是能真正跨站点复用的关键。
// //   // ---------------------------------------------------------------------
// //   let activeCapture = null; // { cardId, startedAt, best: {score, detail} | null }

// //   document.addEventListener('REQ_BEGIN_CAPTURE', (e) => {
// //     const { cardId } = e.detail || {};
// //     if (!cardId) return;
// //     activeCapture = { cardId: String(cardId), startedAt: Date.now(), best: null };
// //     diag('捕获窗口已开启, cardId =', cardId);
// //   });

// //   document.addEventListener('REQ_END_CAPTURE', () => {
// //     if (!activeCapture) return;
// //     // 窗口关闭时，如果期间攒到了候选，把得分最高的那个作为该卡片的详情发出去
// //     if (activeCapture.best) {
// //       diag('捕获窗口关闭，采用最佳候选, score =', activeCapture.best.score);
// //       window.postMessage({
// //         type: 'JOB_HOOK_DETAIL', site: SITE,
// //         data: { ...activeCapture.best.detail, matchKey: activeCapture.cardId, source: 'Click-Correlated Capture' }
// //       }, '*');
// //     }
// //     activeCapture = null;
// //   });

// //   // JD 形状打分：文本越长、越命中 JD 关键词、越像自然语言，分越高。
// //   // 用来在捕获窗口内出现多个候选时挑出最像职位详情的那一个，
// //   // 也用来把埋点/推荐位这类"碰巧也很长"的响应排除掉。
// //   const JD_KEYWORD_PATTERN = /(岗位职责|工作职责|任职要求|任职资格|岗位要求|职位描述|工作内容|加分项|Responsibilities|Requirements|Qualifications|Job\s+Description|What\s+you.{0,10}do)/gi;

// //   function scoreJdText(text) {
// //     if (!text || text.length < 150) return 0;
// //     const kwHits = (text.match(JD_KEYWORD_PATTERN) || []).length;
// //     const hasSentences = /[。！？.!?]/.test(text);
// //     if (!kwHits && !hasSentences) return 0;

// //     // ⚡ 提高识别度：除了关键词命中，再叠加几个"这看起来确实是 JD 正文"的结构特征。
// //     // 目的是把"碰巧很长的自然语言"（公司简介、用户协议、推荐位文案）跟真正的
// //     // 职位描述区分开——JD 的典型形态是"分条列举的要求/职责"。
// //     let structureBonus = 0;
// //     // 项目符号/编号列表：JD 几乎必有
// //     const bulletLines = (text.match(/(?:^|\n)\s*(?:[•·▪●\-*]|\d+[.、)）])\s*\S/g) || []).length;
// //     if (bulletLines >= 3) structureBonus += 120;
// //     else if (bulletLines >= 1) structureBonus += 40;
// //     // 年限/学历/技能这类硬性要求措辞
// //     if (/(\d+\s*[-~到]?\s*\d*\s*年(以上)?(工作)?经验|本科|硕士|博士|大专|years?\s+of\s+experience|bachelor|master's|degree)/i.test(text)) structureBonus += 80;
// //     // 负面信号：明显是公司介绍/协议条款而不是岗位描述
// //     if (/(公司简介|关于我们|企业文化|发展历程|隐私政策|用户协议|Cookie|About\s+Us|Privacy\s+Policy|Terms\s+of\s+Service)/i.test(text)
// //         && kwHits === 0) structureBonus -= 150;

// //     return Math.min(kwHits, 5) * 100 + Math.min(text.length, 4000) * 0.05 + structureBonus;
// //   }

// //   // 递归找 payload 里最像 JD 正文的那个字符串字段
// //   function findBestJdTextInPayload(node, depth = 0, seen = new Set()) {
// //     if (!node || typeof node !== 'object' || depth > 6 || seen.has(node)) return null;
// //     seen.add(node);
// //     let best = null;
// //     for (const key in node) {
// //       if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
// //       const val = node[key];
// //       if (typeof val === 'string') {
// //         const text = htmlToText(val);
// //         const score = scoreJdText(text);
// //         if (score > 0 && (!best || score > best.score)) {
// //           best = { score, text, key, container: node };
// //         }
// //       } else if (val && typeof val === 'object') {
// //         const sub = findBestJdTextInPayload(val, depth + 1, seen);
// //         if (sub && (!best || sub.score > best.score)) best = sub;
// //       }
// //     }
// //     return best;
// //   }

// //   const TITLE_LIKE_KEYS = ['jobName', 'title', 'jobTitle', 'positionName', 'name', 'headline'];
// //   function guessTitle(container) {
// //     if (!container) return '';
// //     for (const k of TITLE_LIKE_KEYS) {
// //       if (typeof container[k] === 'string' && container[k].length < 100) return container[k];
// //     }
// //     return '';
// //   }

// //   // 捕获窗口内的候选收集：不立刻发出，先攒着比分数，窗口关闭时发最佳的那个
// //   // ⚡ 高置信度候选立刻发出，不等窗口关闭。
// //   // 之前的设计是"窗口内攒着，REQ_END_CAPTURE 时发最佳的那个"——但 content.js
// //   // 侧的 REQ_END_CAPTURE 是在 finalize() 里派发的，而 finalize() 只在已经
// //   // resolve/超时时才跑，等于候选永远晚一拍，network 这个源在观察窗口内根本
// //   // 没机会赢，白白掉到更慢的 pageFetch。现在改成：分数够高(明显就是 JD)就
// //   // 立即发出，让等待中的 Promise 当场接住；分数不够高的才留到窗口关闭时兜底。
// //   const CONFIDENT_SCORE = 260; // 约等于"命中 2 个以上 JD 关键词 + 有列表结构"

// //   function offerToCapture(json) {
// //     if (!activeCapture) return false;
// //     const best = findBestJdTextInPayload(json);
// //     if (!best) return false;

// //     const detail = { title: guessTitle(best.container), ...parseJdSmart(best.text) };

// //     if (best.score >= CONFIDENT_SCORE) {
// //       diag('捕获窗口内命中高置信度候选，立即发出, score =', best.score, 'key =', best.key);
// //       window.postMessage({
// //         type: 'JOB_HOOK_DETAIL', site: SITE,
// //         data: { ...detail, matchKey: activeCapture.cardId, source: 'Click-Correlated Capture' }
// //       }, '*');
// //       activeCapture.best = null; // 已经发过了，窗口关闭时不用再发一遍
// //       return true;
// //     }

// //     if (activeCapture.best && activeCapture.best.score >= best.score) return true;
// //     activeCapture.best = { score: best.score, detail };
// //     diag('捕获窗口内收到低置信度候选(暂存), score =', best.score, 'key =', best.key);
// //     return true;
// //   }

// //   // ---------------------------------------------------------------------
// //   // 3. BOSS 专属规则（优先级最高，因为字段结构确定，解析最准）
// //   // ---------------------------------------------------------------------
// //   // ⚡ URL 放宽：不再写死 /job/detail.json。BOSS 换路径/换域名前缀的情况很常见，
// //   //    这里覆盖常见几种，再由 payload 结构做二次确认（zpData.jobInfo 存在才算数）。
// //   const BOSS_DETAIL_URL = /\/(job\/detail|jobdetail|job\/card|geek\/job\/detail)\.json/i;
// //   const BOSS_LIST_URL = /\/(joblist|job\/list|geek\/joblist)\.json/i;
// //   // 51job 的搜索列表接口，返回结果里每条职位自带 jobDescribe 字段——
// //   // 不用等点击详情，列表加载的这一次响应就够用了。
// //   const FIFTYONEJOB_SEARCH_URL = /we\.51job\.com\/api\/job\/search-pc/i;
// //   const ZHAOPIN_DETAIL_URL = /(?:^|\/\/)fe-api\.zhaopin\.com\/c\/i\/jobs\/detail|\/c\/i\/jobs\/detail/i;
// //   const ZHAOPIN_LIST_URL = /(?:^|\/\/)fe-api\.zhaopin\.com\/c\/i\/(?:search|jobs|position|positions)|\/c\/i\/jobs\/search|\/sou\/result/i;
// //   const ZHAOPIN_ID_KEYS = ['number', 'jobNumber', 'job_number', 'jobId', 'jobID', 'jobid', 'positionId', 'positionID', 'positionNumber', 'position_number'];
// //   const ZHAOPIN_TITLE_KEYS = ['jobName', 'name', 'title', 'jobTitle', 'positionName'];
// //   const ZHAOPIN_DESC_KEYS = ['jobDesc', 'jobDescription', 'description', 'describe', 'positionDesc', 'positionDetail', 'responsibility', 'jobDetail', 'details', 'content'];
// //   const ZHAOPIN_SALARY_KEYS = ['salaryDesc', 'salary', 'salaryReal', 'salary60', 'salaryName'];
// //   const ZHAOPIN_COMPANY_KEYS = ['companyName', 'brandName', 'company', 'companyInfo', 'companyDTO'];
// //   const ZHAOPIN_LOCATION_KEYS = ['cityName', 'workCity', 'city', 'cityDisplay', 'areaDistrict', 'workAddress', 'location'];

// //   function zhaopinValueToText(value) {
// //     if (value == null) return '';
// //     if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
// //     if (Array.isArray(value)) return value.map(zhaopinValueToText).filter(Boolean).join(' ').trim();
// //     if (typeof value === 'object') {
// //       for (const key of ['display', 'name', 'value', 'text', 'label', 'content', 'title']) {
// //         const text = zhaopinValueToText(value[key]);
// //         if (text) return text;
// //       }
// //     }
// //     return '';
// //   }

// //   function findZhaopinValueByKeys(node, keys, depth = 0, seen = new Set()) {
// //     if (!node || typeof node !== 'object' || depth > 5 || seen.has(node)) return '';
// //     seen.add(node);
// //     for (const key of keys) {
// //       if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
// //       const text = zhaopinValueToText(node[key]);
// //       if (text) return text;
// //     }
// //     for (const key in node) {
// //       if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
// //       const value = node[key];
// //       if (!value || typeof value !== 'object') continue;
// //       const text = findZhaopinValueByKeys(value, keys, depth + 1, seen);
// //       if (text) return text;
// //     }
// //     return '';
// //   }

// //   function unwrapZhaopinData(json) {
// //     return json?.data?.jobDetail
// //       || json?.data?.jobInfo
// //       || json?.data?.detail
// //       || json?.data
// //       || json?.result?.data
// //       || json?.result
// //       || json;
// //   }

// //   function extractZhaopinMatchKey(data, url, fallbackMatchKey = '') {
// //     if (fallbackMatchKey) return String(fallbackMatchKey);
// //     try {
// //       const params = new URL(url, location.origin).searchParams;
// //       for (const key of ZHAOPIN_ID_KEYS) {
// //         const val = params.get(key);
// //         if (val) return String(val);
// //       }
// //     } catch (e) {}
// //     return findZhaopinValueByKeys(data, ZHAOPIN_ID_KEYS);
// //   }

// //   function parseZhaopinDetail(json, url, fallbackMatchKey = '') {
// //     const dataRaw = unwrapZhaopinData(json);
// //     if (!dataRaw) return null;
// //     const data = typeof dataRaw === 'object' ? dataRaw : { description: String(dataRaw) };
// //     const directDesc = findZhaopinValueByKeys(data, ZHAOPIN_DESC_KEYS);
// //     const best = findBestJdTextInPayload(data);
// //     const rawDesc = htmlToText(directDesc || best?.text || '');
// //     if (!rawDesc || rawDesc.length < 50) return null;

// //     const parsed = parseJdSmart(rawDesc);
// //     if (!parsed.fullCleanText) parsed.fullCleanText = rawDesc;
// //     if (!parsed.responsibilities && !parsed.requirements && parsed.fullCleanText) {
// //       parsed.responsibilities = parsed.fullCleanText;
// //     }

// //     const realJobId = extractZhaopinMatchKey(data, url);
// //     return {
// //       matchKey: extractZhaopinMatchKey(data, url, fallbackMatchKey || realJobId),
// //       jobId: realJobId || fallbackMatchKey,
// //       number: realJobId || '',
// //       title: findZhaopinValueByKeys(data, ZHAOPIN_TITLE_KEYS),
// //       salary: findZhaopinValueByKeys(data, ZHAOPIN_SALARY_KEYS),
// //       company: findZhaopinValueByKeys(data, ZHAOPIN_COMPANY_KEYS),
// //       location: findZhaopinValueByKeys(data, ZHAOPIN_LOCATION_KEYS),
// //       ...parsed
// //     };
// //   }

// //   function normalizeZhaopinListItem(item) {
// //     if (!item || typeof item !== 'object') return null;
// //     const jobId = extractZhaopinMatchKey(item, '');
// //     const jobName = findZhaopinValueByKeys(item, ZHAOPIN_TITLE_KEYS);
// //     const salaryDesc = findZhaopinValueByKeys(item, ZHAOPIN_SALARY_KEYS);
// //     const brandName = findZhaopinValueByKeys(item, ZHAOPIN_COMPANY_KEYS);
// //     const cityName = findZhaopinValueByKeys(item, ZHAOPIN_LOCATION_KEYS);
// //     if (!jobId || !jobName || !(salaryDesc || brandName || cityName)) return null;
// //     return { jobId, number: jobId, jobName, salaryDesc, brandName, cityName };
// //   }

// //   function findZhaopinListItems(node, results = [], seen = new Set(), depth = 0) {
// //     if (!node || typeof node !== 'object' || depth > 6 || seen.has(node)) return results;
// //     seen.add(node);
// //     if (Array.isArray(node)) {
// //       const items = node.map(normalizeZhaopinListItem).filter(Boolean);
// //       if (items.length >= 2) results.push(...items);
// //       node.forEach((item) => findZhaopinListItems(item, results, seen, depth + 1));
// //       return results;
// //     }
// //     for (const key in node) {
// //       if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
// //       const value = node[key];
// //       if (value && typeof value === 'object') findZhaopinListItems(value, results, seen, depth + 1);
// //     }
// //     return results;
// //   }

// //   function parseFiftyOneJobList(json) {
// //     // 路径通过实测确认：Resultbody.job.items[].jobDescribe
// //     const items = json?.resultbody?.job?.items;
// //     if (!Array.isArray(items)) return [];
// //     return items.map((it) => {
// //       // 51job 具体用哪个字段做职位ID，没有实测确认过，几个常见候选都试一下，
// //       // 拿不到就退化用 jobDescribe 本身取一段哈希当 key（保底不完全丢弃这条数据，
// //       // 但没法准确匹配回具体卡片，最好还是确认一下真实字段名替换掉这里的猜测）。
// //       const jobId = it.jobId || it.jobid || it.id || it.jobID || null;
// //       const rawDesc = it.jobDescribe || '';
// //       if (!rawDesc) return null;
// //       return { matchKey: jobId != null ? String(jobId) : null, title: it.jobName || it.jobTitle || '', rawDesc };
// //     }).filter(Boolean);
// //   }

// //   function parseBossDetail(json, url) {
// //     const jobInfo = json?.zpData?.jobInfo;
// //     if (!jobInfo) return null;

// //     // matchKey 多级兜底：URL query 的 securityId 最可靠（跟 content.js 发起
// //     // 点击时用的是同一个值），其次 payload 里的各种 id，最后交给点击相关性。
// //     let matchKey = '';
// //     try { matchKey = new URL(url, location.origin).searchParams.get('securityId') || ''; } catch (e) {}
// //     if (!matchKey) matchKey = jobInfo.encryptJobId || jobInfo.encryptId || jobInfo.securityId || '';
// //     if (!matchKey && activeCapture) matchKey = activeCapture.cardId;

// //     const rawDesc = htmlToText(jobInfo.postDescription || '');
// //     return {
// //       matchKey,
// //       title: jobInfo.jobName || '',
// //       salary: jobInfo.salaryDesc || '',
// //       company: json.zpData.brandComInfo?.brandName || '',
// //       location: jobInfo.locationName || '',
// //       ...parseJdSmart(rawDesc)
// //     };
// //   }

// //   // injected.js (运行在 MAIN 作用域)

// //   // injected.js (运行在 MAIN 作用域)
// // function parseZhilianJobDetail() {
// //   try {
// //     // 1. 优先读取 __INITIAL_STATE__
// //     if (window.__INITIAL_STATE__?.jobDetail?.jobDetail) {
// //       return window.__INITIAL_STATE__.jobDetail.jobDetail;
// //     }
// //     if (window.__INITIAL_STATE__?.desc?.description) {
// //       return { description: window.__INITIAL_STATE__.desc.description };
// //     }
    
// //     // 2. 备用提取 __NEXT_DATA__ 节点
// //     const nextDataEl = document.getElementById('__NEXT_DATA__');
// //     if (nextDataEl) {
// //       const parsed = JSON.parse(nextDataEl.textContent);
// //       return parsed.props?.pageProps?.jobDetail || null;
// //     }
// //   } catch (err) {
// //     console.error('解析智联预载数据失败:', err);
// //   }
// //   return null;
// // }

// // // DOM 加载完成后读取并推送给 content_scripts
// // window.addEventListener('DOMContentLoaded', () => {
// //   const detail = parseZhilianJobDetail();
// //   if (detail) {
// //     const parsedDetail = SITE === 'zhaopin' ? parseZhaopinDetail({ data: detail }, location.href) : null;
// //     console.log("zhaopin",parsedDetail)
// //     if (parsedDetail) notifyDetail(parsedDetail);
// //     else window.postMessage({ type: 'ZHILIAN_DETAIL_LOADED', site: 'zhaopin', data: detail }, '*');
// //   }
// // });
// // // injected.js 代理 Fetch
// // // const originalFetch = window.fetch;
// // // window.fetch = async function (...args) {
// // //   const response = await originalFetch.apply(this, args);
// // //   const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;

// // //   // 拦截智联详情接口
// // //   if (url && url.includes('fe-api.zhaopin.com/c/i/jobs/detail')) {
// // //     try {
// // //       const cloneRes = response.clone();
// // //       cloneRes.json().then(resData => {
// // //         if (resData && resData.code === 200) {
// // //           console.log("zhilian",resData.data)
// // //           window.postMessage({
// // //             type: 'ZHILIAN_INTERCEPTED_DATA',
// // //             data: resData.data
// // //           }, '*');
// // //         }
// // //       });
// // //     } catch (e) {
// // //       console.error('拦截智联 API 解析失败:', e);
// // //     }
// // //   }

// // //   return response;
// // // };

// //   // const XHR = XMLHttpRequest.prototype;
// //   // const open = XHR.open;
// //   // const send = XHR.send;

// //   // XHR.open = function(method, url) {
// //   //   this._url = url;
// //   //   return open.apply(this, arguments);
// //   // };
// //   //   XHR.send = function(body) {
// //   //   this.addEventListener('load', function() {
// //   //     if (this._url && this._url.includes('/api/job/detail-pc')) {
// //   //       try {
// //   //         const resData = JSON.parse(this.responseText);
// //   //         console.log(resData)
// //   //         // 通过 window.postMessage 发送给 content.js
// //   //         window.postMessage({
// //   //           type: '51JOB_Hook',
// //   //           site: "51job",
// //   //           data: resData
// //   //         }, '*');
// //   //       } catch (e) {}
// //   //     }
// //   //   });
// //   //   // window.postMessage({ type: 'JOB_HOOK_DETAIL', site: "51job", data: detail }, '*');
// //   //   return send.apply(this, arguments);
// //   // };

// //   function notifyList(list) {
// //     if (!Array.isArray(list) || list.length === 0) return;
// //     window.postMessage({ type: 'JOB_HOOK_LIST', site: SITE, data: list }, '*');
// //   }

// //   function notifyDetail(detail) {
// //     if (!detail) return;
// //     if (!detail.matchKey) {
// //       // ⚡ 以前这里直接 return，静默丢弃。现在至少留个诊断痕迹，
// //       //    并且如果捕获窗口开着，就把它归属给当前点击的卡片。
// //       if (activeCapture) {
// //         detail = { ...detail, matchKey: activeCapture.cardId, source: 'Click-Correlated Fallback' };
// //         diag('详情缺少 matchKey，按点击相关性归属给', activeCapture.cardId);
// //       } else {
// //         diag('⚠️ 拿到详情但没有 matchKey，且没有捕获窗口，只能丢弃');
// //         return;
// //       }
// //     }
// //     window.postMessage({ type: 'JOB_HOOK_DETAIL', site: SITE, data: detail }, '*');
// //   }

// //   // ---------------------------------------------------------------------
// //   // 4. LinkedIn / generic 的内容特征扫描（沿用上一版思路）
// //   // ---------------------------------------------------------------------
// //   const LINKEDIN_PAYLOAD_HINT = /fsd_jobPosting|jobPostingUrn|"description":\s*\{\s*"text"/;

// //   function extractJobIdFromUrn(urn) {
// //     if (typeof urn !== 'string') return null;
// //     const m = urn.match(/(?:fsd_jobPosting|jobPosting):(\d+)/);
// //     return m ? m[1] : null;
// //   }

// //   function scanLinkedInPayloadForJobPosting(node, results, seen, depth = 0) {
// //     if (!node || typeof node !== 'object' || seen.has(node) || depth > 8) return;
// //     seen.add(node);
// //     const entityUrn = node.entityUrn || node['*entityUrn'] || node.jobPostingUrn || '';
// //     const jobId = extractJobIdFromUrn(entityUrn) || (node.jobPostingId ? String(node.jobPostingId) : null);
// //     const rawDesc = typeof node.description === 'string'
// //       ? node.description
// //       : (node.description && typeof node.description.text === 'string' ? node.description.text : '');
// //     if (jobId && rawDesc) results.push({ matchKey: jobId, title: node.title || '', rawDesc: htmlToText(rawDesc) });
// //     for (const key in node) {
// //       if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
// //       const val = node[key];
// //       if (val && typeof val === 'object') scanLinkedInPayloadForJobPosting(val, results, seen, depth + 1);
// //     }
// //   }

// //   // ---------------------------------------------------------------------
// //   // 5. 统一响应处理入口
// //   // ---------------------------------------------------------------------
// //   function handleResponse(url, payloadText, payloadObj) {
// //     let json = payloadObj;
// //     if (!json) {
// //       if (!payloadText || payloadText.length < 50) return;
// //       // 便宜的预筛，避免对每个响应都 JSON.parse
// //       if (payloadText[0] !== '{' && payloadText[0] !== '[') return;
// //       try { json = JSON.parse(payloadText); } catch (e) { return; }
// //     }
// //     if (!json || typeof json !== 'object') return;

// //     // ---- 诊断：把疑似职位相关的响应打出来，帮你定位真实接口 ----
// //     if (window.__jdpDiag) {
// //       const probe = findBestJdTextInPayload(json);
// //       if (probe) {
// //         diag('疑似含 JD 正文的响应:', { url, 字段名: probe.key, 分数: probe.score, 前120字: probe.text.slice(0, 120) });
// //       }
// //     }

// //     // ---- BOSS 专属规则优先 ----
// //     if (SITE === 'boss') {
// //       if (BOSS_LIST_URL.test(url)) {
// //         const list = json?.zpData?.jobList;
// //         if (list) { diag('命中列表接口', url, '条数', list.length); notifyList(list); }
// //       }
// //       // URL 命中 或 payload 结构命中（换路径也不会失效）
// //       if (BOSS_DETAIL_URL.test(url) || json?.zpData?.jobInfo) {
// //         const detail = parseBossDetail(json, url);
// //         if (detail) {
// //           diag('命中详情接口', url, 'matchKey =', detail.matchKey);
// //           notifyDetail(detail);
// //           return;
// //         }
// //       }
// //     }

// //     if (SITE === 'zhaopin') {
// //       if (ZHAOPIN_DETAIL_URL.test(url)) {
// //         const detail = parseZhaopinDetail(json, url, activeCapture?.cardId);
// //         if (detail) {
// //           diag('命中智联详情接口', url, 'matchKey =', detail.matchKey, 'jobId =', detail.jobId);
// //           notifyDetail(detail);
// //           return;
// //         }
// //       }

// //       if (ZHAOPIN_LIST_URL.test(url)) {
// //         const items = findZhaopinListItems(json);
// //         if (items.length) {
// //           const uniq = [];
// //           const seenJobIds = new Set();
// //           items.forEach((item) => {
// //             if (seenJobIds.has(item.jobId)) return;
// //             seenJobIds.add(item.jobId);
// //             uniq.push(item);
// //           });
// //           diag('命中智联列表接口', url, '条数', uniq.length);
// //           notifyList(uniq);
// //           return;
// //         }
// //       }
// //     }

// //     if (SITE === 'linkedin' && LINKEDIN_PAYLOAD_HINT.test(payloadText || JSON.stringify(json).slice(0, 20000))) {
// //       const results = [];
// //       scanLinkedInPayloadForJobPosting(json, results, new Set());
// //       results.forEach((r) => notifyDetail({ matchKey: r.matchKey, title: r.title, ...parseJdSmart(r.rawDesc) }));
// //       if (results.length) return;
// //     }

// //     // ---- 51job：搜索列表接口自带完整描述，逐条解析、逐条通知 ----
// //     if (SITE === '51job') {
// //       // 诊断：不管 URL 匹不匹配，只要是 51job 站点、响应体看起来像 JSON
// //       // 且体积不小，就把 URL 打出来——用来确认 XHR/fetch 钩子本身有没有
// //       // 拦到这个请求，以及实际 URL 跟我们写的正则是不是真的对得上
// //       // （很可能有查询参数顺序不同、或者域名/路径跟你在 Network 面板
// //       // 看到的不完全一致这类细节差异）。
// //       console.log(window.__jdpDiag ,json)
// //       if (window.__jdpDiag && url && JSON.stringify(json).length > 500) {
// //         diag('51job响应经过handleResponse', url, '| 匹配search-pc正则:', FIFTYONEJOB_SEARCH_URL.test(url));
// //       }
// //       if (FIFTYONEJOB_SEARCH_URL.test(url)) {
// //         const items = parseFiftyOneJobList(json);
// //         if (window.__jdpDiag) {
// //           diag('search-pc响应结构', { 'Resultbody存在': !!json?.Resultbody, 'job存在': !!json?.Resultbody?.job, 'items是数组': Array.isArray(json?.Resultbody?.job?.items), '解析出条数': items.length });
// //         }
// //         if (items.length) {
// //           diag('命中51job搜索接口', url, '条数', items.length, '有matchKey的', items.filter(i => i.matchKey).length);
// //           items.forEach((it) => {
// //             if (!it.matchKey) return; // 没有可用ID的条目匹配不回具体卡片，跳过不通知，避免脏数据
// //             notifyDetail({ matchKey: it.matchKey, title: it.title, ...parseJdSmart(it.rawDesc) });
// //           });
// //           return;
// //         }
// //       }
// //     }

// //     // ---- 通用兜底：点击相关性捕获（所有站点都适用，包括 BOSS 规则没命中时）----
// //     offerToCapture(json);
// //   }

// //   // ---------------------------------------------------------------------
// //   // 6. Hook XHR —— ⚡ 修复 responseType 导致的静默失效
// //   // ---------------------------------------------------------------------
// //   const origOpen = XMLHttpRequest.prototype.open;
// //   const origSend = XMLHttpRequest.prototype.send;

// //   XMLHttpRequest.prototype.open = function (method, url) {
// //     this.__hookUrl = url;
// //     return origOpen.apply(this, arguments);
// //   };

// //   XMLHttpRequest.prototype.send = function () {
// //     this.addEventListener('load', function () {
// //       try {
// //         const url = this.responseURL || this.__hookUrl || '';
// //         const rt = this.responseType;
// //         // ⚡ 关键修复：responseText 只在 responseType 为 '' 或 'text' 时可读，
// //         // 其它情况（尤其是 'json'）读它会抛 DOMException，被 catch 吞掉后
// //         // 表现为"拦截装了但永远不触发"。这里按类型分别取值。
// //         if (rt === '' || rt === 'text') {
// //           handleResponse(url, this.responseText, null);
// //         } else if (rt === 'json') {
// //           handleResponse(url, null, this.response);
// //         }
// //         // 'blob'/'arraybuffer'/'document' 不是 JSON 接口，直接忽略
// //       } catch (e) {
// //         diag('XHR 响应处理异常(已忽略):', e && e.message);
// //       }
// //     });
// //     return origSend.apply(this, arguments);
// //   };

// //   // ---------------------------------------------------------------------
// //   // 7. Hook fetch
// //   // ---------------------------------------------------------------------
// //   const origFetch = window.fetch;
// //   if (typeof origFetch === 'function') {
// //     window.fetch = function (input, init) {
// //       const url = typeof input === 'string' ? input : (input && input.url) || '';
// //       return origFetch.apply(this, arguments).then((res) => {
// //         try {
// //           res.clone().text().then((text) => handleResponse(url, text, null)).catch(() => {});
// //         } catch (e) {}
// //         return res;
// //       });
// //     };
// //   }

// //   // ---------------------------------------------------------------------
// //   // 8. BOSS 首屏 SSR 数据
// //   // ---------------------------------------------------------------------
// //   if (SITE === 'boss') {
// //     try {
// //       if (window.__INITIAL_STATE__?.jobList) notifyList(window.__INITIAL_STATE__.jobList);
// //     } catch (e) {}
// //   }

// //   // ---------------------------------------------------------------------
// //   // 9. 主动兜底通道（保持原有行为不变）
// //   // ---------------------------------------------------------------------
// //   function getLinkedInCsrfToken() {
// //     const m = document.cookie.match(/JSESSIONID="?([^";]+)"?/);
// //     return m ? m[1] : '';
// //   }

// //   async function directFetchDetail(matchKey, meta) {
// //     if (SITE === 'linkedin') {
// //       const csrfToken = getLinkedInCsrfToken();
// //       if (!csrfToken) return null;
// //       try {
// //         const res = await fetch(`https://www.linkedin.com/voyager/api/jobs/jobPostings/${matchKey}`, {
// //           method: 'GET',
// //           headers: {
// //             'csrf-token': csrfToken,
// //             'x-restli-protocol-version': '2.0.0',
// //             'accept': 'application/vnd.linkedin.normalized+json+2.0.0, application/json, text/plain, */*',
// //             'x-li-lang': 'zh_CN'
// //           }
// //         });
// //         if (!res.ok) return null;
// //         const json = await res.json();
// //         // console.log("injected",json?.description?.text);
// //         const rawDesc = htmlToText(json?.description?.text || (typeof json?.description === 'string' ? json.description : ''));
// //         console.log("injected",parseJdSmart(rawDesc));
// //         return { matchKey: String(matchKey), title: json?.title || '', ...parseJdSmart(rawDesc) };
// //       } catch (e) { return null; }
// //     }

// //     if (SITE === 'zhaopin') {
// //       if (!matchKey || /^h_/.test(String(matchKey))) return null;
// //       try {
// //         const apiUrl = `https://fe-api.zhaopin.com/c/i/jobs/detail?number=${encodeURIComponent(matchKey)}`;
// //         const res = await fetch(apiUrl, {
// //           credentials: 'include',
// //           headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, text/plain, */*' }
// //         });
// //         if (!res.ok) return null;
// //         const json = await res.json();
// //         return parseZhaopinDetail(json, apiUrl, String(matchKey));
// //       } catch (e) { return null; }
// //     }

// //     if (SITE === 'boss') {
// //       const securityId = matchKey;
// //       const lid = meta?.lid || '';
// //       if (!securityId) return null;
// //       try {
// //         const apiUrl = `/wapi/zpgeek/job/detail.json?securityId=${encodeURIComponent(securityId)}&lid=${encodeURIComponent(lid)}`;
// //         const res = await fetch(apiUrl, {
// //           headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, text/plain, */*' }
// //         });
// //         if (!res.ok) return null;
// //         const json = await res.json();
// //         return parseBossDetail(json, apiUrl);
// //       } catch (e) { return null; }
// //     }
// //     return null;
// //   }

// //   document.addEventListener('REQ_DIRECT_FETCH_JOB', async (e) => {
// //     const { matchKey, meta, requestId } = e.detail || {};
// //     const data = await directFetchDetail(matchKey, meta);
// //     document.dispatchEvent(new CustomEvent('RESP_DIRECT_FETCH_JOB', { detail: { requestId, matchKey, data } }));
// //   });

// //   document.documentElement.dataset.injectReady = 'true';
// //   document.dispatchEvent(new CustomEvent('INJECT_SCRIPT_READY'));
// //   console.log("injected.js")
// //   console.log(`✅ [injected.js] (${SITE}) 挂载完成。排查拦截问题请在控制台执行: window.__jdpDiag = true`);
// // })();

// // /**
// //  * ==============================================================================
// //  * injected.js — 运行在页面主环境 (MAIN World)
// //  *
// //  * 本版相对上一版的关键修复与新增：
// //  *   [修复] XHR hook 读 responseText 在 responseType='json'/'blob' 时会抛
// //  *          DOMException，被 catch 静默吞掉 → 拦截永远不触发（"只有直接请求，
// //  *          没有拦截"的根因）。现在按 responseType 分支取值。
// //  *   [修复] BOSS 详情接口 URL 从写死 /job/detail.json 放宽成多模式匹配，
// //  *          并保留"内容形状"兜底，避免站点换路径就全线失效。
// //  *   [修复] matchKey 取不到时不再静默丢弃，走多级兜底（URL → payload → 点击相关性）。
// //  *   [新增] 诊断模式：把流经的、疑似职位相关的 JSON 响应打到控制台，
// //  *          让你能直接看到 BOSS 真实的详情接口叫什么、字段长什么样。
// //  *   [新增] 通用"点击相关性捕获"：content.js 点击前开一个捕获窗口，窗口内
// //  *          出现的 JD 形状响应直接归属给刚点击的那张卡——不需要知道站点的
// //  *          ID 字段名/位置，这是真正站点无关的机制。
// //  * ==============================================================================
// //  */
// // (function () {
// //   'use strict';
// //   if (window.__jobHookInjected) return;
// //   window.__jobHookInjected = true;

// //   // ---------------------------------------------------------------------
// //   // 0. 站点识别 & 诊断开关
// //   // ---------------------------------------------------------------------
// //   const SITE = location.host.includes('zhipin.com')
// //     ? 'boss'
// //     : location.host.includes('linkedin.com')
// //       ? 'linkedin'
// //       : 'generic';

// //   // 诊断模式：控制台执行 window.__jdpDiag = true 即可打开（不用改代码重装插件），
// //   // 打开后会把所有"疑似职位相关"的响应 URL + 字段结构打出来。
// //   // 排查"到底哪个接口才是详情接口"时非常有用。
// //   const diag = (...args) => { if (window.__jdpDiag) console.log('%c[JDP-DIAG]', 'color:#0a66c2;font-weight:bold', ...args); };
// //   window.__jdpDiag = window.__jdpDiag || false;

// //   // ---------------------------------------------------------------------
// //   // 1. JD 文本解析（与 content.js 保持同一套语义，避免两边结果不一致）
// //   // ---------------------------------------------------------------------
// //   // ============================================================================
// //   // 优化版 parseJdSmart —— 针对 LinkedIn / Indeed 英文 JD "照单全收" 的问题
// //   //
// //   // 四个改动：
// //   //  [根因] normalizeAndMergeLines 会把不带冒号的英文小标题并进下一行，
// //   //         标题特征被彻底破坏 → 打分全军覆没 → 退化成"全文塞进 responsibilities"。
// //   //         现在识别到"疑似小标题"的行一律不参与合并。
// //   //  [词表] 按真实 JD 写作规范扩充（Essential Duties / Basic Qualifications /
// //   //         What You'll Bring / Nice-to-Haves 等），并区分 required vs preferred。
// //   //  [新增] 停止小节(STOP_SECTIONS)：Benefits / EEO / About Us 这类尾部样板段落
// //   //         以前会被并进最后一个小节，现在遇到即截断。
// //   //  [判定] 英文标题的结构特征另算：Title Case / ALL CAPS / 独立短行 / 后接列表。
// //   // ============================================================================

// //   // ============================================================================
// //   // 合并版 JD 解析：DOM 有状态遍历(element 感知打分) + 文本兜底
// //   //
// //   // 架构取自你的 parseJdSmartMultiSignal：按渲染顺序遍历块 → 遇标题切换当前小节 →
// //   // 其余内容归入当前小节。这个结构比"先压成文本再按位置切片"更好，因为打分时
// //   // element 还在手上，className/id/tagName 都能用。
// //   //
// //   // 在此基础上修掉三个实测失分点，并补上纯文本路径：
// //   //   [修] \b 对中文无效 + 全角冒号未处理 → 中文标题一个都识别不出
// //   //   [修] 无停止小节 → Benefits/EEO/公司介绍 一路污染最后一个小节
// //   //   [修] unspecified(前言) 被丢弃 → 岗位概述整段消失
// //   //   [补] parseJdSmartText：API 返回的是 JSON/纯文本时没有 DOM，必须有这条路
// //   // ============================================================================

// //   // ============================================================================
// //   // 合并版 JD 解析：DOM 有状态遍历(element 感知打分) + 文本兜底
// //   //
// //   // 架构取自你的 parseJdSmartMultiSignal：按渲染顺序遍历块 → 遇标题切换当前小节 →
// //   // 其余内容归入当前小节。这个结构比"先压成文本再按位置切片"更好，因为打分时
// //   // element 还在手上，className/id/tagName 都能用。
// //   //
// //   // 在此基础上修掉三个实测失分点，并补上纯文本路径：
// //   //   [修] \b 对中文无效 + 全角冒号未处理 → 中文标题一个都识别不出
// //   //   [修] 无停止小节 → Benefits/EEO/公司介绍 一路污染最后一个小节
// //   //   [修] unspecified(前言) 被丢弃 → 岗位概述整段消失
// //   //   [补] parseJdSmartText：API 返回的是 JSON/纯文本时没有 DOM，必须有这条路
// //   // ============================================================================

// //   // ============================================================================
// //   // 合并版 JD 解析：DOM 有状态遍历(element 感知打分) + 文本兜底
// //   //
// //   // 架构取自你的 parseJdSmartMultiSignal：按渲染顺序遍历块 → 遇标题切换当前小节 →
// //   // 其余内容归入当前小节。这个结构比"先压成文本再按位置切片"更好，因为打分时
// //   // element 还在手上，className/id/tagName 都能用。
// //   //
// //   // 在此基础上修掉三个实测失分点，并补上纯文本路径：
// //   //   [修] \b 对中文无效 + 全角冒号未处理 → 中文标题一个都识别不出
// //   //   [修] 无停止小节 → Benefits/EEO/公司介绍 一路污染最后一个小节
// //   //   [修] unspecified(前言) 被丢弃 → 岗位概述整段消失
// //   //   [补] parseJdSmartText：API 返回的是 JSON/纯文本时没有 DOM，必须有这条路
// //   // ============================================================================

// //   const SECTION_VOCAB = [
// //     {
// //       type: 'responsibilities',
// //       tiers: [
// //         { weight: 50, phrases: ['岗位职责','工作职责','职责描述','主要职责','工作内容','岗位描述','职位描述',
// //             'Responsibilities','Key Responsibilities','Primary Responsibilities','Core Responsibilities',
// //             'Duties and Responsibilities','Essential Duties','Essential Functions','Essential Job Functions','Key Accountabilities','Responsibility','职位职责','工作内容及职责'] },
// //         { weight: 40, phrases: ["What you'll do",'What you will do',"What You'll Be Doing",'About the Role',
// //             'About this Role','About the job','Role Overview','Role Summary','Job Summary','Job Purpose',
// //             'The Role','Your Impact','Duties','你将负责','主要工作','主要负责','负责内容'] },
// //         { weight: 25, phrases: ['职责','Tasks','任务'] },
// //       ],
// //     },
// //     {
// //       type: 'requirements',
// //       tiers: [
// //         { weight: 50, phrases: ['任职要求','任职资格','岗位要求','招聘条件','职位要求','能力要求','岗位条件',
// //             'Requirements','Qualifications','Job Requirements','Basic Qualifications','Minimum Qualifications',
// //             'Required Qualifications','Key Qualifications','Skills and Qualifications','Education and Experience','Requirement','Qualification','技能要求','能力要求'] },
// //         { weight: 40, phrases: ["What we're looking for",'What we are looking for','Who You Are',
// //             "What You'll Bring",'What You Bring','Skills & Experience','Required Skills','Must Have','Must-haves',
// //             '你需要具备','我们需要你'] },
// //         { weight: 25, phrases: ['要求','资格','Skills'] },
// //       ],
// //     },
// //     {
// //       type: 'bonus',
// //       tiers: [
// //         { weight: 50, phrases: ['加分项','优先条件','优先考虑','加分技能',
// //             'Preferred Qualifications','Additional Qualifications','Preferred Experience','Preferred Skills',
// //             'Nice to have','Nice-to-haves','Bonus Points','Desirable Skills'] },
// //         { weight: 40, phrases: ['具备以下者优先','有以下经验优先','Bonus points if you have','A plus if','An asset','Desirable'] },
// //         { weight: 25, phrases: ['加分','Preferred'] },
// //       ],
// //     },
// //   ];

// //   // 停止小节：命中即结束正文收集，后面的内容全部丢弃
// //   const STOP_SECTIONS = [
// //     '福利待遇','薪资福利','公司简介','关于我们','企业文化','工作地点','投递方式','我们提供',
// //     'Benefits','What We Offer','Perks','Perks and Benefits','Compensation','Salary','Pay Range',
// //     'Working Conditions','Work Environment','Physical Requirements',
// //     'EEO Statement','Equal Opportunity','Equal Employment Opportunity','EEO',
// //     'About Us','About the Company','Our Story','Our Mission','Why Join Us','Who We Are',
// //     'How to Apply','Application Process','Next Steps','Disclaimer','Legal',
// //   ];

// //   // ⚡ 归一化：把真实页面里的各种写法变体收敛到同一形态再匹配。
// //   // 实测这一步能解决一大半漏判——弯引号、全角括号、连字符/&、多余空白。
// //   function normalizeForMatch(s) {
// //     return String(s || '')
// //       .replace(/[\u2018\u2019\u02bc]/g, "'")      // 弯引号 → 直引号
// //       .replace(/[\u201c\u201d]/g, '"')
// //       .replace(/[\u2010-\u2015\u2212]/g, '-')      // 各种破折号 → 连字符
// //       .replace(/[（）]/g, (m) => (m === '（' ? '(' : ')'))
// //       .replace(/\s*&\s*/g, ' and ')                // & → and
// //       .replace(/-/g, ' ')                          // 连字符与空格等价
// //       .replace(/\s+/g, ' ')
// //       .trim()
// //       .toLowerCase();
// //   }

// //   // 中文短语足够独特（"岗位职责"几乎不可能出现在非标题语境的正文短行里），
// //   // 直接用包含匹配，不再要求特定的前后缀字符——之前要求前缀必须是空白/项目符号，
// //   // 导致"一、岗位职责""1.岗位职责""（一）岗位职责"这类编号标题全部漏判。
// //   function matchPhrase(normText, phrase) {
// //     const p = normalizeForMatch(phrase);
// //     if (/[\u4e00-\u9fa5]/.test(p)) return normText.includes(p);
// //     // 英文：词边界匹配，并容忍词尾复数
// //     const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// //     return new RegExp(`(?:^|\\b)${esc}(?:e?s)?(?:\\b|[:：]|$)`, 'i').test(normText);
// //   }

// //   // ⚡ 核心词正则（你提的思路）：词表覆盖不到的写法用"含核心词"兜底。
// //   // 权重压得低，单独出现过不了阈值，必须叠加排版/DOM 证据才成立——
// //   // 这样既能捞回"主要负责""职位职责"这类变体，又不会把正文里提到
// //   // "负责"的普通句子误判成标题。
// //   const CORE_PATTERNS = [
// //     { type: 'responsibilities', weight: 22, re: /(职责|负责|工作内容|responsibilit|duties|what you.{0,4}(ll|will) do)/i },
// //     { type: 'requirements',     weight: 22, re: /(要求|资格|条件|qualificat|requirement|what (we|you).{0,4}(re |ll )?(looking|bring|have))/i },
// //     { type: 'bonus',            weight: 22, re: /(加分|优先|preferred|nice to have|bonus|desirable|a plus)/i },
// //   ];

// //   // 最长匹配优先：解决 "Preferred Qualifications" 被 "Qualifications" 抢走
// //   // 判成 requirements 的问题（同权重时，命中的短语越长越具体，应该赢）。
// //   function matchVocab(text) {
// //     const normText = normalizeForMatch(text);
// //     let best = { type: null, keywordScore: 0, len: 0 };
// //     for (const cfg of SECTION_VOCAB) {
// //       for (const tier of cfg.tiers) {
// //         for (const p of tier.phrases) {
// //           if (!matchPhrase(normText, p)) continue;
// //           const len = normalizeForMatch(p).length;
// //           if (tier.weight > best.keywordScore || (tier.weight === best.keywordScore && len > best.len)) {
// //             best = { type: cfg.type, keywordScore: tier.weight, len };
// //           }
// //         }
// //       }
// //     }
// //     if (!best.type) {
// //       for (const c of CORE_PATTERNS) {
// //         if (c.re.test(normText) && c.weight > best.keywordScore) {
// //           best = { type: c.type, keywordScore: c.weight, len: 0 };
// //         }
// //       }
// //     }
// //     return best;
// //   }

// //   function isStopSection(text) {
// //     const t = text.trim().replace(/[:：\s]+$/, '').toLowerCase();
// //     return STOP_SECTIONS.some((w) => t === w.toLowerCase());
// //   }

// //   // ---------------------------------------------------------------------------
// //   // 多维打分：DOM 维度 + 排版维度 + 语义维度
// //   // ---------------------------------------------------------------------------
// //   function assessSectionHeader(element, text) {
// //     const isCJKText = /[\u4e00-\u9fa5]/.test(text);

// //     // 一票否决：项目符号开头的绝不是标题
// //     if (/^[*•▪◦●\-–]\s+/.test(text)) return { isHeader: false, score: 0, type: null };

// //     // ⚡ 数字编号不再一律否决。"1.岗位职责" 是标题，"1.负责推荐算法设计" 是列表项，
// //     // 两者的区别不在编号而在长度：标题短、列表项长。以前一刀切否决，导致中文
// //     // JD 里极常见的 "1.岗位职责" "2.任职资格" 全被判成列表项而漏掉。
// //     const numbered = /^\d+[.、)）]\s*\S/.test(text) || /^[一二三四五六七八九十]+[、.]\s*\S/.test(text);
// //     const bare = text.replace(/^[（(]?[\d一二三四五六七八九十]+[）)]?[.、)）]?\s*/, '');
// //     if (numbered && bare.length > (isCJKText ? 12 : 30)) {
// //       return { isHeader: false, score: 0, type: null };
// //     }

// //     let domScore = 0;
// //     if (element && element.tagName) {
// //       const tag = element.tagName.toLowerCase();
// //       // className 在 SVG 元素上是对象，统一转字符串
// //       const cls = typeof element.className === 'string' ? element.className : (element.getAttribute?.('class') || '');
// //       const idName = element.id || '';
// //       if (/^h[1-3]$/.test(tag)) domScore += 35;
// //       else if (/^h[4-6]$/.test(tag)) domScore += 25;
// //       else if (tag === 'b' || tag === 'strong') domScore += 20;
// //       else if (tag === 'dt') domScore += 20;
// //       // ⚡ class/id 语义信号——这是纯文本路径拿不到的证据，也是不同平台
// //       // "职责和要求 class 不一样"时最可靠的线索
// //       if (/header|title|section|heading|caption|label|subtitle/i.test(cls + ' ' + idName)) domScore += 30;
// //       // 反向信号：一看就是正文/描述容器
// //       if (/(desc|content|body|text|paragraph)/i.test(cls + ' ' + idName) && !/title|header|heading/i.test(cls + ' ' + idName)) domScore -= 10;
// //     }

// //     let layoutScore = 0;
// //     const isCJK = isCJKText;
// //     if (/[:：]\s*$/.test(text)) layoutScore += 25;
// //     if (text.length <= (isCJK ? 20 : 40)) layoutScore += 20;
// //     if (!isCJK && text === text.toUpperCase() && /[A-Z]{3,}/.test(text)) layoutScore += 18;
// //     if (/[.。]$/.test(text) && !/[:：]$/.test(text)) layoutScore -= 20;
// //     if (text.length > (isCJK ? 40 : 80)) layoutScore -= 40;
// //     // 叙述句特征
// //     if (/(?:we\s+are|you\s+will|our\s+team|looking\s+for\s+a|我们正在|如果你)/i.test(text) && text.length > 30) layoutScore -= 35;

// //     const { type, keywordScore } = matchVocab(text);
// //     const totalScore = domScore + layoutScore + keywordScore;
// //     const headingLen = isCJKText ? 22 : 50;
// //     const isHeader = (totalScore >= 60 && keywordScore > 0)
// //       || (domScore >= 35 && keywordScore >= 25 && text.length <= headingLen);
// //     return { isHeader, type, score: totalScore };
// //   }

// //   // ---------------------------------------------------------------------------
// //   // 按渲染顺序拆块。相比原版修了两处：
// //   //   - <li> 单独成块（原版 UL 的子元素是 LI，不在 some() 的标签清单里，
// //   //     导致整个 UL 被当成一个叶子块，所有列表项糊成一坨）
// //   //   - 直系文本节点不再丢失（原版 else 分支只遍历 element.children）
// //   // ---------------------------------------------------------------------------
// //   const LEAFY = /^(P|LI|H[1-6]|DT|DD|TD|TH|BLOCKQUOTE)$/i;
// //   const CONTAINER = /^(DIV|SECTION|ARTICLE|UL|OL|DL|TABLE|TBODY|TR|MAIN|SPAN|BODY)$/i;

// //   function getVisualTextBlocks(node) {
// //     const blocks = [];
// //     const walk = (el) => {
// //       if (!el || !el.tagName) return;
// //       const tag = el.tagName;
// //       if (/^(SCRIPT|STYLE|NOSCRIPT|SVG)$/i.test(tag)) return;

// //       if (LEAFY.test(tag)) {
// //         const t = (el.textContent || '').trim();
// //         if (t) blocks.push({ element: el, text: t });
// //         return;
// //       }
// //       if (/^(H[1-6]|STRONG|B)$/i.test(tag)) {
// //         const t = (el.textContent || '').trim();
// //         if (t) blocks.push({ element: el, text: t });
// //         return;
// //       }
// //       if (CONTAINER.test(tag)) {
// //         // 先看有没有值得下钻的子元素；没有就把自己整体作为一块
// //         const hasElementChild = el.children && el.children.length > 0;
// //         if (!hasElementChild) {
// //           const t = (el.textContent || '').trim();
// //           if (t) blocks.push({ element: el, text: t });
// //           return;
// //         }
// //         // 有子元素：逐个 childNode 处理，直系文本节点也要保留（原版会丢）
// //         for (const child of Array.from(el.childNodes)) {
// //           if (child.nodeType === 3) { // TEXT_NODE
// //             const t = (child.nodeValue || '').trim();
// //             if (t) blocks.push({ element: el, text: t });
// //           } else if (child.nodeType === 1) {
// //             walk(child);
// //           }
// //         }
// //         return;
// //       }
// //       // 其它标签(如 <a>/<em>)：并入父级由父级处理，这里只兜底取文本
// //       const t = (el.textContent || '').trim();
// //       if (t) blocks.push({ element: el, text: t });
// //     };
// //     walk(node);
// //     return blocks;
// //   }

// //   // ---------------------------------------------------------------------------
// //   // 主入口（DOM 路径）
// //   // ---------------------------------------------------------------------------
// //   function parseJdFromDom(containerNode) {
// //     const blocks = getVisualTextBlocks(containerNode);
// //     const buckets = { intro: [], responsibilities: [], requirements: [], bonus: [] };
// //     let current = 'intro'; // ⚡ 第一个标题之前的内容不再丢弃，归入 intro

// //     for (const { element, text } of blocks) {
// //       const t = text.trim();
// //       if (!t) continue;

// //       // 停止小节：只认"看起来像标题"的短行，且必须已经进入过真实小节
// //       // （开头的 About Us / 公司简介 是开场白，不是结尾样板）
// //       if (current !== 'intro' && t.length <= 40 && isStopSection(t)) break;

// //       const a = assessSectionHeader(element, t);
// //       if (a.isHeader && a.type) { current = a.type; continue; }
// //       buckets[current].push(t);
// //     }

// //     // intro 并入 responsibilities 前部（岗位概述本质上属于"做什么"）
// //     const resp = [...buckets.intro, ...buckets.responsibilities].join('\n').trim();
// //     return {
// //       responsibilities: resp,
// //       requirements: buckets.requirements.join('\n').trim(),
// //       bonus: buckets.bonus.join('\n').trim(),
// //       fullCleanText: blocks.map((b) => b.text).join('\n').trim(),
// //     };
// //   }

// //   // ---------------------------------------------------------------------------
// //   // 纯文本路径（API/JSON 返回时没有 DOM，这条必须保留）
// //   // 复用同一套词表和停止小节，保证两条路结论一致。
// //   // ---------------------------------------------------------------------------
// //   function looksLikeHeadingLine(s) {
// //     s = s.trim();
// //     if (!s || s.length > 60) return false;
// //     if (/^##\s/.test(s) || /[:：]$/.test(s) || /^【.+】$/.test(s) || /^#+\s/.test(s)) return true;
// //     const isCJK = /[\u4e00-\u9fa5]/.test(s);
// //     if (!isCJK && s.length <= 45 && !/[.!?]$/.test(s)) {
// //       if (s === s.toUpperCase() && /[A-Z]{3,}/.test(s)) return true;
// //       const w = s.split(/\s+/);
// //       const small = ['a','an','the','and','or','of','to','for','in','you','we','your','our','will','be','with'];
// //       if (w.length <= 6 && w.every((x) => !/^[a-z]/.test(x) || small.includes(x.toLowerCase()))) return true;
// //     }
// //     return isCJK && s.length <= 20 && !/[。！？]$/.test(s);
// //   }

// //   function normalizeAndMergeLines(text) {
// //     const lines = text.split('\n');
// //     const bullet = /^([•▪◦●\-*]|[\d一二三四五六七八九十]+[.、)）])\s*/;
// //     const out = [];
// //     for (const raw of lines) {
// //       const line = raw.trim();
// //       if (!line) { out.push(''); continue; }
// //       const prev = out[out.length - 1];
// //       const canMerge = prev
// //         && !bullet.test(line) && !looksLikeHeadingLine(line)
// //         && !/[。！？.!?:：；;]$/.test(prev) && !bullet.test(prev) && !looksLikeHeadingLine(prev)
// //         && /^[a-z(,;)]/.test(line); // 只有小写开头才算折行续写
// //       if (canMerge) out[out.length - 1] = prev + ' ' + line;
// //       else out.push(line);
// //     }
// //     return out.filter(Boolean).join('\n');
// //   }

// //   function parseJdFromText(rawText) {
// //     const result = { responsibilities: '', requirements: '', bonus: '', fullCleanText: '' };
// //     if (!rawText || typeof rawText !== 'string') return result;
// //     const text = normalizeAndMergeLines(
// //       rawText.replace(/\r\n?/g, '\n').replace(/\u3000/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
// //     );
// //     result.fullCleanText = text.replace(/^##\s+/gm, '');

// //     const buckets = { intro: [], responsibilities: [], requirements: [], bonus: [] };
// //     let current = 'intro';
// //     for (const raw of text.split('\n')) {
// //       const t = raw.trim();
// //       if (!t) continue;
// //       const bare = t.replace(/^##\s+/, '');
// //       // ⚡ 停止小节只在"已经进入过真实小节"之后才生效。JD 以 "About Us"/"公司简介"
// //       // 开头极其常见，那是开场介绍标题，不是结尾样板；以前一律 break，导致
// //       // 整份 JD 从第一行就被丢弃，最后靠兜底把全文塞进职责（表现为完全不切分）。
// //       if (current !== 'intro' && bare.length <= 40 && isStopSection(bare)) break;

// //       // ⚡ 统一走标定过的 assessSectionHeader（element 传 null 即纯文本+排版+语义）。
// //       // 之前这里是另一套弱判定（looksLikeHeadingLine + keywordScore>=15），
// //       // 阈值远低于 DOM 路径，结果把 "1、负责推荐算法的设计" 这种列表项当成标题
// //       // 吞掉，正文反而丢了。两条路必须共用同一套判定，结论才会一致。
// //       const a = assessSectionHeader(null, bare);
// //       if (a.isHeader && a.type) { current = a.type; continue; }
// //       buckets[current].push(bare);
// //     }
// //     result.responsibilities = [...buckets.intro, ...buckets.responsibilities].join('\n').trim();
// //     result.requirements = buckets.requirements.join('\n').trim();
// //     result.bonus = buckets.bonus.join('\n').trim();
// //     if (!result.responsibilities && !result.requirements && !result.bonus) {
// //       result.responsibilities = result.fullCleanText;
// //     }
// //     return result;
// //   }

// //   // 统一入口：有 DOM 走 DOM，没有就走文本
// //   function parseJdSmart(input) {
// //     if (input && typeof input === 'object' && input.nodeType === 1) return parseJdFromDom(input);
// //     return parseJdFromText(String(input || ''));
// //   }

// //   // HTML 正文清洗：BOSS 的 postDescription 有时带 <br>/&nbsp; 等实体
// //   function htmlToText(html) {
// //     if (!html || typeof html !== 'string') return '';
// //     if (!/[<&]/.test(html)) return html;
// //     return html
// //       .replace(/<\s*br\s*\/?\s*>/gi, '\n')
// //       .replace(/<\s*\/\s*(p|div|li|tr)\s*>/gi, '\n')
// //       .replace(/<[^>]+>/g, '')
// //       .replace(/&nbsp;/gi, ' ')
// //       .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
// //       .replace(/&amp;/g, '&').replace(/&quot;/g, '"');
// //   }

// //   // ---------------------------------------------------------------------
// //   // 2. 通用："点击相关性捕获窗口"
// //   //    content.js 在模拟点击前派发 REQ_BEGIN_CAPTURE，我们打开一个短窗口；
// //   //    窗口内任何"形状像 JD"的响应，直接归属给刚点击的那张卡片。
// //   //    这样就不需要从 payload 里猜 ID 字段名——这是能真正跨站点复用的关键。
// //   // ---------------------------------------------------------------------
// //   let activeCapture = null; // { cardId, startedAt, best: {score, detail} | null }

// //   document.addEventListener('REQ_BEGIN_CAPTURE', (e) => {
// //     const { cardId } = e.detail || {};
// //     if (!cardId) return;
// //     activeCapture = { cardId: String(cardId), startedAt: Date.now(), best: null };
// //     diag('捕获窗口已开启, cardId =', cardId);
// //   });

// //   document.addEventListener('REQ_END_CAPTURE', () => {
// //     if (!activeCapture) return;
// //     // 窗口关闭时，如果期间攒到了候选，把得分最高的那个作为该卡片的详情发出去
// //     if (activeCapture.best) {
// //       diag('捕获窗口关闭，采用最佳候选, score =', activeCapture.best.score);
// //       window.postMessage({
// //         type: 'JOB_HOOK_DETAIL', site: SITE,
// //         data: { ...activeCapture.best.detail, matchKey: activeCapture.cardId, source: 'Click-Correlated Capture' }
// //       }, '*');
// //     }
// //     activeCapture = null;
// //   });

// //   // JD 形状打分：文本越长、越命中 JD 关键词、越像自然语言，分越高。
// //   // 用来在捕获窗口内出现多个候选时挑出最像职位详情的那一个，
// //   // 也用来把埋点/推荐位这类"碰巧也很长"的响应排除掉。
// //   const JD_KEYWORD_PATTERN = /(岗位职责|工作职责|任职要求|任职资格|岗位要求|职位描述|工作内容|加分项|Responsibilities|Requirements|Qualifications|Job\s+Description|What\s+you.{0,10}do)/gi;

// //   function scoreJdText(text) {
// //     if (!text || text.length < 150) return 0;
// //     const kwHits = (text.match(JD_KEYWORD_PATTERN) || []).length;
// //     const hasSentences = /[。！？.!?]/.test(text);
// //     if (!kwHits && !hasSentences) return 0;

// //     // ⚡ 提高识别度：除了关键词命中，再叠加几个"这看起来确实是 JD 正文"的结构特征。
// //     // 目的是把"碰巧很长的自然语言"（公司简介、用户协议、推荐位文案）跟真正的
// //     // 职位描述区分开——JD 的典型形态是"分条列举的要求/职责"。
// //     let structureBonus = 0;
// //     // 项目符号/编号列表：JD 几乎必有
// //     const bulletLines = (text.match(/(?:^|\n)\s*(?:[•·▪●\-*]|\d+[.、)）])\s*\S/g) || []).length;
// //     if (bulletLines >= 3) structureBonus += 120;
// //     else if (bulletLines >= 1) structureBonus += 40;
// //     // 年限/学历/技能这类硬性要求措辞
// //     if (/(\d+\s*[-~到]?\s*\d*\s*年(以上)?(工作)?经验|本科|硕士|博士|大专|years?\s+of\s+experience|bachelor|master's|degree)/i.test(text)) structureBonus += 80;
// //     // 负面信号：明显是公司介绍/协议条款而不是岗位描述
// //     if (/(公司简介|关于我们|企业文化|发展历程|隐私政策|用户协议|Cookie|About\s+Us|Privacy\s+Policy|Terms\s+of\s+Service)/i.test(text)
// //         && kwHits === 0) structureBonus -= 150;

// //     return Math.min(kwHits, 5) * 100 + Math.min(text.length, 4000) * 0.05 + structureBonus;
// //   }

// //   // 递归找 payload 里最像 JD 正文的那个字符串字段
// //   function findBestJdTextInPayload(node, depth = 0, seen = new Set()) {
// //     if (!node || typeof node !== 'object' || depth > 6 || seen.has(node)) return null;
// //     seen.add(node);
// //     let best = null;
// //     for (const key in node) {
// //       if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
// //       const val = node[key];
// //       if (typeof val === 'string') {
// //         const text = htmlToText(val);
// //         const score = scoreJdText(text);
// //         if (score > 0 && (!best || score > best.score)) {
// //           best = { score, text, key, container: node };
// //         }
// //       } else if (val && typeof val === 'object') {
// //         const sub = findBestJdTextInPayload(val, depth + 1, seen);
// //         if (sub && (!best || sub.score > best.score)) best = sub;
// //       }
// //     }
// //     return best;
// //   }

// //   const TITLE_LIKE_KEYS = ['jobName', 'title', 'jobTitle', 'positionName', 'name', 'headline'];
// //   function guessTitle(container) {
// //     if (!container) return '';
// //     for (const k of TITLE_LIKE_KEYS) {
// //       if (typeof container[k] === 'string' && container[k].length < 100) return container[k];
// //     }
// //     return '';
// //   }

// //   // 捕获窗口内的候选收集：不立刻发出，先攒着比分数，窗口关闭时发最佳的那个
// //   // ⚡ 高置信度候选立刻发出，不等窗口关闭。
// //   // 之前的设计是"窗口内攒着，REQ_END_CAPTURE 时发最佳的那个"——但 content.js
// //   // 侧的 REQ_END_CAPTURE 是在 finalize() 里派发的，而 finalize() 只在已经
// //   // resolve/超时时才跑，等于候选永远晚一拍，network 这个源在观察窗口内根本
// //   // 没机会赢，白白掉到更慢的 pageFetch。现在改成：分数够高(明显就是 JD)就
// //   // 立即发出，让等待中的 Promise 当场接住；分数不够高的才留到窗口关闭时兜底。
// //   const CONFIDENT_SCORE = 260; // 约等于"命中 2 个以上 JD 关键词 + 有列表结构"

// //   function offerToCapture(json) {
// //     if (!activeCapture) return false;
// //     const best = findBestJdTextInPayload(json);
// //     if (!best) return false;

// //     const detail = { title: guessTitle(best.container), ...parseJdSmart(best.text) };

// //     if (best.score >= CONFIDENT_SCORE) {
// //       diag('捕获窗口内命中高置信度候选，立即发出, score =', best.score, 'key =', best.key);
// //       window.postMessage({
// //         type: 'JOB_HOOK_DETAIL', site: SITE,
// //         data: { ...detail, matchKey: activeCapture.cardId, source: 'Click-Correlated Capture' }
// //       }, '*');
// //       activeCapture.best = null; // 已经发过了，窗口关闭时不用再发一遍
// //       return true;
// //     }

// //     if (activeCapture.best && activeCapture.best.score >= best.score) return true;
// //     activeCapture.best = { score: best.score, detail };
// //     diag('捕获窗口内收到低置信度候选(暂存), score =', best.score, 'key =', best.key);
// //     return true;
// //   }

// //   // ---------------------------------------------------------------------
// //   // 3. BOSS 专属规则（优先级最高，因为字段结构确定，解析最准）
// //   // ---------------------------------------------------------------------
// //   // ⚡ URL 放宽：不再写死 /job/detail.json。BOSS 换路径/换域名前缀的情况很常见，
// //   //    这里覆盖常见几种，再由 payload 结构做二次确认（zpData.jobInfo 存在才算数）。
// //   const BOSS_DETAIL_URL = /\/(job\/detail|jobdetail|job\/card|geek\/job\/detail)\.json/i;
// //   const BOSS_LIST_URL = /\/(joblist|job\/list|geek\/joblist)\.json/i;

// //   function parseBossDetail(json, url) {
// //     const jobInfo = json?.zpData?.jobInfo;
// //     if (!jobInfo) return null;

// //     // matchKey 多级兜底：URL query 的 securityId 最可靠（跟 content.js 发起
// //     // 点击时用的是同一个值），其次 payload 里的各种 id，最后交给点击相关性。
// //     let matchKey = '';
// //     try { matchKey = new URL(url, location.origin).searchParams.get('securityId') || ''; } catch (e) {}
// //     if (!matchKey) matchKey = jobInfo.encryptJobId || jobInfo.encryptId || jobInfo.securityId || '';
// //     if (!matchKey && activeCapture) matchKey = activeCapture.cardId;

// //     const rawDesc = htmlToText(jobInfo.postDescription || '');
// //     return {
// //       matchKey,
// //       title: jobInfo.jobName || '',
// //       salary: jobInfo.salaryDesc || '',
// //       company: json.zpData.brandComInfo?.brandName || '',
// //       location: jobInfo.locationName || '',
// //       ...parseJdSmart(rawDesc)
// //     };
// //   }

// //   function notifyList(list) {
// //     if (!Array.isArray(list) || list.length === 0) return;
// //     window.postMessage({ type: 'JOB_HOOK_LIST', site: SITE, data: list }, '*');
// //   }

// //   function notifyDetail(detail) {
// //     if (!detail) return;
// //     if (!detail.matchKey) {
// //       // ⚡ 以前这里直接 return，静默丢弃。现在至少留个诊断痕迹，
// //       //    并且如果捕获窗口开着，就把它归属给当前点击的卡片。
// //       if (activeCapture) {
// //         detail = { ...detail, matchKey: activeCapture.cardId, source: 'Click-Correlated Fallback' };
// //         diag('详情缺少 matchKey，按点击相关性归属给', activeCapture.cardId);
// //       } else {
// //         diag('⚠️ 拿到详情但没有 matchKey，且没有捕获窗口，只能丢弃');
// //         return;
// //       }
// //     }
// //     window.postMessage({ type: 'JOB_HOOK_DETAIL', site: SITE, data: detail }, '*');
// //   }

// //   // ---------------------------------------------------------------------
// //   // 4. LinkedIn / generic 的内容特征扫描（沿用上一版思路）
// //   // ---------------------------------------------------------------------
// //   const LINKEDIN_PAYLOAD_HINT = /fsd_jobPosting|jobPostingUrn|"description":\s*\{\s*"text"/;

// //   function extractJobIdFromUrn(urn) {
// //     if (typeof urn !== 'string') return null;
// //     const m = urn.match(/(?:fsd_jobPosting|jobPosting):(\d+)/);
// //     return m ? m[1] : null;
// //   }

// //   function scanLinkedInPayloadForJobPosting(node, results, seen, depth = 0) {
// //     if (!node || typeof node !== 'object' || seen.has(node) || depth > 8) return;
// //     seen.add(node);
// //     const entityUrn = node.entityUrn || node['*entityUrn'] || node.jobPostingUrn || '';
// //     const jobId = extractJobIdFromUrn(entityUrn) || (node.jobPostingId ? String(node.jobPostingId) : null);
// //     const rawDesc = typeof node.description === 'string'
// //       ? node.description
// //       : (node.description && typeof node.description.text === 'string' ? node.description.text : '');
// //     if (jobId && rawDesc) results.push({ matchKey: jobId, title: node.title || '', rawDesc: htmlToText(rawDesc) });
// //     for (const key in node) {
// //       if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
// //       const val = node[key];
// //       if (val && typeof val === 'object') scanLinkedInPayloadForJobPosting(val, results, seen, depth + 1);
// //     }
// //   }

// //   // ---------------------------------------------------------------------
// //   // 5. 统一响应处理入口
// //   // ---------------------------------------------------------------------
// //   function handleResponse(url, payloadText, payloadObj) {
// //     let json = payloadObj;
// //     if (!json) {
// //       if (!payloadText || payloadText.length < 50) return;
// //       // 便宜的预筛，避免对每个响应都 JSON.parse
// //       if (payloadText[0] !== '{' && payloadText[0] !== '[') return;
// //       try { json = JSON.parse(payloadText); } catch (e) { return; }
// //     }
// //     if (!json || typeof json !== 'object') return;

// //     // ---- 诊断：把疑似职位相关的响应打出来，帮你定位真实接口 ----
// //     if (window.__jdpDiag) {
// //       const probe = findBestJdTextInPayload(json);
// //       if (probe) {
// //         diag('疑似含 JD 正文的响应:', { url, 字段名: probe.key, 分数: probe.score, 前120字: probe.text.slice(0, 120) });
// //       }
// //     }

// //     // ---- BOSS 专属规则优先 ----
// //     if (SITE === 'boss') {
// //       if (BOSS_LIST_URL.test(url)) {
// //         const list = json?.zpData?.jobList;
// //         if (list) { diag('命中列表接口', url, '条数', list.length); notifyList(list); }
// //       }
// //       // URL 命中 或 payload 结构命中（换路径也不会失效）
// //       if (BOSS_DETAIL_URL.test(url) || json?.zpData?.jobInfo) {
// //         const detail = parseBossDetail(json, url);
// //         if (detail) {
// //           diag('命中详情接口', url, 'matchKey =', detail.matchKey);
// //           notifyDetail(detail);
// //           return;
// //         }
// //       }
// //     }

// //     if (SITE === 'linkedin' && LINKEDIN_PAYLOAD_HINT.test(payloadText || JSON.stringify(json).slice(0, 20000))) {
// //       const results = [];
// //       scanLinkedInPayloadForJobPosting(json, results, new Set());
// //       results.forEach((r) => notifyDetail({ matchKey: r.matchKey, title: r.title, ...parseJdSmart(r.rawDesc) }));
// //       if (results.length) return;
// //     }

// //     // ---- 通用兜底：点击相关性捕获（所有站点都适用，包括 BOSS 规则没命中时）----
// //     offerToCapture(json);
// //   }

// //   // ---------------------------------------------------------------------
// //   // 6. Hook XHR —— ⚡ 修复 responseType 导致的静默失效
// //   // ---------------------------------------------------------------------
// //   const origOpen = XMLHttpRequest.prototype.open;
// //   const origSend = XMLHttpRequest.prototype.send;

// //   XMLHttpRequest.prototype.open = function (method, url) {
// //     this.__hookUrl = url;
// //     return origOpen.apply(this, arguments);
// //   };

// //   XMLHttpRequest.prototype.send = function () {
// //     this.addEventListener('load', function () {
// //       try {
// //         const url = this.responseURL || this.__hookUrl || '';
// //         const rt = this.responseType;
// //         // ⚡ 关键修复：responseText 只在 responseType 为 '' 或 'text' 时可读，
// //         // 其它情况（尤其是 'json'）读它会抛 DOMException，被 catch 吞掉后
// //         // 表现为"拦截装了但永远不触发"。这里按类型分别取值。
// //         if (rt === '' || rt === 'text') {
// //           handleResponse(url, this.responseText, null);
// //         } else if (rt === 'json') {
// //           handleResponse(url, null, this.response);
// //         }
// //         // 'blob'/'arraybuffer'/'document' 不是 JSON 接口，直接忽略
// //       } catch (e) {
// //         diag('XHR 响应处理异常(已忽略):', e && e.message);
// //       }
// //     });
// //     return origSend.apply(this, arguments);
// //   };

// //   // ---------------------------------------------------------------------
// //   // 7. Hook fetch
// //   // ---------------------------------------------------------------------
// //   const origFetch = window.fetch;
// //   if (typeof origFetch === 'function') {
// //     window.fetch = function (input, init) {
// //       const url = typeof input === 'string' ? input : (input && input.url) || '';
// //       return origFetch.apply(this, arguments).then((res) => {
// //         try {
// //           res.clone().text().then((text) => handleResponse(url, text, null)).catch(() => {});
// //         } catch (e) {}
// //         return res;
// //       });
// //     };
// //   }

// //   // ---------------------------------------------------------------------
// //   // 8. BOSS 首屏 SSR 数据
// //   // ---------------------------------------------------------------------
// //   if (SITE === 'boss') {
// //     try {
// //       if (window.__INITIAL_STATE__?.jobList) notifyList(window.__INITIAL_STATE__.jobList);
// //     } catch (e) {}
// //   }

// //   // ---------------------------------------------------------------------
// //   // 9. 主动兜底通道（保持原有行为不变）
// //   // ---------------------------------------------------------------------
// //   function getLinkedInCsrfToken() {
// //     const m = document.cookie.match(/JSESSIONID="?([^";]+)"?/);
// //     return m ? m[1] : '';
// //   }

// //   async function directFetchDetail(matchKey, meta) {
// //     if (SITE === 'linkedin') {
// //       const csrfToken = getLinkedInCsrfToken();
// //       if (!csrfToken) return null;
// //       try {
// //         const res = await fetch(`https://www.linkedin.com/voyager/api/jobs/jobPostings/${matchKey}`, {
// //           method: 'GET',
// //           headers: {
// //             'csrf-token': csrfToken,
// //             'x-restli-protocol-version': '2.0.0',
// //             'accept': 'application/vnd.linkedin.normalized+json+2.0.0, application/json, text/plain, */*',
// //             'x-li-lang': 'zh_CN'
// //           }
// //         });
// //         if (!res.ok) return null;
// //         const json = await res.json();
// //         const rawDesc = htmlToText(json?.description?.text || (typeof json?.description === 'string' ? json.description : ''));
// //         return { matchKey: String(matchKey), title: json?.title || '', ...parseJdSmart(rawDesc) };
// //       } catch (e) { return null; }
// //     }

// //     if (SITE === 'boss') {
// //       const securityId = matchKey;
// //       const lid = meta?.lid || '';
// //       if (!securityId) return null;
// //       try {
// //         const apiUrl = `/wapi/zpgeek/job/detail.json?securityId=${encodeURIComponent(securityId)}&lid=${encodeURIComponent(lid)}`;
// //         const res = await fetch(apiUrl, {
// //           headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, text/plain, */*' }
// //         });
// //         if (!res.ok) return null;
// //         const json = await res.json();
// //         return parseBossDetail(json, apiUrl);
// //       } catch (e) { return null; }
// //     }
// //     return null;
// //   }

// //   document.addEventListener('REQ_DIRECT_FETCH_JOB', async (e) => {
// //     const { matchKey, meta, requestId } = e.detail || {};
// //     const data = await directFetchDetail(matchKey, meta);
// //     document.dispatchEvent(new CustomEvent('RESP_DIRECT_FETCH_JOB', { detail: { requestId, matchKey, data } }));
// //   });

// //   document.documentElement.dataset.injectReady = 'true';
// //   document.dispatchEvent(new CustomEvent('INJECT_SCRIPT_READY'));
// //   console.log(`✅ [injected.js] (${SITE}) 挂载完成。排查拦截问题请在控制台执行: window.__jdpDiag = true`);
// // })();
// /**
//  * ==============================================================================
//  * injected.js — 运行在页面主环境 (MAIN World)
//  *
//  * 本版相对上一版的关键修复与新增：
//  *   [修复] XHR hook 读 responseText 在 responseType='json'/'blob' 时会抛
//  *          DOMException，被 catch 静默吞掉 → 拦截永远不触发（"只有直接请求，
//  *          没有拦截"的根因）。现在按 responseType 分支取值。
//  *   [修复] BOSS 详情接口 URL 从写死 /job/detail.json 放宽成多模式匹配，
//  *          并保留"内容形状"兜底，避免站点换路径就全线失效。
//  *   [修复] matchKey 取不到时不再静默丢弃，走多级兜底（URL → payload → 点击相关性）。
//  *   [新增] 诊断模式：把流经的、疑似职位相关的 JSON 响应打到控制台，
//  *          让你能直接看到 BOSS 真实的详情接口叫什么、字段长什么样。
//  *   [新增] 通用"点击相关性捕获"：content.js 点击前开一个捕获窗口，窗口内
//  *          出现的 JD 形状响应直接归属给刚点击的那张卡——不需要知道站点的
//  *          ID 字段名/位置，这是真正站点无关的机制。
//  * ==============================================================================
//  */
// (function () {
//   'use strict';
//   if (window.__jobHookInjected) return;
//   window.__jobHookInjected = true;

//   // ---------------------------------------------------------------------
//   // 0. 站点识别 & 诊断开关
//   // ---------------------------------------------------------------------
//   const SITE = location.host.includes('zhipin.com')
//     ? 'boss'
//     : location.host.includes('linkedin.com')
//       ? 'linkedin'
//       : location.host.includes('51job.com')
//         ? '51job'
//         : 'generic';

//   // 诊断模式：控制台执行 window.__jdpDiag = true 即可打开（不用改代码重装插件），
//   // 打开后会把所有"疑似职位相关"的响应 URL + 字段结构打出来。
//   // 排查"到底哪个接口才是详情接口"时非常有用。
//   const diag = (...args) => { if (window.__jdpDiag) console.log('%c[JDP-DIAG]', 'color:#0a66c2;font-weight:bold', ...args); };
//   window.__jdpDiag = window.__jdpDiag || false;

//   // ---------------------------------------------------------------------
//   // 1. JD 文本解析（与 content.js 保持同一套语义，避免两边结果不一致）
//   // ---------------------------------------------------------------------
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


  

//   const SECTION_VOCAB = [
//     {
//       type: 'responsibilities',
//       tiers: [
//         { weight: 50, phrases: ['岗位职责','工作职责','职责描述','主要职责','工作内容','岗位描述','职位描述',
//             'Responsibilities','Key Responsibilities','Primary Responsibilities','Core Responsibilities',
//             'Duties and Responsibilities','Essential Duties','Essential Functions','Essential Job Functions','Key Accountabilities','Responsibility','职位职责','工作内容及职责'] },
//         { weight: 40, phrases: ["What you'll do",'What you will do',"What You'll Be Doing",'About the Role',
//             'About this Role','About the job','Role Overview','Role Summary','Job Summary','Job Purpose',
//             'The Role','Your Impact','Duties','你将负责','主要工作','主要负责','负责内容'] },
//         { weight: 25, phrases: ['职责','Tasks','任务'] },
//       ],
//     },
//     {
//       type: 'requirements',
//       tiers: [
//         { weight: 50, phrases: ['任职要求','任职资格','岗位要求','招聘条件','职位要求','能力要求','岗位条件',
//             'Requirements','Qualifications','Job Requirements','Basic Qualifications','Minimum Qualifications',
//             'Required Qualifications','Key Qualifications','Skills and Qualifications','Education and Experience','Requirement','Qualification','技能要求','能力要求'] },
//         { weight: 40, phrases: ["What we're looking for",'What we are looking for','Who You Are',
//             "What You'll Bring",'What You Bring','Skills & Experience','Required Skills','Must Have','Must-haves',
//             '你需要具备','我们需要你'] },
//         { weight: 25, phrases: ['要求','资格','Skills'] },
//       ],
//     },
//     {
//       type: 'bonus',
//       tiers: [
//         { weight: 50, phrases: ['加分项','优先条件','优先考虑','加分技能',
//             'Preferred Qualifications','Additional Qualifications','Preferred Experience','Preferred Skills',
//             'Nice to have','Nice-to-haves','Bonus Points','Desirable Skills'] },
//         { weight: 40, phrases: ['具备以下者优先','有以下经验优先','Bonus points if you have','A plus if','An asset','Desirable'] },
//         { weight: 25, phrases: ['加分','Preferred'] },
//       ],
//     },
//   ];

//   // 停止小节：命中即结束正文收集，后面的内容全部丢弃
//   const STOP_SECTIONS = [
//     '福利待遇','薪资福利','公司简介','关于我们','企业文化','工作地点','投递方式','我们提供',
//     'Benefits','What We Offer','Perks','Perks and Benefits','Compensation','Salary','Pay Range',
//     'Working Conditions','Work Environment','Physical Requirements',
//     'EEO Statement','Equal Opportunity','Equal Employment Opportunity','EEO',
//     'About Us','About the Company','Our Story','Our Mission','Why Join Us','Who We Are',
//     'How to Apply','Application Process','Next Steps','Disclaimer','Legal',
//   ];

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
//   //  function parseJdSmart(input) {
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


//   function parseJdSmart(input) {
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
//   // HTML 正文清洗：BOSS 的 postDescription 有时带 <br>/&nbsp; 等实体
//   function htmlToText(html) {
//     if (!html || typeof html !== 'string') return '';
//     if (!/[<&]/.test(html)) return html;
//     return html
//       .replace(/<\s*br\s*\/?\s*>/gi, '\n')
//       .replace(/<\s*\/\s*(p|div|li|tr)\s*>/gi, '\n')
//       .replace(/<[^>]+>/g, '')
//       .replace(/&nbsp;/gi, ' ')
//       .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
//       .replace(/&amp;/g, '&').replace(/&quot;/g, '"');
//   }

//   // ---------------------------------------------------------------------
//   // 2. 通用："点击相关性捕获窗口"
//   //    content.js 在模拟点击前派发 REQ_BEGIN_CAPTURE，我们打开一个短窗口；
//   //    窗口内任何"形状像 JD"的响应，直接归属给刚点击的那张卡片。
//   //    这样就不需要从 payload 里猜 ID 字段名——这是能真正跨站点复用的关键。
//   // ---------------------------------------------------------------------
//   let activeCapture = null; // { cardId, startedAt, best: {score, detail} | null }

//   document.addEventListener('REQ_BEGIN_CAPTURE', (e) => {
//     const { cardId } = e.detail || {};
//     if (!cardId) return;
//     activeCapture = { cardId: String(cardId), startedAt: Date.now(), best: null };
//     diag('捕获窗口已开启, cardId =', cardId);
//   });

//   document.addEventListener('REQ_END_CAPTURE', () => {
//     if (!activeCapture) return;
//     // 窗口关闭时，如果期间攒到了候选，把得分最高的那个作为该卡片的详情发出去
//     if (activeCapture.best) {
//       diag('捕获窗口关闭，采用最佳候选, score =', activeCapture.best.score);
//       window.postMessage({
//         type: 'JOB_HOOK_DETAIL', site: SITE,
//         data: { ...activeCapture.best.detail, matchKey: activeCapture.cardId, source: 'Click-Correlated Capture' }
//       }, '*');
//     }
//     activeCapture = null;
//   });

//   // JD 形状打分：文本越长、越命中 JD 关键词、越像自然语言，分越高。
//   // 用来在捕获窗口内出现多个候选时挑出最像职位详情的那一个，
//   // 也用来把埋点/推荐位这类"碰巧也很长"的响应排除掉。
//   const JD_KEYWORD_PATTERN = /(岗位职责|工作职责|任职要求|任职资格|岗位要求|职位描述|工作内容|加分项|Responsibilities|Requirements|Qualifications|Job\s+Description|What\s+you.{0,10}do)/gi;

//   function scoreJdText(text) {
//     if (!text || text.length < 150) return 0;
//     const kwHits = (text.match(JD_KEYWORD_PATTERN) || []).length;
//     const hasSentences = /[。！？.!?]/.test(text);
//     if (!kwHits && !hasSentences) return 0;

//     // ⚡ 提高识别度：除了关键词命中，再叠加几个"这看起来确实是 JD 正文"的结构特征。
//     // 目的是把"碰巧很长的自然语言"（公司简介、用户协议、推荐位文案）跟真正的
//     // 职位描述区分开——JD 的典型形态是"分条列举的要求/职责"。
//     let structureBonus = 0;
//     // 项目符号/编号列表：JD 几乎必有
//     const bulletLines = (text.match(/(?:^|\n)\s*(?:[•·▪●\-*]|\d+[.、)）])\s*\S/g) || []).length;
//     if (bulletLines >= 3) structureBonus += 120;
//     else if (bulletLines >= 1) structureBonus += 40;
//     // 年限/学历/技能这类硬性要求措辞
//     if (/(\d+\s*[-~到]?\s*\d*\s*年(以上)?(工作)?经验|本科|硕士|博士|大专|years?\s+of\s+experience|bachelor|master's|degree)/i.test(text)) structureBonus += 80;
//     // 负面信号：明显是公司介绍/协议条款而不是岗位描述
//     if (/(公司简介|关于我们|企业文化|发展历程|隐私政策|用户协议|Cookie|About\s+Us|Privacy\s+Policy|Terms\s+of\s+Service)/i.test(text)
//         && kwHits === 0) structureBonus -= 150;

//     return Math.min(kwHits, 5) * 100 + Math.min(text.length, 4000) * 0.05 + structureBonus;
//   }

//   // 递归找 payload 里最像 JD 正文的那个字符串字段
//   function findBestJdTextInPayload(node, depth = 0, seen = new Set()) {
//     if (!node || typeof node !== 'object' || depth > 6 || seen.has(node)) return null;
//     seen.add(node);
//     let best = null;
//     for (const key in node) {
//       if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
//       const val = node[key];
//       if (typeof val === 'string') {
//         const text = htmlToText(val);
//         const score = scoreJdText(text);
//         if (score > 0 && (!best || score > best.score)) {
//           best = { score, text, key, container: node };
//         }
//       } else if (val && typeof val === 'object') {
//         const sub = findBestJdTextInPayload(val, depth + 1, seen);
//         if (sub && (!best || sub.score > best.score)) best = sub;
//       }
//     }
//     return best;
//   }

//   const TITLE_LIKE_KEYS = ['jobName', 'title', 'jobTitle', 'positionName', 'name', 'headline'];
//   function guessTitle(container) {
//     if (!container) return '';
//     for (const k of TITLE_LIKE_KEYS) {
//       if (typeof container[k] === 'string' && container[k].length < 100) return container[k];
//     }
//     return '';
//   }

//   // 捕获窗口内的候选收集：不立刻发出，先攒着比分数，窗口关闭时发最佳的那个
//   // ⚡ 高置信度候选立刻发出，不等窗口关闭。
//   // 之前的设计是"窗口内攒着，REQ_END_CAPTURE 时发最佳的那个"——但 content.js
//   // 侧的 REQ_END_CAPTURE 是在 finalize() 里派发的，而 finalize() 只在已经
//   // resolve/超时时才跑，等于候选永远晚一拍，network 这个源在观察窗口内根本
//   // 没机会赢，白白掉到更慢的 pageFetch。现在改成：分数够高(明显就是 JD)就
//   // 立即发出，让等待中的 Promise 当场接住；分数不够高的才留到窗口关闭时兜底。
//   const CONFIDENT_SCORE = 260; // 约等于"命中 2 个以上 JD 关键词 + 有列表结构"

//   function offerToCapture(json) {
//     if (!activeCapture) return false;
//     const best = findBestJdTextInPayload(json);
//     if (!best) return false;

//     const detail = { title: guessTitle(best.container), ...parseJdSmart(best.text) };

//     if (best.score >= CONFIDENT_SCORE) {
//       diag('捕获窗口内命中高置信度候选，立即发出, score =', best.score, 'key =', best.key);
//       window.postMessage({
//         type: 'JOB_HOOK_DETAIL', site: SITE,
//         data: { ...detail, matchKey: activeCapture.cardId, source: 'Click-Correlated Capture' }
//       }, '*');
//       activeCapture.best = null; // 已经发过了，窗口关闭时不用再发一遍
//       return true;
//     }

//     if (activeCapture.best && activeCapture.best.score >= best.score) return true;
//     activeCapture.best = { score: best.score, detail };
//     diag('捕获窗口内收到低置信度候选(暂存), score =', best.score, 'key =', best.key);
//     return true;
//   }

//   // ---------------------------------------------------------------------
//   // 3. BOSS 专属规则（优先级最高，因为字段结构确定，解析最准）
//   // ---------------------------------------------------------------------
//   // ⚡ URL 放宽：不再写死 /job/detail.json。BOSS 换路径/换域名前缀的情况很常见，
//   //    这里覆盖常见几种，再由 payload 结构做二次确认（zpData.jobInfo 存在才算数）。
//   const BOSS_DETAIL_URL = /\/(job\/detail|jobdetail|job\/card|geek\/job\/detail)\.json/i;
//   const BOSS_LIST_URL = /\/(joblist|job\/list|geek\/joblist)\.json/i;
//   // 51job 的搜索列表接口，返回结果里每条职位自带 jobDescribe 字段——
//   // 不用等点击详情，列表加载的这一次响应就够用了。
//   const FIFTYONEJOB_SEARCH_URL = /we\.51job\.com\/api\/job\/search-pc/i;

//   function normalizeTitleForMatch(title) {
//     // 卡片DOM上的标题和接口返回的标题，哪怕是同一个职位，也可能有细微
//     // 空白差异（多余空格、换行）——统一trim+把连续空白压成一个空格，
//     // 两边用同一个函数处理才能对上。
//     return String(title || '').trim().replace(/\s+/g, ' ');
//   }

//   function parseFiftyOneJobList(json) {
//     // 路径通过实测确认：Resultbody.job.items[].jobDescribe
//     const items = json?.resultbody?.job?.items;
//     if (!Array.isArray(items)) return [];
//     return items.map((it) => {
//       // 用标题做匹配键，不用数字ID——51job接口具体用哪个字段名做ID没有
//       // 实测确认过，标题（jobName）比较确定存在，且卡片DOM上本来就有
//       // 现成的标题可以对，不需要再去猜/解析卡片HTML里嵌的隐藏ID。
//       const title = normalizeTitleForMatch(it.jobName || it.jobTitle || '');
//       const rawDesc = it.jobDescribe || '';
//       if (!rawDesc || !title) return null;
//       return { matchKey: title, title, rawDesc };
//     }).filter(Boolean);
//   }

//   function parseBossDetail(json, url) {
//     const jobInfo = json?.zpData?.jobInfo;
//     if (!jobInfo) return null;

//     // matchKey 多级兜底：URL query 的 securityId 最可靠（跟 content.js 发起
//     // 点击时用的是同一个值），其次 payload 里的各种 id，最后交给点击相关性。
//     let matchKey = '';
//     try { matchKey = new URL(url, location.origin).searchParams.get('securityId') || ''; } catch (e) {}
//     if (!matchKey) matchKey = jobInfo.encryptJobId || jobInfo.encryptId || jobInfo.securityId || '';
//     if (!matchKey && activeCapture) matchKey = activeCapture.cardId;

//     const rawDesc = htmlToText(jobInfo.postDescription || '');
//     return {
//       matchKey,
//       title: jobInfo.jobName || '',
//       salary: jobInfo.salaryDesc || '',
//       company: json.zpData.brandComInfo?.brandName || '',
//       location: jobInfo.locationName || '',
//       ...parseJdSmart(rawDesc)
//     };
//   }

//   // injected.js (运行在 MAIN 作用域)

//   // injected.js (运行在 MAIN 作用域)
// function parseZhilianJobDetail() {
//   try {
//     // 1. 优先读取 __INITIAL_STATE__
//     if (window.__INITIAL_STATE__?.jobDetail?.jobDetail) {
//       const jobInfo = window.__INITIAL_STATE__.desc.description;
//       return jobInfo
  
//     }
    
//     // 2. 备用提取 __NEXT_DATA__ 节点
//     const nextDataEl = document.getElementById('__NEXT_DATA__');
//     if (nextDataEl) {
//       const parsed = JSON.parse(nextDataEl.textContent);
//       return parsed.props?.pageProps?.jobDetail || null;
//     }
//   } catch (err) {
//     console.error('解析智联预载数据失败:', err);
//   }
//   return null;
// }

// // DOM 加载完成后读取并推送给 content_scripts
// window.addEventListener('DOMContentLoaded', () => {
//   const detail = parseZhilianJobDetail();
//   if (detail) {
//     window.postMessage({ type: 'ZHILIAN_DETAIL_LOADED', data: detail }, '*');
//   }
// });
// // injected.js 代理 Fetch
// const originalFetch = window.fetch;
// window.fetch = async function (...args) {
//   const response = await originalFetch.apply(this, args);
//   const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;

//   // 拦截智联详情接口
//   if (url && url.includes('fe-api.zhaopin.com/c/i/jobs/detail')) {
//     try {
//       const cloneRes = response.clone();
//       cloneRes.json().then(resData => {
//         if (resData && resData.code === 200) {
//           console.log("zhilian",resData.data)
//           window.postMessage({
//             type: 'ZHILIAN_INTERCEPTED_DATA',
//             data: resData.data
//           }, '*');
//         }
//       });
//     } catch (e) {
//       console.error('拦截智联 API 解析失败:', e);
//     }
//   }

//   return response;
// };

//   const XHR = XMLHttpRequest.prototype;
//   const open = XHR.open;
//   const send = XHR.send;

//   XHR.open = function(method, url) {
//     this._url = url;
//     return open.apply(this, arguments);
//   };
//     XHR.send = function(body) {
//     this.addEventListener('load', function() {
//       if (this._url && this._url.includes('/api/job/detail-pc')) {
//         try {
//           const resData = JSON.parse(this.responseText);
//           console.log(resData)
//           // 通过 window.postMessage 发送给 content.js
//           window.postMessage({
//             type: '51JOB_Hook',
//             site: "51job",
//             data: resData
//           }, '*');
//         } catch (e) {}
//       }
//     });
//     // window.postMessage({ type: 'JOB_HOOK_DETAIL', site: "51job", data: detail }, '*');
//     return send.apply(this, arguments);
//   };

//   function notifyList(list) {
//     if (!Array.isArray(list) || list.length === 0) return;
//     window.postMessage({ type: 'JOB_HOOK_LIST', site: SITE, data: list }, '*');
//   }

//   function notifyDetail(detail) {
//     if (!detail) return;
//     if (!detail.matchKey) {
//       // ⚡ 以前这里直接 return，静默丢弃。现在至少留个诊断痕迹，
//       //    并且如果捕获窗口开着，就把它归属给当前点击的卡片。
//       if (activeCapture) {
//         detail = { ...detail, matchKey: activeCapture.cardId, source: 'Click-Correlated Fallback' };
//         diag('详情缺少 matchKey，按点击相关性归属给', activeCapture.cardId);
//       } else {
//         diag('⚠️ 拿到详情但没有 matchKey，且没有捕获窗口，只能丢弃');
//         return;
//       }
//     }
//     window.postMessage({ type: 'JOB_HOOK_DETAIL', site: SITE, data: detail }, '*');
//   }

//   // ---------------------------------------------------------------------
//   // 4. LinkedIn / generic 的内容特征扫描（沿用上一版思路）
//   // ---------------------------------------------------------------------
//   const LINKEDIN_PAYLOAD_HINT = /fsd_jobPosting|jobPostingUrn|"description":\s*\{\s*"text"/;

//   function extractJobIdFromUrn(urn) {
//     if (typeof urn !== 'string') return null;
//     const m = urn.match(/(?:fsd_jobPosting|jobPosting):(\d+)/);
//     return m ? m[1] : null;
//   }

//   function scanLinkedInPayloadForJobPosting(node, results, seen, depth = 0) {
//     if (!node || typeof node !== 'object' || seen.has(node) || depth > 8) return;
//     seen.add(node);
//     const entityUrn = node.entityUrn || node['*entityUrn'] || node.jobPostingUrn || '';
//     const jobId = extractJobIdFromUrn(entityUrn) || (node.jobPostingId ? String(node.jobPostingId) : null);
//     const rawDesc = typeof node.description === 'string'
//       ? node.description
//       : (node.description && typeof node.description.text === 'string' ? node.description.text : '');
//     if (jobId && rawDesc) results.push({ matchKey: jobId, title: node.title || '', rawDesc: htmlToText(rawDesc) });
//     for (const key in node) {
//       if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
//       const val = node[key];
//       if (val && typeof val === 'object') scanLinkedInPayloadForJobPosting(val, results, seen, depth + 1);
//     }
//   }

//   // ---------------------------------------------------------------------
//   // 5. 统一响应处理入口
//   // ---------------------------------------------------------------------
//   function handleResponse(url, payloadText, payloadObj) {
//     let json = payloadObj;
//     if (!json) {
//       if (!payloadText || payloadText.length < 50) return;
//       // 便宜的预筛，避免对每个响应都 JSON.parse
//       if (payloadText[0] !== '{' && payloadText[0] !== '[') return;
//       try { json = JSON.parse(payloadText); } catch (e) { return; }
//     }
//     if (!json || typeof json !== 'object') return;

//     // ---- 诊断：把疑似职位相关的响应打出来，帮你定位真实接口 ----
//     if (window.__jdpDiag) {
//       const probe = findBestJdTextInPayload(json);
//       if (probe) {
//         diag('疑似含 JD 正文的响应:', { url, 字段名: probe.key, 分数: probe.score, 前120字: probe.text.slice(0, 120) });
//       }
//     }

//     // ---- BOSS 专属规则优先 ----
//     if (SITE === 'boss') {
//       if (BOSS_LIST_URL.test(url)) {
//         const list = json?.zpData?.jobList;
//         if (list) { diag('命中列表接口', url, '条数', list.length); notifyList(list); }
//       }
//       // URL 命中 或 payload 结构命中（换路径也不会失效）
//       if (BOSS_DETAIL_URL.test(url) || json?.zpData?.jobInfo) {
//         const detail = parseBossDetail(json, url);
//         if (detail) {
//           diag('命中详情接口', url, 'matchKey =', detail.matchKey);
//           notifyDetail(detail);
//           return;
//         }
//       }
//     }

//     if (SITE === 'linkedin' && LINKEDIN_PAYLOAD_HINT.test(payloadText || JSON.stringify(json).slice(0, 20000))) {
//       const results = [];
//       scanLinkedInPayloadForJobPosting(json, results, new Set());
//       results.forEach((r) => notifyDetail({ matchKey: r.matchKey, title: r.title, ...parseJdSmart(r.rawDesc) }));
//       if (results.length) return;
//     }

//     // ---- 51job：搜索列表接口自带完整描述，逐条解析、逐条通知 ----
//     if (SITE === '51job') {
//       // 诊断：不管 URL 匹不匹配，只要是 51job 站点、响应体看起来像 JSON
//       // 且体积不小，就把 URL 打出来——用来确认 XHR/fetch 钩子本身有没有
//       // 拦到这个请求，以及实际 URL 跟我们写的正则是不是真的对得上
//       // （很可能有查询参数顺序不同、或者域名/路径跟你在 Network 面板
//       // 看到的不完全一致这类细节差异）。
//       if (window.__jdpDiag && url && JSON.stringify(json).length > 500) {
//         diag('51job响应经过handleResponse', url, '| 匹配search-pc正则:', FIFTYONEJOB_SEARCH_URL.test(url));
//       }
//       if (FIFTYONEJOB_SEARCH_URL.test(url)) {
//         const items = parseFiftyOneJobList(json);
//         if (window.__jdpDiag) {
//           diag('search-pc响应结构', { 'Resultbody存在': !!json?.Resultbody, 'job存在': !!json?.Resultbody?.job, 'items是数组': Array.isArray(json?.Resultbody?.job?.items), '解析出条数': items.length });
//         }
//         if (items.length) {
//           diag('命中51job搜索接口', url, '条数', items.length, '有matchKey的', items.filter(i => i.matchKey).length);
//           items.forEach((it) => {
//             if (!it.matchKey) return; // 没有可用ID的条目匹配不回具体卡片，跳过不通知，避免脏数据
//             notifyDetail({ matchKey: it.matchKey, title: it.title, ...parseJdSmart(it.rawDesc) });
//           });
//           return;
//         }
//       }
//     }

//     // ---- 通用兜底：点击相关性捕获（所有站点都适用，包括 BOSS 规则没命中时）----
//     offerToCapture(json);
//   }

//   // ---------------------------------------------------------------------
//   // 6. Hook XHR —— ⚡ 修复 responseType 导致的静默失效
//   // ---------------------------------------------------------------------
//   const origOpen = XMLHttpRequest.prototype.open;
//   const origSend = XMLHttpRequest.prototype.send;

//   XMLHttpRequest.prototype.open = function (method, url) {
//     this.__hookUrl = url;
//     return origOpen.apply(this, arguments);
//   };

//   XMLHttpRequest.prototype.send = function () {
//     this.addEventListener('load', function () {
//       try {
//         const url = this.responseURL || this.__hookUrl || '';
//         const rt = this.responseType;
//         // ⚡ 关键修复：responseText 只在 responseType 为 '' 或 'text' 时可读，
//         // 其它情况（尤其是 'json'）读它会抛 DOMException，被 catch 吞掉后
//         // 表现为"拦截装了但永远不触发"。这里按类型分别取值。
//         if (rt === '' || rt === 'text') {
//           handleResponse(url, this.responseText, null);
//         } else if (rt === 'json') {
//           handleResponse(url, null, this.response);
//         }
//         // 'blob'/'arraybuffer'/'document' 不是 JSON 接口，直接忽略
//       } catch (e) {
//         diag('XHR 响应处理异常(已忽略):', e && e.message);
//       }
//     });
//     return origSend.apply(this, arguments);
//   };

//   // ---------------------------------------------------------------------
//   // 7. Hook fetch
//   // ---------------------------------------------------------------------
//   const origFetch = window.fetch;
//   if (typeof origFetch === 'function') {
//     window.fetch = function (input, init) {
//       const url = typeof input === 'string' ? input : (input && input.url) || '';
//       return origFetch.apply(this, arguments).then((res) => {
//         try {
//           res.clone().text().then((text) => handleResponse(url, text, null)).catch(() => {});
//         } catch (e) {}
//         return res;
//       });
//     };
//   }

//   // ---------------------------------------------------------------------
//   // 8. BOSS 首屏 SSR 数据
//   // ---------------------------------------------------------------------
//   if (SITE === 'boss') {
//     try {
//       if (window.__INITIAL_STATE__?.jobList) notifyList(window.__INITIAL_STATE__.jobList);
//     } catch (e) {}
//   }

//   // ---------------------------------------------------------------------
//   // 9. 主动兜底通道（保持原有行为不变）
//   // ---------------------------------------------------------------------
//   function getLinkedInCsrfToken() {
//     const m = document.cookie.match(/JSESSIONID="?([^";]+)"?/);
//     return m ? m[1] : '';
//   }

//   async function directFetchDetail(matchKey, meta) {
//     if (SITE === 'linkedin') {
//       const csrfToken = getLinkedInCsrfToken();
//       if (!csrfToken) return null;
//       try {
//         const res = await fetch(`https://www.linkedin.com/voyager/api/jobs/jobPostings/${matchKey}`, {
//           method: 'GET',
//           headers: {
//             'csrf-token': csrfToken,
//             'x-restli-protocol-version': '2.0.0',
//             'accept': 'application/vnd.linkedin.normalized+json+2.0.0, application/json, text/plain, */*',
//             'x-li-lang': 'zh_CN'
//           }
//         });
//         if (!res.ok) return null;
//         const json = await res.json();
//         // console.log("injected",json?.description?.text);
//         const rawDesc = htmlToText(json?.description?.text || (typeof json?.description === 'string' ? json.description : ''));
//         console.log("injected",parseJdSmart(rawDesc));
//         return { matchKey: String(matchKey), title: json?.title || '', ...parseJdSmart(rawDesc) };
//       } catch (e) { return null; }
//     }

//     if (SITE === 'boss') {
//       const securityId = matchKey;
//       const lid = meta?.lid || '';
//       if (!securityId) return null;
//       try {
//         const apiUrl = `/wapi/zpgeek/job/detail.json?securityId=${encodeURIComponent(securityId)}&lid=${encodeURIComponent(lid)}`;
//         const res = await fetch(apiUrl, {
//           headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, text/plain, */*' }
//         });
//         if (!res.ok) return null;
//         const json = await res.json();
//         return parseBossDetail(json, apiUrl);
//       } catch (e) { return null; }
//     }
//     return null;
//   }

//   document.addEventListener('REQ_DIRECT_FETCH_JOB', async (e) => {
//     const { matchKey, meta, requestId } = e.detail || {};
//     const data = await directFetchDetail(matchKey, meta);
//     document.dispatchEvent(new CustomEvent('RESP_DIRECT_FETCH_JOB', { detail: { requestId, matchKey, data } }));
//   });

//   document.documentElement.dataset.injectReady = 'true';
//   document.dispatchEvent(new CustomEvent('INJECT_SCRIPT_READY'));
//   console.log(`✅ [injected.js] (${SITE}) 挂载完成。排查拦截问题请在控制台执行: window.__jdpDiag = true`);
// })();


// // /**
// //  * ==============================================================================
// //  * injected.js — 运行在页面主环境 (MAIN World)
// //  *
// //  * 本版相对上一版的关键修复与新增：
// //  *   [修复] XHR hook 读 responseText 在 responseType='json'/'blob' 时会抛
// //  *          DOMException，被 catch 静默吞掉 → 拦截永远不触发（"只有直接请求，
// //  *          没有拦截"的根因）。现在按 responseType 分支取值。
// //  *   [修复] BOSS 详情接口 URL 从写死 /job/detail.json 放宽成多模式匹配，
// //  *          并保留"内容形状"兜底，避免站点换路径就全线失效。
// //  *   [修复] matchKey 取不到时不再静默丢弃，走多级兜底（URL → payload → 点击相关性）。
// //  *   [新增] 诊断模式：把流经的、疑似职位相关的 JSON 响应打到控制台，
// //  *          让你能直接看到 BOSS 真实的详情接口叫什么、字段长什么样。
// //  *   [新增] 通用"点击相关性捕获"：content.js 点击前开一个捕获窗口，窗口内
// //  *          出现的 JD 形状响应直接归属给刚点击的那张卡——不需要知道站点的
// //  *          ID 字段名/位置，这是真正站点无关的机制。
// //  * ==============================================================================
// //  */
// // (function () {
// //   'use strict';
// //   if (window.__jobHookInjected) return;
// //   window.__jobHookInjected = true;

// //   // ---------------------------------------------------------------------
// //   // 0. 站点识别 & 诊断开关
// //   // ---------------------------------------------------------------------
// //   const SITE = location.host.includes('zhipin.com')
// //     ? 'boss'
// //     : location.host.includes('linkedin.com')
// //       ? 'linkedin'
// //       : 'generic';

// //   // 诊断模式：控制台执行 window.__jdpDiag = true 即可打开（不用改代码重装插件），
// //   // 打开后会把所有"疑似职位相关"的响应 URL + 字段结构打出来。
// //   // 排查"到底哪个接口才是详情接口"时非常有用。
// //   const diag = (...args) => { if (window.__jdpDiag) console.log('%c[JDP-DIAG]', 'color:#0a66c2;font-weight:bold', ...args); };
// //   window.__jdpDiag = window.__jdpDiag || false;

// //   // ---------------------------------------------------------------------
// //   // 1. JD 文本解析（与 content.js 保持同一套语义，避免两边结果不一致）
// //   // ---------------------------------------------------------------------
// //   // ============================================================================
// //   // 优化版 parseJdSmart —— 针对 LinkedIn / Indeed 英文 JD "照单全收" 的问题
// //   //
// //   // 四个改动：
// //   //  [根因] normalizeAndMergeLines 会把不带冒号的英文小标题并进下一行，
// //   //         标题特征被彻底破坏 → 打分全军覆没 → 退化成"全文塞进 responsibilities"。
// //   //         现在识别到"疑似小标题"的行一律不参与合并。
// //   //  [词表] 按真实 JD 写作规范扩充（Essential Duties / Basic Qualifications /
// //   //         What You'll Bring / Nice-to-Haves 等），并区分 required vs preferred。
// //   //  [新增] 停止小节(STOP_SECTIONS)：Benefits / EEO / About Us 这类尾部样板段落
// //   //         以前会被并进最后一个小节，现在遇到即截断。
// //   //  [判定] 英文标题的结构特征另算：Title Case / ALL CAPS / 独立短行 / 后接列表。
// //   // ============================================================================

// //   // ============================================================================
// //   // 合并版 JD 解析：DOM 有状态遍历(element 感知打分) + 文本兜底
// //   //
// //   // 架构取自你的 parseJdSmartMultiSignal：按渲染顺序遍历块 → 遇标题切换当前小节 →
// //   // 其余内容归入当前小节。这个结构比"先压成文本再按位置切片"更好，因为打分时
// //   // element 还在手上，className/id/tagName 都能用。
// //   //
// //   // 在此基础上修掉三个实测失分点，并补上纯文本路径：
// //   //   [修] \b 对中文无效 + 全角冒号未处理 → 中文标题一个都识别不出
// //   //   [修] 无停止小节 → Benefits/EEO/公司介绍 一路污染最后一个小节
// //   //   [修] unspecified(前言) 被丢弃 → 岗位概述整段消失
// //   //   [补] parseJdSmartText：API 返回的是 JSON/纯文本时没有 DOM，必须有这条路
// //   // ============================================================================

// //   // ============================================================================
// //   // 合并版 JD 解析：DOM 有状态遍历(element 感知打分) + 文本兜底
// //   //
// //   // 架构取自你的 parseJdSmartMultiSignal：按渲染顺序遍历块 → 遇标题切换当前小节 →
// //   // 其余内容归入当前小节。这个结构比"先压成文本再按位置切片"更好，因为打分时
// //   // element 还在手上，className/id/tagName 都能用。
// //   //
// //   // 在此基础上修掉三个实测失分点，并补上纯文本路径：
// //   //   [修] \b 对中文无效 + 全角冒号未处理 → 中文标题一个都识别不出
// //   //   [修] 无停止小节 → Benefits/EEO/公司介绍 一路污染最后一个小节
// //   //   [修] unspecified(前言) 被丢弃 → 岗位概述整段消失
// //   //   [补] parseJdSmartText：API 返回的是 JSON/纯文本时没有 DOM，必须有这条路
// //   // ============================================================================

// //   // ============================================================================
// //   // 合并版 JD 解析：DOM 有状态遍历(element 感知打分) + 文本兜底
// //   //
// //   // 架构取自你的 parseJdSmartMultiSignal：按渲染顺序遍历块 → 遇标题切换当前小节 →
// //   // 其余内容归入当前小节。这个结构比"先压成文本再按位置切片"更好，因为打分时
// //   // element 还在手上，className/id/tagName 都能用。
// //   //
// //   // 在此基础上修掉三个实测失分点，并补上纯文本路径：
// //   //   [修] \b 对中文无效 + 全角冒号未处理 → 中文标题一个都识别不出
// //   //   [修] 无停止小节 → Benefits/EEO/公司介绍 一路污染最后一个小节
// //   //   [修] unspecified(前言) 被丢弃 → 岗位概述整段消失
// //   //   [补] parseJdSmartText：API 返回的是 JSON/纯文本时没有 DOM，必须有这条路
// //   // ============================================================================

// //   const SECTION_VOCAB = [
// //     {
// //       type: 'responsibilities',
// //       tiers: [
// //         { weight: 50, phrases: ['岗位职责','工作职责','职责描述','主要职责','工作内容','岗位描述','职位描述',
// //             'Responsibilities','Key Responsibilities','Primary Responsibilities','Core Responsibilities',
// //             'Duties and Responsibilities','Essential Duties','Essential Functions','Essential Job Functions','Key Accountabilities','Responsibility','职位职责','工作内容及职责'] },
// //         { weight: 40, phrases: ["What you'll do",'What you will do',"What You'll Be Doing",'About the Role',
// //             'About this Role','About the job','Role Overview','Role Summary','Job Summary','Job Purpose',
// //             'The Role','Your Impact','Duties','你将负责','主要工作','主要负责','负责内容'] },
// //         { weight: 25, phrases: ['职责','Tasks','任务'] },
// //       ],
// //     },
// //     {
// //       type: 'requirements',
// //       tiers: [
// //         { weight: 50, phrases: ['任职要求','任职资格','岗位要求','招聘条件','职位要求','能力要求','岗位条件',
// //             'Requirements','Qualifications','Job Requirements','Basic Qualifications','Minimum Qualifications',
// //             'Required Qualifications','Key Qualifications','Skills and Qualifications','Education and Experience','Requirement','Qualification','技能要求','能力要求'] },
// //         { weight: 40, phrases: ["What we're looking for",'What we are looking for','Who You Are',
// //             "What You'll Bring",'What You Bring','Skills & Experience','Required Skills','Must Have','Must-haves',
// //             '你需要具备','我们需要你'] },
// //         { weight: 25, phrases: ['要求','资格','Skills'] },
// //       ],
// //     },
// //     {
// //       type: 'bonus',
// //       tiers: [
// //         { weight: 50, phrases: ['加分项','优先条件','优先考虑','加分技能',
// //             'Preferred Qualifications','Additional Qualifications','Preferred Experience','Preferred Skills',
// //             'Nice to have','Nice-to-haves','Bonus Points','Desirable Skills'] },
// //         { weight: 40, phrases: ['具备以下者优先','有以下经验优先','Bonus points if you have','A plus if','An asset','Desirable'] },
// //         { weight: 25, phrases: ['加分','Preferred'] },
// //       ],
// //     },
// //   ];

// //   // 停止小节：命中即结束正文收集，后面的内容全部丢弃
// //   const STOP_SECTIONS = [
// //     '福利待遇','薪资福利','公司简介','关于我们','企业文化','工作地点','投递方式','我们提供',
// //     'Benefits','What We Offer','Perks','Perks and Benefits','Compensation','Salary','Pay Range',
// //     'Working Conditions','Work Environment','Physical Requirements',
// //     'EEO Statement','Equal Opportunity','Equal Employment Opportunity','EEO',
// //     'About Us','About the Company','Our Story','Our Mission','Why Join Us','Who We Are',
// //     'How to Apply','Application Process','Next Steps','Disclaimer','Legal',
// //   ];

// //   // ⚡ 归一化：把真实页面里的各种写法变体收敛到同一形态再匹配。
// //   // 实测这一步能解决一大半漏判——弯引号、全角括号、连字符/&、多余空白。
// //   function normalizeForMatch(s) {
// //     return String(s || '')
// //       .replace(/[\u2018\u2019\u02bc]/g, "'")      // 弯引号 → 直引号
// //       .replace(/[\u201c\u201d]/g, '"')
// //       .replace(/[\u2010-\u2015\u2212]/g, '-')      // 各种破折号 → 连字符
// //       .replace(/[（）]/g, (m) => (m === '（' ? '(' : ')'))
// //       .replace(/\s*&\s*/g, ' and ')                // & → and
// //       .replace(/-/g, ' ')                          // 连字符与空格等价
// //       .replace(/\s+/g, ' ')
// //       .trim()
// //       .toLowerCase();
// //   }

// //   // 中文短语足够独特（"岗位职责"几乎不可能出现在非标题语境的正文短行里），
// //   // 直接用包含匹配，不再要求特定的前后缀字符——之前要求前缀必须是空白/项目符号，
// //   // 导致"一、岗位职责""1.岗位职责""（一）岗位职责"这类编号标题全部漏判。
// //   function matchPhrase(normText, phrase) {
// //     const p = normalizeForMatch(phrase);
// //     if (/[\u4e00-\u9fa5]/.test(p)) return normText.includes(p);
// //     // 英文：词边界匹配，并容忍词尾复数
// //     const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// //     return new RegExp(`(?:^|\\b)${esc}(?:e?s)?(?:\\b|[:：]|$)`, 'i').test(normText);
// //   }

// //   // ⚡ 核心词正则（你提的思路）：词表覆盖不到的写法用"含核心词"兜底。
// //   // 权重压得低，单独出现过不了阈值，必须叠加排版/DOM 证据才成立——
// //   // 这样既能捞回"主要负责""职位职责"这类变体，又不会把正文里提到
// //   // "负责"的普通句子误判成标题。
// //   const CORE_PATTERNS = [
// //     { type: 'responsibilities', weight: 22, re: /(职责|负责|工作内容|responsibilit|duties|what you.{0,4}(ll|will) do)/i },
// //     { type: 'requirements',     weight: 22, re: /(要求|资格|条件|qualificat|requirement|what (we|you).{0,4}(re |ll )?(looking|bring|have))/i },
// //     { type: 'bonus',            weight: 22, re: /(加分|优先|preferred|nice to have|bonus|desirable|a plus)/i },
// //   ];

// //   // 最长匹配优先：解决 "Preferred Qualifications" 被 "Qualifications" 抢走
// //   // 判成 requirements 的问题（同权重时，命中的短语越长越具体，应该赢）。
// //   function matchVocab(text) {
// //     const normText = normalizeForMatch(text);
// //     let best = { type: null, keywordScore: 0, len: 0 };
// //     for (const cfg of SECTION_VOCAB) {
// //       for (const tier of cfg.tiers) {
// //         for (const p of tier.phrases) {
// //           if (!matchPhrase(normText, p)) continue;
// //           const len = normalizeForMatch(p).length;
// //           if (tier.weight > best.keywordScore || (tier.weight === best.keywordScore && len > best.len)) {
// //             best = { type: cfg.type, keywordScore: tier.weight, len };
// //           }
// //         }
// //       }
// //     }
// //     if (!best.type) {
// //       for (const c of CORE_PATTERNS) {
// //         if (c.re.test(normText) && c.weight > best.keywordScore) {
// //           best = { type: c.type, keywordScore: c.weight, len: 0 };
// //         }
// //       }
// //     }
// //     return best;
// //   }

// //   function isStopSection(text) {
// //     const t = text.trim().replace(/[:：\s]+$/, '').toLowerCase();
// //     return STOP_SECTIONS.some((w) => t === w.toLowerCase());
// //   }

// //   // ---------------------------------------------------------------------------
// //   // 多维打分：DOM 维度 + 排版维度 + 语义维度
// //   // ---------------------------------------------------------------------------
// //   function assessSectionHeader(element, text) {
// //     const isCJKText = /[\u4e00-\u9fa5]/.test(text);

// //     // 一票否决：项目符号开头的绝不是标题
// //     if (/^[*•▪◦●\-–]\s+/.test(text)) return { isHeader: false, score: 0, type: null };

// //     // ⚡ 数字编号不再一律否决。"1.岗位职责" 是标题，"1.负责推荐算法设计" 是列表项，
// //     // 两者的区别不在编号而在长度：标题短、列表项长。以前一刀切否决，导致中文
// //     // JD 里极常见的 "1.岗位职责" "2.任职资格" 全被判成列表项而漏掉。
// //     const numbered = /^\d+[.、)）]\s*\S/.test(text) || /^[一二三四五六七八九十]+[、.]\s*\S/.test(text);
// //     const bare = text.replace(/^[（(]?[\d一二三四五六七八九十]+[）)]?[.、)）]?\s*/, '');
// //     if (numbered && bare.length > (isCJKText ? 12 : 30)) {
// //       return { isHeader: false, score: 0, type: null };
// //     }

// //     let domScore = 0;
// //     if (element && element.tagName) {
// //       const tag = element.tagName.toLowerCase();
// //       // className 在 SVG 元素上是对象，统一转字符串
// //       const cls = typeof element.className === 'string' ? element.className : (element.getAttribute?.('class') || '');
// //       const idName = element.id || '';
// //       if (/^h[1-3]$/.test(tag)) domScore += 35;
// //       else if (/^h[4-6]$/.test(tag)) domScore += 25;
// //       else if (tag === 'b' || tag === 'strong') domScore += 20;
// //       else if (tag === 'dt') domScore += 20;
// //       // ⚡ class/id 语义信号——这是纯文本路径拿不到的证据，也是不同平台
// //       // "职责和要求 class 不一样"时最可靠的线索
// //       if (/header|title|section|heading|caption|label|subtitle/i.test(cls + ' ' + idName)) domScore += 30;
// //       // 反向信号：一看就是正文/描述容器
// //       if (/(desc|content|body|text|paragraph)/i.test(cls + ' ' + idName) && !/title|header|heading/i.test(cls + ' ' + idName)) domScore -= 10;
// //     }

// //     let layoutScore = 0;
// //     const isCJK = isCJKText;
// //     if (/[:：]\s*$/.test(text)) layoutScore += 25;
// //     if (text.length <= (isCJK ? 20 : 40)) layoutScore += 20;
// //     if (!isCJK && text === text.toUpperCase() && /[A-Z]{3,}/.test(text)) layoutScore += 18;
// //     if (/[.。]$/.test(text) && !/[:：]$/.test(text)) layoutScore -= 20;
// //     if (text.length > (isCJK ? 40 : 80)) layoutScore -= 40;
// //     // 叙述句特征
// //     if (/(?:we\s+are|you\s+will|our\s+team|looking\s+for\s+a|我们正在|如果你)/i.test(text) && text.length > 30) layoutScore -= 35;

// //     const { type, keywordScore } = matchVocab(text);
// //     const totalScore = domScore + layoutScore + keywordScore;
// //     const headingLen = isCJKText ? 22 : 50;
// //     const isHeader = (totalScore >= 60 && keywordScore > 0)
// //       || (domScore >= 35 && keywordScore >= 25 && text.length <= headingLen);
// //     return { isHeader, type, score: totalScore };
// //   }

// //   // ---------------------------------------------------------------------------
// //   // 按渲染顺序拆块。相比原版修了两处：
// //   //   - <li> 单独成块（原版 UL 的子元素是 LI，不在 some() 的标签清单里，
// //   //     导致整个 UL 被当成一个叶子块，所有列表项糊成一坨）
// //   //   - 直系文本节点不再丢失（原版 else 分支只遍历 element.children）
// //   // ---------------------------------------------------------------------------
// //   const LEAFY = /^(P|LI|H[1-6]|DT|DD|TD|TH|BLOCKQUOTE)$/i;
// //   const CONTAINER = /^(DIV|SECTION|ARTICLE|UL|OL|DL|TABLE|TBODY|TR|MAIN|SPAN|BODY)$/i;

// //   function getVisualTextBlocks(node) {
// //     const blocks = [];
// //     const walk = (el) => {
// //       if (!el || !el.tagName) return;
// //       const tag = el.tagName;
// //       if (/^(SCRIPT|STYLE|NOSCRIPT|SVG)$/i.test(tag)) return;

// //       if (LEAFY.test(tag)) {
// //         const t = (el.textContent || '').trim();
// //         if (t) blocks.push({ element: el, text: t });
// //         return;
// //       }
// //       if (/^(H[1-6]|STRONG|B)$/i.test(tag)) {
// //         const t = (el.textContent || '').trim();
// //         if (t) blocks.push({ element: el, text: t });
// //         return;
// //       }
// //       if (CONTAINER.test(tag)) {
// //         // 先看有没有值得下钻的子元素；没有就把自己整体作为一块
// //         const hasElementChild = el.children && el.children.length > 0;
// //         if (!hasElementChild) {
// //           const t = (el.textContent || '').trim();
// //           if (t) blocks.push({ element: el, text: t });
// //           return;
// //         }
// //         // 有子元素：逐个 childNode 处理，直系文本节点也要保留（原版会丢）
// //         for (const child of Array.from(el.childNodes)) {
// //           if (child.nodeType === 3) { // TEXT_NODE
// //             const t = (child.nodeValue || '').trim();
// //             if (t) blocks.push({ element: el, text: t });
// //           } else if (child.nodeType === 1) {
// //             walk(child);
// //           }
// //         }
// //         return;
// //       }
// //       // 其它标签(如 <a>/<em>)：并入父级由父级处理，这里只兜底取文本
// //       const t = (el.textContent || '').trim();
// //       if (t) blocks.push({ element: el, text: t });
// //     };
// //     walk(node);
// //     return blocks;
// //   }

// //   // ---------------------------------------------------------------------------
// //   // 主入口（DOM 路径）
// //   // ---------------------------------------------------------------------------
// //   function parseJdFromDom(containerNode) {
// //     const blocks = getVisualTextBlocks(containerNode);
// //     const buckets = { intro: [], responsibilities: [], requirements: [], bonus: [] };
// //     let current = 'intro'; // ⚡ 第一个标题之前的内容不再丢弃，归入 intro

// //     for (const { element, text } of blocks) {
// //       const t = text.trim();
// //       if (!t) continue;

// //       // 停止小节：只认"看起来像标题"的短行，且必须已经进入过真实小节
// //       // （开头的 About Us / 公司简介 是开场白，不是结尾样板）
// //       if (current !== 'intro' && t.length <= 40 && isStopSection(t)) break;

// //       const a = assessSectionHeader(element, t);
// //       if (a.isHeader && a.type) { current = a.type; continue; }
// //       buckets[current].push(t);
// //     }

// //     // intro 并入 responsibilities 前部（岗位概述本质上属于"做什么"）
// //     const resp = [...buckets.intro, ...buckets.responsibilities].join('\n').trim();
// //     return {
// //       responsibilities: resp,
// //       requirements: buckets.requirements.join('\n').trim(),
// //       bonus: buckets.bonus.join('\n').trim(),
// //       fullCleanText: blocks.map((b) => b.text).join('\n').trim(),
// //     };
// //   }

// //   // ---------------------------------------------------------------------------
// //   // 纯文本路径（API/JSON 返回时没有 DOM，这条必须保留）
// //   // 复用同一套词表和停止小节，保证两条路结论一致。
// //   // ---------------------------------------------------------------------------
// //   function looksLikeHeadingLine(s) {
// //     s = s.trim();
// //     if (!s || s.length > 60) return false;
// //     if (/^##\s/.test(s) || /[:：]$/.test(s) || /^【.+】$/.test(s) || /^#+\s/.test(s)) return true;
// //     const isCJK = /[\u4e00-\u9fa5]/.test(s);
// //     if (!isCJK && s.length <= 45 && !/[.!?]$/.test(s)) {
// //       if (s === s.toUpperCase() && /[A-Z]{3,}/.test(s)) return true;
// //       const w = s.split(/\s+/);
// //       const small = ['a','an','the','and','or','of','to','for','in','you','we','your','our','will','be','with'];
// //       if (w.length <= 6 && w.every((x) => !/^[a-z]/.test(x) || small.includes(x.toLowerCase()))) return true;
// //     }
// //     return isCJK && s.length <= 20 && !/[。！？]$/.test(s);
// //   }

// //   function normalizeAndMergeLines(text) {
// //     const lines = text.split('\n');
// //     const bullet = /^([•▪◦●\-*]|[\d一二三四五六七八九十]+[.、)）])\s*/;
// //     const out = [];
// //     for (const raw of lines) {
// //       const line = raw.trim();
// //       if (!line) { out.push(''); continue; }
// //       const prev = out[out.length - 1];
// //       const canMerge = prev
// //         && !bullet.test(line) && !looksLikeHeadingLine(line)
// //         && !/[。！？.!?:：；;]$/.test(prev) && !bullet.test(prev) && !looksLikeHeadingLine(prev)
// //         && /^[a-z(,;)]/.test(line); // 只有小写开头才算折行续写
// //       if (canMerge) out[out.length - 1] = prev + ' ' + line;
// //       else out.push(line);
// //     }
// //     return out.filter(Boolean).join('\n');
// //   }

// //   function parseJdFromText(rawText) {
// //     const result = { responsibilities: '', requirements: '', bonus: '', fullCleanText: '' };
// //     if (!rawText || typeof rawText !== 'string') return result;
// //     const text = normalizeAndMergeLines(
// //       rawText.replace(/\r\n?/g, '\n').replace(/\u3000/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
// //     );
// //     result.fullCleanText = text.replace(/^##\s+/gm, '');

// //     const buckets = { intro: [], responsibilities: [], requirements: [], bonus: [] };
// //     let current = 'intro';
// //     for (const raw of text.split('\n')) {
// //       const t = raw.trim();
// //       if (!t) continue;
// //       const bare = t.replace(/^##\s+/, '');
// //       // ⚡ 停止小节只在"已经进入过真实小节"之后才生效。JD 以 "About Us"/"公司简介"
// //       // 开头极其常见，那是开场介绍标题，不是结尾样板；以前一律 break，导致
// //       // 整份 JD 从第一行就被丢弃，最后靠兜底把全文塞进职责（表现为完全不切分）。
// //       if (current !== 'intro' && bare.length <= 40 && isStopSection(bare)) break;

// //       // ⚡ 统一走标定过的 assessSectionHeader（element 传 null 即纯文本+排版+语义）。
// //       // 之前这里是另一套弱判定（looksLikeHeadingLine + keywordScore>=15），
// //       // 阈值远低于 DOM 路径，结果把 "1、负责推荐算法的设计" 这种列表项当成标题
// //       // 吞掉，正文反而丢了。两条路必须共用同一套判定，结论才会一致。
// //       const a = assessSectionHeader(null, bare);
// //       if (a.isHeader && a.type) { current = a.type; continue; }
// //       buckets[current].push(bare);
// //     }
// //     result.responsibilities = [...buckets.intro, ...buckets.responsibilities].join('\n').trim();
// //     result.requirements = buckets.requirements.join('\n').trim();
// //     result.bonus = buckets.bonus.join('\n').trim();
// //     if (!result.responsibilities && !result.requirements && !result.bonus) {
// //       result.responsibilities = result.fullCleanText;
// //     }
// //     return result;
// //   }

// //   // 统一入口：有 DOM 走 DOM，没有就走文本
// //   function parseJdSmart(input) {
// //     if (input && typeof input === 'object' && input.nodeType === 1) return parseJdFromDom(input);
// //     return parseJdFromText(String(input || ''));
// //   }

// //   // HTML 正文清洗：BOSS 的 postDescription 有时带 <br>/&nbsp; 等实体
// //   function htmlToText(html) {
// //     if (!html || typeof html !== 'string') return '';
// //     if (!/[<&]/.test(html)) return html;
// //     return html
// //       .replace(/<\s*br\s*\/?\s*>/gi, '\n')
// //       .replace(/<\s*\/\s*(p|div|li|tr)\s*>/gi, '\n')
// //       .replace(/<[^>]+>/g, '')
// //       .replace(/&nbsp;/gi, ' ')
// //       .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
// //       .replace(/&amp;/g, '&').replace(/&quot;/g, '"');
// //   }

// //   // ---------------------------------------------------------------------
// //   // 2. 通用："点击相关性捕获窗口"
// //   //    content.js 在模拟点击前派发 REQ_BEGIN_CAPTURE，我们打开一个短窗口；
// //   //    窗口内任何"形状像 JD"的响应，直接归属给刚点击的那张卡片。
// //   //    这样就不需要从 payload 里猜 ID 字段名——这是能真正跨站点复用的关键。
// //   // ---------------------------------------------------------------------
// //   let activeCapture = null; // { cardId, startedAt, best: {score, detail} | null }

// //   document.addEventListener('REQ_BEGIN_CAPTURE', (e) => {
// //     const { cardId } = e.detail || {};
// //     if (!cardId) return;
// //     activeCapture = { cardId: String(cardId), startedAt: Date.now(), best: null };
// //     diag('捕获窗口已开启, cardId =', cardId);
// //   });

// //   document.addEventListener('REQ_END_CAPTURE', () => {
// //     if (!activeCapture) return;
// //     // 窗口关闭时，如果期间攒到了候选，把得分最高的那个作为该卡片的详情发出去
// //     if (activeCapture.best) {
// //       diag('捕获窗口关闭，采用最佳候选, score =', activeCapture.best.score);
// //       window.postMessage({
// //         type: 'JOB_HOOK_DETAIL', site: SITE,
// //         data: { ...activeCapture.best.detail, matchKey: activeCapture.cardId, source: 'Click-Correlated Capture' }
// //       }, '*');
// //     }
// //     activeCapture = null;
// //   });

// //   // JD 形状打分：文本越长、越命中 JD 关键词、越像自然语言，分越高。
// //   // 用来在捕获窗口内出现多个候选时挑出最像职位详情的那一个，
// //   // 也用来把埋点/推荐位这类"碰巧也很长"的响应排除掉。
// //   const JD_KEYWORD_PATTERN = /(岗位职责|工作职责|任职要求|任职资格|岗位要求|职位描述|工作内容|加分项|Responsibilities|Requirements|Qualifications|Job\s+Description|What\s+you.{0,10}do)/gi;

// //   function scoreJdText(text) {
// //     if (!text || text.length < 150) return 0;
// //     const kwHits = (text.match(JD_KEYWORD_PATTERN) || []).length;
// //     const hasSentences = /[。！？.!?]/.test(text);
// //     if (!kwHits && !hasSentences) return 0;

// //     // ⚡ 提高识别度：除了关键词命中，再叠加几个"这看起来确实是 JD 正文"的结构特征。
// //     // 目的是把"碰巧很长的自然语言"（公司简介、用户协议、推荐位文案）跟真正的
// //     // 职位描述区分开——JD 的典型形态是"分条列举的要求/职责"。
// //     let structureBonus = 0;
// //     // 项目符号/编号列表：JD 几乎必有
// //     const bulletLines = (text.match(/(?:^|\n)\s*(?:[•·▪●\-*]|\d+[.、)）])\s*\S/g) || []).length;
// //     if (bulletLines >= 3) structureBonus += 120;
// //     else if (bulletLines >= 1) structureBonus += 40;
// //     // 年限/学历/技能这类硬性要求措辞
// //     if (/(\d+\s*[-~到]?\s*\d*\s*年(以上)?(工作)?经验|本科|硕士|博士|大专|years?\s+of\s+experience|bachelor|master's|degree)/i.test(text)) structureBonus += 80;
// //     // 负面信号：明显是公司介绍/协议条款而不是岗位描述
// //     if (/(公司简介|关于我们|企业文化|发展历程|隐私政策|用户协议|Cookie|About\s+Us|Privacy\s+Policy|Terms\s+of\s+Service)/i.test(text)
// //         && kwHits === 0) structureBonus -= 150;

// //     return Math.min(kwHits, 5) * 100 + Math.min(text.length, 4000) * 0.05 + structureBonus;
// //   }

// //   // 递归找 payload 里最像 JD 正文的那个字符串字段
// //   function findBestJdTextInPayload(node, depth = 0, seen = new Set()) {
// //     if (!node || typeof node !== 'object' || depth > 6 || seen.has(node)) return null;
// //     seen.add(node);
// //     let best = null;
// //     for (const key in node) {
// //       if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
// //       const val = node[key];
// //       if (typeof val === 'string') {
// //         const text = htmlToText(val);
// //         const score = scoreJdText(text);
// //         if (score > 0 && (!best || score > best.score)) {
// //           best = { score, text, key, container: node };
// //         }
// //       } else if (val && typeof val === 'object') {
// //         const sub = findBestJdTextInPayload(val, depth + 1, seen);
// //         if (sub && (!best || sub.score > best.score)) best = sub;
// //       }
// //     }
// //     return best;
// //   }

// //   const TITLE_LIKE_KEYS = ['jobName', 'title', 'jobTitle', 'positionName', 'name', 'headline'];
// //   function guessTitle(container) {
// //     if (!container) return '';
// //     for (const k of TITLE_LIKE_KEYS) {
// //       if (typeof container[k] === 'string' && container[k].length < 100) return container[k];
// //     }
// //     return '';
// //   }

// //   // 捕获窗口内的候选收集：不立刻发出，先攒着比分数，窗口关闭时发最佳的那个
// //   // ⚡ 高置信度候选立刻发出，不等窗口关闭。
// //   // 之前的设计是"窗口内攒着，REQ_END_CAPTURE 时发最佳的那个"——但 content.js
// //   // 侧的 REQ_END_CAPTURE 是在 finalize() 里派发的，而 finalize() 只在已经
// //   // resolve/超时时才跑，等于候选永远晚一拍，network 这个源在观察窗口内根本
// //   // 没机会赢，白白掉到更慢的 pageFetch。现在改成：分数够高(明显就是 JD)就
// //   // 立即发出，让等待中的 Promise 当场接住；分数不够高的才留到窗口关闭时兜底。
// //   const CONFIDENT_SCORE = 260; // 约等于"命中 2 个以上 JD 关键词 + 有列表结构"

// //   function offerToCapture(json) {
// //     if (!activeCapture) return false;
// //     const best = findBestJdTextInPayload(json);
// //     if (!best) return false;

// //     const detail = { title: guessTitle(best.container), ...parseJdSmart(best.text) };

// //     if (best.score >= CONFIDENT_SCORE) {
// //       diag('捕获窗口内命中高置信度候选，立即发出, score =', best.score, 'key =', best.key);
// //       window.postMessage({
// //         type: 'JOB_HOOK_DETAIL', site: SITE,
// //         data: { ...detail, matchKey: activeCapture.cardId, source: 'Click-Correlated Capture' }
// //       }, '*');
// //       activeCapture.best = null; // 已经发过了，窗口关闭时不用再发一遍
// //       return true;
// //     }

// //     if (activeCapture.best && activeCapture.best.score >= best.score) return true;
// //     activeCapture.best = { score: best.score, detail };
// //     diag('捕获窗口内收到低置信度候选(暂存), score =', best.score, 'key =', best.key);
// //     return true;
// //   }

// //   // ---------------------------------------------------------------------
// //   // 3. BOSS 专属规则（优先级最高，因为字段结构确定，解析最准）
// //   // ---------------------------------------------------------------------
// //   // ⚡ URL 放宽：不再写死 /job/detail.json。BOSS 换路径/换域名前缀的情况很常见，
// //   //    这里覆盖常见几种，再由 payload 结构做二次确认（zpData.jobInfo 存在才算数）。
// //   const BOSS_DETAIL_URL = /\/(job\/detail|jobdetail|job\/card|geek\/job\/detail)\.json/i;
// //   const BOSS_LIST_URL = /\/(joblist|job\/list|geek\/joblist)\.json/i;

// //   function parseBossDetail(json, url) {
// //     const jobInfo = json?.zpData?.jobInfo;
// //     if (!jobInfo) return null;

// //     // matchKey 多级兜底：URL query 的 securityId 最可靠（跟 content.js 发起
// //     // 点击时用的是同一个值），其次 payload 里的各种 id，最后交给点击相关性。
// //     let matchKey = '';
// //     try { matchKey = new URL(url, location.origin).searchParams.get('securityId') || ''; } catch (e) {}
// //     if (!matchKey) matchKey = jobInfo.encryptJobId || jobInfo.encryptId || jobInfo.securityId || '';
// //     if (!matchKey && activeCapture) matchKey = activeCapture.cardId;

// //     const rawDesc = htmlToText(jobInfo.postDescription || '');
// //     return {
// //       matchKey,
// //       title: jobInfo.jobName || '',
// //       salary: jobInfo.salaryDesc || '',
// //       company: json.zpData.brandComInfo?.brandName || '',
// //       location: jobInfo.locationName || '',
// //       ...parseJdSmart(rawDesc)
// //     };
// //   }

// //   function notifyList(list) {
// //     if (!Array.isArray(list) || list.length === 0) return;
// //     window.postMessage({ type: 'JOB_HOOK_LIST', site: SITE, data: list }, '*');
// //   }

// //   function notifyDetail(detail) {
// //     if (!detail) return;
// //     if (!detail.matchKey) {
// //       // ⚡ 以前这里直接 return，静默丢弃。现在至少留个诊断痕迹，
// //       //    并且如果捕获窗口开着，就把它归属给当前点击的卡片。
// //       if (activeCapture) {
// //         detail = { ...detail, matchKey: activeCapture.cardId, source: 'Click-Correlated Fallback' };
// //         diag('详情缺少 matchKey，按点击相关性归属给', activeCapture.cardId);
// //       } else {
// //         diag('⚠️ 拿到详情但没有 matchKey，且没有捕获窗口，只能丢弃');
// //         return;
// //       }
// //     }
// //     window.postMessage({ type: 'JOB_HOOK_DETAIL', site: SITE, data: detail }, '*');
// //   }

// //   // ---------------------------------------------------------------------
// //   // 4. LinkedIn / generic 的内容特征扫描（沿用上一版思路）
// //   // ---------------------------------------------------------------------
// //   const LINKEDIN_PAYLOAD_HINT = /fsd_jobPosting|jobPostingUrn|"description":\s*\{\s*"text"/;

// //   function extractJobIdFromUrn(urn) {
// //     if (typeof urn !== 'string') return null;
// //     const m = urn.match(/(?:fsd_jobPosting|jobPosting):(\d+)/);
// //     return m ? m[1] : null;
// //   }

// //   function scanLinkedInPayloadForJobPosting(node, results, seen, depth = 0) {
// //     if (!node || typeof node !== 'object' || seen.has(node) || depth > 8) return;
// //     seen.add(node);
// //     const entityUrn = node.entityUrn || node['*entityUrn'] || node.jobPostingUrn || '';
// //     const jobId = extractJobIdFromUrn(entityUrn) || (node.jobPostingId ? String(node.jobPostingId) : null);
// //     const rawDesc = typeof node.description === 'string'
// //       ? node.description
// //       : (node.description && typeof node.description.text === 'string' ? node.description.text : '');
// //     if (jobId && rawDesc) results.push({ matchKey: jobId, title: node.title || '', rawDesc: htmlToText(rawDesc) });
// //     for (const key in node) {
// //       if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
// //       const val = node[key];
// //       if (val && typeof val === 'object') scanLinkedInPayloadForJobPosting(val, results, seen, depth + 1);
// //     }
// //   }

// //   // ---------------------------------------------------------------------
// //   // 5. 统一响应处理入口
// //   // ---------------------------------------------------------------------
// //   function handleResponse(url, payloadText, payloadObj) {
// //     let json = payloadObj;
// //     if (!json) {
// //       if (!payloadText || payloadText.length < 50) return;
// //       // 便宜的预筛，避免对每个响应都 JSON.parse
// //       if (payloadText[0] !== '{' && payloadText[0] !== '[') return;
// //       try { json = JSON.parse(payloadText); } catch (e) { return; }
// //     }
// //     if (!json || typeof json !== 'object') return;

// //     // ---- 诊断：把疑似职位相关的响应打出来，帮你定位真实接口 ----
// //     if (window.__jdpDiag) {
// //       const probe = findBestJdTextInPayload(json);
// //       if (probe) {
// //         diag('疑似含 JD 正文的响应:', { url, 字段名: probe.key, 分数: probe.score, 前120字: probe.text.slice(0, 120) });
// //       }
// //     }

// //     // ---- BOSS 专属规则优先 ----
// //     if (SITE === 'boss') {
// //       if (BOSS_LIST_URL.test(url)) {
// //         const list = json?.zpData?.jobList;
// //         if (list) { diag('命中列表接口', url, '条数', list.length); notifyList(list); }
// //       }
// //       // URL 命中 或 payload 结构命中（换路径也不会失效）
// //       if (BOSS_DETAIL_URL.test(url) || json?.zpData?.jobInfo) {
// //         const detail = parseBossDetail(json, url);
// //         if (detail) {
// //           diag('命中详情接口', url, 'matchKey =', detail.matchKey);
// //           notifyDetail(detail);
// //           return;
// //         }
// //       }
// //     }

// //     if (SITE === 'linkedin' && LINKEDIN_PAYLOAD_HINT.test(payloadText || JSON.stringify(json).slice(0, 20000))) {
// //       const results = [];
// //       scanLinkedInPayloadForJobPosting(json, results, new Set());
// //       results.forEach((r) => notifyDetail({ matchKey: r.matchKey, title: r.title, ...parseJdSmart(r.rawDesc) }));
// //       if (results.length) return;
// //     }

// //     // ---- 通用兜底：点击相关性捕获（所有站点都适用，包括 BOSS 规则没命中时）----
// //     offerToCapture(json);
// //   }

// //   // ---------------------------------------------------------------------
// //   // 6. Hook XHR —— ⚡ 修复 responseType 导致的静默失效
// //   // ---------------------------------------------------------------------
// //   const origOpen = XMLHttpRequest.prototype.open;
// //   const origSend = XMLHttpRequest.prototype.send;

// //   XMLHttpRequest.prototype.open = function (method, url) {
// //     this.__hookUrl = url;
// //     return origOpen.apply(this, arguments);
// //   };

// //   XMLHttpRequest.prototype.send = function () {
// //     this.addEventListener('load', function () {
// //       try {
// //         const url = this.responseURL || this.__hookUrl || '';
// //         const rt = this.responseType;
// //         // ⚡ 关键修复：responseText 只在 responseType 为 '' 或 'text' 时可读，
// //         // 其它情况（尤其是 'json'）读它会抛 DOMException，被 catch 吞掉后
// //         // 表现为"拦截装了但永远不触发"。这里按类型分别取值。
// //         if (rt === '' || rt === 'text') {
// //           handleResponse(url, this.responseText, null);
// //         } else if (rt === 'json') {
// //           handleResponse(url, null, this.response);
// //         }
// //         // 'blob'/'arraybuffer'/'document' 不是 JSON 接口，直接忽略
// //       } catch (e) {
// //         diag('XHR 响应处理异常(已忽略):', e && e.message);
// //       }
// //     });
// //     return origSend.apply(this, arguments);
// //   };

// //   // ---------------------------------------------------------------------
// //   // 7. Hook fetch
// //   // ---------------------------------------------------------------------
// //   const origFetch = window.fetch;
// //   if (typeof origFetch === 'function') {
// //     window.fetch = function (input, init) {
// //       const url = typeof input === 'string' ? input : (input && input.url) || '';
// //       return origFetch.apply(this, arguments).then((res) => {
// //         try {
// //           res.clone().text().then((text) => handleResponse(url, text, null)).catch(() => {});
// //         } catch (e) {}
// //         return res;
// //       });
// //     };
// //   }

// //   // ---------------------------------------------------------------------
// //   // 8. BOSS 首屏 SSR 数据
// //   // ---------------------------------------------------------------------
// //   if (SITE === 'boss') {
// //     try {
// //       if (window.__INITIAL_STATE__?.jobList) notifyList(window.__INITIAL_STATE__.jobList);
// //     } catch (e) {}
// //   }

// //   // ---------------------------------------------------------------------
// //   // 9. 主动兜底通道（保持原有行为不变）
// //   // ---------------------------------------------------------------------
// //   function getLinkedInCsrfToken() {
// //     const m = document.cookie.match(/JSESSIONID="?([^";]+)"?/);
// //     return m ? m[1] : '';
// //   }

// //   async function directFetchDetail(matchKey, meta) {
// //     if (SITE === 'linkedin') {
// //       const csrfToken = getLinkedInCsrfToken();
// //       if (!csrfToken) return null;
// //       try {
// //         const res = await fetch(`https://www.linkedin.com/voyager/api/jobs/jobPostings/${matchKey}`, {
// //           method: 'GET',
// //           headers: {
// //             'csrf-token': csrfToken,
// //             'x-restli-protocol-version': '2.0.0',
// //             'accept': 'application/vnd.linkedin.normalized+json+2.0.0, application/json, text/plain, */*',
// //             'x-li-lang': 'zh_CN'
// //           }
// //         });
// //         if (!res.ok) return null;
// //         const json = await res.json();
// //         const rawDesc = htmlToText(json?.description?.text || (typeof json?.description === 'string' ? json.description : ''));
// //         return { matchKey: String(matchKey), title: json?.title || '', ...parseJdSmart(rawDesc) };
// //       } catch (e) { return null; }
// //     }

// //     if (SITE === 'boss') {
// //       const securityId = matchKey;
// //       const lid = meta?.lid || '';
// //       if (!securityId) return null;
// //       try {
// //         const apiUrl = `/wapi/zpgeek/job/detail.json?securityId=${encodeURIComponent(securityId)}&lid=${encodeURIComponent(lid)}`;
// //         const res = await fetch(apiUrl, {
// //           headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, text/plain, */*' }
// //         });
// //         if (!res.ok) return null;
// //         const json = await res.json();
// //         return parseBossDetail(json, apiUrl);
// //       } catch (e) { return null; }
// //     }
// //     return null;
// //   }

// //   document.addEventListener('REQ_DIRECT_FETCH_JOB', async (e) => {
// //     const { matchKey, meta, requestId } = e.detail || {};
// //     const data = await directFetchDetail(matchKey, meta);
// //     document.dispatchEvent(new CustomEvent('RESP_DIRECT_FETCH_JOB', { detail: { requestId, matchKey, data } }));
// //   });

// //   document.documentElement.dataset.injectReady = 'true';
// //   document.dispatchEvent(new CustomEvent('INJECT_SCRIPT_READY'));
// //   console.log(`✅ [injected.js] (${SITE}) 挂载完成。排查拦截问题请在控制台执行: window.__jdpDiag = true`);
// // })();
// /**
//  * ==============================================================================
//  * injected.js — 运行在页面主环境 (MAIN World)
//  *
//  * 本版相对上一版的关键修复与新增：
//  *   [修复] XHR hook 读 responseText 在 responseType='json'/'blob' 时会抛
//  *          DOMException，被 catch 静默吞掉 → 拦截永远不触发（"只有直接请求，
//  *          没有拦截"的根因）。现在按 responseType 分支取值。
//  *   [修复] BOSS 详情接口 URL 从写死 /job/detail.json 放宽成多模式匹配，
//  *          并保留"内容形状"兜底，避免站点换路径就全线失效。
//  *   [修复] matchKey 取不到时不再静默丢弃，走多级兜底（URL → payload → 点击相关性）。
//  *   [新增] 诊断模式：把流经的、疑似职位相关的 JSON 响应打到控制台，
//  *          让你能直接看到 BOSS 真实的详情接口叫什么、字段长什么样。
//  *   [新增] 通用"点击相关性捕获"：content.js 点击前开一个捕获窗口，窗口内
//  *          出现的 JD 形状响应直接归属给刚点击的那张卡——不需要知道站点的
//  *          ID 字段名/位置，这是真正站点无关的机制。
//  * ==============================================================================
//  */
// (function () {
//   'use strict';
//   if (window.__jobHookInjected) return;
//   window.__jobHookInjected = true;

//   // ---------------------------------------------------------------------
//   // 0. 站点识别 & 诊断开关
//   // ---------------------------------------------------------------------
//   const SITE = location.host.includes('zhipin.com')
//     ? 'boss'
//     : location.host.includes('linkedin.com')
//       ? 'linkedin'
//       : (location.host.includes('zhaopin.com') || location.host.includes('zhilian.com'))
//         ? 'zhaopin'
//       : 'generic';

//   // 诊断模式：控制台执行 window.__jdpDiag = true 即可打开（不用改代码重装插件），
//   // 打开后会把所有"疑似职位相关"的响应 URL + 字段结构打出来。
//   // 排查"到底哪个接口才是详情接口"时非常有用。
//   const diag = (...args) => { if (window.__jdpDiag) console.log('%c[JDP-DIAG]', 'color:#0a66c2;font-weight:bold', ...args); };
//   window.__jdpDiag = window.__jdpDiag || false;

//   // ---------------------------------------------------------------------
//   // 1. JD 文本解析（与 content.js 保持同一套语义，避免两边结果不一致）
//   // ---------------------------------------------------------------------
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


  

//   const SECTION_VOCAB = [
//     {
//       type: 'responsibilities',
//       tiers: [
//         { weight: 50, phrases: ['岗位职责','工作职责','职责描述','主要职责','工作内容','岗位描述','职位描述',
//             'Responsibilities','Key Responsibilities','Primary Responsibilities','Core Responsibilities',
//             'Duties and Responsibilities','Essential Duties','Essential Functions','Essential Job Functions','Key Accountabilities','Responsibility','职位职责','工作内容及职责'] },
//         { weight: 40, phrases: ["What you'll do",'What you will do',"What You'll Be Doing",'About the Role',
//             'About this Role','About the job','Role Overview','Role Summary','Job Summary','Job Purpose',
//             'The Role','Your Impact','Duties','你将负责','主要工作','主要负责','负责内容'] },
//         { weight: 25, phrases: ['职责','Tasks','任务'] },
//       ],
//     },
//     {
//       type: 'requirements',
//       tiers: [
//         { weight: 50, phrases: ['任职要求','任职资格','岗位要求','招聘条件','职位要求','能力要求','岗位条件',
//             'Requirements','Qualifications','Job Requirements','Basic Qualifications','Minimum Qualifications',
//             'Required Qualifications','Key Qualifications','Skills and Qualifications','Education and Experience','Requirement','Qualification','技能要求','能力要求'] },
//         { weight: 40, phrases: ["What we're looking for",'What we are looking for','Who You Are',
//             "What You'll Bring",'What You Bring','Skills & Experience','Required Skills','Must Have','Must-haves',
//             '你需要具备','我们需要你'] },
//         { weight: 25, phrases: ['要求','资格','Skills'] },
//       ],
//     },
//     {
//       type: 'bonus',
//       tiers: [
//         { weight: 50, phrases: ['加分项','优先条件','优先考虑','加分技能',
//             'Preferred Qualifications','Additional Qualifications','Preferred Experience','Preferred Skills',
//             'Nice to have','Nice-to-haves','Bonus Points','Desirable Skills'] },
//         { weight: 40, phrases: ['具备以下者优先','有以下经验优先','Bonus points if you have','A plus if','An asset','Desirable'] },
//         { weight: 25, phrases: ['加分','Preferred'] },
//       ],
//     },
//   ];

//   // 停止小节：命中即结束正文收集，后面的内容全部丢弃
//   const STOP_SECTIONS = [
//     '福利待遇','薪资福利','公司简介','关于我们','企业文化','工作地点','投递方式','我们提供',
//     'Benefits','What We Offer','Perks','Perks and Benefits','Compensation','Salary','Pay Range',
//     'Working Conditions','Work Environment','Physical Requirements',
//     'EEO Statement','Equal Opportunity','Equal Employment Opportunity','EEO',
//     'About Us','About the Company','Our Story','Our Mission','Why Join Us','Who We Are',
//     'How to Apply','Application Process','Next Steps','Disclaimer','Legal',
//   ];

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
//   //  function parseJdSmart(input) {
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


//   function parseJdSmart(input) {
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
//   // HTML 正文清洗：BOSS 的 postDescription 有时带 <br>/&nbsp; 等实体
//   function htmlToText(html) {
//     if (!html || typeof html !== 'string') return '';
//     if (!/[<&]/.test(html)) return html;
//     return html
//       .replace(/<\s*br\s*\/?\s*>/gi, '\n')
//       .replace(/<\s*\/\s*(p|div|li|tr)\s*>/gi, '\n')
//       .replace(/<[^>]+>/g, '')
//       .replace(/&nbsp;/gi, ' ')
//       .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
//       .replace(/&amp;/g, '&').replace(/&quot;/g, '"');
//   }

//   // ---------------------------------------------------------------------
//   // 2. 通用："点击相关性捕获窗口"
//   //    content.js 在模拟点击前派发 REQ_BEGIN_CAPTURE，我们打开一个短窗口；
//   //    窗口内任何"形状像 JD"的响应，直接归属给刚点击的那张卡片。
//   //    这样就不需要从 payload 里猜 ID 字段名——这是能真正跨站点复用的关键。
//   // ---------------------------------------------------------------------
//   let activeCapture = null; // { cardId, startedAt, best: {score, detail} | null }

//   document.addEventListener('REQ_BEGIN_CAPTURE', (e) => {
//     const { cardId } = e.detail || {};
//     if (!cardId) return;
//     activeCapture = { cardId: String(cardId), startedAt: Date.now(), best: null };
//     diag('捕获窗口已开启, cardId =', cardId);
//   });

//   document.addEventListener('REQ_END_CAPTURE', () => {
//     if (!activeCapture) return;
//     // 窗口关闭时，如果期间攒到了候选，把得分最高的那个作为该卡片的详情发出去
//     if (activeCapture.best) {
//       diag('捕获窗口关闭，采用最佳候选, score =', activeCapture.best.score);
//       window.postMessage({
//         type: 'JOB_HOOK_DETAIL', site: SITE,
//         data: { ...activeCapture.best.detail, matchKey: activeCapture.cardId, source: 'Click-Correlated Capture' }
//       }, '*');
//     }
//     activeCapture = null;
//   });

//   // JD 形状打分：文本越长、越命中 JD 关键词、越像自然语言，分越高。
//   // 用来在捕获窗口内出现多个候选时挑出最像职位详情的那一个，
//   // 也用来把埋点/推荐位这类"碰巧也很长"的响应排除掉。
//   const JD_KEYWORD_PATTERN = /(岗位职责|工作职责|任职要求|任职资格|岗位要求|职位描述|工作内容|加分项|Responsibilities|Requirements|Qualifications|Job\s+Description|What\s+you.{0,10}do)/gi;

//   function scoreJdText(text) {
//     if (!text || text.length < 150) return 0;
//     const kwHits = (text.match(JD_KEYWORD_PATTERN) || []).length;
//     const hasSentences = /[。！？.!?]/.test(text);
//     if (!kwHits && !hasSentences) return 0;

//     // ⚡ 提高识别度：除了关键词命中，再叠加几个"这看起来确实是 JD 正文"的结构特征。
//     // 目的是把"碰巧很长的自然语言"（公司简介、用户协议、推荐位文案）跟真正的
//     // 职位描述区分开——JD 的典型形态是"分条列举的要求/职责"。
//     let structureBonus = 0;
//     // 项目符号/编号列表：JD 几乎必有
//     const bulletLines = (text.match(/(?:^|\n)\s*(?:[•·▪●\-*]|\d+[.、)）])\s*\S/g) || []).length;
//     if (bulletLines >= 3) structureBonus += 120;
//     else if (bulletLines >= 1) structureBonus += 40;
//     // 年限/学历/技能这类硬性要求措辞
//     if (/(\d+\s*[-~到]?\s*\d*\s*年(以上)?(工作)?经验|本科|硕士|博士|大专|years?\s+of\s+experience|bachelor|master's|degree)/i.test(text)) structureBonus += 80;
//     // 负面信号：明显是公司介绍/协议条款而不是岗位描述
//     if (/(公司简介|关于我们|企业文化|发展历程|隐私政策|用户协议|Cookie|About\s+Us|Privacy\s+Policy|Terms\s+of\s+Service)/i.test(text)
//         && kwHits === 0) structureBonus -= 150;

//     return Math.min(kwHits, 5) * 100 + Math.min(text.length, 4000) * 0.05 + structureBonus;
//   }

//   // 递归找 payload 里最像 JD 正文的那个字符串字段
//   function findBestJdTextInPayload(node, depth = 0, seen = new Set()) {
//     if (!node || typeof node !== 'object' || depth > 6 || seen.has(node)) return null;
//     seen.add(node);
//     let best = null;
//     for (const key in node) {
//       if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
//       const val = node[key];
//       if (typeof val === 'string') {
//         const text = htmlToText(val);
//         const score = scoreJdText(text);
//         if (score > 0 && (!best || score > best.score)) {
//           best = { score, text, key, container: node };
//         }
//       } else if (val && typeof val === 'object') {
//         const sub = findBestJdTextInPayload(val, depth + 1, seen);
//         if (sub && (!best || sub.score > best.score)) best = sub;
//       }
//     }
//     return best;
//   }

//   const TITLE_LIKE_KEYS = ['jobName', 'title', 'jobTitle', 'positionName', 'name', 'headline'];
//   function guessTitle(container) {
//     if (!container) return '';
//     for (const k of TITLE_LIKE_KEYS) {
//       if (typeof container[k] === 'string' && container[k].length < 100) return container[k];
//     }
//     return '';
//   }

//   // 捕获窗口内的候选收集：不立刻发出，先攒着比分数，窗口关闭时发最佳的那个
//   // ⚡ 高置信度候选立刻发出，不等窗口关闭。
//   // 之前的设计是"窗口内攒着，REQ_END_CAPTURE 时发最佳的那个"——但 content.js
//   // 侧的 REQ_END_CAPTURE 是在 finalize() 里派发的，而 finalize() 只在已经
//   // resolve/超时时才跑，等于候选永远晚一拍，network 这个源在观察窗口内根本
//   // 没机会赢，白白掉到更慢的 pageFetch。现在改成：分数够高(明显就是 JD)就
//   // 立即发出，让等待中的 Promise 当场接住；分数不够高的才留到窗口关闭时兜底。
//   const CONFIDENT_SCORE = 260; // 约等于"命中 2 个以上 JD 关键词 + 有列表结构"

//   function offerToCapture(json) {
//     if (!activeCapture) return false;
//     const best = findBestJdTextInPayload(json);
//     if (!best) return false;

//     const detail = { title: guessTitle(best.container), ...parseJdSmart(best.text) };

//     if (best.score >= CONFIDENT_SCORE) {
//       diag('捕获窗口内命中高置信度候选，立即发出, score =', best.score, 'key =', best.key);
//       window.postMessage({
//         type: 'JOB_HOOK_DETAIL', site: SITE,
//         data: { ...detail, matchKey: activeCapture.cardId, source: 'Click-Correlated Capture' }
//       }, '*');
//       activeCapture.best = null; // 已经发过了，窗口关闭时不用再发一遍
//       return true;
//     }

//     if (activeCapture.best && activeCapture.best.score >= best.score) return true;
//     activeCapture.best = { score: best.score, detail };
//     diag('捕获窗口内收到低置信度候选(暂存), score =', best.score, 'key =', best.key);
//     return true;
//   }

//   // ---------------------------------------------------------------------
//   // 3. BOSS 专属规则（优先级最高，因为字段结构确定，解析最准）
//   // ---------------------------------------------------------------------
//   // ⚡ URL 放宽：不再写死 /job/detail.json。BOSS 换路径/换域名前缀的情况很常见，
//   //    这里覆盖常见几种，再由 payload 结构做二次确认（zpData.jobInfo 存在才算数）。
//   const BOSS_DETAIL_URL = /\/(job\/detail|jobdetail|job\/card|geek\/job\/detail)\.json/i;
//   const BOSS_LIST_URL = /\/(joblist|job\/list|geek\/joblist)\.json/i;
//   const ZHAOPIN_DETAIL_URL = /(?:^|\/\/)fe-api\.zhaopin\.com\/c\/i\/jobs\/detail|\/c\/i\/jobs\/detail/i;
//   const ZHAOPIN_LIST_URL = /(?:^|\/\/)fe-api\.zhaopin\.com\/c\/i\/(?:search|jobs|position|positions)|\/c\/i\/jobs\/search|\/sou\/result/i;
//   const ZHAOPIN_ID_KEYS = ['number', 'jobNumber', 'job_number', 'jobId', 'jobID', 'jobid', 'positionId', 'positionID', 'positionNumber', 'position_number'];
//   const ZHAOPIN_TITLE_KEYS = ['jobName', 'name', 'title', 'jobTitle', 'positionName'];
//   const ZHAOPIN_DESC_KEYS = ['jobDesc', 'jobDescription', 'description', 'describe', 'positionDesc', 'positionDetail', 'responsibility', 'jobDetail', 'details', 'content'];
//   const ZHAOPIN_SALARY_KEYS = ['salaryDesc', 'salary', 'salaryReal', 'salary60', 'salaryName'];
//   const ZHAOPIN_COMPANY_KEYS = ['companyName', 'brandName', 'company', 'companyInfo', 'companyDTO'];
//   const ZHAOPIN_LOCATION_KEYS = ['cityName', 'workCity', 'city', 'cityDisplay', 'areaDistrict', 'workAddress', 'location'];

//   function zhaopinValueToText(value) {
//     if (value == null) return '';
//     if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
//     if (Array.isArray(value)) return value.map(zhaopinValueToText).filter(Boolean).join(' ').trim();
//     if (typeof value === 'object') {
//       for (const key of ['display', 'name', 'value', 'text', 'label', 'content', 'title']) {
//         const text = zhaopinValueToText(value[key]);
//         if (text) return text;
//       }
//     }
//     return '';
//   }

//   function findZhaopinValueByKeys(node, keys, depth = 0, seen = new Set()) {
//     if (!node || typeof node !== 'object' || depth > 5 || seen.has(node)) return '';
//     seen.add(node);
//     for (const key of keys) {
//       if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
//       const text = zhaopinValueToText(node[key]);
//       if (text) return text;
//     }
//     for (const key in node) {
//       if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
//       const value = node[key];
//       if (!value || typeof value !== 'object') continue;
//       const text = findZhaopinValueByKeys(value, keys, depth + 1, seen);
//       if (text) return text;
//     }
//     return '';
//   }

//   function unwrapZhaopinData(json) {
//     return json?.data?.jobDetail
//       || json?.data?.jobInfo
//       || json?.data?.detail
//       || json?.data
//       || json?.result?.data
//       || json?.result
//       || json;
//   }

//   function extractZhaopinMatchKey(data, url, fallbackMatchKey = '') {
//     if (fallbackMatchKey) return String(fallbackMatchKey);
//     try {
//       const params = new URL(url, location.origin).searchParams;
//       for (const key of ZHAOPIN_ID_KEYS) {
//         const val = params.get(key);
//         if (val) return String(val);
//       }
//     } catch (e) {}
//     return findZhaopinValueByKeys(data, ZHAOPIN_ID_KEYS);
//   }

//   function parseZhaopinDetail(json, url, fallbackMatchKey = '') {
//     const dataRaw = unwrapZhaopinData(json);
//     if (!dataRaw) return null;
//     const data = typeof dataRaw === 'object' ? dataRaw : { description: String(dataRaw) };
//     const directDesc = findZhaopinValueByKeys(data, ZHAOPIN_DESC_KEYS);
//     const best = findBestJdTextInPayload(data);
//     const rawDesc = htmlToText(directDesc || best?.text || '');
//     if (!rawDesc || rawDesc.length < 50) return null;

//     const parsed = parseJdSmart(rawDesc);
//     if (!parsed.fullCleanText) parsed.fullCleanText = rawDesc;
//     if (!parsed.responsibilities && !parsed.requirements && parsed.fullCleanText) {
//       parsed.responsibilities = parsed.fullCleanText;
//     }

//     const realJobId = extractZhaopinMatchKey(data, url);
//     return {
//       matchKey: extractZhaopinMatchKey(data, url, fallbackMatchKey || realJobId),
//       jobId: realJobId || fallbackMatchKey,
//       number: realJobId || '',
//       title: findZhaopinValueByKeys(data, ZHAOPIN_TITLE_KEYS),
//       salary: findZhaopinValueByKeys(data, ZHAOPIN_SALARY_KEYS),
//       company: findZhaopinValueByKeys(data, ZHAOPIN_COMPANY_KEYS),
//       location: findZhaopinValueByKeys(data, ZHAOPIN_LOCATION_KEYS),
//       ...parsed
//     };
//   }

//   function normalizeZhaopinListItem(item) {
//     if (!item || typeof item !== 'object') return null;
//     const jobId = extractZhaopinMatchKey(item, '');
//     const jobName = findZhaopinValueByKeys(item, ZHAOPIN_TITLE_KEYS);
//     const salaryDesc = findZhaopinValueByKeys(item, ZHAOPIN_SALARY_KEYS);
//     const brandName = findZhaopinValueByKeys(item, ZHAOPIN_COMPANY_KEYS);
//     const cityName = findZhaopinValueByKeys(item, ZHAOPIN_LOCATION_KEYS);
//     if (!jobId || !jobName || !(salaryDesc || brandName || cityName)) return null;
//     return { jobId, number: jobId, jobName, salaryDesc, brandName, cityName };
//   }

//   function findZhaopinListItems(node, results = [], seen = new Set(), depth = 0) {
//     if (!node || typeof node !== 'object' || depth > 6 || seen.has(node)) return results;
//     seen.add(node);
//     if (Array.isArray(node)) {
//       const items = node.map(normalizeZhaopinListItem).filter(Boolean);
//       if (items.length >= 2) results.push(...items);
//       node.forEach((item) => findZhaopinListItems(item, results, seen, depth + 1));
//       return results;
//     }
//     for (const key in node) {
//       if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
//       const value = node[key];
//       if (value && typeof value === 'object') findZhaopinListItems(value, results, seen, depth + 1);
//     }
//     return results;
//   }

//   function parseBossDetail(json, url) {
//     const jobInfo = json?.zpData?.jobInfo;
//     if (!jobInfo) return null;

//     // matchKey 多级兜底：URL query 的 securityId 最可靠（跟 content.js 发起
//     // 点击时用的是同一个值），其次 payload 里的各种 id，最后交给点击相关性。
//     let matchKey = '';
//     try { matchKey = new URL(url, location.origin).searchParams.get('securityId') || ''; } catch (e) {}
//     if (!matchKey) matchKey = jobInfo.encryptJobId || jobInfo.encryptId || jobInfo.securityId || '';
//     if (!matchKey && activeCapture) matchKey = activeCapture.cardId;

//     const rawDesc = htmlToText(jobInfo.postDescription || '');
//     return {
//       matchKey,
//       title: jobInfo.jobName || '',
//       salary: jobInfo.salaryDesc || '',
//       company: json.zpData.brandComInfo?.brandName || '',
//       location: jobInfo.locationName || '',
//       ...parseJdSmart(rawDesc)
//     };
//   }

//   // injected.js (运行在 MAIN 作用域)

//   // injected.js (运行在 MAIN 作用域)
// function parseZhilianJobDetail() {
//   try {
//     // 1. 优先读取 __INITIAL_STATE__
//     if (window.__INITIAL_STATE__?.jobDetail?.jobDetail) {
//       return window.__INITIAL_STATE__.jobDetail.jobDetail;
//     }
//     if (window.__INITIAL_STATE__?.desc?.description) {
//       return { description: window.__INITIAL_STATE__.desc.description };
//     }
    
//     // 2. 备用提取 __NEXT_DATA__ 节点
//     const nextDataEl = document.getElementById('__NEXT_DATA__');
//     if (nextDataEl) {
//       const parsed = JSON.parse(nextDataEl.textContent);
//       return parsed.props?.pageProps?.jobDetail || null;
//     }
//   } catch (err) {
//     console.error('解析智联预载数据失败:', err);
//   }
//   return null;
// }

// // DOM 加载完成后读取并推送给 content_scripts
// window.addEventListener('DOMContentLoaded', () => {
//   const detail = parseZhilianJobDetail();
//   if (detail) {
//     const parsedDetail = SITE === 'zhaopin' ? parseZhaopinDetail({ data: detail }, location.href) : null;
//     if (parsedDetail) notifyDetail(parsedDetail);
//     else window.postMessage({ type: 'ZHILIAN_DETAIL_LOADED', site: 'zhaopin', data: detail }, '*');
//   }
// });
// // injected.js 代理 Fetch
// // const originalFetch = window.fetch;
// // window.fetch = async function (...args) {
// //   const response = await originalFetch.apply(this, args);
// //   const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;

// //   // 拦截智联详情接口
// //   if (url && url.includes('fe-api.zhaopin.com/c/i/jobs/detail')) {
// //     try {
// //       const cloneRes = response.clone();
// //       cloneRes.json().then(resData => {
// //         if (resData && resData.code === 200) {
// //           console.log("zhilian",resData.data)
// //           window.postMessage({
// //             type: 'ZHILIAN_INTERCEPTED_DATA',
// //             data: resData.data
// //           }, '*');
// //         }
// //       });
// //     } catch (e) {
// //       console.error('拦截智联 API 解析失败:', e);
// //     }
// //   }

// //   return response;
// // };

//   // const XHR = XMLHttpRequest.prototype;
//   // const open = XHR.open;
//   // const send = XHR.send;

//   // XHR.open = function(method, url) {
//   //   this._url = url;
//   //   return open.apply(this, arguments);
//   // };
//   //   XHR.send = function(body) {
//   //   this.addEventListener('load', function() {
//   //     if (this._url && this._url.includes('/api/job/detail-pc')) {
//   //       try {
//   //         const resData = JSON.parse(this.responseText);
//   //         console.log(resData)
//   //         // 通过 window.postMessage 发送给 content.js
//   //         window.postMessage({
//   //           type: '51JOB_Hook',
//   //           site: "51job",
//   //           data: resData
//   //         }, '*');
//   //       } catch (e) {}
//   //     }
//   //   });
//   //   // window.postMessage({ type: 'JOB_HOOK_DETAIL', site: "51job", data: detail }, '*');
//   //   return send.apply(this, arguments);
//   // };

//   function notifyList(list) {
//     if (!Array.isArray(list) || list.length === 0) return;
//     window.postMessage({ type: 'JOB_HOOK_LIST', site: SITE, data: list }, '*');
//   }

//   function notifyDetail(detail) {
//     if (!detail) return;
//     if (!detail.matchKey) {
//       // ⚡ 以前这里直接 return，静默丢弃。现在至少留个诊断痕迹，
//       //    并且如果捕获窗口开着，就把它归属给当前点击的卡片。
//       if (activeCapture) {
//         detail = { ...detail, matchKey: activeCapture.cardId, source: 'Click-Correlated Fallback' };
//         diag('详情缺少 matchKey，按点击相关性归属给', activeCapture.cardId);
//       } else {
//         diag('⚠️ 拿到详情但没有 matchKey，且没有捕获窗口，只能丢弃');
//         return;
//       }
//     }
//     window.postMessage({ type: 'JOB_HOOK_DETAIL', site: SITE, data: detail }, '*');
//   }

//   // ---------------------------------------------------------------------
//   // 4. LinkedIn / generic 的内容特征扫描（沿用上一版思路）
//   // ---------------------------------------------------------------------
//   const LINKEDIN_PAYLOAD_HINT = /fsd_jobPosting|jobPostingUrn|"description":\s*\{\s*"text"/;

//   function extractJobIdFromUrn(urn) {
//     if (typeof urn !== 'string') return null;
//     const m = urn.match(/(?:fsd_jobPosting|jobPosting):(\d+)/);
//     return m ? m[1] : null;
//   }

//   function scanLinkedInPayloadForJobPosting(node, results, seen, depth = 0) {
//     if (!node || typeof node !== 'object' || seen.has(node) || depth > 8) return;
//     seen.add(node);
//     const entityUrn = node.entityUrn || node['*entityUrn'] || node.jobPostingUrn || '';
//     const jobId = extractJobIdFromUrn(entityUrn) || (node.jobPostingId ? String(node.jobPostingId) : null);
//     const rawDesc = typeof node.description === 'string'
//       ? node.description
//       : (node.description && typeof node.description.text === 'string' ? node.description.text : '');
//     if (jobId && rawDesc) results.push({ matchKey: jobId, title: node.title || '', rawDesc: htmlToText(rawDesc) });
//     for (const key in node) {
//       if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
//       const val = node[key];
//       if (val && typeof val === 'object') scanLinkedInPayloadForJobPosting(val, results, seen, depth + 1);
//     }
//   }

//   // ---------------------------------------------------------------------
//   // 5. 统一响应处理入口
//   // ---------------------------------------------------------------------
//   function handleResponse(url, payloadText, payloadObj) {
//     let json = payloadObj;
//     if (!json) {
//       if (!payloadText || payloadText.length < 50) return;
//       // 便宜的预筛，避免对每个响应都 JSON.parse
//       if (payloadText[0] !== '{' && payloadText[0] !== '[') return;
//       try { json = JSON.parse(payloadText); } catch (e) { return; }
//     }
//     if (!json || typeof json !== 'object') return;

//     // ---- 诊断：把疑似职位相关的响应打出来，帮你定位真实接口 ----
//     if (window.__jdpDiag) {
//       const probe = findBestJdTextInPayload(json);
//       if (probe) {
//         diag('疑似含 JD 正文的响应:', { url, 字段名: probe.key, 分数: probe.score, 前120字: probe.text.slice(0, 120) });
//       }
//     }

//     // ---- BOSS 专属规则优先 ----
//     if (SITE === 'boss') {
//       if (BOSS_LIST_URL.test(url)) {
//         const list = json?.zpData?.jobList;
//         if (list) { diag('命中列表接口', url, '条数', list.length); notifyList(list); }
//       }
//       // URL 命中 或 payload 结构命中（换路径也不会失效）
//       if (BOSS_DETAIL_URL.test(url) || json?.zpData?.jobInfo) {
//         const detail = parseBossDetail(json, url);
//         if (detail) {
//           diag('命中详情接口', url, 'matchKey =', detail.matchKey);
//           notifyDetail(detail);
//           return;
//         }
//       }
//     }

//     if (SITE === 'zhaopin') {
//       if (ZHAOPIN_DETAIL_URL.test(url)) {
//         const detail = parseZhaopinDetail(json, url, activeCapture?.cardId);
//         if (detail) {
//           diag('命中智联详情接口', url, 'matchKey =', detail.matchKey, 'jobId =', detail.jobId);
//           notifyDetail(detail);
//           return;
//         }
//       }

//       if (ZHAOPIN_LIST_URL.test(url)) {
//         const items = findZhaopinListItems(json);
//         if (items.length) {
//           const uniq = [];
//           const seenJobIds = new Set();
//           items.forEach((item) => {
//             if (seenJobIds.has(item.jobId)) return;
//             seenJobIds.add(item.jobId);
//             uniq.push(item);
//           });
//           diag('命中智联列表接口', url, '条数', uniq.length);
//           notifyList(uniq);
//           return;
//         }
//       }
//     }

//     if (SITE === 'linkedin' && LINKEDIN_PAYLOAD_HINT.test(payloadText || JSON.stringify(json).slice(0, 20000))) {
//       const results = [];
//       scanLinkedInPayloadForJobPosting(json, results, new Set());
//       results.forEach((r) => notifyDetail({ matchKey: r.matchKey, title: r.title, ...parseJdSmart(r.rawDesc) }));
//       if (results.length) return;
//     }

//     // ---- 通用兜底：点击相关性捕获（所有站点都适用，包括 BOSS 规则没命中时）----
//     offerToCapture(json);
//   }

//   // ---------------------------------------------------------------------
//   // 6. Hook XHR —— ⚡ 修复 responseType 导致的静默失效
//   // ---------------------------------------------------------------------
//   const origOpen = XMLHttpRequest.prototype.open;
//   const origSend = XMLHttpRequest.prototype.send;

//   XMLHttpRequest.prototype.open = function (method, url) {
//     this.__hookUrl = url;
//     return origOpen.apply(this, arguments);
//   };

//   XMLHttpRequest.prototype.send = function () {
//     this.addEventListener('load', function () {
//       try {
//         const url = this.responseURL || this.__hookUrl || '';
//         const rt = this.responseType;
//         // ⚡ 关键修复：responseText 只在 responseType 为 '' 或 'text' 时可读，
//         // 其它情况（尤其是 'json'）读它会抛 DOMException，被 catch 吞掉后
//         // 表现为"拦截装了但永远不触发"。这里按类型分别取值。
//         if (rt === '' || rt === 'text') {
//           handleResponse(url, this.responseText, null);
//         } else if (rt === 'json') {
//           handleResponse(url, null, this.response);
//         }
//         // 'blob'/'arraybuffer'/'document' 不是 JSON 接口，直接忽略
//       } catch (e) {
//         diag('XHR 响应处理异常(已忽略):', e && e.message);
//       }
//     });
//     return origSend.apply(this, arguments);
//   };

//   // ---------------------------------------------------------------------
//   // 7. Hook fetch
//   // ---------------------------------------------------------------------
//   const origFetch = window.fetch;
//   if (typeof origFetch === 'function') {
//     window.fetch = function (input, init) {
//       const url = typeof input === 'string' ? input : (input && input.url) || '';
//       return origFetch.apply(this, arguments).then((res) => {
//         try {
//           res.clone().text().then((text) => handleResponse(url, text, null)).catch(() => {});
//         } catch (e) {}
//         return res;
//       });
//     };
//   }

//   // ---------------------------------------------------------------------
//   // 8. BOSS 首屏 SSR 数据
//   // ---------------------------------------------------------------------
//   if (SITE === 'boss') {
//     try {
//       if (window.__INITIAL_STATE__?.jobList) notifyList(window.__INITIAL_STATE__.jobList);
//     } catch (e) {}
//   }

//   // ---------------------------------------------------------------------
//   // 9. 主动兜底通道（保持原有行为不变）
//   // ---------------------------------------------------------------------
//   function getLinkedInCsrfToken() {
//     const m = document.cookie.match(/JSESSIONID="?([^";]+)"?/);
//     return m ? m[1] : '';
//   }

//   async function directFetchDetail(matchKey, meta) {
//     if (SITE === 'linkedin') {
//       const csrfToken = getLinkedInCsrfToken();
//       if (!csrfToken) return null;
//       try {
//         const res = await fetch(`https://www.linkedin.com/voyager/api/jobs/jobPostings/${matchKey}`, {
//           method: 'GET',
//           headers: {
//             'csrf-token': csrfToken,
//             'x-restli-protocol-version': '2.0.0',
//             'accept': 'application/vnd.linkedin.normalized+json+2.0.0, application/json, text/plain, */*',
//             'x-li-lang': 'zh_CN'
//           }
//         });
//         if (!res.ok) return null;
//         const json = await res.json();
//         // console.log("injected",json?.description?.text);
//         const rawDesc = htmlToText(json?.description?.text || (typeof json?.description === 'string' ? json.description : ''));
//         console.log("injected",parseJdSmart(rawDesc));
//         return { matchKey: String(matchKey), title: json?.title || '', ...parseJdSmart(rawDesc) };
//       } catch (e) { return null; }
//     }

//     if (SITE === 'zhaopin') {
//       if (!matchKey || /^h_/.test(String(matchKey))) return null;
//       try {
//         const apiUrl = `https://fe-api.zhaopin.com/c/i/jobs/detail?number=${encodeURIComponent(matchKey)}`;
//         const res = await fetch(apiUrl, {
//           credentials: 'include',
//           headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, text/plain, */*' }
//         });
//         if (!res.ok) return null;
//         const json = await res.json();
//         return parseZhaopinDetail(json, apiUrl, String(matchKey));
//       } catch (e) { return null; }
//     }

//     if (SITE === 'boss') {
//       const securityId = matchKey;
//       const lid = meta?.lid || '';
//       if (!securityId) return null;
//       try {
//         const apiUrl = `/wapi/zpgeek/job/detail.json?securityId=${encodeURIComponent(securityId)}&lid=${encodeURIComponent(lid)}`;
//         const res = await fetch(apiUrl, {
//           headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, text/plain, */*' }
//         });
//         if (!res.ok) return null;
//         const json = await res.json();
//         return parseBossDetail(json, apiUrl);
//       } catch (e) { return null; }
//     }
//     return null;
//   }

//   document.addEventListener('REQ_DIRECT_FETCH_JOB', async (e) => {
//     const { matchKey, meta, requestId } = e.detail || {};
//     const data = await directFetchDetail(matchKey, meta);
//     document.dispatchEvent(new CustomEvent('RESP_DIRECT_FETCH_JOB', { detail: { requestId, matchKey, data } }));
//   });

//   document.documentElement.dataset.injectReady = 'true';
//   document.dispatchEvent(new CustomEvent('INJECT_SCRIPT_READY'));
//   console.log(`✅ [injected.js] (${SITE}) 挂载完成。排查拦截问题请在控制台执行: window.__jdpDiag = true`);
// })();

/**
 * ==============================================================================
 * injected.js — 运行在页面主环境 (MAIN World)
 *
 * 已新增猎聘 (liepin.com) 的站点识别、API 响应拦截、SSR 数据解析及直接请求支持。
 * ==============================================================================
 */
// (function () {
//   'use strict';
//   if (window.__jobHookInjected) return;
//   window.__jobHookInjected = true;

//   // ---------------------------------------------------------------------
//   // 0. 站点识别 & 诊断开关
//   // ---------------------------------------------------------------------
//   const SITE = location.host.includes('zhipin.com')
//     ? 'boss'
//     : location.host.includes('linkedin.com')
//       ? 'linkedin'
//       : (location.host.includes('zhaopin.com') || location.host.includes('zhilian.com'))
//         ? 'zhaopin'
//         : location.host.includes('51job.com')
//         ? '51job'
//         : location.host.includes('liepin.com')
//         ? 'liepin'
//         : 'generic';

//   const diag = (...args) => { if (window.__jdpDiag) console.log('%c[JDP-DIAG]', 'color:#0a66c2;font-weight:bold', ...args); };
//   window.__jdpDiag = window.__jdpDiag || false;

//   // ---------------------------------------------------------------------
//   // 1. JD 文本解析
//   // ---------------------------------------------------------------------
//   const SECTION_VOCAB = [
//     {
//       type: 'responsibilities',
//       tiers: [
//         { weight: 50, phrases: ['岗位职责','工作职责','职责描述','主要职责','工作内容','岗位描述','职位描述',
//             'Responsibilities','Key Responsibilities','Primary Responsibilities','Core Responsibilities',
//             'Duties and Responsibilities','Essential Duties','Essential Functions','Essential Job Functions','Key Accountabilities','Responsibility','职位职责','工作内容及职责'] },
//         { weight: 40, phrases: ["What you'll do",'What you will do',"What You'll Be Doing",'About the Role',
//             'About this Role','About the job','Role Overview','Role Summary','Job Summary','Job Purpose',
//             'The Role','Your Impact','Duties','你将负责','主要工作','主要负责','负责内容'] },
//         { weight: 25, phrases: ['职责','Tasks','任务'] },
//       ],
//     },
//     {
//       type: 'requirements',
//       tiers: [
//         { weight: 50, phrases: ['任职要求','任职资格','岗位要求','招聘条件','职位要求','能力要求','岗位条件',
//             'Requirements','Qualifications','Job Requirements','Basic Qualifications','Minimum Qualifications',
//             'Required Qualifications','Key Qualifications','Skills and Qualifications','Education and Experience','Requirement','Qualification','技能要求','能力要求'] },
//         { weight: 40, phrases: ["What we're looking for",'What we are looking for','Who You Are',
//             "What You'll Bring",'What You Bring','Skills & Experience','Required Skills','Must Have','Must-haves',
//             '你需要具备','我们需要你'] },
//         { weight: 25, phrases: ['要求','资格','Skills'] },
//       ],
//     },
//     {
//       type: 'bonus',
//       tiers: [
//         { weight: 50, phrases: ['加分项','优先条件','优先考虑','加分技能',
//             'Preferred Qualifications','Additional Qualifications','Preferred Experience','Preferred Skills',
//             'Nice to have','Nice-to-haves','Bonus Points','Desirable Skills'] },
//         { weight: 40, phrases: ['具备以下者优先','有以下经验优先','Bonus points if you have','A plus if','An asset','Desirable'] },
//         { weight: 25, phrases: ['加分','Preferred'] },
//       ],
//     },
//   ];

//   const STOP_SECTIONS = [
//     '福利待遇','薪资福利','公司简介','关于我们','企业文化','工作地点','投递方式','我们提供',
//     'Benefits','What We Offer','Perks','Perks and Benefits','Compensation','Salary','Pay Range',
//     'Working Conditions','Work Environment','Physical Requirements',
//     'EEO Statement','Equal Opportunity','Equal Employment Opportunity','EEO',
//     'About Us','About the Company','Our Story','Our Mission','Why Join Us','Who We Are',
//     'How to Apply','Application Process','Next Steps','Disclaimer','Legal',
//   ];

//   function normalizeForMatch(s) {
//     return String(s || '')
//       .replace(/[\u2018\u2019\u02bc]/g, "'")
//       .replace(/[\u201c\u201d]/g, '"')
//       .replace(/[\u2010-\u2015\u2212]/g, '-')
//       .replace(/[（）]/g, (m) => (m === '（' ? '(' : ')'))
//       .replace(/\s*&\s*/g, ' and ')
//       .replace(/-/g, ' ')
//       .replace(/\s+/g, ' ')
//       .trim()
//       .toLowerCase();
//   }

//   function matchPhrase(normText, phrase) {
//     const p = normalizeForMatch(phrase);
//     if (/[\u4e00-\u9fa5]/.test(p)) return normText.includes(p);
//     const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
//     return new RegExp(`(?:^|\\b)${esc}(?:e?s)?(?:\\b|[:：]|$)`, 'i').test(normText);
//   }

//   const CORE_PATTERNS = [
//     { type: 'responsibilities', weight: 22, re: /(职责|负责|工作内容|responsibilit|duties|what you.{0,4}(ll|will) do)/i },
//     { type: 'requirements',     weight: 22, re: /(要求|资格|条件|qualificat|requirement|what (we|you).{0,4}(re |ll )?(looking|bring|have))/i },
//     { type: 'bonus',            weight: 22, re: /(加分|优先|preferred|nice to have|bonus|desirable|a plus)/i },
//   ];

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

//   function assessSectionHeader(element, text) {
//     const isCJKText = /[\u4e00-\u9fa5]/.test(text);
//     if (/^[*•▪◦●\-–]\s+/.test(text)) return { isHeader: false, score: 0, type: null };

//     const numbered = /^\d+[.、)）]\s*\S/.test(text) || /^[一二三四五六七八九十]+[、.]\s*\S/.test(text);
//     const bare = text.replace(/^[（(]?[\d一二三四五六七八九十]+[）)]?[.、)）]?\s*/, '');
//     if (numbered && bare.length > (isCJKText ? 12 : 30)) {
//       return { isHeader: false, score: 0, type: null };
//     }

//     let domScore = 0;
//     if (element && element.tagName) {
//       const tag = element.tagName.toLowerCase();
//       const cls = typeof element.className === 'string' ? element.className : (element.getAttribute?.('class') || '');
//       const idName = element.id || '';
//       if (/^h[1-3]$/.test(tag)) domScore += 35;
//       else if (/^h[4-6]$/.test(tag)) domScore += 25;
//       else if (tag === 'b' || tag === 'strong') domScore += 20;
//       else if (tag === 'dt') domScore += 20;
//       if (/header|title|section|heading|caption|label|subtitle/i.test(cls + ' ' + idName)) domScore += 30;
//       if (/(desc|content|body|text|paragraph)/i.test(cls + ' ' + idName) && !/title|header|heading/i.test(cls + ' ' + idName)) domScore -= 10;
//     }

//     let layoutScore = 0;
//     const isCJK = isCJKText;
//     if (/[:：]\s*$/.test(text)) layoutScore += 25;
//     if (text.length <= (isCJK ? 20 : 40)) layoutScore += 20;
//     if (!isCJK && text === text.toUpperCase() && /[A-Z]{3,}/.test(text)) layoutScore += 18;
//     if (/[.。]$/.test(text) && !/[:：]$/.test(text)) layoutScore -= 20;
//     if (text.length > (isCJK ? 40 : 80)) layoutScore -= 40;
//     if (/(?:we\s+are|you\s+will|our\s+team|looking\s+for\s+a|我们正在|如果你)/i.test(text) && text.length > 30) layoutScore -= 35;

//     const { type, keywordScore } = matchVocab(text);
//     const totalScore = domScore + layoutScore + keywordScore;
//     const headingLen = isCJKText ? 22 : 50;
//     const isHeader = (totalScore >= 60 && keywordScore > 0)
//       || (domScore >= 35 && keywordScore >= 25 && text.length <= headingLen);
//     return { isHeader, type, score: totalScore };
//   }

//   const LEAFY = /^(P|LI|H[1-6]|DT|DD|TD|TH|BLOCKQUOTE)$/i;
//   const CONTAINER = /^(DIV|SECTION|ARTICLE|UL|OL|DL|TABLE|TBODY|TR|MAIN|SPAN|BODY)$/i;

//   function getVisualTextBlocks(node) {
//     const blocks = [];
//     const walk = (el) => {
//       if (!el || !el.tagName) return;
//       const tag = el.tagName;
//       if (/^(SCRIPT|STYLE|NOSCRIPT|SVG)$/i.test(tag)) return;

//       if (LEAFY.test(tag) || /^(H[1-6]|STRONG|B)$/i.test(tag)) {
//         const t = (el.textContent || '').trim();
//         if (t) blocks.push({ element: el, text: t });
//         return;
//       }
//       if (CONTAINER.test(tag)) {
//         const hasElementChild = el.children && el.children.length > 0;
//         if (!hasElementChild) {
//           const t = (el.textContent || '').trim();
//           if (t) blocks.push({ element: el, text: t });
//           return;
//         }
//         for (const child of Array.from(el.childNodes)) {
//           if (child.nodeType === 3) {
//             const t = (child.nodeValue || '').trim();
//             if (t) blocks.push({ element: el, text: t });
//           } else if (child.nodeType === 1) {
//             walk(child);
//           }
//         }
//         return;
//       }
//       const t = (el.textContent || '').trim();
//       if (t) blocks.push({ element: el, text: t });
//     };
//     walk(node);
//     return blocks;
//   }

//   function parseJdFromDom(containerNode) {
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
//     let current = 'intro';

//     for (const blk of blocks) {
//       const { element, text } = blk;
//       const blockIsSplit = !!blk.__split;
//       const t = text.trim();
//       if (!t) continue;

//       if (current !== 'intro' && t.length <= 40 && isStopSection(t)) break;

//       const a = assessSectionHeader(blockIsSplit ? null : element, t);
//       if (a.isHeader && a.type) { current = a.type; continue; }
//       buckets[current].push(t);
//     }

//     const resp = [...buckets.intro, ...buckets.responsibilities].join('\n').trim();
//     return {
//       responsibilities: resp,
//       requirements: buckets.requirements.join('\n').trim(),
//       bonus: buckets.bonus.join('\n').trim(),
//       fullCleanText: blocks.map((b) => b.text).join('\n').trim(),
//     };
//   }

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
//         && /^[a-z(,;)]/.test(line);
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
//       if (current !== 'intro' && bare.length <= 40 && isStopSection(bare)) break;

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

//   function parseJdSmart(input) {
//     if (input && typeof input === 'object' && input.nodeType === 1) return parseJdFromDom(input);
    
//     if (window.JdParsed && typeof window.JdParsed.parseJd === 'function') {
//       const result = { responsibilities: '', requirements: '', bonus: '', fullCleanText: '' };
//       const jdresult = window.JdParsed.parseJd(input);
//       const resp = jdresult.responsibilities || [];
//       const req = jdresult.requirements || [];
//       const pref = jdresult.preferred || [];

//       result.responsibilities = resp.join('\n').trim();
//       result.requirements = [...req, ...pref].join('\n').trim();
//       result.bonus = pref.join('\n').trim();
//       result.fullCleanText = [...resp, ...req, ...pref].join('\n').trim();
//       return result;
//     }
//     return parseJdFromText(String(input || ''));
//   }

//   function htmlToText(html) {
//     if (!html || typeof html !== 'string') return '';
//     if (!/[<&]/.test(html)) return html;
//     return html
//       .replace(/<\s*br\s*\/?\s*>/gi, '\n')
//       .replace(/<\s*\/\s*(p|div|li|tr)\s*>/gi, '\n')
//       .replace(/<[^>]+>/g, '')
//       .replace(/&nbsp;/gi, ' ')
//       .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
//       .replace(/&amp;/g, '&').replace(/&quot;/g, '"');
//   }

//   // ---------------------------------------------------------------------
//   // 2. 通用："点击相关性捕获窗口"
//   // ---------------------------------------------------------------------
//   let activeCapture = null;

//   document.addEventListener('REQ_BEGIN_CAPTURE', (e) => {
//     const { cardId } = e.detail || {};
//     if (!cardId) return;
//     activeCapture = { cardId: String(cardId), startedAt: Date.now(), best: null };
//     diag('捕获窗口已开启, cardId =', cardId);
//   });

//   document.addEventListener('REQ_END_CAPTURE', () => {
//     if (!activeCapture) return;
//     if (activeCapture.best) {
//       diag('捕获窗口关闭，采用最佳候选, score =', activeCapture.best.score);
//       window.postMessage({
//         type: 'JOB_HOOK_DETAIL', site: SITE,
//         data: { ...activeCapture.best.detail, matchKey: activeCapture.cardId, source: 'Click-Correlated Capture' }
//       }, '*');
//     }
//     activeCapture = null;
//   });

//   const JD_KEYWORD_PATTERN = /(岗位职责|工作职责|任职要求|任职资格|岗位要求|职位描述|工作内容|加分项|Responsibilities|Requirements|Qualifications|Job\s+Description|What\s+you.{0,10}do)/gi;

//   function scoreJdText(text) {
//     if (!text || text.length < 150) return 0;
//     const kwHits = (text.match(JD_KEYWORD_PATTERN) || []).length;
//     const hasSentences = /[。！？.!?]/.test(text);
//     if (!kwHits && !hasSentences) return 0;

//     let structureBonus = 0;
//     const bulletLines = (text.match(/(?:^|\n)\s*(?:[•·▪●\-*]|\d+[.、)）])\s*\S/g) || []).length;
//     if (bulletLines >= 3) structureBonus += 120;
//     else if (bulletLines >= 1) structureBonus += 40;
//     if (/(\d+\s*[-~到]?\s*\d*\s*年(以上)?(工作)?经验|本科|硕士|博士|大专|years?\s+of\s+experience|bachelor|master's|degree)/i.test(text)) structureBonus += 80;
//     if (/(公司简介|关于我们|企业文化|发展历程|隐私政策|用户协议|Cookie|About\s+Us|Privacy\s+Policy|Terms\s+of\s+Service)/i.test(text)
//         && kwHits === 0) structureBonus -= 150;

//     return Math.min(kwHits, 5) * 100 + Math.min(text.length, 4000) * 0.05 + structureBonus;
//   }

//   function findBestJdTextInPayload(node, depth = 0, seen = new Set()) {
//     if (!node || typeof node !== 'object' || depth > 6 || seen.has(node)) return null;
//     seen.add(node);
//     let best = null;
//     for (const key in node) {
//       if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
//       const val = node[key];
//       if (typeof val === 'string') {
//         const text = htmlToText(val);
//         const score = scoreJdText(text);
//         if (score > 0 && (!best || score > best.score)) {
//           best = { score, text, key, container: node };
//         }
//       } else if (val && typeof val === 'object') {
//         const sub = findBestJdTextInPayload(val, depth + 1, seen);
//         if (sub && (!best || sub.score > best.score)) best = sub;
//       }
//     }
//     return best;
//   }

//   const TITLE_LIKE_KEYS = ['jobName', 'title', 'jobTitle', 'positionName', 'name', 'headline'];
//   function guessTitle(container) {
//     if (!container) return '';
//     for (const k of TITLE_LIKE_KEYS) {
//       if (typeof container[k] === 'string' && container[k].length < 100) return container[k];
//     }
//     return '';
//   }

//   const CONFIDENT_SCORE = 260;

//   function offerToCapture(json) {
//     if (!activeCapture) return false;
//     const best = findBestJdTextInPayload(json);
//     if (!best) return false;

//     const detail = { title: guessTitle(best.container), ...parseJdSmart(best.text) };

//     if (best.score >= CONFIDENT_SCORE) {
//       diag('捕获窗口内命中高置信度候选，立即发出, score =', best.score, 'key =', best.key);
//       window.postMessage({
//         type: 'JOB_HOOK_DETAIL', site: SITE,
//         data: { ...detail, matchKey: activeCapture.cardId, source: 'Click-Correlated Capture' }
//       }, '*');
//       activeCapture.best = null;
//       return true;
//     }

//     if (activeCapture.best && activeCapture.best.score >= best.score) return true;
//     activeCapture.best = { score: best.score, detail };
//     diag('捕获窗口内收到低置信度候选(暂存), score =', best.score, 'key =', best.key);
//     return true;
//   }

//   // ---------------------------------------------------------------------
//   // 3. 站点专用匹配规则（BOSS / 智联 / 51job / 猎聘）
//   // ---------------------------------------------------------------------
//   const BOSS_DETAIL_URL = /\/(job\/detail|jobdetail|job\/card|geek\/job\/detail)\.json/i;
//   const BOSS_LIST_URL = /\/(joblist|job\/list|geek\/joblist)\.json/i;

//   const FIFTYONEJOB_SEARCH_URL = /we\.51job\.com\/api\/job\/search-pc/i;

//   const ZHAOPIN_DETAIL_URL = /(?:^|\/\/)fe-api\.zhaopin\.com\/c\/i\/jobs\/detail|\/c\/i\/jobs\/detail/i;
//   const ZHAOPIN_LIST_URL = /(?:^|\/\/)fe-api\.zhaopin\.com\/c\/i\/(?:search|jobs|position|positions)|\/c\/i\/jobs\/search|\/sou\/result/i;
//   const ZHAOPIN_ID_KEYS = ['number', 'jobNumber', 'job_number', 'jobId', 'jobID', 'jobid', 'positionId', 'positionID', 'positionNumber', 'position_number'];
//   const ZHAOPIN_TITLE_KEYS = ['jobName', 'name', 'title', 'jobTitle', 'positionName'];
//   const ZHAOPIN_DESC_KEYS = ['jobDesc', 'jobDescription', 'description', 'describe', 'positionDesc', 'positionDetail', 'responsibility', 'jobDetail', 'details', 'content'];
//   const ZHAOPIN_SALARY_KEYS = ['salaryDesc', 'salary', 'salaryReal', 'salary60', 'salaryName'];
//   const ZHAOPIN_COMPANY_KEYS = ['companyName', 'brandName', 'company', 'companyInfo', 'companyDTO'];
//   const ZHAOPIN_LOCATION_KEYS = ['cityName', 'workCity', 'city', 'cityDisplay', 'areaDistrict', 'workAddress', 'location'];

//   // --- 猎聘 (Liepin) 规则配置 ---
//   const LIEPIN_DETAIL_URL = /\/(?:gapi|api|pas)\/.*?(?:job\/detail|get-job-detail|job-detail|job-info)/i;
//   const LIEPIN_LIST_URL = /\/(?:gapi|api|pas)\/.*?(?:search\/job|job-list|search-job|pc-search-job)/i;
//   const LIEPIN_ID_KEYS = ['jobId', 'job_id', 'jobNo', 'job_no', 'encodeId', 'positionId', 'jobCardId'];
//   const LIEPIN_TITLE_KEYS = ['jobName', 'title', 'positionName', 'jobTitle', 'name'];
//   const LIEPIN_DESC_KEYS = ['jobDesc', 'jobDescription', 'description', 'positionDesc', 'desc', 'jobSummary', 'jobIntro'];
//   const LIEPIN_SALARY_KEYS = ['salary', 'salaryDesc', 'salaryShow', 'showSalary', 'jobSalary'];
//   const LIEPIN_COMPANY_KEYS = ['compName', 'companyName', 'comp', 'company', 'brandName'];
//   const LIEPIN_LOCATION_KEYS = ['cityName', 'dqName', 'location', 'city', 'workAddress', 'cityNameList'];

//   function getDeepValueByKeys(node, keys, depth = 0, seen = new Set()) {
//     if (!node || typeof node !== 'object' || depth > 6 || seen.has(node)) return '';
//     seen.add(node);
//     for (const key of keys) {
//       if (Object.prototype.hasOwnProperty.call(node, key)) {
//         const val = node[key];
//         if (val != null) {
//           if (typeof val === 'string' || typeof val === 'number') return String(val).trim();
//           if (Array.isArray(val)) return val.map(x => (typeof x === 'object' ? (x.name || x.label || '') : String(x))).filter(Boolean).join(' ');
//         }
//       }
//     }
//     for (const key in node) {
//       if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
//       const value = node[key];
//       if (value && typeof value === 'object') {
//         const text = getDeepValueByKeys(value, keys, depth + 1, seen);
//         if (text) return text;
//       }
//     }
//     return '';
//   }

//   function parseLiepinDetail(json, url, fallbackMatchKey = '') {
//     const data = json?.data || json?.result || json;
//     if (!data) return null;

//     const directDesc = getDeepValueByKeys(data, LIEPIN_DESC_KEYS);
//     const best = findBestJdTextInPayload(data);
//     const rawDesc = htmlToText(directDesc || best?.text || '');
//     if (!rawDesc || rawDesc.length < 30) return null;

//     const parsed = parseJdSmart(rawDesc);
//     let matchKey = getDeepValueByKeys(data, LIEPIN_ID_KEYS) || fallbackMatchKey;
//     if (!matchKey) {
//       try {
//         const params = new URL(url, location.origin).searchParams;
//         matchKey = params.get('jobId') || params.get('job_id') || params.get('jobNo') || '';
//       } catch (e) {}
//     }
//     if (!matchKey && activeCapture) matchKey = activeCapture.cardId;

//     return {
//       matchKey: String(matchKey || ''),
//       jobId: String(matchKey || ''),
//       title: getDeepValueByKeys(data, LIEPIN_TITLE_KEYS),
//       salary: getDeepValueByKeys(data, LIEPIN_SALARY_KEYS),
//       company: getDeepValueByKeys(data, LIEPIN_COMPANY_KEYS),
//       location: getDeepValueByKeys(data, LIEPIN_LOCATION_KEYS),
//       ...parsed
//     };
//   }

//   function parseLiepinList(json) {
//     const list = json?.data?.jobCardList || json?.data?.list || json?.data?.jobList || json?.result?.list || [];
//     if (!Array.isArray(list) || list.length === 0) return [];

//     return list.map((item) => {
//       const jobId = getDeepValueByKeys(item, LIEPIN_ID_KEYS);
//       const jobName = getDeepValueByKeys(item, LIEPIN_TITLE_KEYS);
//       if (!jobId || !jobName) return null;
//       return {
//         jobId: String(jobId),
//         matchKey: String(jobId),
//         jobName,
//         salaryDesc: getDeepValueByKeys(item, LIEPIN_SALARY_KEYS),
//         brandName: getDeepValueByKeys(item, LIEPIN_COMPANY_KEYS),
//         cityName: getDeepValueByKeys(item, LIEPIN_LOCATION_KEYS),
//       };
//     }).filter(Boolean);
//   }

//   // --- 智联与 51job 解析方法保持 ---
//   function zhaopinValueToText(value) {
//     if (value == null) return '';
//     if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
//     if (Array.isArray(value)) return value.map(zhaopinValueToText).filter(Boolean).join(' ').trim();
//     if (typeof value === 'object') {
//       for (const key of ['display', 'name', 'value', 'text', 'label', 'content', 'title']) {
//         const text = zhaopinValueToText(value[key]);
//         if (text) return text;
//       }
//     }
//     return '';
//   }

//   function findZhaopinValueByKeys(node, keys, depth = 0, seen = new Set()) {
//     if (!node || typeof node !== 'object' || depth > 5 || seen.has(node)) return '';
//     seen.add(node);
//     for (const key of keys) {
//       if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
//       const text = zhaopinValueToText(node[key]);
//       if (text) return text;
//     }
//     for (const key in node) {
//       if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
//       const value = node[key];
//       if (!value || typeof value !== 'object') continue;
//       const text = findZhaopinValueByKeys(value, keys, depth + 1, seen);
//       if (text) return text;
//     }
//     return '';
//   }

//   function unwrapZhaopinData(json) {
//     return json?.data?.jobDetail
//       || json?.data?.jobInfo
//       || json?.data?.detail
//       || json?.data
//       || json?.result?.data
//       || json?.result
//       || json;
//   }

//   function extractZhaopinMatchKey(data, url, fallbackMatchKey = '') {
//     if (fallbackMatchKey) return String(fallbackMatchKey);
//     try {
//       const params = new URL(url, location.origin).searchParams;
//       for (const key of ZHAOPIN_ID_KEYS) {
//         const val = params.get(key);
//         if (val) return String(val);
//       }
//     } catch (e) {}
//     return findZhaopinValueByKeys(data, ZHAOPIN_ID_KEYS);
//   }

//   function parseZhaopinDetail(json, url, fallbackMatchKey = '') {
//     const dataRaw = unwrapZhaopinData(json);
//     if (!dataRaw) return null;
//     const data = typeof dataRaw === 'object' ? dataRaw : { description: String(dataRaw) };
//     const directDesc = findZhaopinValueByKeys(data, ZHAOPIN_DESC_KEYS);
//     const best = findBestJdTextInPayload(data);
//     const rawDesc = htmlToText(directDesc || best?.text || '');
//     if (!rawDesc || rawDesc.length < 50) return null;

//     const parsed = parseJdSmart(rawDesc);
//     if (!parsed.fullCleanText) parsed.fullCleanText = rawDesc;
//     if (!parsed.responsibilities && !parsed.requirements && parsed.fullCleanText) {
//       parsed.responsibilities = parsed.fullCleanText;
//     }

//     const realJobId = extractZhaopinMatchKey(data, url);
//     return {
//       matchKey: extractZhaopinMatchKey(data, url, fallbackMatchKey || realJobId),
//       jobId: realJobId || fallbackMatchKey,
//       number: realJobId || '',
//       title: findZhaopinValueByKeys(data, ZHAOPIN_TITLE_KEYS),
//       salary: findZhaopinValueByKeys(data, ZHAOPIN_SALARY_KEYS),
//       company: findZhaopinValueByKeys(data, ZHAOPIN_COMPANY_KEYS),
//       location: findZhaopinValueByKeys(data, ZHAOPIN_LOCATION_KEYS),
//       ...parsed
//     };
//   }

//   function normalizeZhaopinListItem(item) {
//     if (!item || typeof item !== 'object') return null;
//     const jobId = extractZhaopinMatchKey(item, '');
//     const jobName = findZhaopinValueByKeys(item, ZHAOPIN_TITLE_KEYS);
//     const salaryDesc = findZhaopinValueByKeys(item, ZHAOPIN_SALARY_KEYS);
//     const brandName = findZhaopinValueByKeys(item, ZHAOPIN_COMPANY_KEYS);
//     const cityName = findZhaopinValueByKeys(item, ZHAOPIN_LOCATION_KEYS);
//     if (!jobId || !jobName || !(salaryDesc || brandName || cityName)) return null;
//     return { jobId, number: jobId, jobName, salaryDesc, brandName, cityName };
//   }

//   function findZhaopinListItems(node, results = [], seen = new Set(), depth = 0) {
//     if (!node || typeof node !== 'object' || depth > 6 || seen.has(node)) return results;
//     seen.add(node);
//     if (Array.isArray(node)) {
//       const items = node.map(normalizeZhaopinListItem).filter(Boolean);
//       if (items.length >= 2) results.push(...items);
//       node.forEach((item) => findZhaopinListItems(item, results, seen, depth + 1));
//       return results;
//     }
//     for (const key in node) {
//       if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
//       const value = node[key];
//       if (value && typeof value === 'object') findZhaopinListItems(value, results, seen, depth + 1);
//     }
//     return results;
//   }

//   function parseFiftyOneJobList(json) {
//     const items = json?.resultbody?.job?.items;
//     if (!Array.isArray(items)) return [];
//     return items.map((it) => {
//       const jobId = it.jobId || it.jobid || it.id || it.jobID || null;
//       const rawDesc = it.jobDescribe || '';
//       if (!rawDesc) return null;
//       return { matchKey: jobId != null ? String(jobId) : null, title: it.jobName || it.jobTitle || '', rawDesc };
//     }).filter(Boolean);
//   }

//   function parseBossDetail(json, url) {
//     const jobInfo = json?.zpData?.jobInfo;
//     if (!jobInfo) return null;

//     let matchKey = '';
//     try { matchKey = new URL(url, location.origin).searchParams.get('securityId') || ''; } catch (e) {}
//     if (!matchKey) matchKey = jobInfo.encryptJobId || jobInfo.encryptId || jobInfo.securityId || '';
//     if (!matchKey && activeCapture) matchKey = activeCapture.cardId;

//     const rawDesc = htmlToText(jobInfo.postDescription || '');
//     return {
//       matchKey,
//       title: jobInfo.jobName || '',
//       salary: jobInfo.salaryDesc || '',
//       company: json.zpData.brandComInfo?.brandName || '',
//       location: jobInfo.locationName || '',
//       ...parseJdSmart(rawDesc)
//     };
//   }

//   // ---------------------------------------------------------------------
//   // 4. 通知派发函数
//   // ---------------------------------------------------------------------
//   function notifyList(list) {
//     if (!Array.isArray(list) || list.length === 0) return;
//     window.postMessage({ type: 'JOB_HOOK_LIST', site: SITE, data: list }, '*');
//   }

//   function notifyDetail(detail) {
//     if (!detail) return;
//     if (!detail.matchKey) {
//       if (activeCapture) {
//         detail = { ...detail, matchKey: activeCapture.cardId, source: 'Click-Correlated Fallback' };
//         diag('详情缺少 matchKey，按点击相关性归属给', activeCapture.cardId);
//       } else {
//         diag('⚠️ 拿到详情但没有 matchKey，且没有捕获窗口，只能丢弃');
//         return;
//       }
//     }
//     window.postMessage({ type: 'JOB_HOOK_DETAIL', site: SITE, data: detail }, '*');
//   }

//   // ---------------------------------------------------------------------
//   // 5. 统一响应处理入口
//   // ---------------------------------------------------------------------
//   function handleResponse(url, payloadText, payloadObj) {
//     let json = payloadObj;
//     if (!json) {
//       if (!payloadText || payloadText.length < 50) return;
//       if (payloadText[0] !== '{' && payloadText[0] !== '[') return;
//       try { json = JSON.parse(payloadText); } catch (e) { return; }
//     }
//     if (!json || typeof json !== 'object') return;

//     if (window.__jdpDiag) {
//       const probe = findBestJdTextInPayload(json);
//       if (probe) {
//         diag('疑似含 JD 正文的响应:', { url, 字段名: probe.key, 分数: probe.score, 前120字: probe.text.slice(0, 120) });
//       }
//     }

//     // ---- BOSS 专属 ----
//     if (SITE === 'boss') {
//       if (BOSS_LIST_URL.test(url)) {
//         const list = json?.zpData?.jobList;
//         if (list) { diag('命中 BOSS 列表接口', url, '条数', list.length); notifyList(list); }
//       }
//       if (BOSS_DETAIL_URL.test(url) || json?.zpData?.jobInfo) {
//         const detail = parseBossDetail(json, url);
//         if (detail) {
//           diag('命中 BOSS 详情接口', url, 'matchKey =', detail.matchKey);
//           notifyDetail(detail);
//           return;
//         }
//       }
//     }

//     // ---- 智联专属 ----
//     if (SITE === 'zhaopin') {
//       if (ZHAOPIN_DETAIL_URL.test(url)) {
//         const detail = parseZhaopinDetail(json, url, activeCapture?.cardId);
//         if (detail) {
//           diag('命中智联详情接口', url, 'matchKey =', detail.matchKey, 'jobId =', detail.jobId);
//           notifyDetail(detail);
//           return;
//         }
//       }
//       if (ZHAOPIN_LIST_URL.test(url)) {
//         const items = findZhaopinListItems(json);
//         if (items.length) {
//           const uniq = [];
//           const seenJobIds = new Set();
//           items.forEach((item) => {
//             if (seenJobIds.has(item.jobId)) return;
//             seenJobIds.add(item.jobId);
//             uniq.push(item);
//           });
//           diag('命中智联列表接口', url, '条数', uniq.length);
//           notifyList(uniq);
//           return;
//         }
//       }
//     }

//     // ---- 猎聘专属 ----
//     if (SITE === 'liepin') {
//       sendToDebugServer(url, json);
//       if (LIEPIN_DETAIL_URL.test(url) || json?.data?.data?.job || json?.data?.jobCard) {
//         const joblist=json?.d;ta?.data;
//         // joblist.forEach(job=>{
//         // const jobId=job.jobId;
//         // const detail = directFetchDetail(jobId);
//         // if (detail) {
//         //   diag('命中猎聘详情接口', url, 'matchKey =', detail.matchKey);
//         //   notifyDetail(detail);
//         //   return;
//         // }
//         // })
        
//       }
//       // if (LIEPIN_LIST_URL.test(url) || json?.data?.jobCardList) {
//       //   const list = parseLiepinL(json);
//       //   if (list.length) {
//       //     diag('命中猎聘列表接口', url, '条数', list.length);
//       //     notifyList(list);
//       //     return;
//       //   }
//       // }
//     }

//     // ---- LinkedIn ----
//     if (SITE === 'linkedin' && /fsd_jobPosting|jobPostingUrn|"description":\s*\{\s*"text"/.test(payloadText || JSON.stringify(json).slice(0, 20000))) {
//       const results = [];
//       const extractJobIdFromUrn = (urn) => (typeof urn === 'string' ? (urn.match(/(?:fsd_jobPosting|jobPosting):(\d+)/) || [])[1] : null);
//       const scan = (node, seen = new Set(), depth = 0) => {
//         if (!node || typeof node !== 'object' || seen.has(node) || depth > 8) return;
//         seen.add(node);
//         const entityUrn = node.entityUrn || node['*entityUrn'] || node.jobPostingUrn || '';
//         const jobId = extractJobIdFromUrn(entityUrn) || (node.jobPostingId ? String(node.jobPostingId) : null);
//         const rawDesc = typeof node.description === 'string'
//           ? node.description
//           : (node.description && typeof node.description.text === 'string' ? node.description.text : '');
//         if (jobId && rawDesc) results.push({ matchKey: jobId, title: node.title || '', rawDesc: htmlToText(rawDesc) });
//         for (const key in node) {
//           if (Object.prototype.hasOwnProperty.call(node, key) && node[key] && typeof node[key] === 'object') {
//             scan(node[key], seen, depth + 1);
//           }
//         }
//       };
//       scan(json);
//       results.forEach((r) => notifyDetail({ matchKey: r.matchKey, title: r.title, ...parseJdSmart(r.rawDesc) }));
//       if (results.length) return;
//     }

//     // ---- 51job ----
//     if (SITE === '51job' && FIFTYONEJOB_SEARCH_URL.test(url)) {
//       const items = parseFiftyOneJobList(json);
//       if (items.length) {
//         diag('命中51job搜索接口', url, '条数', items.length);
//         items.forEach((it) => {
//           if (it.matchKey) notifyDetail({ matchKey: it.matchKey, title: it.title, ...parseJdSmart(it.rawDesc) });
//         });
//         return;
//       }
//     }

//     // ---- 通用点击捕获兜底 ----
//     offerToCapture(json);
//   }


//   function sendToDebugServer(url, json) {
//   // 只接收猎聘相关接口
//   if (!url.includes('liepin') && !url.includes('pas') && !url.includes('gapi')) return;

//   fetch('http://127.0.0.1:9000/log-json', {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     // 转发接口 URL 及完整 JSON 结构
//     body: JSON.stringify({
//       url: url,
//       timestamp: new Date().toLocaleTimeString(),
//       data: json
//     })
//   }).catch(() => {
//     // 忽略未启动本地调试服务时的报错，避免干扰主流程
//   });
// }

//   // ---------------------------------------------------------------------
//   // 6. Hook XHR & Fetch
//   // ---------------------------------------------------------------------
//   const origOpen = XMLHttpRequest.prototype.open;
//   const origSend = XMLHttpRequest.prototype.send;

//   XMLHttpRequest.prototype.open = function (method, url) {
//     this.__hookUrl = url;
//     return origOpen.apply(this, arguments);
//   };

//   XMLHttpRequest.prototype.send = function () {
//     this.addEventListener('load', function () {
//       try {
//         const url = this.responseURL || this.__hookUrl || '';
//         const rt = this.responseType;
//         if (rt === '' || rt === 'text') {
//           handleResponse(url, this.responseText, null);
//         } else if (rt === 'json') {
//           handleResponse(url, null, this.response);
//         }
//       } catch (e) {
//         diag('XHR 响应处理异常:', e && e.message);
//       }
//     });
//     return origSend.apply(this, arguments);
//   };

//   const origFetch = window.fetch;
//   if (typeof origFetch === 'function') {
//     window.fetch = function (input, init) {
//       const url = typeof input === 'string' ? input : (input && input.url) || '';
//       return origFetch.apply(this, arguments).then((res) => {
//         try {
//           res.clone().text().then((text) => handleResponse(url, text, null)).catch(() => {});
//         } catch (e) {}
//         return res;
//       });
//     };
//   }

//   // ---------------------------------------------------------------------
//   // 7. 首屏 SSR 数据解析 (含 猎聘 __NEXT_DATA__)
//   // ---------------------------------------------------------------------
//   window.addEventListener('DOMContentLoaded', () => {
//     if (SITE === 'boss') {
//       try {
//         if (window.__INITIAL_STATE__?.jobList) notifyList(window.__INITIAL_STATE__.jobList);
//       } catch (e) {}
//     }

//     if (SITE === 'liepin') {
//       try {
//         const nextDataEl = document.getElementById('__NEXT_DATA__');
//         if (nextDataEl) {
//           const parsed = JSON.parse(nextDataEl.textContent || '{}');
//           const pageProps = parsed?.props?.pageProps;
//           if (pageProps) {
//             const detail = parseLiepinDetail(pageProps, location.href);
//             if (detail) notifyDetail(detail);
//           }
//         }
//       } catch (e) {
//         diag('猎聘 SSR 数据提取失败:', e);
//       }
//     }
//   });

//   // ---------------------------------------------------------------------
//   // 8. 主动兜底通道 (Direct Fetch)
//   // ---------------------------------------------------------------------
//   async function directFetchDetail(matchKey, meta) {
//     if (SITE === 'liepin') {
//       if (!matchKey) return null;
//       try {
//         const apiUrl = `https://www.liepin.com/gapi/api/c/job/detail?jobId=${encodeURIComponent(matchKey)}`;
//         const res = await fetch(apiUrl, {
//           headers: { 'Accept': 'application/json, text/plain, */*' }
//         });
//         if (!res.ok) return null;
//         const json = await res.json();
//         sendToDebugServer(apiUrl, json);
//         return parseLiepinDetail(json, apiUrl, String(matchKey));
//       } catch (e) { return null; }
//     }

//     if (SITE === 'boss') {
//       const securityId = matchKey;
//       const lid = meta?.lid || '';
//       if (!securityId) return null;
//       try {
//         const apiUrl = `/wapi/zpgeek/job/detail.json?securityId=${encodeURIComponent(securityId)}&lid=${encodeURIComponent(lid)}`;
//         const res = await fetch(apiUrl, {
//           headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, text/plain, */*' }
//         });
//         if (!res.ok) return null;
//         const json = await res.json();
//         return parseBossDetail(json, apiUrl);
//       } catch (e) { return null; }
//     }
//     return null;
//   }

//   document.addEventListener('REQ_DIRECT_FETCH_JOB', async (e) => {
//     const { matchKey, meta, requestId } = e.detail || {};
//     const data = await directFetchDetail(matchKey, meta);
//     document.dispatchEvent(new CustomEvent('RESP_DIRECT_FETCH_JOB', { detail: { requestId, matchKey, data } }));
//   });

//   document.documentElement.dataset.injectReady = 'true';
//   document.dispatchEvent(new CustomEvent('INJECT_SCRIPT_READY'));
//   console.log(`✅ [injected.js] (${SITE}) 挂载完成。排查拦截问题请在控制台执行: window.__jdpDiag = true`);
// })();

// // /**
// //  * ==============================================================================
// //  * injected.js — 运行在页面主环境 (MAIN World)
// //  *
// //  * 本版相对上一版的关键修复与新增：
// //  *   [修复] XHR hook 读 responseText 在 responseType='json'/'blob' 时会抛
// //  *          DOMException，被 catch 静默吞掉 → 拦截永远不触发（"只有直接请求，
// //  *          没有拦截"的根因）。现在按 responseType 分支取值。
// //  *   [修复] BOSS 详情接口 URL 从写死 /job/detail.json 放宽成多模式匹配，
// //  *          并保留"内容形状"兜底，避免站点换路径就全线失效。
// //  *   [修复] matchKey 取不到时不再静默丢弃，走多级兜底（URL → payload → 点击相关性）。
// //  *   [新增] 诊断模式：把流经的、疑似职位相关的 JSON 响应打到控制台，
// //  *          让你能直接看到 BOSS 真实的详情接口叫什么、字段长什么样。
// //  *   [新增] 通用"点击相关性捕获"：content.js 点击前开一个捕获窗口，窗口内
// //  *          出现的 JD 形状响应直接归属给刚点击的那张卡——不需要知道站点的
// //  *          ID 字段名/位置，这是真正站点无关的机制。
// //  * ==============================================================================
// //  */
// // (function () {
// //   'use strict';
// //   if (window.__jobHookInjected) return;
// //   window.__jobHookInjected = true;

// //   // ---------------------------------------------------------------------
// //   // 0. 站点识别 & 诊断开关
// //   // ---------------------------------------------------------------------
// //   const SITE = location.host.includes('zhipin.com')
// //     ? 'boss'
// //     : location.host.includes('linkedin.com')
// //       ? 'linkedin'
// //       : 'generic';

// //   // 诊断模式：控制台执行 window.__jdpDiag = true 即可打开（不用改代码重装插件），
// //   // 打开后会把所有"疑似职位相关"的响应 URL + 字段结构打出来。
// //   // 排查"到底哪个接口才是详情接口"时非常有用。
// //   const diag = (...args) => { if (window.__jdpDiag) console.log('%c[JDP-DIAG]', 'color:#0a66c2;font-weight:bold', ...args); };
// //   window.__jdpDiag = window.__jdpDiag || false;

// //   // ---------------------------------------------------------------------
// //   // 1. JD 文本解析（与 content.js 保持同一套语义，避免两边结果不一致）
// //   // ---------------------------------------------------------------------
// //   // ============================================================================
// //   // 优化版 parseJdSmart —— 针对 LinkedIn / Indeed 英文 JD "照单全收" 的问题
// //   //
// //   // 四个改动：
// //   //  [根因] normalizeAndMergeLines 会把不带冒号的英文小标题并进下一行，
// //   //         标题特征被彻底破坏 → 打分全军覆没 → 退化成"全文塞进 responsibilities"。
// //   //         现在识别到"疑似小标题"的行一律不参与合并。
// //   //  [词表] 按真实 JD 写作规范扩充（Essential Duties / Basic Qualifications /
// //   //         What You'll Bring / Nice-to-Haves 等），并区分 required vs preferred。
// //   //  [新增] 停止小节(STOP_SECTIONS)：Benefits / EEO / About Us 这类尾部样板段落
// //   //         以前会被并进最后一个小节，现在遇到即截断。
// //   //  [判定] 英文标题的结构特征另算：Title Case / ALL CAPS / 独立短行 / 后接列表。
// //   // ============================================================================

// //   // ============================================================================
// //   // 合并版 JD 解析：DOM 有状态遍历(element 感知打分) + 文本兜底
// //   //
// //   // 架构取自你的 parseJdSmartMultiSignal：按渲染顺序遍历块 → 遇标题切换当前小节 →
// //   // 其余内容归入当前小节。这个结构比"先压成文本再按位置切片"更好，因为打分时
// //   // element 还在手上，className/id/tagName 都能用。
// //   //
// //   // 在此基础上修掉三个实测失分点，并补上纯文本路径：
// //   //   [修] \b 对中文无效 + 全角冒号未处理 → 中文标题一个都识别不出
// //   //   [修] 无停止小节 → Benefits/EEO/公司介绍 一路污染最后一个小节
// //   //   [修] unspecified(前言) 被丢弃 → 岗位概述整段消失
// //   //   [补] parseJdSmartText：API 返回的是 JSON/纯文本时没有 DOM，必须有这条路
// //   // ============================================================================

// //   // ============================================================================
// //   // 合并版 JD 解析：DOM 有状态遍历(element 感知打分) + 文本兜底
// //   //
// //   // 架构取自你的 parseJdSmartMultiSignal：按渲染顺序遍历块 → 遇标题切换当前小节 →
// //   // 其余内容归入当前小节。这个结构比"先压成文本再按位置切片"更好，因为打分时
// //   // element 还在手上，className/id/tagName 都能用。
// //   //
// //   // 在此基础上修掉三个实测失分点，并补上纯文本路径：
// //   //   [修] \b 对中文无效 + 全角冒号未处理 → 中文标题一个都识别不出
// //   //   [修] 无停止小节 → Benefits/EEO/公司介绍 一路污染最后一个小节
// //   //   [修] unspecified(前言) 被丢弃 → 岗位概述整段消失
// //   //   [补] parseJdSmartText：API 返回的是 JSON/纯文本时没有 DOM，必须有这条路
// //   // ============================================================================

// //   // ============================================================================
// //   // 合并版 JD 解析：DOM 有状态遍历(element 感知打分) + 文本兜底
// //   //
// //   // 架构取自你的 parseJdSmartMultiSignal：按渲染顺序遍历块 → 遇标题切换当前小节 →
// //   // 其余内容归入当前小节。这个结构比"先压成文本再按位置切片"更好，因为打分时
// //   // element 还在手上，className/id/tagName 都能用。
// //   //
// //   // 在此基础上修掉三个实测失分点，并补上纯文本路径：
// //   //   [修] \b 对中文无效 + 全角冒号未处理 → 中文标题一个都识别不出
// //   //   [修] 无停止小节 → Benefits/EEO/公司介绍 一路污染最后一个小节
// //   //   [修] unspecified(前言) 被丢弃 → 岗位概述整段消失
// //   //   [补] parseJdSmartText：API 返回的是 JSON/纯文本时没有 DOM，必须有这条路
// //   // ============================================================================

// //   const SECTION_VOCAB = [
// //     {
// //       type: 'responsibilities',
// //       tiers: [
// //         { weight: 50, phrases: ['岗位职责','工作职责','职责描述','主要职责','工作内容','岗位描述','职位描述',
// //             'Responsibilities','Key Responsibilities','Primary Responsibilities','Core Responsibilities',
// //             'Duties and Responsibilities','Essential Duties','Essential Functions','Essential Job Functions','Key Accountabilities','Responsibility','职位职责','工作内容及职责'] },
// //         { weight: 40, phrases: ["What you'll do",'What you will do',"What You'll Be Doing",'About the Role',
// //             'About this Role','About the job','Role Overview','Role Summary','Job Summary','Job Purpose',
// //             'The Role','Your Impact','Duties','你将负责','主要工作','主要负责','负责内容'] },
// //         { weight: 25, phrases: ['职责','Tasks','任务'] },
// //       ],
// //     },
// //     {
// //       type: 'requirements',
// //       tiers: [
// //         { weight: 50, phrases: ['任职要求','任职资格','岗位要求','招聘条件','职位要求','能力要求','岗位条件',
// //             'Requirements','Qualifications','Job Requirements','Basic Qualifications','Minimum Qualifications',
// //             'Required Qualifications','Key Qualifications','Skills and Qualifications','Education and Experience','Requirement','Qualification','技能要求','能力要求'] },
// //         { weight: 40, phrases: ["What we're looking for",'What we are looking for','Who You Are',
// //             "What You'll Bring",'What You Bring','Skills & Experience','Required Skills','Must Have','Must-haves',
// //             '你需要具备','我们需要你'] },
// //         { weight: 25, phrases: ['要求','资格','Skills'] },
// //       ],
// //     },
// //     {
// //       type: 'bonus',
// //       tiers: [
// //         { weight: 50, phrases: ['加分项','优先条件','优先考虑','加分技能',
// //             'Preferred Qualifications','Additional Qualifications','Preferred Experience','Preferred Skills',
// //             'Nice to have','Nice-to-haves','Bonus Points','Desirable Skills'] },
// //         { weight: 40, phrases: ['具备以下者优先','有以下经验优先','Bonus points if you have','A plus if','An asset','Desirable'] },
// //         { weight: 25, phrases: ['加分','Preferred'] },
// //       ],
// //     },
// //   ];

// //   // 停止小节：命中即结束正文收集，后面的内容全部丢弃
// //   const STOP_SECTIONS = [
// //     '福利待遇','薪资福利','公司简介','关于我们','企业文化','工作地点','投递方式','我们提供',
// //     'Benefits','What We Offer','Perks','Perks and Benefits','Compensation','Salary','Pay Range',
// //     'Working Conditions','Work Environment','Physical Requirements',
// //     'EEO Statement','Equal Opportunity','Equal Employment Opportunity','EEO',
// //     'About Us','About the Company','Our Story','Our Mission','Why Join Us','Who We Are',
// //     'How to Apply','Application Process','Next Steps','Disclaimer','Legal',
// //   ];

// //   // ⚡ 归一化：把真实页面里的各种写法变体收敛到同一形态再匹配。
// //   // 实测这一步能解决一大半漏判——弯引号、全角括号、连字符/&、多余空白。
// //   function normalizeForMatch(s) {
// //     return String(s || '')
// //       .replace(/[\u2018\u2019\u02bc]/g, "'")      // 弯引号 → 直引号
// //       .replace(/[\u201c\u201d]/g, '"')
// //       .replace(/[\u2010-\u2015\u2212]/g, '-')      // 各种破折号 → 连字符
// //       .replace(/[（）]/g, (m) => (m === '（' ? '(' : ')'))
// //       .replace(/\s*&\s*/g, ' and ')                // & → and
// //       .replace(/-/g, ' ')                          // 连字符与空格等价
// //       .replace(/\s+/g, ' ')
// //       .trim()
// //       .toLowerCase();
// //   }

// //   // 中文短语足够独特（"岗位职责"几乎不可能出现在非标题语境的正文短行里），
// //   // 直接用包含匹配，不再要求特定的前后缀字符——之前要求前缀必须是空白/项目符号，
// //   // 导致"一、岗位职责""1.岗位职责""（一）岗位职责"这类编号标题全部漏判。
// //   function matchPhrase(normText, phrase) {
// //     const p = normalizeForMatch(phrase);
// //     if (/[\u4e00-\u9fa5]/.test(p)) return normText.includes(p);
// //     // 英文：词边界匹配，并容忍词尾复数
// //     const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// //     return new RegExp(`(?:^|\\b)${esc}(?:e?s)?(?:\\b|[:：]|$)`, 'i').test(normText);
// //   }

// //   // ⚡ 核心词正则（你提的思路）：词表覆盖不到的写法用"含核心词"兜底。
// //   // 权重压得低，单独出现过不了阈值，必须叠加排版/DOM 证据才成立——
// //   // 这样既能捞回"主要负责""职位职责"这类变体，又不会把正文里提到
// //   // "负责"的普通句子误判成标题。
// //   const CORE_PATTERNS = [
// //     { type: 'responsibilities', weight: 22, re: /(职责|负责|工作内容|responsibilit|duties|what you.{0,4}(ll|will) do)/i },
// //     { type: 'requirements',     weight: 22, re: /(要求|资格|条件|qualificat|requirement|what (we|you).{0,4}(re |ll )?(looking|bring|have))/i },
// //     { type: 'bonus',            weight: 22, re: /(加分|优先|preferred|nice to have|bonus|desirable|a plus)/i },
// //   ];

// //   // 最长匹配优先：解决 "Preferred Qualifications" 被 "Qualifications" 抢走
// //   // 判成 requirements 的问题（同权重时，命中的短语越长越具体，应该赢）。
// //   function matchVocab(text) {
// //     const normText = normalizeForMatch(text);
// //     let best = { type: null, keywordScore: 0, len: 0 };
// //     for (const cfg of SECTION_VOCAB) {
// //       for (const tier of cfg.tiers) {
// //         for (const p of tier.phrases) {
// //           if (!matchPhrase(normText, p)) continue;
// //           const len = normalizeForMatch(p).length;
// //           if (tier.weight > best.keywordScore || (tier.weight === best.keywordScore && len > best.len)) {
// //             best = { type: cfg.type, keywordScore: tier.weight, len };
// //           }
// //         }
// //       }
// //     }
// //     if (!best.type) {
// //       for (const c of CORE_PATTERNS) {
// //         if (c.re.test(normText) && c.weight > best.keywordScore) {
// //           best = { type: c.type, keywordScore: c.weight, len: 0 };
// //         }
// //       }
// //     }
// //     return best;
// //   }

// //   function isStopSection(text) {
// //     const t = text.trim().replace(/[:：\s]+$/, '').toLowerCase();
// //     return STOP_SECTIONS.some((w) => t === w.toLowerCase());
// //   }

// //   // ---------------------------------------------------------------------------
// //   // 多维打分：DOM 维度 + 排版维度 + 语义维度
// //   // ---------------------------------------------------------------------------
// //   function assessSectionHeader(element, text) {
// //     const isCJKText = /[\u4e00-\u9fa5]/.test(text);

// //     // 一票否决：项目符号开头的绝不是标题
// //     if (/^[*•▪◦●\-–]\s+/.test(text)) return { isHeader: false, score: 0, type: null };

// //     // ⚡ 数字编号不再一律否决。"1.岗位职责" 是标题，"1.负责推荐算法设计" 是列表项，
// //     // 两者的区别不在编号而在长度：标题短、列表项长。以前一刀切否决，导致中文
// //     // JD 里极常见的 "1.岗位职责" "2.任职资格" 全被判成列表项而漏掉。
// //     const numbered = /^\d+[.、)）]\s*\S/.test(text) || /^[一二三四五六七八九十]+[、.]\s*\S/.test(text);
// //     const bare = text.replace(/^[（(]?[\d一二三四五六七八九十]+[）)]?[.、)）]?\s*/, '');
// //     if (numbered && bare.length > (isCJKText ? 12 : 30)) {
// //       return { isHeader: false, score: 0, type: null };
// //     }

// //     let domScore = 0;
// //     if (element && element.tagName) {
// //       const tag = element.tagName.toLowerCase();
// //       // className 在 SVG 元素上是对象，统一转字符串
// //       const cls = typeof element.className === 'string' ? element.className : (element.getAttribute?.('class') || '');
// //       const idName = element.id || '';
// //       if (/^h[1-3]$/.test(tag)) domScore += 35;
// //       else if (/^h[4-6]$/.test(tag)) domScore += 25;
// //       else if (tag === 'b' || tag === 'strong') domScore += 20;
// //       else if (tag === 'dt') domScore += 20;
// //       // ⚡ class/id 语义信号——这是纯文本路径拿不到的证据，也是不同平台
// //       // "职责和要求 class 不一样"时最可靠的线索
// //       if (/header|title|section|heading|caption|label|subtitle/i.test(cls + ' ' + idName)) domScore += 30;
// //       // 反向信号：一看就是正文/描述容器
// //       if (/(desc|content|body|text|paragraph)/i.test(cls + ' ' + idName) && !/title|header|heading/i.test(cls + ' ' + idName)) domScore -= 10;
// //     }

// //     let layoutScore = 0;
// //     const isCJK = isCJKText;
// //     if (/[:：]\s*$/.test(text)) layoutScore += 25;
// //     if (text.length <= (isCJK ? 20 : 40)) layoutScore += 20;
// //     if (!isCJK && text === text.toUpperCase() && /[A-Z]{3,}/.test(text)) layoutScore += 18;
// //     if (/[.。]$/.test(text) && !/[:：]$/.test(text)) layoutScore -= 20;
// //     if (text.length > (isCJK ? 40 : 80)) layoutScore -= 40;
// //     // 叙述句特征
// //     if (/(?:we\s+are|you\s+will|our\s+team|looking\s+for\s+a|我们正在|如果你)/i.test(text) && text.length > 30) layoutScore -= 35;

// //     const { type, keywordScore } = matchVocab(text);
// //     const totalScore = domScore + layoutScore + keywordScore;
// //     const headingLen = isCJKText ? 22 : 50;
// //     const isHeader = (totalScore >= 60 && keywordScore > 0)
// //       || (domScore >= 35 && keywordScore >= 25 && text.length <= headingLen);
// //     return { isHeader, type, score: totalScore };
// //   }

// //   // ---------------------------------------------------------------------------
// //   // 按渲染顺序拆块。相比原版修了两处：
// //   //   - <li> 单独成块（原版 UL 的子元素是 LI，不在 some() 的标签清单里，
// //   //     导致整个 UL 被当成一个叶子块，所有列表项糊成一坨）
// //   //   - 直系文本节点不再丢失（原版 else 分支只遍历 element.children）
// //   // ---------------------------------------------------------------------------
// //   const LEAFY = /^(P|LI|H[1-6]|DT|DD|TD|TH|BLOCKQUOTE)$/i;
// //   const CONTAINER = /^(DIV|SECTION|ARTICLE|UL|OL|DL|TABLE|TBODY|TR|MAIN|SPAN|BODY)$/i;

// //   function getVisualTextBlocks(node) {
// //     const blocks = [];
// //     const walk = (el) => {
// //       if (!el || !el.tagName) return;
// //       const tag = el.tagName;
// //       if (/^(SCRIPT|STYLE|NOSCRIPT|SVG)$/i.test(tag)) return;

// //       if (LEAFY.test(tag)) {
// //         const t = (el.textContent || '').trim();
// //         if (t) blocks.push({ element: el, text: t });
// //         return;
// //       }
// //       if (/^(H[1-6]|STRONG|B)$/i.test(tag)) {
// //         const t = (el.textContent || '').trim();
// //         if (t) blocks.push({ element: el, text: t });
// //         return;
// //       }
// //       if (CONTAINER.test(tag)) {
// //         // 先看有没有值得下钻的子元素；没有就把自己整体作为一块
// //         const hasElementChild = el.children && el.children.length > 0;
// //         if (!hasElementChild) {
// //           const t = (el.textContent || '').trim();
// //           if (t) blocks.push({ element: el, text: t });
// //           return;
// //         }
// //         // 有子元素：逐个 childNode 处理，直系文本节点也要保留（原版会丢）
// //         for (const child of Array.from(el.childNodes)) {
// //           if (child.nodeType === 3) { // TEXT_NODE
// //             const t = (child.nodeValue || '').trim();
// //             if (t) blocks.push({ element: el, text: t });
// //           } else if (child.nodeType === 1) {
// //             walk(child);
// //           }
// //         }
// //         return;
// //       }
// //       // 其它标签(如 <a>/<em>)：并入父级由父级处理，这里只兜底取文本
// //       const t = (el.textContent || '').trim();
// //       if (t) blocks.push({ element: el, text: t });
// //     };
// //     walk(node);
// //     return blocks;
// //   }

// //   // ---------------------------------------------------------------------------
// //   // 主入口（DOM 路径）
// //   // ---------------------------------------------------------------------------
// //   function parseJdFromDom(containerNode) {
// //     const blocks = getVisualTextBlocks(containerNode);
// //     const buckets = { intro: [], responsibilities: [], requirements: [], bonus: [] };
// //     let current = 'intro'; // ⚡ 第一个标题之前的内容不再丢弃，归入 intro

// //     for (const { element, text } of blocks) {
// //       const t = text.trim();
// //       if (!t) continue;

// //       // 停止小节：只认"看起来像标题"的短行，且必须已经进入过真实小节
// //       // （开头的 About Us / 公司简介 是开场白，不是结尾样板）
// //       if (current !== 'intro' && t.length <= 40 && isStopSection(t)) break;

// //       const a = assessSectionHeader(element, t);
// //       if (a.isHeader && a.type) { current = a.type; continue; }
// //       buckets[current].push(t);
// //     }

// //     // intro 并入 responsibilities 前部（岗位概述本质上属于"做什么"）
// //     const resp = [...buckets.intro, ...buckets.responsibilities].join('\n').trim();
// //     return {
// //       responsibilities: resp,
// //       requirements: buckets.requirements.join('\n').trim(),
// //       bonus: buckets.bonus.join('\n').trim(),
// //       fullCleanText: blocks.map((b) => b.text).join('\n').trim(),
// //     };
// //   }

// //   // ---------------------------------------------------------------------------
// //   // 纯文本路径（API/JSON 返回时没有 DOM，这条必须保留）
// //   // 复用同一套词表和停止小节，保证两条路结论一致。
// //   // ---------------------------------------------------------------------------
// //   function looksLikeHeadingLine(s) {
// //     s = s.trim();
// //     if (!s || s.length > 60) return false;
// //     if (/^##\s/.test(s) || /[:：]$/.test(s) || /^【.+】$/.test(s) || /^#+\s/.test(s)) return true;
// //     const isCJK = /[\u4e00-\u9fa5]/.test(s);
// //     if (!isCJK && s.length <= 45 && !/[.!?]$/.test(s)) {
// //       if (s === s.toUpperCase() && /[A-Z]{3,}/.test(s)) return true;
// //       const w = s.split(/\s+/);
// //       const small = ['a','an','the','and','or','of','to','for','in','you','we','your','our','will','be','with'];
// //       if (w.length <= 6 && w.every((x) => !/^[a-z]/.test(x) || small.includes(x.toLowerCase()))) return true;
// //     }
// //     return isCJK && s.length <= 20 && !/[。！？]$/.test(s);
// //   }

// //   function normalizeAndMergeLines(text) {
// //     const lines = text.split('\n');
// //     const bullet = /^([•▪◦●\-*]|[\d一二三四五六七八九十]+[.、)）])\s*/;
// //     const out = [];
// //     for (const raw of lines) {
// //       const line = raw.trim();
// //       if (!line) { out.push(''); continue; }
// //       const prev = out[out.length - 1];
// //       const canMerge = prev
// //         && !bullet.test(line) && !looksLikeHeadingLine(line)
// //         && !/[。！？.!?:：；;]$/.test(prev) && !bullet.test(prev) && !looksLikeHeadingLine(prev)
// //         && /^[a-z(,;)]/.test(line); // 只有小写开头才算折行续写
// //       if (canMerge) out[out.length - 1] = prev + ' ' + line;
// //       else out.push(line);
// //     }
// //     return out.filter(Boolean).join('\n');
// //   }

// //   function parseJdFromText(rawText) {
// //     const result = { responsibilities: '', requirements: '', bonus: '', fullCleanText: '' };
// //     if (!rawText || typeof rawText !== 'string') return result;
// //     const text = normalizeAndMergeLines(
// //       rawText.replace(/\r\n?/g, '\n').replace(/\u3000/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
// //     );
// //     result.fullCleanText = text.replace(/^##\s+/gm, '');

// //     const buckets = { intro: [], responsibilities: [], requirements: [], bonus: [] };
// //     let current = 'intro';
// //     for (const raw of text.split('\n')) {
// //       const t = raw.trim();
// //       if (!t) continue;
// //       const bare = t.replace(/^##\s+/, '');
// //       // ⚡ 停止小节只在"已经进入过真实小节"之后才生效。JD 以 "About Us"/"公司简介"
// //       // 开头极其常见，那是开场介绍标题，不是结尾样板；以前一律 break，导致
// //       // 整份 JD 从第一行就被丢弃，最后靠兜底把全文塞进职责（表现为完全不切分）。
// //       if (current !== 'intro' && bare.length <= 40 && isStopSection(bare)) break;

// //       // ⚡ 统一走标定过的 assessSectionHeader（element 传 null 即纯文本+排版+语义）。
// //       // 之前这里是另一套弱判定（looksLikeHeadingLine + keywordScore>=15），
// //       // 阈值远低于 DOM 路径，结果把 "1、负责推荐算法的设计" 这种列表项当成标题
// //       // 吞掉，正文反而丢了。两条路必须共用同一套判定，结论才会一致。
// //       const a = assessSectionHeader(null, bare);
// //       if (a.isHeader && a.type) { current = a.type; continue; }
// //       buckets[current].push(bare);
// //     }
// //     result.responsibilities = [...buckets.intro, ...buckets.responsibilities].join('\n').trim();
// //     result.requirements = buckets.requirements.join('\n').trim();
// //     result.bonus = buckets.bonus.join('\n').trim();
// //     if (!result.responsibilities && !result.requirements && !result.bonus) {
// //       result.responsibilities = result.fullCleanText;
// //     }
// //     return result;
// //   }

// //   // 统一入口：有 DOM 走 DOM，没有就走文本
// //   function parseJdSmart(input) {
// //     if (input && typeof input === 'object' && input.nodeType === 1) return parseJdFromDom(input);
// //     return parseJdFromText(String(input || ''));
// //   }

// //   // HTML 正文清洗：BOSS 的 postDescription 有时带 <br>/&nbsp; 等实体
// //   function htmlToText(html) {
// //     if (!html || typeof html !== 'string') return '';
// //     if (!/[<&]/.test(html)) return html;
// //     return html
// //       .replace(/<\s*br\s*\/?\s*>/gi, '\n')
// //       .replace(/<\s*\/\s*(p|div|li|tr)\s*>/gi, '\n')
// //       .replace(/<[^>]+>/g, '')
// //       .replace(/&nbsp;/gi, ' ')
// //       .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
// //       .replace(/&amp;/g, '&').replace(/&quot;/g, '"');
// //   }

// //   // ---------------------------------------------------------------------
// //   // 2. 通用："点击相关性捕获窗口"
// //   //    content.js 在模拟点击前派发 REQ_BEGIN_CAPTURE，我们打开一个短窗口；
// //   //    窗口内任何"形状像 JD"的响应，直接归属给刚点击的那张卡片。
// //   //    这样就不需要从 payload 里猜 ID 字段名——这是能真正跨站点复用的关键。
// //   // ---------------------------------------------------------------------
// //   let activeCapture = null; // { cardId, startedAt, best: {score, detail} | null }

// //   document.addEventListener('REQ_BEGIN_CAPTURE', (e) => {
// //     const { cardId } = e.detail || {};
// //     if (!cardId) return;
// //     activeCapture = { cardId: String(cardId), startedAt: Date.now(), best: null };
// //     diag('捕获窗口已开启, cardId =', cardId);
// //   });

// //   document.addEventListener('REQ_END_CAPTURE', () => {
// //     if (!activeCapture) return;
// //     // 窗口关闭时，如果期间攒到了候选，把得分最高的那个作为该卡片的详情发出去
// //     if (activeCapture.best) {
// //       diag('捕获窗口关闭，采用最佳候选, score =', activeCapture.best.score);
// //       window.postMessage({
// //         type: 'JOB_HOOK_DETAIL', site: SITE,
// //         data: { ...activeCapture.best.detail, matchKey: activeCapture.cardId, source: 'Click-Correlated Capture' }
// //       }, '*');
// //     }
// //     activeCapture = null;
// //   });

// //   // JD 形状打分：文本越长、越命中 JD 关键词、越像自然语言，分越高。
// //   // 用来在捕获窗口内出现多个候选时挑出最像职位详情的那一个，
// //   // 也用来把埋点/推荐位这类"碰巧也很长"的响应排除掉。
// //   const JD_KEYWORD_PATTERN = /(岗位职责|工作职责|任职要求|任职资格|岗位要求|职位描述|工作内容|加分项|Responsibilities|Requirements|Qualifications|Job\s+Description|What\s+you.{0,10}do)/gi;

// //   function scoreJdText(text) {
// //     if (!text || text.length < 150) return 0;
// //     const kwHits = (text.match(JD_KEYWORD_PATTERN) || []).length;
// //     const hasSentences = /[。！？.!?]/.test(text);
// //     if (!kwHits && !hasSentences) return 0;

// //     // ⚡ 提高识别度：除了关键词命中，再叠加几个"这看起来确实是 JD 正文"的结构特征。
// //     // 目的是把"碰巧很长的自然语言"（公司简介、用户协议、推荐位文案）跟真正的
// //     // 职位描述区分开——JD 的典型形态是"分条列举的要求/职责"。
// //     let structureBonus = 0;
// //     // 项目符号/编号列表：JD 几乎必有
// //     const bulletLines = (text.match(/(?:^|\n)\s*(?:[•·▪●\-*]|\d+[.、)）])\s*\S/g) || []).length;
// //     if (bulletLines >= 3) structureBonus += 120;
// //     else if (bulletLines >= 1) structureBonus += 40;
// //     // 年限/学历/技能这类硬性要求措辞
// //     if (/(\d+\s*[-~到]?\s*\d*\s*年(以上)?(工作)?经验|本科|硕士|博士|大专|years?\s+of\s+experience|bachelor|master's|degree)/i.test(text)) structureBonus += 80;
// //     // 负面信号：明显是公司介绍/协议条款而不是岗位描述
// //     if (/(公司简介|关于我们|企业文化|发展历程|隐私政策|用户协议|Cookie|About\s+Us|Privacy\s+Policy|Terms\s+of\s+Service)/i.test(text)
// //         && kwHits === 0) structureBonus -= 150;

// //     return Math.min(kwHits, 5) * 100 + Math.min(text.length, 4000) * 0.05 + structureBonus;
// //   }

// //   // 递归找 payload 里最像 JD 正文的那个字符串字段
// //   function findBestJdTextInPayload(node, depth = 0, seen = new Set()) {
// //     if (!node || typeof node !== 'object' || depth > 6 || seen.has(node)) return null;
// //     seen.add(node);
// //     let best = null;
// //     for (const key in node) {
// //       if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
// //       const val = node[key];
// //       if (typeof val === 'string') {
// //         const text = htmlToText(val);
// //         const score = scoreJdText(text);
// //         if (score > 0 && (!best || score > best.score)) {
// //           best = { score, text, key, container: node };
// //         }
// //       } else if (val && typeof val === 'object') {
// //         const sub = findBestJdTextInPayload(val, depth + 1, seen);
// //         if (sub && (!best || sub.score > best.score)) best = sub;
// //       }
// //     }
// //     return best;
// //   }

// //   const TITLE_LIKE_KEYS = ['jobName', 'title', 'jobTitle', 'positionName', 'name', 'headline'];
// //   function guessTitle(container) {
// //     if (!container) return '';
// //     for (const k of TITLE_LIKE_KEYS) {
// //       if (typeof container[k] === 'string' && container[k].length < 100) return container[k];
// //     }
// //     return '';
// //   }

// //   // 捕获窗口内的候选收集：不立刻发出，先攒着比分数，窗口关闭时发最佳的那个
// //   // ⚡ 高置信度候选立刻发出，不等窗口关闭。
// //   // 之前的设计是"窗口内攒着，REQ_END_CAPTURE 时发最佳的那个"——但 content.js
// //   // 侧的 REQ_END_CAPTURE 是在 finalize() 里派发的，而 finalize() 只在已经
// //   // resolve/超时时才跑，等于候选永远晚一拍，network 这个源在观察窗口内根本
// //   // 没机会赢，白白掉到更慢的 pageFetch。现在改成：分数够高(明显就是 JD)就
// //   // 立即发出，让等待中的 Promise 当场接住；分数不够高的才留到窗口关闭时兜底。
// //   const CONFIDENT_SCORE = 260; // 约等于"命中 2 个以上 JD 关键词 + 有列表结构"

// //   function offerToCapture(json) {
// //     if (!activeCapture) return false;
// //     const best = findBestJdTextInPayload(json);
// //     if (!best) return false;

// //     const detail = { title: guessTitle(best.container), ...parseJdSmart(best.text) };

// //     if (best.score >= CONFIDENT_SCORE) {
// //       diag('捕获窗口内命中高置信度候选，立即发出, score =', best.score, 'key =', best.key);
// //       window.postMessage({
// //         type: 'JOB_HOOK_DETAIL', site: SITE,
// //         data: { ...detail, matchKey: activeCapture.cardId, source: 'Click-Correlated Capture' }
// //       }, '*');
// //       activeCapture.best = null; // 已经发过了，窗口关闭时不用再发一遍
// //       return true;
// //     }

// //     if (activeCapture.best && activeCapture.best.score >= best.score) return true;
// //     activeCapture.best = { score: best.score, detail };
// //     diag('捕获窗口内收到低置信度候选(暂存), score =', best.score, 'key =', best.key);
// //     return true;
// //   }

// //   // ---------------------------------------------------------------------
// //   // 3. BOSS 专属规则（优先级最高，因为字段结构确定，解析最准）
// //   // ---------------------------------------------------------------------
// //   // ⚡ URL 放宽：不再写死 /job/detail.json。BOSS 换路径/换域名前缀的情况很常见，
// //   //    这里覆盖常见几种，再由 payload 结构做二次确认（zpData.jobInfo 存在才算数）。
// //   const BOSS_DETAIL_URL = /\/(job\/detail|jobdetail|job\/card|geek\/job\/detail)\.json/i;
// //   const BOSS_LIST_URL = /\/(joblist|job\/list|geek\/joblist)\.json/i;

// //   function parseBossDetail(json, url) {
// //     const jobInfo = json?.zpData?.jobInfo;
// //     if (!jobInfo) return null;

// //     // matchKey 多级兜底：URL query 的 securityId 最可靠（跟 content.js 发起
// //     // 点击时用的是同一个值），其次 payload 里的各种 id，最后交给点击相关性。
// //     let matchKey = '';
// //     try { matchKey = new URL(url, location.origin).searchParams.get('securityId') || ''; } catch (e) {}
// //     if (!matchKey) matchKey = jobInfo.encryptJobId || jobInfo.encryptId || jobInfo.securityId || '';
// //     if (!matchKey && activeCapture) matchKey = activeCapture.cardId;

// //     const rawDesc = htmlToText(jobInfo.postDescription || '');
// //     return {
// //       matchKey,
// //       title: jobInfo.jobName || '',
// //       salary: jobInfo.salaryDesc || '',
// //       company: json.zpData.brandComInfo?.brandName || '',
// //       location: jobInfo.locationName || '',
// //       ...parseJdSmart(rawDesc)
// //     };
// //   }

// //   function notifyList(list) {
// //     if (!Array.isArray(list) || list.length === 0) return;
// //     window.postMessage({ type: 'JOB_HOOK_LIST', site: SITE, data: list }, '*');
// //   }

// //   function notifyDetail(detail) {
// //     if (!detail) return;
// //     if (!detail.matchKey) {
// //       // ⚡ 以前这里直接 return，静默丢弃。现在至少留个诊断痕迹，
// //       //    并且如果捕获窗口开着，就把它归属给当前点击的卡片。
// //       if (activeCapture) {
// //         detail = { ...detail, matchKey: activeCapture.cardId, source: 'Click-Correlated Fallback' };
// //         diag('详情缺少 matchKey，按点击相关性归属给', activeCapture.cardId);
// //       } else {
// //         diag('⚠️ 拿到详情但没有 matchKey，且没有捕获窗口，只能丢弃');
// //         return;
// //       }
// //     }
// //     window.postMessage({ type: 'JOB_HOOK_DETAIL', site: SITE, data: detail }, '*');
// //   }

// //   // ---------------------------------------------------------------------
// //   // 4. LinkedIn / generic 的内容特征扫描（沿用上一版思路）
// //   // ---------------------------------------------------------------------
// //   const LINKEDIN_PAYLOAD_HINT = /fsd_jobPosting|jobPostingUrn|"description":\s*\{\s*"text"/;

// //   function extractJobIdFromUrn(urn) {
// //     if (typeof urn !== 'string') return null;
// //     const m = urn.match(/(?:fsd_jobPosting|jobPosting):(\d+)/);
// //     return m ? m[1] : null;
// //   }

// //   function scanLinkedInPayloadForJobPosting(node, results, seen, depth = 0) {
// //     if (!node || typeof node !== 'object' || seen.has(node) || depth > 8) return;
// //     seen.add(node);
// //     const entityUrn = node.entityUrn || node['*entityUrn'] || node.jobPostingUrn || '';
// //     const jobId = extractJobIdFromUrn(entityUrn) || (node.jobPostingId ? String(node.jobPostingId) : null);
// //     const rawDesc = typeof node.description === 'string'
// //       ? node.description
// //       : (node.description && typeof node.description.text === 'string' ? node.description.text : '');
// //     if (jobId && rawDesc) results.push({ matchKey: jobId, title: node.title || '', rawDesc: htmlToText(rawDesc) });
// //     for (const key in node) {
// //       if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
// //       const val = node[key];
// //       if (val && typeof val === 'object') scanLinkedInPayloadForJobPosting(val, results, seen, depth + 1);
// //     }
// //   }

// //   // ---------------------------------------------------------------------
// //   // 5. 统一响应处理入口
// //   // ---------------------------------------------------------------------
// //   function handleResponse(url, payloadText, payloadObj) {
// //     let json = payloadObj;
// //     if (!json) {
// //       if (!payloadText || payloadText.length < 50) return;
// //       // 便宜的预筛，避免对每个响应都 JSON.parse
// //       if (payloadText[0] !== '{' && payloadText[0] !== '[') return;
// //       try { json = JSON.parse(payloadText); } catch (e) { return; }
// //     }
// //     if (!json || typeof json !== 'object') return;

// //     // ---- 诊断：把疑似职位相关的响应打出来，帮你定位真实接口 ----
// //     if (window.__jdpDiag) {
// //       const probe = findBestJdTextInPayload(json);
// //       if (probe) {
// //         diag('疑似含 JD 正文的响应:', { url, 字段名: probe.key, 分数: probe.score, 前120字: probe.text.slice(0, 120) });
// //       }
// //     }

// //     // ---- BOSS 专属规则优先 ----
// //     if (SITE === 'boss') {
// //       if (BOSS_LIST_URL.test(url)) {
// //         const list = json?.zpData?.jobList;
// //         if (list) { diag('命中列表接口', url, '条数', list.length); notifyList(list); }
// //       }
// //       // URL 命中 或 payload 结构命中（换路径也不会失效）
// //       if (BOSS_DETAIL_URL.test(url) || json?.zpData?.jobInfo) {
// //         const detail = parseBossDetail(json, url);
// //         if (detail) {
// //           diag('命中详情接口', url, 'matchKey =', detail.matchKey);
// //           notifyDetail(detail);
// //           return;
// //         }
// //       }
// //     }

// //     if (SITE === 'linkedin' && LINKEDIN_PAYLOAD_HINT.test(payloadText || JSON.stringify(json).slice(0, 20000))) {
// //       const results = [];
// //       scanLinkedInPayloadForJobPosting(json, results, new Set());
// //       results.forEach((r) => notifyDetail({ matchKey: r.matchKey, title: r.title, ...parseJdSmart(r.rawDesc) }));
// //       if (results.length) return;
// //     }

// //     // ---- 通用兜底：点击相关性捕获（所有站点都适用，包括 BOSS 规则没命中时）----
// //     offerToCapture(json);
// //   }

// //   // ---------------------------------------------------------------------
// //   // 6. Hook XHR —— ⚡ 修复 responseType 导致的静默失效
// //   // ---------------------------------------------------------------------
// //   const origOpen = XMLHttpRequest.prototype.open;
// //   const origSend = XMLHttpRequest.prototype.send;

// //   XMLHttpRequest.prototype.open = function (method, url) {
// //     this.__hookUrl = url;
// //     return origOpen.apply(this, arguments);
// //   };

// //   XMLHttpRequest.prototype.send = function () {
// //     this.addEventListener('load', function () {
// //       try {
// //         const url = this.responseURL || this.__hookUrl || '';
// //         const rt = this.responseType;
// //         // ⚡ 关键修复：responseText 只在 responseType 为 '' 或 'text' 时可读，
// //         // 其它情况（尤其是 'json'）读它会抛 DOMException，被 catch 吞掉后
// //         // 表现为"拦截装了但永远不触发"。这里按类型分别取值。
// //         if (rt === '' || rt === 'text') {
// //           handleResponse(url, this.responseText, null);
// //         } else if (rt === 'json') {
// //           handleResponse(url, null, this.response);
// //         }
// //         // 'blob'/'arraybuffer'/'document' 不是 JSON 接口，直接忽略
// //       } catch (e) {
// //         diag('XHR 响应处理异常(已忽略):', e && e.message);
// //       }
// //     });
// //     return origSend.apply(this, arguments);
// //   };

// //   // ---------------------------------------------------------------------
// //   // 7. Hook fetch
// //   // ---------------------------------------------------------------------
// //   const origFetch = window.fetch;
// //   if (typeof origFetch === 'function') {
// //     window.fetch = function (input, init) {
// //       const url = typeof input === 'string' ? input : (input && input.url) || '';
// //       return origFetch.apply(this, arguments).then((res) => {
// //         try {
// //           res.clone().text().then((text) => handleResponse(url, text, null)).catch(() => {});
// //         } catch (e) {}
// //         return res;
// //       });
// //     };
// //   }

// //   // ---------------------------------------------------------------------
// //   // 8. BOSS 首屏 SSR 数据
// //   // ---------------------------------------------------------------------
// //   if (SITE === 'boss') {
// //     try {
// //       if (window.__INITIAL_STATE__?.jobList) notifyList(window.__INITIAL_STATE__.jobList);
// //     } catch (e) {}
// //   }

// //   // ---------------------------------------------------------------------
// //   // 9. 主动兜底通道（保持原有行为不变）
// //   // ---------------------------------------------------------------------
// //   function getLinkedInCsrfToken() {
// //     const m = document.cookie.match(/JSESSIONID="?([^";]+)"?/);
// //     return m ? m[1] : '';
// //   }

// //   async function directFetchDetail(matchKey, meta) {
// //     if (SITE === 'linkedin') {
// //       const csrfToken = getLinkedInCsrfToken();
// //       if (!csrfToken) return null;
// //       try {
// //         const res = await fetch(`https://www.linkedin.com/voyager/api/jobs/jobPostings/${matchKey}`, {
// //           method: 'GET',
// //           headers: {
// //             'csrf-token': csrfToken,
// //             'x-restli-protocol-version': '2.0.0',
// //             'accept': 'application/vnd.linkedin.normalized+json+2.0.0, application/json, text/plain, */*',
// //             'x-li-lang': 'zh_CN'
// //           }
// //         });
// //         if (!res.ok) return null;
// //         const json = await res.json();
// //         const rawDesc = htmlToText(json?.description?.text || (typeof json?.description === 'string' ? json.description : ''));
// //         return { matchKey: String(matchKey), title: json?.title || '', ...parseJdSmart(rawDesc) };
// //       } catch (e) { return null; }
// //     }

// //     if (SITE === 'boss') {
// //       const securityId = matchKey;
// //       const lid = meta?.lid || '';
// //       if (!securityId) return null;
// //       try {
// //         const apiUrl = `/wapi/zpgeek/job/detail.json?securityId=${encodeURIComponent(securityId)}&lid=${encodeURIComponent(lid)}`;
// //         const res = await fetch(apiUrl, {
// //           headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, text/plain, */*' }
// //         });
// //         if (!res.ok) return null;
// //         const json = await res.json();
// //         return parseBossDetail(json, apiUrl);
// //       } catch (e) { return null; }
// //     }
// //     return null;
// //   }

// //   document.addEventListener('REQ_DIRECT_FETCH_JOB', async (e) => {
// //     const { matchKey, meta, requestId } = e.detail || {};
// //     const data = await directFetchDetail(matchKey, meta);
// //     document.dispatchEvent(new CustomEvent('RESP_DIRECT_FETCH_JOB', { detail: { requestId, matchKey, data } }));
// //   });

// //   document.documentElement.dataset.injectReady = 'true';
// //   document.dispatchEvent(new CustomEvent('INJECT_SCRIPT_READY'));
// //   console.log(`✅ [injected.js] (${SITE}) 挂载完成。排查拦截问题请在控制台执行: window.__jdpDiag = true`);
// // })();
// /**
//  * ==============================================================================
//  * injected.js — 运行在页面主环境 (MAIN World)
//  *
//  * 本版相对上一版的关键修复与新增：
//  *   [修复] XHR hook 读 responseText 在 responseType='json'/'blob' 时会抛
//  *          DOMException，被 catch 静默吞掉 → 拦截永远不触发（"只有直接请求，
//  *          没有拦截"的根因）。现在按 responseType 分支取值。
//  *   [修复] BOSS 详情接口 URL 从写死 /job/detail.json 放宽成多模式匹配，
//  *          并保留"内容形状"兜底，避免站点换路径就全线失效。
//  *   [修复] matchKey 取不到时不再静默丢弃，走多级兜底（URL → payload → 点击相关性）。
//  *   [新增] 诊断模式：把流经的、疑似职位相关的 JSON 响应打到控制台，
//  *          让你能直接看到 BOSS 真实的详情接口叫什么、字段长什么样。
//  *   [新增] 通用"点击相关性捕获"：content.js 点击前开一个捕获窗口，窗口内
//  *          出现的 JD 形状响应直接归属给刚点击的那张卡——不需要知道站点的
//  *          ID 字段名/位置，这是真正站点无关的机制。
//  * ==============================================================================
//  */
// (function () {
//   'use strict';
//   if (window.__jobHookInjected) return;
//   window.__jobHookInjected = true;

//   // ---------------------------------------------------------------------
//   // 0. 站点识别 & 诊断开关
//   // ---------------------------------------------------------------------
//   const SITE = location.host.includes('zhipin.com')
//     ? 'boss'
//     : location.host.includes('linkedin.com')
//       ? 'linkedin'
//       : (location.host.includes('zhaopin.com') || location.host.includes('zhilian.com'))
//         ? 'zhaopin'
//       : 'generic';

//   // 诊断模式：控制台执行 window.__jdpDiag = true 即可打开（不用改代码重装插件），
//   // 打开后会把所有"疑似职位相关"的响应 URL + 字段结构打出来。
//   // 排查"到底哪个接口才是详情接口"时非常有用。
//   const diag = (...args) => { if (window.__jdpDiag) console.log('%c[JDP-DIAG]', 'color:#0a66c2;font-weight:bold', ...args); };
//   window.__jdpDiag = window.__jdpDiag || false;

//   // ---------------------------------------------------------------------
//   // 1. JD 文本解析（与 content.js 保持同一套语义，避免两边结果不一致）
//   // ---------------------------------------------------------------------
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


  

//   const SECTION_VOCAB = [
//     {
//       type: 'responsibilities',
//       tiers: [
//         { weight: 50, phrases: ['岗位职责','工作职责','职责描述','主要职责','工作内容','岗位描述','职位描述',
//             'Responsibilities','Key Responsibilities','Primary Responsibilities','Core Responsibilities',
//             'Duties and Responsibilities','Essential Duties','Essential Functions','Essential Job Functions','Key Accountabilities','Responsibility','职位职责','工作内容及职责'] },
//         { weight: 40, phrases: ["What you'll do",'What you will do',"What You'll Be Doing",'About the Role',
//             'About this Role','About the job','Role Overview','Role Summary','Job Summary','Job Purpose',
//             'The Role','Your Impact','Duties','你将负责','主要工作','主要负责','负责内容'] },
//         { weight: 25, phrases: ['职责','Tasks','任务'] },
//       ],
//     },
//     {
//       type: 'requirements',
//       tiers: [
//         { weight: 50, phrases: ['任职要求','任职资格','岗位要求','招聘条件','职位要求','能力要求','岗位条件',
//             'Requirements','Qualifications','Job Requirements','Basic Qualifications','Minimum Qualifications',
//             'Required Qualifications','Key Qualifications','Skills and Qualifications','Education and Experience','Requirement','Qualification','技能要求','能力要求'] },
//         { weight: 40, phrases: ["What we're looking for",'What we are looking for','Who You Are',
//             "What You'll Bring",'What You Bring','Skills & Experience','Required Skills','Must Have','Must-haves',
//             '你需要具备','我们需要你'] },
//         { weight: 25, phrases: ['要求','资格','Skills'] },
//       ],
//     },
//     {
//       type: 'bonus',
//       tiers: [
//         { weight: 50, phrases: ['加分项','优先条件','优先考虑','加分技能',
//             'Preferred Qualifications','Additional Qualifications','Preferred Experience','Preferred Skills',
//             'Nice to have','Nice-to-haves','Bonus Points','Desirable Skills'] },
//         { weight: 40, phrases: ['具备以下者优先','有以下经验优先','Bonus points if you have','A plus if','An asset','Desirable'] },
//         { weight: 25, phrases: ['加分','Preferred'] },
//       ],
//     },
//   ];

//   // 停止小节：命中即结束正文收集，后面的内容全部丢弃
//   const STOP_SECTIONS = [
//     '福利待遇','薪资福利','公司简介','关于我们','企业文化','工作地点','投递方式','我们提供',
//     'Benefits','What We Offer','Perks','Perks and Benefits','Compensation','Salary','Pay Range',
//     'Working Conditions','Work Environment','Physical Requirements',
//     'EEO Statement','Equal Opportunity','Equal Employment Opportunity','EEO',
//     'About Us','About the Company','Our Story','Our Mission','Why Join Us','Who We Are',
//     'How to Apply','Application Process','Next Steps','Disclaimer','Legal',
//   ];

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
//   //  function parseJdSmart(input) {
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


//   function parseJdSmart(input) {
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
//   // HTML 正文清洗：BOSS 的 postDescription 有时带 <br>/&nbsp; 等实体
//   function htmlToText(html) {
//     if (!html || typeof html !== 'string') return '';
//     if (!/[<&]/.test(html)) return html;
//     return html
//       .replace(/<\s*br\s*\/?\s*>/gi, '\n')
//       .replace(/<\s*\/\s*(p|div|li|tr)\s*>/gi, '\n')
//       .replace(/<[^>]+>/g, '')
//       .replace(/&nbsp;/gi, ' ')
//       .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
//       .replace(/&amp;/g, '&').replace(/&quot;/g, '"');
//   }

//   // ---------------------------------------------------------------------
//   // 2. 通用："点击相关性捕获窗口"
//   //    content.js 在模拟点击前派发 REQ_BEGIN_CAPTURE，我们打开一个短窗口；
//   //    窗口内任何"形状像 JD"的响应，直接归属给刚点击的那张卡片。
//   //    这样就不需要从 payload 里猜 ID 字段名——这是能真正跨站点复用的关键。
//   // ---------------------------------------------------------------------
//   let activeCapture = null; // { cardId, startedAt, best: {score, detail} | null }

//   document.addEventListener('REQ_BEGIN_CAPTURE', (e) => {
//     const { cardId } = e.detail || {};
//     if (!cardId) return;
//     activeCapture = { cardId: String(cardId), startedAt: Date.now(), best: null };
//     diag('捕获窗口已开启, cardId =', cardId);
//   });

//   document.addEventListener('REQ_END_CAPTURE', () => {
//     if (!activeCapture) return;
//     // 窗口关闭时，如果期间攒到了候选，把得分最高的那个作为该卡片的详情发出去
//     if (activeCapture.best) {
//       diag('捕获窗口关闭，采用最佳候选, score =', activeCapture.best.score);
//       window.postMessage({
//         type: 'JOB_HOOK_DETAIL', site: SITE,
//         data: { ...activeCapture.best.detail, matchKey: activeCapture.cardId, source: 'Click-Correlated Capture' }
//       }, '*');
//     }
//     activeCapture = null;
//   });

//   // JD 形状打分：文本越长、越命中 JD 关键词、越像自然语言，分越高。
//   // 用来在捕获窗口内出现多个候选时挑出最像职位详情的那一个，
//   // 也用来把埋点/推荐位这类"碰巧也很长"的响应排除掉。
//   const JD_KEYWORD_PATTERN = /(岗位职责|工作职责|任职要求|任职资格|岗位要求|职位描述|工作内容|加分项|Responsibilities|Requirements|Qualifications|Job\s+Description|What\s+you.{0,10}do)/gi;

//   function scoreJdText(text) {
//     if (!text || text.length < 150) return 0;
//     const kwHits = (text.match(JD_KEYWORD_PATTERN) || []).length;
//     const hasSentences = /[。！？.!?]/.test(text);
//     if (!kwHits && !hasSentences) return 0;

//     // ⚡ 提高识别度：除了关键词命中，再叠加几个"这看起来确实是 JD 正文"的结构特征。
//     // 目的是把"碰巧很长的自然语言"（公司简介、用户协议、推荐位文案）跟真正的
//     // 职位描述区分开——JD 的典型形态是"分条列举的要求/职责"。
//     let structureBonus = 0;
//     // 项目符号/编号列表：JD 几乎必有
//     const bulletLines = (text.match(/(?:^|\n)\s*(?:[•·▪●\-*]|\d+[.、)）])\s*\S/g) || []).length;
//     if (bulletLines >= 3) structureBonus += 120;
//     else if (bulletLines >= 1) structureBonus += 40;
//     // 年限/学历/技能这类硬性要求措辞
//     if (/(\d+\s*[-~到]?\s*\d*\s*年(以上)?(工作)?经验|本科|硕士|博士|大专|years?\s+of\s+experience|bachelor|master's|degree)/i.test(text)) structureBonus += 80;
//     // 负面信号：明显是公司介绍/协议条款而不是岗位描述
//     if (/(公司简介|关于我们|企业文化|发展历程|隐私政策|用户协议|Cookie|About\s+Us|Privacy\s+Policy|Terms\s+of\s+Service)/i.test(text)
//         && kwHits === 0) structureBonus -= 150;

//     return Math.min(kwHits, 5) * 100 + Math.min(text.length, 4000) * 0.05 + structureBonus;
//   }

//   // 递归找 payload 里最像 JD 正文的那个字符串字段
//   function findBestJdTextInPayload(node, depth = 0, seen = new Set()) {
//     if (!node || typeof node !== 'object' || depth > 6 || seen.has(node)) return null;
//     seen.add(node);
//     let best = null;
//     for (const key in node) {
//       if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
//       const val = node[key];
//       if (typeof val === 'string') {
//         const text = htmlToText(val);
//         const score = scoreJdText(text);
//         if (score > 0 && (!best || score > best.score)) {
//           best = { score, text, key, container: node };
//         }
//       } else if (val && typeof val === 'object') {
//         const sub = findBestJdTextInPayload(val, depth + 1, seen);
//         if (sub && (!best || sub.score > best.score)) best = sub;
//       }
//     }
//     return best;
//   }

//   const TITLE_LIKE_KEYS = ['jobName', 'title', 'jobTitle', 'positionName', 'name', 'headline'];
//   function guessTitle(container) {
//     if (!container) return '';
//     for (const k of TITLE_LIKE_KEYS) {
//       if (typeof container[k] === 'string' && container[k].length < 100) return container[k];
//     }
//     return '';
//   }

//   // 捕获窗口内的候选收集：不立刻发出，先攒着比分数，窗口关闭时发最佳的那个
//   // ⚡ 高置信度候选立刻发出，不等窗口关闭。
//   // 之前的设计是"窗口内攒着，REQ_END_CAPTURE 时发最佳的那个"——但 content.js
//   // 侧的 REQ_END_CAPTURE 是在 finalize() 里派发的，而 finalize() 只在已经
//   // resolve/超时时才跑，等于候选永远晚一拍，network 这个源在观察窗口内根本
//   // 没机会赢，白白掉到更慢的 pageFetch。现在改成：分数够高(明显就是 JD)就
//   // 立即发出，让等待中的 Promise 当场接住；分数不够高的才留到窗口关闭时兜底。
//   const CONFIDENT_SCORE = 260; // 约等于"命中 2 个以上 JD 关键词 + 有列表结构"

//   function offerToCapture(json) {
//     if (!activeCapture) return false;
//     const best = findBestJdTextInPayload(json);
//     if (!best) return false;

//     const detail = { title: guessTitle(best.container), ...parseJdSmart(best.text) };

//     if (best.score >= CONFIDENT_SCORE) {
//       diag('捕获窗口内命中高置信度候选，立即发出, score =', best.score, 'key =', best.key);
//       window.postMessage({
//         type: 'JOB_HOOK_DETAIL', site: SITE,
//         data: { ...detail, matchKey: activeCapture.cardId, source: 'Click-Correlated Capture' }
//       }, '*');
//       activeCapture.best = null; // 已经发过了，窗口关闭时不用再发一遍
//       return true;
//     }

//     if (activeCapture.best && activeCapture.best.score >= best.score) return true;
//     activeCapture.best = { score: best.score, detail };
//     diag('捕获窗口内收到低置信度候选(暂存), score =', best.score, 'key =', best.key);
//     return true;
//   }

//   // ---------------------------------------------------------------------
//   // 3. BOSS 专属规则（优先级最高，因为字段结构确定，解析最准）
//   // ---------------------------------------------------------------------
//   // ⚡ URL 放宽：不再写死 /job/detail.json。BOSS 换路径/换域名前缀的情况很常见，
//   //    这里覆盖常见几种，再由 payload 结构做二次确认（zpData.jobInfo 存在才算数）。
//   const BOSS_DETAIL_URL = /\/(job\/detail|jobdetail|job\/card|geek\/job\/detail)\.json/i;
//   const BOSS_LIST_URL = /\/(joblist|job\/list|geek\/joblist)\.json/i;
//   const ZHAOPIN_DETAIL_URL = /(?:^|\/\/)fe-api\.zhaopin\.com\/c\/i\/jobs\/detail|\/c\/i\/jobs\/detail/i;
//   const ZHAOPIN_LIST_URL = /(?:^|\/\/)fe-api\.zhaopin\.com\/c\/i\/(?:search|jobs|position|positions)|\/c\/i\/jobs\/search|\/sou\/result/i;
//   const ZHAOPIN_ID_KEYS = ['number', 'jobNumber', 'job_number', 'jobId', 'jobID', 'jobid', 'positionId', 'positionID', 'positionNumber', 'position_number'];
//   const ZHAOPIN_TITLE_KEYS = ['jobName', 'name', 'title', 'jobTitle', 'positionName'];
//   const ZHAOPIN_DESC_KEYS = ['jobDesc', 'jobDescription', 'description', 'describe', 'positionDesc', 'positionDetail', 'responsibility', 'jobDetail', 'details', 'content'];
//   const ZHAOPIN_SALARY_KEYS = ['salaryDesc', 'salary', 'salaryReal', 'salary60', 'salaryName'];
//   const ZHAOPIN_COMPANY_KEYS = ['companyName', 'brandName', 'company', 'companyInfo', 'companyDTO'];
//   const ZHAOPIN_LOCATION_KEYS = ['cityName', 'workCity', 'city', 'cityDisplay', 'areaDistrict', 'workAddress', 'location'];

//   function zhaopinValueToText(value) {
//     if (value == null) return '';
//     if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
//     if (Array.isArray(value)) return value.map(zhaopinValueToText).filter(Boolean).join(' ').trim();
//     if (typeof value === 'object') {
//       for (const key of ['display', 'name', 'value', 'text', 'label', 'content', 'title']) {
//         const text = zhaopinValueToText(value[key]);
//         if (text) return text;
//       }
//     }
//     return '';
//   }

//   function findZhaopinValueByKeys(node, keys, depth = 0, seen = new Set()) {
//     if (!node || typeof node !== 'object' || depth > 5 || seen.has(node)) return '';
//     seen.add(node);
//     for (const key of keys) {
//       if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
//       const text = zhaopinValueToText(node[key]);
//       if (text) return text;
//     }
//     for (const key in node) {
//       if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
//       const value = node[key];
//       if (!value || typeof value !== 'object') continue;
//       const text = findZhaopinValueByKeys(value, keys, depth + 1, seen);
//       if (text) return text;
//     }
//     return '';
//   }

//   function unwrapZhaopinData(json) {
//     return json?.data?.jobDetail
//       || json?.data?.jobInfo
//       || json?.data?.detail
//       || json?.data
//       || json?.result?.data
//       || json?.result
//       || json;
//   }

//   function extractZhaopinMatchKey(data, url, fallbackMatchKey = '') {
//     if (fallbackMatchKey) return String(fallbackMatchKey);
//     try {
//       const params = new URL(url, location.origin).searchParams;
//       for (const key of ZHAOPIN_ID_KEYS) {
//         const val = params.get(key);
//         if (val) return String(val);
//       }
//     } catch (e) {}
//     return findZhaopinValueByKeys(data, ZHAOPIN_ID_KEYS);
//   }

//   function parseZhaopinDetail(json, url, fallbackMatchKey = '') {
//     const dataRaw = unwrapZhaopinData(json);
//     if (!dataRaw) return null;
//     const data = typeof dataRaw === 'object' ? dataRaw : { description: String(dataRaw) };
//     const directDesc = findZhaopinValueByKeys(data, ZHAOPIN_DESC_KEYS);
//     const best = findBestJdTextInPayload(data);
//     const rawDesc = htmlToText(directDesc || best?.text || '');
//     if (!rawDesc || rawDesc.length < 50) return null;

//     const parsed = parseJdSmart(rawDesc);
//     if (!parsed.fullCleanText) parsed.fullCleanText = rawDesc;
//     if (!parsed.responsibilities && !parsed.requirements && parsed.fullCleanText) {
//       parsed.responsibilities = parsed.fullCleanText;
//     }

//     const realJobId = extractZhaopinMatchKey(data, url);
//     return {
//       matchKey: extractZhaopinMatchKey(data, url, fallbackMatchKey || realJobId),
//       jobId: realJobId || fallbackMatchKey,
//       number: realJobId || '',
//       title: findZhaopinValueByKeys(data, ZHAOPIN_TITLE_KEYS),
//       salary: findZhaopinValueByKeys(data, ZHAOPIN_SALARY_KEYS),
//       company: findZhaopinValueByKeys(data, ZHAOPIN_COMPANY_KEYS),
//       location: findZhaopinValueByKeys(data, ZHAOPIN_LOCATION_KEYS),
//       ...parsed
//     };
//   }

//   function normalizeZhaopinListItem(item) {
//     if (!item || typeof item !== 'object') return null;
//     const jobId = extractZhaopinMatchKey(item, '');
//     const jobName = findZhaopinValueByKeys(item, ZHAOPIN_TITLE_KEYS);
//     const salaryDesc = findZhaopinValueByKeys(item, ZHAOPIN_SALARY_KEYS);
//     const brandName = findZhaopinValueByKeys(item, ZHAOPIN_COMPANY_KEYS);
//     const cityName = findZhaopinValueByKeys(item, ZHAOPIN_LOCATION_KEYS);
//     if (!jobId || !jobName || !(salaryDesc || brandName || cityName)) return null;
//     return { jobId, number: jobId, jobName, salaryDesc, brandName, cityName };
//   }

//   function findZhaopinListItems(node, results = [], seen = new Set(), depth = 0) {
//     if (!node || typeof node !== 'object' || depth > 6 || seen.has(node)) return results;
//     seen.add(node);
//     if (Array.isArray(node)) {
//       const items = node.map(normalizeZhaopinListItem).filter(Boolean);
//       if (items.length >= 2) results.push(...items);
//       node.forEach((item) => findZhaopinListItems(item, results, seen, depth + 1));
//       return results;
//     }
//     for (const key in node) {
//       if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
//       const value = node[key];
//       if (value && typeof value === 'object') findZhaopinListItems(value, results, seen, depth + 1);
//     }
//     return results;
//   }

//   function parseBossDetail(json, url) {
//     const jobInfo = json?.zpData?.jobInfo;
//     if (!jobInfo) return null;

//     // matchKey 多级兜底：URL query 的 securityId 最可靠（跟 content.js 发起
//     // 点击时用的是同一个值），其次 payload 里的各种 id，最后交给点击相关性。
//     let matchKey = '';
//     try { matchKey = new URL(url, location.origin).searchParams.get('securityId') || ''; } catch (e) {}
//     if (!matchKey) matchKey = jobInfo.encryptJobId || jobInfo.encryptId || jobInfo.securityId || '';
//     if (!matchKey && activeCapture) matchKey = activeCapture.cardId;

//     const rawDesc = htmlToText(jobInfo.postDescription || '');
//     return {
//       matchKey,
//       title: jobInfo.jobName || '',
//       salary: jobInfo.salaryDesc || '',
//       company: json.zpData.brandComInfo?.brandName || '',
//       location: jobInfo.locationName || '',
//       ...parseJdSmart(rawDesc)
//     };
//   }

//   // injected.js (运行在 MAIN 作用域)

//   // injected.js (运行在 MAIN 作用域)
// function parseZhilianJobDetail() {
//   try {
//     // 1. 优先读取 __INITIAL_STATE__
//     if (window.__INITIAL_STATE__?.jobDetail?.jobDetail) {
//       return window.__INITIAL_STATE__.jobDetail.jobDetail;
//     }
//     if (window.__INITIAL_STATE__?.desc?.description) {
//       return { description: window.__INITIAL_STATE__.desc.description };
//     }
    
//     // 2. 备用提取 __NEXT_DATA__ 节点
//     const nextDataEl = document.getElementById('__NEXT_DATA__');
//     if (nextDataEl) {
//       const parsed = JSON.parse(nextDataEl.textContent);
//       return parsed.props?.pageProps?.jobDetail || null;
//     }
//   } catch (err) {
//     console.error('解析智联预载数据失败:', err);
//   }
//   return null;
// }

// // DOM 加载完成后读取并推送给 content_scripts
// window.addEventListener('DOMContentLoaded', () => {
//   const detail = parseZhilianJobDetail();
//   if (detail) {
//     const parsedDetail = SITE === 'zhaopin' ? parseZhaopinDetail({ data: detail }, location.href) : null;
//     if (parsedDetail) notifyDetail(parsedDetail);
//     else window.postMessage({ type: 'ZHILIAN_DETAIL_LOADED', site: 'zhaopin', data: detail }, '*');
//   }
// });
// // injected.js 代理 Fetch
// // const originalFetch = window.fetch;
// // window.fetch = async function (...args) {
// //   const response = await originalFetch.apply(this, args);
// //   const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;

// //   // 拦截智联详情接口
// //   if (url && url.includes('fe-api.zhaopin.com/c/i/jobs/detail')) {
// //     try {
// //       const cloneRes = response.clone();
// //       cloneRes.json().then(resData => {
// //         if (resData && resData.code === 200) {
// //           console.log("zhilian",resData.data)
// //           window.postMessage({
// //             type: 'ZHILIAN_INTERCEPTED_DATA',
// //             data: resData.data
// //           }, '*');
// //         }
// //       });
// //     } catch (e) {
// //       console.error('拦截智联 API 解析失败:', e);
// //     }
// //   }

// //   return response;
// // };

//   // const XHR = XMLHttpRequest.prototype;
//   // const open = XHR.open;
//   // const send = XHR.send;

//   // XHR.open = function(method, url) {
//   //   this._url = url;
//   //   return open.apply(this, arguments);
//   // };
//   //   XHR.send = function(body) {
//   //   this.addEventListener('load', function() {
//   //     if (this._url && this._url.includes('/api/job/detail-pc')) {
//   //       try {
//   //         const resData = JSON.parse(this.responseText);
//   //         console.log(resData)
//   //         // 通过 window.postMessage 发送给 content.js
//   //         window.postMessage({
//   //           type: '51JOB_Hook',
//   //           site: "51job",
//   //           data: resData
//   //         }, '*');
//   //       } catch (e) {}
//   //     }
//   //   });
//   //   // window.postMessage({ type: 'JOB_HOOK_DETAIL', site: "51job", data: detail }, '*');
//   //   return send.apply(this, arguments);
//   // };

//   function notifyList(list) {
//     if (!Array.isArray(list) || list.length === 0) return;
//     window.postMessage({ type: 'JOB_HOOK_LIST', site: SITE, data: list }, '*');
//   }

//   function notifyDetail(detail) {
//     if (!detail) return;
//     if (!detail.matchKey) {
//       // ⚡ 以前这里直接 return，静默丢弃。现在至少留个诊断痕迹，
//       //    并且如果捕获窗口开着，就把它归属给当前点击的卡片。
//       if (activeCapture) {
//         detail = { ...detail, matchKey: activeCapture.cardId, source: 'Click-Correlated Fallback' };
//         diag('详情缺少 matchKey，按点击相关性归属给', activeCapture.cardId);
//       } else {
//         diag('⚠️ 拿到详情但没有 matchKey，且没有捕获窗口，只能丢弃');
//         return;
//       }
//     }
//     window.postMessage({ type: 'JOB_HOOK_DETAIL', site: SITE, data: detail }, '*');
//   }

//   // ---------------------------------------------------------------------
//   // 4. LinkedIn / generic 的内容特征扫描（沿用上一版思路）
//   // ---------------------------------------------------------------------
//   const LINKEDIN_PAYLOAD_HINT = /fsd_jobPosting|jobPostingUrn|"description":\s*\{\s*"text"/;

//   function extractJobIdFromUrn(urn) {
//     if (typeof urn !== 'string') return null;
//     const m = urn.match(/(?:fsd_jobPosting|jobPosting):(\d+)/);
//     return m ? m[1] : null;
//   }

//   function scanLinkedInPayloadForJobPosting(node, results, seen, depth = 0) {
//     if (!node || typeof node !== 'object' || seen.has(node) || depth > 8) return;
//     seen.add(node);
//     const entityUrn = node.entityUrn || node['*entityUrn'] || node.jobPostingUrn || '';
//     const jobId = extractJobIdFromUrn(entityUrn) || (node.jobPostingId ? String(node.jobPostingId) : null);
//     const rawDesc = typeof node.description === 'string'
//       ? node.description
//       : (node.description && typeof node.description.text === 'string' ? node.description.text : '');
//     if (jobId && rawDesc) results.push({ matchKey: jobId, title: node.title || '', rawDesc: htmlToText(rawDesc) });
//     for (const key in node) {
//       if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
//       const val = node[key];
//       if (val && typeof val === 'object') scanLinkedInPayloadForJobPosting(val, results, seen, depth + 1);
//     }
//   }

//   // ---------------------------------------------------------------------
//   // 5. 统一响应处理入口
//   // ---------------------------------------------------------------------
//   function handleResponse(url, payloadText, payloadObj) {
//     let json = payloadObj;
//     if (!json) {
//       if (!payloadText || payloadText.length < 50) return;
//       // 便宜的预筛，避免对每个响应都 JSON.parse
//       if (payloadText[0] !== '{' && payloadText[0] !== '[') return;
//       try { json = JSON.parse(payloadText); } catch (e) { return; }
//     }
//     if (!json || typeof json !== 'object') return;

//     // ---- 诊断：把疑似职位相关的响应打出来，帮你定位真实接口 ----
//     if (window.__jdpDiag) {
//       const probe = findBestJdTextInPayload(json);
//       if (probe) {
//         diag('疑似含 JD 正文的响应:', { url, 字段名: probe.key, 分数: probe.score, 前120字: probe.text.slice(0, 120) });
//       }
//     }

//     // ---- BOSS 专属规则优先 ----
//     if (SITE === 'boss') {
//       if (BOSS_LIST_URL.test(url)) {
//         const list = json?.zpData?.jobList;
//         if (list) { diag('命中列表接口', url, '条数', list.length); notifyList(list); }
//       }
//       // URL 命中 或 payload 结构命中（换路径也不会失效）
//       if (BOSS_DETAIL_URL.test(url) || json?.zpData?.jobInfo) {
//         const detail = parseBossDetail(json, url);
//         if (detail) {
//           diag('命中详情接口', url, 'matchKey =', detail.matchKey);
//           notifyDetail(detail);
//           return;
//         }
//       }
//     }

//     if (SITE === 'zhaopin') {
//       if (ZHAOPIN_DETAIL_URL.test(url)) {
//         const detail = parseZhaopinDetail(json, url, activeCapture?.cardId);
//         if (detail) {
//           diag('命中智联详情接口', url, 'matchKey =', detail.matchKey, 'jobId =', detail.jobId);
//           notifyDetail(detail);
//           return;
//         }
//       }

//       if (ZHAOPIN_LIST_URL.test(url)) {
//         const items = findZhaopinListItems(json);
//         if (items.length) {
//           const uniq = [];
//           const seenJobIds = new Set();
//           items.forEach((item) => {
//             if (seenJobIds.has(item.jobId)) return;
//             seenJobIds.add(item.jobId);
//             uniq.push(item);
//           });
//           diag('命中智联列表接口', url, '条数', uniq.length);
//           notifyList(uniq);
//           return;
//         }
//       }
//     }

//     if (SITE === 'linkedin' && LINKEDIN_PAYLOAD_HINT.test(payloadText || JSON.stringify(json).slice(0, 20000))) {
//       const results = [];
//       scanLinkedInPayloadForJobPosting(json, results, new Set());
//       results.forEach((r) => notifyDetail({ matchKey: r.matchKey, title: r.title, ...parseJdSmart(r.rawDesc) }));
//       if (results.length) return;
//     }

//     // ---- 通用兜底：点击相关性捕获（所有站点都适用，包括 BOSS 规则没命中时）----
//     offerToCapture(json);
//   }

//   // ---------------------------------------------------------------------
//   // 6. Hook XHR —— ⚡ 修复 responseType 导致的静默失效
//   // ---------------------------------------------------------------------
//   const origOpen = XMLHttpRequest.prototype.open;
//   const origSend = XMLHttpRequest.prototype.send;

//   XMLHttpRequest.prototype.open = function (method, url) {
//     this.__hookUrl = url;
//     return origOpen.apply(this, arguments);
//   };

//   XMLHttpRequest.prototype.send = function () {
//     this.addEventListener('load', function () {
//       try {
//         const url = this.responseURL || this.__hookUrl || '';
//         const rt = this.responseType;
//         // ⚡ 关键修复：responseText 只在 responseType 为 '' 或 'text' 时可读，
//         // 其它情况（尤其是 'json'）读它会抛 DOMException，被 catch 吞掉后
//         // 表现为"拦截装了但永远不触发"。这里按类型分别取值。
//         if (rt === '' || rt === 'text') {
//           handleResponse(url, this.responseText, null);
//         } else if (rt === 'json') {
//           handleResponse(url, null, this.response);
//         }
//         // 'blob'/'arraybuffer'/'document' 不是 JSON 接口，直接忽略
//       } catch (e) {
//         diag('XHR 响应处理异常(已忽略):', e && e.message);
//       }
//     });
//     return origSend.apply(this, arguments);
//   };

//   // ---------------------------------------------------------------------
//   // 7. Hook fetch
//   // ---------------------------------------------------------------------
//   const origFetch = window.fetch;
//   if (typeof origFetch === 'function') {
//     window.fetch = function (input, init) {
//       const url = typeof input === 'string' ? input : (input && input.url) || '';
//       return origFetch.apply(this, arguments).then((res) => {
//         try {
//           res.clone().text().then((text) => handleResponse(url, text, null)).catch(() => {});
//         } catch (e) {}
//         return res;
//       });
//     };
//   }

//   // ---------------------------------------------------------------------
//   // 8. BOSS 首屏 SSR 数据
//   // ---------------------------------------------------------------------
//   if (SITE === 'boss') {
//     try {
//       if (window.__INITIAL_STATE__?.jobList) notifyList(window.__INITIAL_STATE__.jobList);
//     } catch (e) {}
//   }

//   // ---------------------------------------------------------------------
//   // 9. 主动兜底通道（保持原有行为不变）
//   // ---------------------------------------------------------------------
//   function getLinkedInCsrfToken() {
//     const m = document.cookie.match(/JSESSIONID="?([^";]+)"?/);
//     return m ? m[1] : '';
//   }

//   async function directFetchDetail(matchKey, meta) {
//     if (SITE === 'linkedin') {
//       const csrfToken = getLinkedInCsrfToken();
//       if (!csrfToken) return null;
//       try {
//         const res = await fetch(`https://www.linkedin.com/voyager/api/jobs/jobPostings/${matchKey}`, {
//           method: 'GET',
//           headers: {
//             'csrf-token': csrfToken,
//             'x-restli-protocol-version': '2.0.0',
//             'accept': 'application/vnd.linkedin.normalized+json+2.0.0, application/json, text/plain, */*',
//             'x-li-lang': 'zh_CN'
//           }
//         });
//         if (!res.ok) return null;
//         const json = await res.json();
//         // console.log("injected",json?.description?.text);
//         const rawDesc = htmlToText(json?.description?.text || (typeof json?.description === 'string' ? json.description : ''));
//         console.log("injected",parseJdSmart(rawDesc));
//         return { matchKey: String(matchKey), title: json?.title || '', ...parseJdSmart(rawDesc) };
//       } catch (e) { return null; }
//     }

//     if (SITE === 'zhaopin') {
//       if (!matchKey || /^h_/.test(String(matchKey))) return null;
//       try {
//         const apiUrl = `https://fe-api.zhaopin.com/c/i/jobs/detail?number=${encodeURIComponent(matchKey)}`;
//         const res = await fetch(apiUrl, {
//           credentials: 'include',
//           headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, text/plain, */*' }
//         });
//         if (!res.ok) return null;
//         const json = await res.json();
//         return parseZhaopinDetail(json, apiUrl, String(matchKey));
//       } catch (e) { return null; }
//     }

//     if (SITE === 'boss') {
//       const securityId = matchKey;
//       const lid = meta?.lid || '';
//       if (!securityId) return null;
//       try {
//         const apiUrl = `/wapi/zpgeek/job/detail.json?securityId=${encodeURIComponent(securityId)}&lid=${encodeURIComponent(lid)}`;
//         const res = await fetch(apiUrl, {
//           headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, text/plain, */*' }
//         });
//         if (!res.ok) return null;
//         const json = await res.json();
//         return parseBossDetail(json, apiUrl);
//       } catch (e) { return null; }
//     }
//     return null;
//   }

//   document.addEventListener('REQ_DIRECT_FETCH_JOB', async (e) => {
//     const { matchKey, meta, requestId } = e.detail || {};
//     const data = await directFetchDetail(matchKey, meta);
//     document.dispatchEvent(new CustomEvent('RESP_DIRECT_FETCH_JOB', { detail: { requestId, matchKey, data } }));
//   });

//   document.documentElement.dataset.injectReady = 'true';
//   document.dispatchEvent(new CustomEvent('INJECT_SCRIPT_READY'));
//   console.log(`✅ [injected.js] (${SITE}) 挂载完成。排查拦截问题请在控制台执行: window.__jdpDiag = true`);
// })();

/**
 * ==============================================================================
 * injected.js — 运行在页面主环境 (MAIN World)
 *
 * 已新增猎聘 (liepin.com) 的站点识别、API 响应拦截、SSR 数据解析及直接请求支持。
 * ==============================================================================
 */
(function () {
  'use strict';
  if (window.__jobHookInjected) return;
  window.__jobHookInjected = true;

  // ---------------------------------------------------------------------
  // 0. 站点识别 & 诊断开关
  // ---------------------------------------------------------------------
  const SITE = location.host.includes('zhipin.com')
    ? 'boss'
    : location.host.includes('linkedin.com')
      ? 'linkedin'
      : (location.host.includes('zhaopin.com') || location.host.includes('zhilian.com'))
        ? 'zhaopin'
        : location.host.includes('51job.com')
        ? '51job'
        : location.host.includes('liepin.com')
        ? 'liepin'
        : 'generic';

  const diag = (...args) => { if (window.__jdpDiag) console.log('%c[JDP-DIAG]', 'color:#0a66c2;font-weight:bold', ...args); };
  window.__jdpDiag = window.__jdpDiag || false;

  // ---------------------------------------------------------------------
  // 1. JD 文本解析
  // ---------------------------------------------------------------------
  const SECTION_VOCAB = [
    {
      type: 'responsibilities',
      tiers: [
        { weight: 50, phrases: ['岗位职责','工作职责','职责描述','主要职责','工作内容','岗位描述','职位描述',
            'Responsibilities','Key Responsibilities','Primary Responsibilities','Core Responsibilities',
            'Duties and Responsibilities','Essential Duties','Essential Functions','Essential Job Functions','Key Accountabilities','Responsibility','职位职责','工作内容及职责'] },
        { weight: 40, phrases: ["What you'll do",'What you will do',"What You'll Be Doing",'About the Role',
            'About this Role','About the job','Role Overview','Role Summary','Job Summary','Job Purpose',
            'The Role','Your Impact','Duties','你将负责','主要工作','主要负责','负责内容'] },
        { weight: 25, phrases: ['职责','Tasks','任务'] },
      ],
    },
    {
      type: 'requirements',
      tiers: [
        { weight: 50, phrases: ['任职要求','任职资格','岗位要求','招聘条件','职位要求','能力要求','岗位条件',
            'Requirements','Qualifications','Job Requirements','Basic Qualifications','Minimum Qualifications',
            'Required Qualifications','Key Qualifications','Skills and Qualifications','Education and Experience','Requirement','Qualification','技能要求','能力要求'] },
        { weight: 40, phrases: ["What we're looking for",'What we are looking for','Who You Are',
            "What You'll Bring",'What You Bring','Skills & Experience','Required Skills','Must Have','Must-haves',
            '你需要具备','我们需要你'] },
        { weight: 25, phrases: ['要求','资格','Skills'] },
      ],
    },
    {
      type: 'bonus',
      tiers: [
        { weight: 50, phrases: ['加分项','优先条件','优先考虑','加分技能',
            'Preferred Qualifications','Additional Qualifications','Preferred Experience','Preferred Skills',
            'Nice to have','Nice-to-haves','Bonus Points','Desirable Skills'] },
        { weight: 40, phrases: ['具备以下者优先','有以下经验优先','Bonus points if you have','A plus if','An asset','Desirable'] },
        { weight: 25, phrases: ['加分','Preferred'] },
      ],
    },
  ];

  const STOP_SECTIONS = [
    '福利待遇','薪资福利','公司简介','关于我们','企业文化','工作地点','投递方式','我们提供',
    'Benefits','What We Offer','Perks','Perks and Benefits','Compensation','Salary','Pay Range',
    'Working Conditions','Work Environment','Physical Requirements',
    'EEO Statement','Equal Opportunity','Equal Employment Opportunity','EEO',
    'About Us','About the Company','Our Story','Our Mission','Why Join Us','Who We Are',
    'How to Apply','Application Process','Next Steps','Disclaimer','Legal',
  ];

  function normalizeForMatch(s) {
    return String(s || '')
      .replace(/[\u2018\u2019\u02bc]/g, "'")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/[\u2010-\u2015\u2212]/g, '-')
      .replace(/[（）]/g, (m) => (m === '（' ? '(' : ')'))
      .replace(/\s*&\s*/g, ' and ')
      .replace(/-/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function matchPhrase(normText, phrase) {
    const p = normalizeForMatch(phrase);
    if (/[\u4e00-\u9fa5]/.test(p)) return normText.includes(p);
    const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\b)${esc}(?:e?s)?(?:\\b|[:：]|$)`, 'i').test(normText);
  }

  const CORE_PATTERNS = [
    { type: 'responsibilities', weight: 22, re: /(职责|负责|工作内容|responsibilit|duties|what you.{0,4}(ll|will) do)/i },
    { type: 'requirements',     weight: 22, re: /(要求|资格|条件|qualificat|requirement|what (we|you).{0,4}(re |ll )?(looking|bring|have))/i },
    { type: 'bonus',            weight: 22, re: /(加分|优先|preferred|nice to have|bonus|desirable|a plus)/i },
  ];

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

  function assessSectionHeader(element, text) {
    const isCJKText = /[\u4e00-\u9fa5]/.test(text);
    if (/^[*•▪◦●\-–]\s+/.test(text)) return { isHeader: false, score: 0, type: null };

    const numbered = /^\d+[.、)）]\s*\S/.test(text) || /^[一二三四五六七八九十]+[、.]\s*\S/.test(text);
    const bare = text.replace(/^[（(]?[\d一二三四五六七八九十]+[）)]?[.、)）]?\s*/, '');
    if (numbered && bare.length > (isCJKText ? 12 : 30)) {
      return { isHeader: false, score: 0, type: null };
    }

    let domScore = 0;
    if (element && element.tagName) {
      const tag = element.tagName.toLowerCase();
      const cls = typeof element.className === 'string' ? element.className : (element.getAttribute?.('class') || '');
      const idName = element.id || '';
      if (/^h[1-3]$/.test(tag)) domScore += 35;
      else if (/^h[4-6]$/.test(tag)) domScore += 25;
      else if (tag === 'b' || tag === 'strong') domScore += 20;
      else if (tag === 'dt') domScore += 20;
      if (/header|title|section|heading|caption|label|subtitle/i.test(cls + ' ' + idName)) domScore += 30;
      if (/(desc|content|body|text|paragraph)/i.test(cls + ' ' + idName) && !/title|header|heading/i.test(cls + ' ' + idName)) domScore -= 10;
    }

    let layoutScore = 0;
    const isCJK = isCJKText;
    if (/[:：]\s*$/.test(text)) layoutScore += 25;
    if (text.length <= (isCJK ? 20 : 40)) layoutScore += 20;
    if (!isCJK && text === text.toUpperCase() && /[A-Z]{3,}/.test(text)) layoutScore += 18;
    if (/[.。]$/.test(text) && !/[:：]$/.test(text)) layoutScore -= 20;
    if (text.length > (isCJK ? 40 : 80)) layoutScore -= 40;
    if (/(?:we\s+are|you\s+will|our\s+team|looking\s+for\s+a|我们正在|如果你)/i.test(text) && text.length > 30) layoutScore -= 35;

    const { type, keywordScore } = matchVocab(text);
    const totalScore = domScore + layoutScore + keywordScore;
    const headingLen = isCJKText ? 22 : 50;
    const isHeader = (totalScore >= 60 && keywordScore > 0)
      || (domScore >= 35 && keywordScore >= 25 && text.length <= headingLen);
    return { isHeader, type, score: totalScore };
  }

  const LEAFY = /^(P|LI|H[1-6]|DT|DD|TD|TH|BLOCKQUOTE)$/i;
  const CONTAINER = /^(DIV|SECTION|ARTICLE|UL|OL|DL|TABLE|TBODY|TR|MAIN|SPAN|BODY)$/i;

  function getVisualTextBlocks(node) {
    const blocks = [];
    const walk = (el) => {
      if (!el || !el.tagName) return;
      const tag = el.tagName;
      if (/^(SCRIPT|STYLE|NOSCRIPT|SVG)$/i.test(tag)) return;

      if (LEAFY.test(tag) || /^(H[1-6]|STRONG|B)$/i.test(tag)) {
        const t = (el.textContent || '').trim();
        if (t) blocks.push({ element: el, text: t });
        return;
      }
      if (CONTAINER.test(tag)) {
        const hasElementChild = el.children && el.children.length > 0;
        if (!hasElementChild) {
          const t = (el.textContent || '').trim();
          if (t) blocks.push({ element: el, text: t });
          return;
        }
        for (const child of Array.from(el.childNodes)) {
          if (child.nodeType === 3) {
            const t = (child.nodeValue || '').trim();
            if (t) blocks.push({ element: el, text: t });
          } else if (child.nodeType === 1) {
            walk(child);
          }
        }
        return;
      }
      const t = (el.textContent || '').trim();
      if (t) blocks.push({ element: el, text: t });
    };
    walk(node);
    return blocks;
  }

  function parseJdFromDom(containerNode) {
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
    let current = 'intro';

    for (const blk of blocks) {
      const { element, text } = blk;
      const blockIsSplit = !!blk.__split;
      const t = text.trim();
      if (!t) continue;

      if (current !== 'intro' && t.length <= 40 && isStopSection(t)) break;

      const a = assessSectionHeader(blockIsSplit ? null : element, t);
      if (a.isHeader && a.type) { current = a.type; continue; }
      buckets[current].push(t);
    }

    const resp = [...buckets.intro, ...buckets.responsibilities].join('\n').trim();
    return {
      responsibilities: resp,
      requirements: buckets.requirements.join('\n').trim(),
      bonus: buckets.bonus.join('\n').trim(),
      fullCleanText: blocks.map((b) => b.text).join('\n').trim(),
    };
  }

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
        && /^[a-z(,;)]/.test(line);
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
      if (current !== 'intro' && bare.length <= 40 && isStopSection(bare)) break;

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

  function parseJdSmart(input) {
    if (input && typeof input === 'object' && input.nodeType === 1) return parseJdFromDom(input);
    
    if (window.JdParsed && typeof window.JdParsed.parseJd === 'function') {
      const result = { responsibilities: '', requirements: '', bonus: '', fullCleanText: '' };
      const jdresult = window.JdParsed.parseJd(input);
      const resp = jdresult.responsibilities || [];
      const req = jdresult.requirements || [];
      const pref = jdresult.preferred || [];

      result.responsibilities = resp.join('\n').trim();
      result.requirements = [...req, ...pref].join('\n').trim();
      result.bonus = pref.join('\n').trim();
      result.fullCleanText = [...resp, ...req, ...pref].join('\n').trim();
      return result;
    }
    return parseJdFromText(String(input || ''));
  }

  function htmlToText(html) {
    if (!html || typeof html !== 'string') return '';
    if (!/[<&]/.test(html)) return html;
    return html
      .replace(/<\s*br\s*\/?\s*>/gi, '\n')
      .replace(/<\s*\/\s*(p|div|li|tr)\s*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&').replace(/&quot;/g, '"');
  }

  // ---------------------------------------------------------------------
  // 2. 通用："点击相关性捕获窗口"
  // ---------------------------------------------------------------------
  let activeCapture = null;

  document.addEventListener('REQ_BEGIN_CAPTURE', (e) => {
    const { cardId } = e.detail || {};
    if (!cardId) return;
    activeCapture = { cardId: String(cardId), startedAt: Date.now(), best: null };
    diag('捕获窗口已开启, cardId =', cardId);
  });

  document.addEventListener('REQ_END_CAPTURE', () => {
    if (!activeCapture) return;
    if (activeCapture.best) {
      diag('捕获窗口关闭，采用最佳候选, score =', activeCapture.best.score);
      window.postMessage({
        type: 'JOB_HOOK_DETAIL', site: SITE,
        data: { ...activeCapture.best.detail, matchKey: activeCapture.cardId, source: 'Click-Correlated Capture' }
      }, '*');
    }
    activeCapture = null;
  });

  const JD_KEYWORD_PATTERN = /(岗位职责|工作职责|任职要求|任职资格|岗位要求|职位描述|工作内容|加分项|Responsibilities|Requirements|Qualifications|Job\s+Description|What\s+you.{0,10}do)/gi;

  function scoreJdText(text) {
    if (!text || text.length < 150) return 0;
    const kwHits = (text.match(JD_KEYWORD_PATTERN) || []).length;
    const hasSentences = /[。！？.!?]/.test(text);
    if (!kwHits && !hasSentences) return 0;

    let structureBonus = 0;
    const bulletLines = (text.match(/(?:^|\n)\s*(?:[•·▪●\-*]|\d+[.、)）])\s*\S/g) || []).length;
    if (bulletLines >= 3) structureBonus += 120;
    else if (bulletLines >= 1) structureBonus += 40;
    if (/(\d+\s*[-~到]?\s*\d*\s*年(以上)?(工作)?经验|本科|硕士|博士|大专|years?\s+of\s+experience|bachelor|master's|degree)/i.test(text)) structureBonus += 80;
    if (/(公司简介|关于我们|企业文化|发展历程|隐私政策|用户协议|Cookie|About\s+Us|Privacy\s+Policy|Terms\s+of\s+Service)/i.test(text)
        && kwHits === 0) structureBonus -= 150;

    return Math.min(kwHits, 5) * 100 + Math.min(text.length, 4000) * 0.05 + structureBonus;
  }

  function findBestJdTextInPayload(node, depth = 0, seen = new Set()) {
    if (!node || typeof node !== 'object' || depth > 6 || seen.has(node)) return null;
    seen.add(node);
    let best = null;
    for (const key in node) {
      if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
      const val = node[key];
      if (typeof val === 'string') {
        const text = htmlToText(val);
        const score = scoreJdText(text);
        if (score > 0 && (!best || score > best.score)) {
          best = { score, text, key, container: node };
        }
      } else if (val && typeof val === 'object') {
        const sub = findBestJdTextInPayload(val, depth + 1, seen);
        if (sub && (!best || sub.score > best.score)) best = sub;
      }
    }
    return best;
  }

  const TITLE_LIKE_KEYS = ['jobName', 'title', 'jobTitle', 'positionName', 'name', 'headline'];
  function guessTitle(container) {
    if (!container) return '';
    for (const k of TITLE_LIKE_KEYS) {
      if (typeof container[k] === 'string' && container[k].length < 100) return container[k];
    }
    return '';
  }

  const CONFIDENT_SCORE = 260;

  function offerToCapture(json) {
    if (!activeCapture) return false;
    const best = findBestJdTextInPayload(json);
    if (!best) return false;

    const detail = { title: guessTitle(best.container), ...parseJdSmart(best.text) };

    if (best.score >= CONFIDENT_SCORE) {
      diag('捕获窗口内命中高置信度候选，立即发出, score =', best.score, 'key =', best.key);
      window.postMessage({
        type: 'JOB_HOOK_DETAIL', site: SITE,
        data: { ...detail, matchKey: activeCapture.cardId, source: 'Click-Correlated Capture' }
      }, '*');
      activeCapture.best = null;
      return true;
    }

    if (activeCapture.best && activeCapture.best.score >= best.score) return true;
    activeCapture.best = { score: best.score, detail };
    diag('捕获窗口内收到低置信度候选(暂存), score =', best.score, 'key =', best.key);
    return true;
  }

  // ---------------------------------------------------------------------
  // 3. 站点专用匹配规则（BOSS / 智联 / 51job / 猎聘）
  // ---------------------------------------------------------------------
  const BOSS_DETAIL_URL = /\/(job\/detail|jobdetail|job\/card|geek\/job\/detail)\.json/i;
  const BOSS_LIST_URL = /\/(joblist|job\/list|geek\/joblist)\.json/i;

  const FIFTYONEJOB_SEARCH_URL = /we\.51job\.com\/api\/job\/search-pc/i;

  const ZHAOPIN_DETAIL_URL = /(?:^|\/\/)fe-api\.zhaopin\.com\/c\/i\/jobs\/detail|\/c\/i\/jobs\/detail/i;
  const ZHAOPIN_LIST_URL = /(?:^|\/\/)fe-api\.zhaopin\.com\/c\/i\/(?:search|jobs|position|positions)|\/c\/i\/jobs\/search|\/sou\/result/i;
  const ZHAOPIN_ID_KEYS = ['number', 'jobNumber', 'job_number', 'jobId', 'jobID', 'jobid', 'positionId', 'positionID', 'positionNumber', 'position_number'];
  const ZHAOPIN_TITLE_KEYS = ['jobName', 'name', 'title', 'jobTitle', 'positionName'];
  const ZHAOPIN_DESC_KEYS = ['jobDesc', 'jobDescription', 'description', 'describe', 'positionDesc', 'positionDetail', 'responsibility', 'jobDetail', 'details', 'content'];
  const ZHAOPIN_SALARY_KEYS = ['salaryDesc', 'salary', 'salaryReal', 'salary60', 'salaryName'];
  const ZHAOPIN_COMPANY_KEYS = ['companyName', 'brandName', 'company', 'companyInfo', 'companyDTO'];
  const ZHAOPIN_LOCATION_KEYS = ['cityName', 'workCity', 'city', 'cityDisplay', 'areaDistrict', 'workAddress', 'location'];

  // --- 猎聘 (Liepin) 规则配置 ---
  const LIEPIN_DETAIL_URL = /\/(?:gapi|api|pas)\/.*?(?:job\/detail|get-job-detail|job-detail|job-info)/i;
  const LIEPIN_LIST_URL = /\/(?:gapi|api|pas)\/.*?(?:search\/job|job-list|search-job|pc-search-job)/i;
  const LIEPIN_ID_KEYS = ['jobId', 'job_id', 'jobNo', 'job_no', 'encodeId', 'positionId', 'jobCardId'];
  const LIEPIN_TITLE_KEYS = ['jobName', 'title', 'positionName', 'jobTitle', 'name'];
  const LIEPIN_DESC_KEYS = ['jobDesc', 'jobDescription', 'description', 'positionDesc', 'desc', 'jobSummary', 'jobIntro'];
  const LIEPIN_SALARY_KEYS = ['salary', 'salaryDesc', 'salaryShow', 'showSalary', 'jobSalary'];
  const LIEPIN_COMPANY_KEYS = ['compName', 'companyName', 'comp', 'company', 'brandName'];
  const LIEPIN_LOCATION_KEYS = ['cityName', 'dqName', 'location', 'city', 'workAddress', 'cityNameList'];

  function getDeepValueByKeys(node, keys, depth = 0, seen = new Set()) {
    if (!node || typeof node !== 'object' || depth > 6 || seen.has(node)) return '';
    seen.add(node);
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(node, key)) {
        const val = node[key];
        if (val != null) {
          if (typeof val === 'string' || typeof val === 'number') return String(val).trim();
          if (Array.isArray(val)) return val.map(x => (typeof x === 'object' ? (x.name || x.label || '') : String(x))).filter(Boolean).join(' ');
        }
      }
    }
    for (const key in node) {
      if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
      const value = node[key];
      if (value && typeof value === 'object') {
        const text = getDeepValueByKeys(value, keys, depth + 1, seen);
        if (text) return text;
      }
    }
    return '';
  }

  function parseLiepinDetail(json, url, fallbackMatchKey = '') {
    const data = json?.data || json?.result || json;
    if (!data) return null;

    const directDesc = getDeepValueByKeys(data, LIEPIN_DESC_KEYS);
    const best = findBestJdTextInPayload(data);
    const rawDesc = htmlToText(directDesc || best?.text || '');
    if (!rawDesc || rawDesc.length < 30) return null;

    const parsed = parseJdSmart(rawDesc);
    let matchKey = getDeepValueByKeys(data, LIEPIN_ID_KEYS) || fallbackMatchKey;
    if (!matchKey) {
      try {
        const params = new URL(url, location.origin).searchParams;
        matchKey = params.get('jobId') || params.get('job_id') || params.get('jobNo') || '';
      } catch (e) {}
    }
    if (!matchKey && activeCapture) matchKey = activeCapture.cardId;

    return {
      matchKey: String(matchKey || ''),
      jobId: String(matchKey || ''),
      title: getDeepValueByKeys(data, LIEPIN_TITLE_KEYS),
      salary: getDeepValueByKeys(data, LIEPIN_SALARY_KEYS),
      company: getDeepValueByKeys(data, LIEPIN_COMPANY_KEYS),
      location: getDeepValueByKeys(data, LIEPIN_LOCATION_KEYS),
      ...parsed
    };
  }

  function parseLiepinList(json) {
    const list = json?.data?.jobCardList || json?.data?.list || json?.data?.jobList || json?.result?.list || [];
    if (!Array.isArray(list) || list.length === 0) return [];

    return list.map((item) => {
      const jobId = getDeepValueByKeys(item, LIEPIN_ID_KEYS);
      const jobName = getDeepValueByKeys(item, LIEPIN_TITLE_KEYS);
      if (!jobId || !jobName) return null;
      return {
        jobId: String(jobId),
        matchKey: String(jobId),
        jobName,
        salaryDesc: getDeepValueByKeys(item, LIEPIN_SALARY_KEYS),
        brandName: getDeepValueByKeys(item, LIEPIN_COMPANY_KEYS),
        cityName: getDeepValueByKeys(item, LIEPIN_LOCATION_KEYS),
      };
    }).filter(Boolean);
  }

  // --- 智联与 51job 解析方法保持 ---
  function zhaopinValueToText(value) {
    if (value == null) return '';
    if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
    if (Array.isArray(value)) return value.map(zhaopinValueToText).filter(Boolean).join(' ').trim();
    if (typeof value === 'object') {
      for (const key of ['display', 'name', 'value', 'text', 'label', 'content', 'title']) {
        const text = zhaopinValueToText(value[key]);
        if (text) return text;
      }
    }
    return '';
  }

  function findZhaopinValueByKeys(node, keys, depth = 0, seen = new Set()) {
    if (!node || typeof node !== 'object' || depth > 5 || seen.has(node)) return '';
    seen.add(node);
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
      const text = zhaopinValueToText(node[key]);
      if (text) return text;
    }
    for (const key in node) {
      if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
      const value = node[key];
      if (!value || typeof value !== 'object') continue;
      const text = findZhaopinValueByKeys(value, keys, depth + 1, seen);
      if (text) return text;
    }
    return '';
  }

  function unwrapZhaopinData(json) {
    return json?.data?.jobDetail
      || json?.data?.jobInfo
      || json?.data?.detail
      || json?.data
      || json?.result?.data
      || json?.result
      || json;
  }

  function extractZhaopinMatchKey(data, url, fallbackMatchKey = '') {
    if (fallbackMatchKey) return String(fallbackMatchKey);
    try {
      const params = new URL(url, location.origin).searchParams;
      for (const key of ZHAOPIN_ID_KEYS) {
        const val = params.get(key);
        if (val) return String(val);
      }
    } catch (e) {}
    return findZhaopinValueByKeys(data, ZHAOPIN_ID_KEYS);
  }

  function parseZhaopinDetail(json, url, fallbackMatchKey = '') {
    const dataRaw = unwrapZhaopinData(json);
    if (!dataRaw) return null;
    const data = typeof dataRaw === 'object' ? dataRaw : { description: String(dataRaw) };
    const directDesc = findZhaopinValueByKeys(data, ZHAOPIN_DESC_KEYS);
    const best = findBestJdTextInPayload(data);
    const rawDesc = htmlToText(directDesc || best?.text || '');
    if (!rawDesc || rawDesc.length < 50) return null;

    const parsed = parseJdSmart(rawDesc);
    if (!parsed.fullCleanText) parsed.fullCleanText = rawDesc;
    if (!parsed.responsibilities && !parsed.requirements && parsed.fullCleanText) {
      parsed.responsibilities = parsed.fullCleanText;
    }

    const realJobId = extractZhaopinMatchKey(data, url);
    return {
      matchKey: extractZhaopinMatchKey(data, url, fallbackMatchKey || realJobId),
      jobId: realJobId || fallbackMatchKey,
      number: realJobId || '',
      title: findZhaopinValueByKeys(data, ZHAOPIN_TITLE_KEYS),
      salary: findZhaopinValueByKeys(data, ZHAOPIN_SALARY_KEYS),
      company: findZhaopinValueByKeys(data, ZHAOPIN_COMPANY_KEYS),
      location: findZhaopinValueByKeys(data, ZHAOPIN_LOCATION_KEYS),
      ...parsed
    };
  }

  function normalizeZhaopinListItem(item) {
    if (!item || typeof item !== 'object') return null;
    const jobId = extractZhaopinMatchKey(item, '');
    const jobName = findZhaopinValueByKeys(item, ZHAOPIN_TITLE_KEYS);
    const salaryDesc = findZhaopinValueByKeys(item, ZHAOPIN_SALARY_KEYS);
    const brandName = findZhaopinValueByKeys(item, ZHAOPIN_COMPANY_KEYS);
    const cityName = findZhaopinValueByKeys(item, ZHAOPIN_LOCATION_KEYS);
    if (!jobId || !jobName || !(salaryDesc || brandName || cityName)) return null;
    // _raw 留一份原始对象的引用——列表接口有的响应里单条职位本身就带着
    // 完整描述字段（比如 jobdetailData.position-desc.description），只是
    // 字段名不在这几个基础字段的查找范围内。之前这里只挑了标题/薪资/
    // 公司/地点这几个卡片展示要用的基础信息，完整描述被忽略掉了——
    // 调用处会拿着 _raw 再跑一遍 parseZhaopinDetail 那套本来就有、
    // 但只给"详情接口"用的正确逻辑，尝试从同一个对象里再挖一次描述。
    return { jobId, number: jobId, jobName, salaryDesc, brandName, cityName, _raw: item };
  }

  function findZhaopinListItems(node, results = [], seen = new Set(), depth = 0) {
    if (!node || typeof node !== 'object' || depth > 6 || seen.has(node)) return results;
    seen.add(node);
    if (Array.isArray(node)) {
      const items = node.map(normalizeZhaopinListItem).filter(Boolean);
      if (items.length >= 2) results.push(...items);
      node.forEach((item) => findZhaopinListItems(item, results, seen, depth + 1));
      return results;
    }
    for (const key in node) {
      if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
      const value = node[key];
      if (value && typeof value === 'object') findZhaopinListItems(value, results, seen, depth + 1);
    }
    return results;
  }

  function normalizeTitleForMatch(title) {
    // 卡片DOM上的标题和接口返回的标题，哪怕是同一个职位，也可能有细微
    // 空白差异（多余空格、换行）——统一trim+把连续空白压成一个空格，
    // 两边用同一个函数处理才能对上。跟 content3.js 里同名函数逻辑必须
    // 完全一致，否则两边算出来的 matchKey 对不上。
    return String(title || '').trim().replace(/\s+/g, ' ');
  }

  function parseFiftyOneJobList(json) {
    const items = json?.resultbody?.job?.items;
    if (!Array.isArray(items)) return [];
    return items.map((it) => {
      // 用标题做匹配键，不用数字ID——51job接口具体用哪个字段名做ID没有
      // 实测确认过，猜 jobId/jobid/id/jobID 这几个候选字段名导致过真实
      // 的数据错位（onDetailArrived 匹配不上），标题（jobName）比较
      // 确定存在，且卡片DOM上本来就有现成的标题可以对，不需要再猜。
      const title = normalizeTitleForMatch(it.jobName || it.jobTitle || '');
      const rawDesc = it.jobDescribe || '';
      if (!rawDesc || !title) return null;
      return { matchKey: title, title, rawDesc };
    }).filter(Boolean);
  }

  function parseBossDetail(json, url) {
    const jobInfo = json?.zpData?.jobInfo;
    if (!jobInfo) return null;

    let matchKey = '';
    try { matchKey = new URL(url, location.origin).searchParams.get('securityId') || ''; } catch (e) {}
    if (!matchKey) matchKey = jobInfo.encryptJobId || jobInfo.encryptId || jobInfo.securityId || '';
    if (!matchKey && activeCapture) matchKey = activeCapture.cardId;

    const rawDesc = htmlToText(jobInfo.postDescription || '');
    return {
      matchKey,
      title: jobInfo.jobName || '',
      salary: jobInfo.salaryDesc || '',
      company: json.zpData.brandComInfo?.brandName || '',
      location: jobInfo.locationName || '',
      ...parseJdSmart(rawDesc)
    };
  }

  // ---------------------------------------------------------------------
  // 4. 通知派发函数
  // ---------------------------------------------------------------------
  function notifyList(list) {
    if (!Array.isArray(list) || list.length === 0) return;
    window.postMessage({ type: 'JOB_HOOK_LIST', site: SITE, data: list }, '*');
  }

  function notifyDetail(detail) {
    if (!detail) return;
    if (!detail.matchKey) {
      if (activeCapture) {
        detail = { ...detail, matchKey: activeCapture.cardId, source: 'Click-Correlated Fallback' };
        diag('详情缺少 matchKey，按点击相关性归属给', activeCapture.cardId);
      } else {
        diag('⚠️ 拿到详情但没有 matchKey，且没有捕获窗口，只能丢弃');
        return;
      }
    }
    window.postMessage({ type: 'JOB_HOOK_DETAIL', site: SITE, data: detail }, '*');
  }

  // ---------------------------------------------------------------------
  // 5. 统一响应处理入口
  // ---------------------------------------------------------------------
  function handleResponse(url, payloadText, payloadObj) {
    let json = payloadObj;
    if (!json) {
      if (!payloadText || payloadText.length < 50) return;
      if (payloadText[0] !== '{' && payloadText[0] !== '[') return;
      try { json = JSON.parse(payloadText); } catch (e) { return; }
    }
    if (!json || typeof json !== 'object') return;

    if (window.__jdpDiag) {
      const probe = findBestJdTextInPayload(json);
      if (probe) {
        diag('疑似含 JD 正文的响应:', { url, 字段名: probe.key, 分数: probe.score, 前120字: probe.text.slice(0, 120) });
      }
    }

    // ---- BOSS 专属 ----
    if (SITE === 'boss') {
      if (BOSS_LIST_URL.test(url)) {
        const list = json?.zpData?.jobList;
        if (list) { diag('命中 BOSS 列表接口', url, '条数', list.length); notifyList(list); }
      }
      if (BOSS_DETAIL_URL.test(url) || json?.zpData?.jobInfo) {
        const detail = parseBossDetail(json, url);
        if (detail) {
          diag('命中 BOSS 详情接口', url, 'matchKey =', detail.matchKey);
          notifyDetail(detail);
          return;
        }
      }
    }

    // ---- 智联专属 ----
    if (SITE === 'zhaopin') {
      if (ZHAOPIN_DETAIL_URL.test(url)) {
        const detail = parseZhaopinDetail(json, url, activeCapture?.cardId);
        if (detail) {
          diag('命中智联详情接口', url, 'matchKey =', detail.matchKey, 'jobId =', detail.jobId);
          notifyDetail(detail);
          return;
        }
      }
      if (ZHAOPIN_LIST_URL.test(url)) {
        const items = findZhaopinListItems(json);
        if (items.length) {
          const uniq = [];
          const seenJobIds = new Set();
          items.forEach((item) => {
            if (seenJobIds.has(item.jobId)) return;
            seenJobIds.add(item.jobId);
            uniq.push(item);
          });
          diag('命中智联列表接口', url, '条数', uniq.length);
          notifyList(uniq);

          // ⚡ 列表接口有些响应里单条职位本身就带着完整描述（比如
          // jobdetailData.position-desc.description），之前只走 notifyList
          // 只给了标题/薪资/公司/地点这几个基础字段，描述被完全忽略——
          // 复用 parseZhaopinDetail 这个本来只给"详情接口"用的、已经验证
          // 正确的逻辑，对列表里每一条的原始对象(_raw)再挖一次，挖到了
          // 就额外发一次 notifyDetail，responsibilities/requirements
          // 才有机会被正确解析出来，不用等用户真的点进详情页。
          let detailHits = 0;
          uniq.forEach((item) => {
            const detail = parseZhaopinDetail(item._raw, url, item.jobId);
            if (detail && (detail.responsibilities || detail.requirements)) {
              detailHits++;
              notifyDetail(detail);
            }
          });
          if (window.__jdpDiag) diag('列表接口顺带挖到完整描述的条数', detailHits, '/', uniq.length);
          return;
        }
      }
    }

    // ---- 猎聘专属 ----
    if (SITE === 'liepin') {
      // sendToDebugServer(url, json);
      if (LIEPIN_DETAIL_URL.test(url) || json?.data?.data?.job || json?.data?.jobCard) {
        const joblist=json?.d;ta?.data;
        // joblist.forEach(job=>{
        // const jobId=job.jobId;
        // const detail = directFetchDetail(jobId);
        // if (detail) {
        //   diag('命中猎聘详情接口', url, 'matchKey =', detail.matchKey);
        //   notifyDetail(detail);
        //   return;
        // }
        // })
        
      }
      // if (LIEPIN_LIST_URL.test(url) || json?.data?.jobCardList) {
      //   const list = parseLiepinL(json);
      //   if (list.length) {
      //     diag('命中猎聘列表接口', url, '条数', list.length);
      //     notifyList(list);
      //     return;
      //   }
      // }
    }

    // ---- LinkedIn ----
    if (SITE === 'linkedin' && /fsd_jobPosting|jobPostingUrn|"description":\s*\{\s*"text"/.test(payloadText || JSON.stringify(json).slice(0, 20000))) {
      const results = [];
      scanLinkedInPayloadForJobPosting(json, results, new Set());
      results.forEach((r) => notifyDetail({ matchKey: r.matchKey, title: r.title, ...parseJdSmart(r.rawDesc) }));
      if (results.length) return;
    }

    // ---- 51job ----
    if (SITE === '51job') {
      // 诊断：不管 URL 匹不匹配，只要是 51job 站点、响应体看起来像 JSON
      // 且体积不小，就把 URL 打出来——用来确认 XHR/fetch 钩子本身有没有
      // 拦到这个请求，以及实际 URL 跟我们写的正则是不是真的对得上
      // （很可能有查询参数顺序不同、或者域名/路径跟你在 Network 面板
      // 看到的不完全一致这类细节差异）。
      if (window.__jdpDiag && url && JSON.stringify(json).length > 500) {
        diag('51job响应经过handleResponse', url, '| 匹配search-pc正则:', FIFTYONEJOB_SEARCH_URL.test(url));
      }
      if (FIFTYONEJOB_SEARCH_URL.test(url)) {
        const items = parseFiftyOneJobList(json);
        if (window.__jdpDiag) {
          diag('search-pc响应结构', { 'Resultbody存在': !!json?.Resultbody, 'job存在': !!json?.Resultbody?.job, 'items是数组': Array.isArray(json?.Resultbody?.job?.items), '解析出条数': items.length });
        }
        if (items.length) {
          diag('命中51job搜索接口', url, '条数', items.length, '有matchKey的', items.filter(i => i.matchKey).length);
          items.forEach((it) => {
            if (!it.matchKey) return; // 没有可用ID的条目匹配不回具体卡片，跳过不通知，避免脏数据
            notifyDetail({ matchKey: it.matchKey, title: it.title, ...parseJdSmart(it.rawDesc) });
          });
          return;
        }
      }
    }

    // ---- 通用点击捕获兜底 ----
    offerToCapture(json);
  }


  function sendToDebugServer(url, json) {
  // 只接收猎聘相关接口
  if (!url.includes('liepin') && !url.includes('pas') && !url.includes('gapi')) return;

  fetch('http://127.0.0.1:9000/log-json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // 转发接口 URL 及完整 JSON 结构
    body: JSON.stringify({
      url: url,
      timestamp: new Date().toLocaleTimeString(),
      data: json
    })
  }).catch(() => {
    // 忽略未启动本地调试服务时的报错，避免干扰主流程
  });
}

  // ---------------------------------------------------------------------
  // 6. Hook XHR & Fetch
  // ---------------------------------------------------------------------
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__hookUrl = url;
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', function () {
      try {
        const url = this.responseURL || this.__hookUrl || '';
        const rt = this.responseType;
        if (rt === '' || rt === 'text') {
          handleResponse(url, this.responseText, null);
        } else if (rt === 'json') {
          handleResponse(url, null, this.response);
        }
      } catch (e) {
        diag('XHR 响应处理异常:', e && e.message);
      }
    });
    return origSend.apply(this, arguments);
  };

  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      return origFetch.apply(this, arguments).then((res) => {
        try {
          res.clone().text().then((text) => handleResponse(url, text, null)).catch(() => {});
        } catch (e) {}
        return res;
      });
    };
  }

  // ---------------------------------------------------------------------
  // 7. 首屏 SSR 数据解析 (含 猎聘 __NEXT_DATA__)
  // ---------------------------------------------------------------------
  window.addEventListener('DOMContentLoaded', () => {
    if (SITE === 'boss') {
      try {
        if (window.__INITIAL_STATE__?.jobList) notifyList(window.__INITIAL_STATE__.jobList);
      } catch (e) {}
    }

    if (SITE === 'liepin') {
      try {
        const nextDataEl = document.getElementById('__NEXT_DATA__');
        if (nextDataEl) {
          const parsed = JSON.parse(nextDataEl.textContent || '{}');
          const pageProps = parsed?.props?.pageProps;
          if (pageProps) {
            const detail = parseLiepinDetail(pageProps, location.href);
            if (detail) notifyDetail(detail);
          }
        }
      } catch (e) {
        diag('猎聘 SSR 数据提取失败:', e);
      }
    }
  });

  // ---------------------------------------------------------------------
  // 8. 主动兜底通道 (Direct Fetch)
  // ---------------------------------------------------------------------
  // ---- LinkedIn：网络载荷扫描 + voyager API 直连共用的两个函数 ----
  // 之前这两个是内联定义在 handleResponse 里的（每次响应经过都要重新
  // 声明一遍），现在提成顶层函数，跟 directFetchDetail 共享，也更方便
  // 单独测试/复用。
  function extractJobIdFromUrn(urn) {
    if (typeof urn !== 'string') return null;
    const m = urn.match(/(?:fsd_jobPosting|jobPosting):(\d+)/);
    return m ? m[1] : null;
  }

  function scanLinkedInPayloadForJobPosting(node, results, seen, depth = 0) {
    if (!node || typeof node !== 'object' || seen.has(node) || depth > 8) return;
    seen.add(node);
    const entityUrn = node.entityUrn || node['*entityUrn'] || node.jobPostingUrn || '';
    const jobId = extractJobIdFromUrn(entityUrn) || (node.jobPostingId ? String(node.jobPostingId) : null);
    const rawDesc = typeof node.description === 'string'
      ? node.description
      : (node.description && typeof node.description.text === 'string' ? node.description.text : '');
    if (jobId && rawDesc) results.push({ matchKey: jobId, title: node.title || '', rawDesc: htmlToText(rawDesc) });
    for (const key in node) {
      if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
      const val = node[key];
      if (val && typeof val === 'object') scanLinkedInPayloadForJobPosting(val, results, seen, depth + 1);
    }
  }

  function getLinkedInCsrfToken() {
    const m = document.cookie.match(/JSESSIONID="?([^";]+)"?/);
    return m ? m[1] : '';
  }

  async function directFetchDetail(matchKey, meta) {
    if (SITE === 'linkedin') {
      const csrfToken = getLinkedInCsrfToken();
      if (!csrfToken) return null;
      try {
        const res = await fetch(`https://www.linkedin.com/voyager/api/jobs/jobPostings/${matchKey}`, {
          method: 'GET',
          headers: {
            'csrf-token': csrfToken,
            'x-restli-protocol-version': '2.0.0',
            'accept': 'application/vnd.linkedin.normalized+json+2.0.0, application/json, text/plain, */*',
            'x-li-lang': 'zh_CN'
          }
        });
        if (!res.ok) return null;
        const json = await res.json();
        const rawDesc = htmlToText(json?.description?.text || (typeof json?.description === 'string' ? json.description : ''));
        return { matchKey: String(matchKey), title: json?.title || '', ...parseJdSmart(rawDesc) };
      } catch (e) { return null; }
    }

    if (SITE === 'liepin') {
      if (!matchKey) return null;
      try {
        const apiUrl = `https://www.liepin.com/gapi/api/c/job/detail?jobId=${encodeURIComponent(matchKey)}`;
        const res = await fetch(apiUrl, {
          headers: { 'Accept': 'application/json, text/plain, */*' }
        });
        if (!res.ok) return null;
        const json = await res.json();
        sendToDebugServer(apiUrl, json);
        return parseLiepinDetail(json, apiUrl, String(matchKey));
      } catch (e) { return null; }
    }

    if (SITE === 'boss') {
      const securityId = matchKey;
      const lid = meta?.lid || '';
      if (!securityId) return null;
      try {
        const apiUrl = `/wapi/zpgeek/job/detail.json?securityId=${encodeURIComponent(securityId)}&lid=${encodeURIComponent(lid)}`;
        const res = await fetch(apiUrl, {
          headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, text/plain, */*' }
        });
        if (!res.ok) return null;
        const json = await res.json();
        return parseBossDetail(json, apiUrl);
      } catch (e) { return null; }
    }
    return null;
  }

  document.addEventListener('REQ_DIRECT_FETCH_JOB', async (e) => {
    const { matchKey, meta, requestId } = e.detail || {};
    const data = await directFetchDetail(matchKey, meta);
    document.dispatchEvent(new CustomEvent('RESP_DIRECT_FETCH_JOB', { detail: { requestId, matchKey, data } }));
  });

  document.documentElement.dataset.injectReady = 'true';
  document.dispatchEvent(new CustomEvent('INJECT_SCRIPT_READY'));
  console.log(`✅ [injected.js] (${SITE}) 挂载完成。排查拦截问题请在控制台执行: window.__jdpDiag = true`);
})();