
// //匹配度
const API_BASE_URL = "http://127.0.0.1:3000"; // 你的 FastAPI 后端地址
const isFiftyOneJob = location.hostname.includes('51job.com');

// 获取当前登录用户 ID (可根据你的系统从 localStorage 或 Cookie 中获取)
function getCurrentUserId() {
  const userInfo = getUserInfo("user_info");
  return userInfo ? userInfo : "guest_1001";
}

let GLOBAL_USER_INFO = null;
async function getUserInfo(key) {
  const data = await chrome.storage.local.get([key]);

  
  if (!data) {
    console.warn("未登录或未存储 用户信息，返回 null");
    return null;
  }
  
  console.log("在智联招聘页面成功获取到插件用户:", data);
  return data[key].data.user_id;
}


// =========================================================
// 详情页抓取——只覆盖猎聘和51job，两条完全不同的路径：
//
//   猎聘：卡片上的 url 就是可用的详情页地址，后台 fetch 那个 URL，
//         解析返回的 HTML。
//   51job：卡片上的 <a> 存的是公司URL，不是职位详情URL；真正的详情URL
//          是点击后才动态生成的（带追踪参数），没法提前拼出来。不能用
//          fetch（不管是fetch接口还是fetch详情页URL，都会触发风控）。
//          解法：不阻止点击的默认动作，让它真的弹出新标签（这本来就是
//          该站点的正常交互，触发风控的可能性最低），background 用
//          chrome.tabs.onCreated 按 openerTabId 捕获这个新标签，等它
//          加载完、问它要提取出来的内容，再关掉。
//          能读到内容是因为 Chrome 的 content_scripts 按 URL pattern
//          自动生效，不区分标签页是用户点的还是脚本触发弹出的——只要
//          新标签的地址匹配 manifest 里 51job.com 的规则，injected.js
//          和 content_backend.js 会在这个新标签里各自重新加载一遍，
//          跟在原页面上一样能读 DOM。
// =========================================================

const JD_ANCHOR_PATTERN_TAB = /(岗位职责|工作职责|职责描述|岗位描述|工作内容|任职要求|任职资格|岗位要求|招聘条件|加分项|优先条件|职位描述|职位信息|Responsibilities|Requirements|Qualifications|What\s+you.{0,10}do|What\s+we.{0,15}looking\s+for|Job\s+Description|About\s+the\s+role|About\s+this\s+role)/i;
const BLOCK_TAGS_TAB = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'TR', 'UL', 'OL', 'TABLE', 'HEADER', 'FOOTER']);
const HEADING_TAGS_TAB = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);


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

function domToStructuredTextTab(root) {
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
    if (tag === 'LI') { out.push('\n• '); Array.from(node.childNodes).forEach(walk); out.push('\n'); return; }
    if (HEADING_TAGS_TAB.has(tag)) { out.push('\n## '); Array.from(node.childNodes).forEach(walk); out.push('\n'); return; }
    if (tag === 'STRONG' || tag === 'B') {
      const own = (node.innerText || node.textContent || '').trim();
      const parentText = (node.parentElement?.innerText || node.parentElement?.textContent || '').trim();
      if (own && parentText && own.length >= parentText.length - 2 && own.length <= 60) {
        out.push('\n## '); Array.from(node.childNodes).forEach(walk); out.push('\n'); return;
      }
    }
    if (BLOCK_TAGS_TAB.has(tag)) out.push('\n');
    Array.from(node.childNodes).forEach(walk);
    if (BLOCK_TAGS_TAB.has(tag)) out.push('\n');
  };
  walk(root);
  return out.join('').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function cleanTextTab(str) {
  if (!str) return '';
  const tailNoisePattern = /(?:去App|随时沟通|点击查看地图|查看更多信息|微信扫码|Easy Apply|Apply now).*$/i;
  const uiInlineNoisePattern = /(地点[:：]?\s*[\u4e00-\u9fa5]{1,10}(市|区|省)?|完整的职位描述|职位描述如下|查看完整职位描述|Full\s+Job\s+Description)/gi;
  return str.replace(/&nbsp;/gi, ' ').split('\n').map((line) => {
    let cleaned = line.trim().replace(tailNoisePattern, '').trim();
    return cleaned.replace(uiInlineNoisePattern, ' ').replace(/[ \t]{2,}/g, ' ').trim();
  }).filter(Boolean).join('\n');
}

function looksLikeHeadingLineTab(s) {
  s = s.trim();
  if (!s || s.length > 60) return false;
  if (/^##\s/.test(s) || /[:：]$/.test(s) || /^【.+】$/.test(s) || /^#+\s/.test(s)) return true;
  const isCJK = /[\u4e00-\u9fa5]/.test(s);
  if (!isCJK && s.length <= 45 && !/[.!?]$/.test(s)) {
    if (s === s.toUpperCase() && /[A-Z]{3,}/.test(s)) return true;
    const w = s.split(/\s+/);
    const small = ['a', 'an', 'the', 'and', 'or', 'of', 'to', 'for', 'in', 'you', 'we', 'your', 'our', 'will', 'be', 'with'];
    if (w.length <= 6 && w.every((x) => !/^[a-z]/.test(x) || small.includes(x.toLowerCase()))) return true;
  }
  return isCJK && s.length <= 20 && !/[。！？]$/.test(s);
}

function normalizeAndMergeLinesTab(text) {
  const lines = text.split('\n');
  const bullet = /^([•▪◦●\-*]|[\d一二三四五六七八九十]+[.、)）])\s*/;
  const out = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { out.push(''); continue; }
    const prev = out[out.length - 1];
    const canMerge = prev && !bullet.test(line) && !looksLikeHeadingLineTab(line)
      && !/[。！？.!?:：；;]$/.test(prev) && !bullet.test(prev) && !looksLikeHeadingLineTab(prev)
      && /^[a-z(,;)]/.test(line);
    if (canMerge) out[out.length - 1] = prev + ' ' + line;
    else out.push(line);
  }
  return out.filter(Boolean).join('\n');
}

function parseJdSmartTab(input) {
  const result = { responsibilities: '', requirements: '', bonus: '', fullCleanText: '' };
  if (!window.JdParsed) {
    console.error('[content_backend.js] window.JdParsed 不存在——检查 manifest.json 里 jd_parsed.js 是否排在本文件之前加载');
    return result;
  }
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

function refineDomExtractedTextTab(rawText) {
  return parseJdSmartTab(normalizeAndMergeLinesTab(cleanTextTab(rawText)));
}

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

  function refineDomExtractedText(rawText) {
    const cleaned = cleanText(rawText);
    const formatted = normalizeAndMergeLines(cleaned);
    return parseJdSmart(formatted);
    // return parseJdFromText(formatted);
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


  function computeStructuralBonus(element) {
    let bonus = 0;
    const classAndId = `${element.className || ''} ${element.id || ''}`;
    if (SEMANTIC_CLASS_PATTERN.test(classAndId)) bonus += 80;
    if (hasNearbyHeadingContext(element)) bonus += 30;
    return bonus;
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
  const SEMANTIC_CLASS_PATTERN = /(job[-_]?desc|jobdescription|description[-_]?content|jd[-_]?content|jd[-_]?body|posting[-_]?content|posting[-_]?body|position[-_]?desc|job[-_]?detail|content[-_]?description)/i;
  const JD_ANCHOR_PATTERN = /(岗位职责|工作职责|职责描述|岗位描述|工作内容|任职要求|任职资格|岗位要求|招聘条件|加分项|优先条件|职位描述|职位信息|Responsibilities|Requirements|Qualifications|What\s+you.{0,10}do|What\s+we.{0,15}looking\s+for|Job\s+Description|About\s+the\s+role|About\s+this\s+role)/i;

   const SEMANTIC_JD_SELECTORS = '[class*="job-description" i], [class*="jobDescription" i], [class*="jd-content" i], [class*="jd-body" i], [id*="jobDescription" i], [id*="job-description" i], [class*="posting-requirements" i], [class*="description-content" i], [class*="job-detail" i],[class*="job-intro-container" i],[data-selector*="job-intro-content" i]';
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

// ---- 猎聘：url 直接可用，后台 fetch ----
async function fetchAndParseJdByUrl(url) {
  if (!url) return null;
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: "FETCH_RAW_HTML", url }, (res) => {
      if (chrome.runtime.lastError || !res || !res.success) {
        console.warn('[content_backend.js] 后台fetch详情失败:',
          (chrome.runtime.lastError && chrome.runtime.lastError.message) || (res && res.error));
        resolve(null);
        return;
      }
       try {
      const html =res.html;
      const doc = new DOMParser().parseFromString(html, 'text/html');
      doc.querySelectorAll('script, style, noscript, nav, footer, header, aside, svg, iframe, form').forEach((el) => el.remove());
      const jdContainer = locateJdContainerInDoc(doc);
      // alert(jdContainer)
      const structuredText = domToStructuredTextTab(jdContainer);
    if (!structuredText || structuredText.length < 100) { resolve(null); return; }
      sendToDebugServer(jdContainer.innerText)
      const parsed = refineDomExtractedText(jdContainer.innerText);
      // if (!parsed.responsibilities && !parsed.requirements && !parsed.fullCleanText) return null;
        
      // const titleEl = doc.querySelector('h1');
      resolve({ ...parsed, source: 'Fetch (Liepin)' });
    } catch (e) {
      console.warn('[content.js] 拉取/解析详情页失败:', e);
     resolve(null);
    }
      // try {
      //   const doc = new DOMParser().parseFromString(res.html, 'text/html');
      //   doc.querySelectorAll('script, style, noscript, nav, footer, header, aside, svg, iframe, form').forEach((el) => el.remove());
      //   const structuredText = domToStructuredTextTab(doc.body);
      //   if (!structuredText || structuredText.length < 100) { resolve(null); return; }
      //   const parsed = refineDomExtractedTextTab(structuredText);
      //   resolve({ ...parsed, source: 'Fetch (Liepin)' });
      // } catch (e) {
      //   console.warn('[content_backend.js] 解析详情HTML失败:', e);
      //   resolve(null);
      // }
    });
  });
}

  function sendToDebugServer(json) {
  // 只接收猎聘相关接口
  // if (!url.includes('liepin') && !url.includes('pas') && !url.includes('gapi')) return;

  fetch('http://127.0.0.1:9000/log-json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // 转发接口 URL 及完整 JSON 结构
    body: JSON.stringify({
      timestamp: new Date().toLocaleTimeString(),
      data: json
    })
  }).catch(() => {
    // 忽略未启动本地调试服务时的报错，避免干扰主流程
  });
}

  function hasNearbyHeadingContext(element) {
    const inner = element.querySelector && element.querySelector('h1, h2, h3, h4, h5, strong, b');
    if (inner && JD_ANCHOR_PATTERN.test(inner.textContent || '')) return true;
    const prevSibling = element.previousElementSibling;
    if (prevSibling && JD_ANCHOR_PATTERN.test((prevSibling.textContent || '').slice(0, 60))) return true;
    return false;
  }

// ---- 51job：不拦截点击，捕获点击弹出的新标签 ----
async function fetchAndParseJdViaRealClick(cardNode) {
  if (!cardNode) return null;

  // 51job 卡片上可见的 <a> 存的是公司URL，真正触发详情弹窗的点击目标
  // 往往是职位标题本身（跟公司名链接是两个不同元素）。优先找带
  // "job"/"title" 类关键词的子元素，找不到就退到点卡片本身——很多
  // 列表实现是把点击事件绑在整个卡片容器上，不一定非要点中某个具体
  // 的 <a>。这个优先级如果实测不准，需要对着真实DOM调整。
  const titleEl = cardNode.querySelector('[class*="title" i], [class*="job" i] a, h3, h2') || cardNode;

  return new Promise((resolve) => {
    // 先让 background 记下"接下来这个 tab 弹出的新标签算这次点击开的"，
    // 再真正触发点击——不能反过来，不然点击弹出新标签这个动作可能比
    // background 里的监听器注册得还快，错过捕获时机。
    chrome.runtime.sendMessage({ action: "WATCH_POPUP_FROM_CLICK" }, (ackRes) => {
      if (chrome.runtime.lastError || !ackRes || !ackRes.watching) {
        console.warn('[content_backend.js] background 未能开始监听弹出标签');
        resolve(null);
        return;
      }

      // 真正点击——不调用 preventDefault，让它按站点本来的行为弹出新标签。
      titleEl.click();

      // 等 background 那边把捕获到的新标签内容传回来。
      const onMessage = (msg) => {
        if (msg.action !== "POPUP_CAPTURE_RESULT") return;
        chrome.runtime.onMessage.removeListener(onMessage);
        if (!msg.success) {
          console.warn('[content_backend.js] 捕获51job弹出标签失败:', msg.error);
          resolve(null);
          return;
        }
        resolve({ responsibilities: msg.data.responsibilities, requirements: msg.data.requirements, source: 'Real Click + Tab Capture (51job)' });
      };
      chrome.runtime.onMessage.addListener(onMessage);
    });
  });
}

// 这个 tab 如果是被 background 捕获、要求提取内容的"后台标签页"，
// background 会发这条消息问它要内容——跟这个 tab 本身是不是正常用户
//在看的列表页、页面自身的 init() 逻辑完全独立，互不干扰。
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "EXTRACT_JD_HTML") {
      try {
        const structuredText = domToStructuredTextTab(document.body);
        if (!structuredText || structuredText.length < 100) {
          sendResponse({ success: false, error: '页面内容太短，可能还没加载完' });
          return true;
        }
        const parsed = refineDomExtractedTextTab(structuredText);
        sendResponse({ success: true, data: { responsibilities: parsed.responsibilities, requirements: parsed.requirements } });
      } catch (e) {
        sendResponse({ success: false, error: String(e) });
      }
      return true;
    }
  });
}

// 显示深度报告
document.addEventListener("click", async (e) => {
  const matchCard = e.target.closest(".jdp-card-match");
  if (!matchCard) return;

  e.stopPropagation();
  e.preventDefault();

  const jobCard = matchCard.closest(".jdp-card") || matchCard.closest(".job-card");
  if (!jobCard) return;

  // const jobId = matchCard.dataset.jobId || jobCard.dataset.jobId;
  const userId = await getUserInfo("user_info");
    const idx = matchCard.getAttribute("data-act-idx") || jobCard.getAttribute("data-index");

  // 4. ⚡ 精准提取 jobId（优先取按钮本身的，再取父卡片的）
  const jobId = matchCard.dataset.jobId 
             || jobCard.dataset.jobId 
             || matchCard.getAttribute("data-job-id") 
             || jobCard.getAttribute("data-job-id");

  if (!jobId) {
    console.warn("⚠️ 当前点击的卡片未找到有效的 data-job-id", jobCard);
  }

  // 5. ⚡ 提取职位标题（优先读取 .jdp-card-title 的innerText）
  const titleEl = jobCard.querySelector(".jdp-card-title") || jobCard.querySelector(".job-title");
  const jobTitle = titleEl?.innerText?.trim() 
                || jobCard.getAttribute("data-job-title") 
                || "目标岗位";

  // 6. ⚡ 提取 JD 详解（将职责 .jdp-resp-box 和要求 .jdp-req-box 拼合）
  const respText = jobCard.querySelector(".jdp-resp-box")?.innerText?.trim() || "";
  const reqText = jobCard.querySelector(".jdp-req-box")?.innerText?.trim() || "";
  const legacyJd = jobCard.querySelector(".job-detail-text")?.innerText?.trim() || "";

  // 组合最终发给 AI 分析的完整 JD 文本
  const cleanedJd = [respText, reqText].filter(Boolean).join("\n\n") || legacyJd || jobTitle;

  console.log(`🚀 [触发深度报告] jobId: ${jobId}, title: ${jobTitle}`);
 fetchAndShowReport(jobId, jobTitle, false, cleanedJd);


  // const cacheKey = `jdp_report_${jobId}`;
  
  // // 1. 先检查本地缓存（实现秒开，无需显示 Loading）
  // const cachedData = localStorage.getItem(cacheKey);
  // if (cachedData) {
  //   try {
  //     const { report, remainingQuota } = JSON.parse(cachedData);
  //     // 直接显示缓存报告
  //     updateReportModalContent(report, remainingQuota, true);
  //     return;
  //   } catch (e) {
  //     localStorage.removeItem(cacheKey); // 缓存损坏，清理掉
  //   }
  // }

  // // ⚡ 1. [第一步：秒弹窗！] 立即打开 Modal，展示 Skeleton 骨架屏或 Loading 动画
  // showReportModalLoading();

  // try {
  //   // ⚡ 2. [第二步：后台异步请求 API]
  //   const res = await fetch(`${API_BASE_URL}/api/match/detailed-report`, {
  //     method: 'POST',
  //     headers: { 'Content-Type': 'application/json' },
  //     body: JSON.stringify({ 
  //       job_id: jobId, 
  //       user_id: userId,
  //       job_title: jobTitle,
  //       cleaned_jd: cleanedJd })
  //   });

  //   fetchAndShowReport
    
  //   const resData = await res.json();

  //   if (res.status === 429) {
  //     updateReportModalError(resData.detail || "请求过于频繁，触发频控限制，请稍后再试");
  //     return;
  //   }

  //   if (!res.ok) {
  //     updateReportModalError(resData.detail || "生成深度报告失败，请稍后再试");
  //     return;
  //   }
  //   // ⚡ 3. [第三步：拿到了数据，填充内容并更新额度]（加入 ?. 可靠容错）
  //   const report = resData.data;
  //  const remainingQuota = resData.remaining_quota;

  //   // 5. 写入缓存（便于下一次直接弹出）
  //   localStorage.setItem(cacheKey, JSON.stringify({
  //     report,
  //     remainingQuota,
  //     timestamp: Date.now()
  //   }));

  //   // 6. 刷新弹窗为正式报告
  //   updateReportModalContent(report, remainingQuota, false);

  // } catch (error) {
  //   console.error("❌ 报告生成失败:", error);
  //   updateReportModalError("网络开小差了，请稍后重试");
  // }
});

/**
 * 持久化 UI 挂件管理器 (防止 React 重新渲染擦除 UI)
 * @param {HTMLElement} wrapperNode - 待注入的 UI 节点
 * @param {string} widgetId - 挂件唯一 ID，用于查找和防重
 */
function setupPersistentWidget(wrapperNode, widgetId = 'linkedin-ai-helper-widget') {
  wrapperNode.id = widgetId;

  // 1. 定义核心注入动作
  const ensureInjected = () => {
    // 如果页面上已经存在该挂件，不做重复处理
    if (document.getElementById(widgetId)) {
      return;
    }

    // 寻找领英筛选栏或列表容器
     const FILTER_BAR_SELECTORS = [
    '.condition-filter-box',                   // BOSS直聘 筛选条件栏
    '.job-filter-box',                         // BOSS直聘 选项栏
    '.search-filter-wrapper',                  // 通用筛选栏
    '.jobs-search-box-container',              // LinkedIn 顶部搜索与筛选栏
    '.search-scaffold-layout__filter-options', // LinkedIn 分栏模式筛选栏
    '[class*="filter-box"]',                   // 包含 filter-box 的节点
    '[class*="filter-container"]',
    '[componentkey="JobsSearchFilters"]',
    '[id="JobsSearchFilters"]',
  ];

  // 1. 尝试寻找筛选栏节点
  for (const selector of FILTER_BAR_SELECTORS) {
     const filterEl = document.querySelector(selector);
     const listContainer = document.querySelector('.jobs-search-results-list') || 
                          document.querySelector('.scaffold-layout__list');
    // 确保筛选栏可见且有高度
    if (filterEl && filterEl.offsetHeight > 0) {
      // afterend 表示插入到该元素紧随其后的同级位置（即筛选栏正下方）
      filterEl.insertAdjacentElement('afterend', wrapperNode);
      console.log(`✅ [UI Inject] 成功挂载至筛选栏下方: ${selector}`);
      return;
    }else if (listContainer && listContainer.parentNode) {
      listContainer.parentNode.insertBefore(wrapperNode, listContainer);
      console.log('⚠️ [PersistentWidget] 挂件已被重新注入到列表上方');
    }

  }
  };

  // 2. 首次尝试注入
  ensureInjected();

  // 3. 启动 MutationObserver 监听 DOM 树变化
  // 建议监听列表的主包裹容器，或者 document.body
  const targetObserveNode = document.querySelector('.scaffold-layout') || document.body;

  let debounceTimer = null;
  const observer = new MutationObserver((mutations) => {
    // 使用防抖处理，避免 React 密集更新时高频触发重绘
    if (debounceTimer) clearTimeout(debounceTimer);
    
    debounceTimer = setTimeout(() => {
      // 检查挂件是否被 React 擦除了，如果是，立刻补刷
      if (!document.getElementById(widgetId)) {
        ensureInjected();
      }
    }, 100);
  });

  // 配置监听：子节点增加/删除、子树变化
  observer.observe(targetObserveNode, {
    childList: true,
    subtree: true
  });

  console.log('👀 [PersistentWidget] DOM 变化监听器已启动，防止 UI 被 React 清除');
  return observer; // 返回 observer 实例，以便必要时调用 .disconnect() 销毁
}

// =========================================================
// 1. 获取或创建全局 Modal 弹窗容器（自动保证 DOM 存在）
// =========================================================
// =========================================================
// 1. 安全获取/创建 Modal 根容器 (纯原生 JS 挂载，不依赖外部 fetch)
// =========================================================

// 全局配置：缓存有效时长 5 分钟 (300,000 毫秒)
const REPORT_CACHE_TTL = 5 * 60 * 1000; 

// =========================================================
// 1. 获取或创建全局基础 Modal 容器
// =========================================================
function getOrCreateReportModal() {
  let modal = document.getElementById("jdp-report-modal");
  
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "jdp-report-modal";
    modal.className = "jdp-modal-backdrop";
    modal.innerHTML = `
      <div class="jdp-modal-content">
        <!-- 弹窗页头 -->
        <div class="jdp-modal-header" >
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <h3>⚡ AI 岗位匹配评估报告</h3>
            <p class="subtitle" id="jdp-modal-job-title">正在分析岗位匹配度...</p>
            <button class="jdp-btn-secondary" id="jdp-modal-refresh-btn" style="display:none; margin-right: 2px;">🔄 重新诊断</button>
          </div>
          <button class="jdp-modal-close" id="jdp-modal-close-x" title="关闭">&times;</button>
        </div>

        <!-- 弹窗主体 (动态替换内容) -->
        <div class="jdp-modal-body" id="jdp-modal-body"></div>

        <!-- 弹窗底部 -->
        <div class="jdp-modal-footer">
          
          <button class="jdp-btn-primary jdp-btn-close-action" id="jdp-modal-close-btn">关闭报告</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // 绑定关闭事件
    const closeBtns = modal.querySelectorAll("#jdp-modal-close-x, #jdp-modal-close-btn");
    closeBtns.forEach(btn => btn.addEventListener("click", closeReportModal));

    // 点击背景遮罩关闭
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeReportModal();
    });
  }

  return modal;
}

// 关闭并销毁弹窗
function closeReportModal() {
  const modal = document.getElementById("jdp-report-modal");
  if (modal) modal.remove();
}

// =========================================================
// 2. 显示 Loading 骨架屏
// =========================================================
function showReportModalLoading(jobTitle = "目标岗位") {
  const modal = getOrCreateReportModal();
  
  // 更新 Header & 隐藏刷新按钮
  document.getElementById("jdp-modal-job-title").innerText = `目标岗位：${jobTitle}`;
  document.getElementById("jdp-modal-refresh-btn").style.display = "none";

  // 渲染 Loading 骨架屏
  const bodyEl = document.getElementById("jdp-modal-body");
  bodyEl.innerHTML = `
    <div class="jdp-loading-container" style="text-align: center; padding: 30px 10px;">
      <div class="jdp-spinner" style="margin: 0 auto 15px;"></div>
      <p style="font-weight: 600; color: #1e293b; margin-bottom: 5px;">AI 正在深度解析简历与 JD...</p>
      <p style="font-size: 12px; color: #64748b;">提取硬性要求、碰撞技能交集与核查短板中</p>
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

// =========================================================
// 3. 渲染/更新正式报告内容
// =========================================================
function updateReportModalContent(report, remainingQuota, fromCache, jobId, jobTitle, cleanedJd) {
  getOrCreateReportModal();

  const { total_score = 0, sub_scores = {}, details = {}, job_title = "未知岗位" } = report || {};
  const { matched_skills = [], missing_skills = [], hard_warnings = [], insights = {} } = details;
  // const {highlights=[], risks=[], gaps=[]} = insights || {};
  // 1. 更新 Header 岗位名
  document.getElementById("jdp-modal-job-title").innerText = `目标岗位：${job_title}`;

  // 2. 显示并绑定底部【重新诊断】按钮
  const refreshBtn = document.getElementById("jdp-modal-refresh-btn");
  if (refreshBtn) {
    refreshBtn.style.display = "inline-block";
    refreshBtn.onclick = () => {
      // 💡 关键：点击刷新时，强行清缓存重新请求
      localStorage.removeItem(`jdp_report_${jobId}`);
     fetchAndShowReport(jobId, jobTitle, true,cleanedJd);
    };
  }

  // 3. 构造硬性门槛预警 HTML
  const warningsHtml = hard_warnings.length > 0 
    ? `<div class="jdp-alert-box">⚠️ <b>硬性门槛预警：</b>${hard_warnings.join("；")}</div>`
    : '';

  // 4. 构造技能碰撞 Tag HTML
  const matchedTags = matched_skills.map(s => `<span class="jdp-tag tag-success">✓ ${s}</span>`).join("");
  const missingTags = missing_skills.map(s => `<span class="jdp-tag tag-danger">✕ ${s}</span>`).join("");

  // 5. 渲染报告主体内容
  const bodyEl = document.getElementById("jdp-modal-body");
  bodyEl.innerHTML = `
    <!-- 1. 综合匹配分看板 -->
    <div class="jdp-hero-card">
      <div class="score-circle">
        <span class="score-val">${total_score}</span>
        <span class="score-unit">分</span>
      </div>
      <div class="score-meta">
        <h4>${total_score >= 80 ? '🔥 极高匹配度' : total_score >= 60 ? '👍 匹配度良好' : '⚠️ 匹配度较低'}</h4>
        <span class="quota-badge">
          ${fromCache ? '⚡ 5分钟内缓存' : `今日剩余 AI 报告额度: ${remainingQuota ?? '无限制'} 次`}
        </span>
      </div>
    </div>

    ${warningsHtml}

    <!-- 2. 四维评分拆解 -->
    <div class="jdp-grid-subscores">
      <div class="subscore-card">
        <span class="title">硬门槛 (20%)</span>
        <span class="score">${sub_scores.hard ?? 0}分</span>
      </div>
      <div class="subscore-card">
        <span class="title">必备技能 (30%)</span>
        <span class="score">${sub_scores.must_skill ?? 0}分</span>
      </div>
      <div class="subscore-card">
        <span class="title">加分项 (15%)</span>
        <span class="score">${sub_scores.bonus_skill ?? 0}分</span>
      </div>
      <div class="subscore-card">
        <span class="title">业务契合 (35%)</span>
        <span class="score">${sub_scores.business ?? 0}分</span>
      </div>
    </div>

    <!-- 3. 技能匹配碰撞 -->
    <div class="jdp-section">
      <h5 class="sec-title">🎯 技能重合与缺失</h5>
      <div class="jdp-tags-wrapper">
        ${matchedTags}
        ${missingTags}
        ${matched_skills.length === 0 && missing_skills.length === 0 ? '<span class="text-muted">暂无技能碰撞数据</span>' : ''}
      </div>
    </div>

    <!-- 4. AI 智能诊断洞察 -->
    <div class="jdp-section">
      <h5 class="sec-title">💡 AI 智能诊断</h5>
      
      <div class="insight-item">
        <span class="insight-label text-green">🌟 匹配亮点</span>
        <ul>${(insights.highlights || []).map(h => `<li>${h}</li>`).join("")}</ul>
      </div>

      <div class="insight-item">
        <span class="insight-label text-orange">⚠️ 潜在风险/短板</span>
        <ul>${(insights.risks || []).map(r => `<li>${r}</li>`).join("")}</ul>
      </div>

      <div class="insight-item">
        <span class="insight-label text-blue">📝 简历优化建议</span>
        <ul>${(insights.gaps || []).map(g => `<li>${g}</li>`).join("")}</ul>
      </div>
    </div>
  `;
}

// =========================================================
// 4. 异常提示（在弹窗内展示错误）
// =========================================================
function updateReportModalError(errorMessage, jobId, jobTitle, cleanedJd) {
  getOrCreateReportModal();

  // 显示重新尝试按钮
  const refreshBtn = document.getElementById("jdp-modal-refresh-btn");
  if (refreshBtn) {
    refreshBtn.style.display = "inline-block";
    refreshBtn.innerText = "🔄 重试请求";
    refreshBtn.onclick = () =>  fetchAndShowReport(jobId, jobTitle, true,cleanedJd);
  }

  const bodyEl = document.getElementById("jdp-modal-body");
  bodyEl.innerHTML = `
    <div class="jdp-error-box" style="text-align: center; padding: 40px 10px;">
      <div style="font-size: 40px; margin-bottom: 10px;">⚠️</div>
      <h4 style="color: #ef4444; margin-bottom: 8px;">报告生成失败</h4>
      <p style="color: #64748b; font-size: 14px; max-width: 80%; margin: 0 auto;">
        ${errorMessage || "服务器繁忙或网络异常，请稍后再试。"}
      </p>
    </div>
  `;
}

// =========================================================
// 5. 核心逻辑入口：读缓存 (5分钟控制) -> 请求 API -> 写入缓存
// =========================================================
async function fetchAndShowReport(jobId, jobTitle = "目标岗位", forceRefresh = false, cleanedJd) {
  const cacheKey = `jdp_report_${jobId}`;
  const userId = await getUserInfo("user_info");
  // ⚡ 1. 检查 5 分钟缓存（如果不要求强制刷新）
  if (!forceRefresh) {
    const cachedStr = localStorage.getItem(cacheKey);
    if (cachedStr) {
      try {
        const cachedData = JSON.parse(cachedStr);
        const now = Date.now();
        // 判断缓存时间是否在 5 分钟 (REPORT_CACHE_TTL) 内
        if (cachedData.timestamp && (now - cachedData.timestamp < REPORT_CACHE_TTL)) {
          // 在 5 分钟内，直接使用缓存，秒开弹窗
          updateReportModalContent(cachedData.report, cachedData.remainingQuota, true, jobId,cleanedJd);
          return;
        } else {
          // 超过 5 分钟，自动删除过期缓存
          localStorage.removeItem(cacheKey);
        }
      } catch (e) {
        localStorage.removeItem(cacheKey);
      }
    }
  }

  // ⚡ 2. 无有效缓存：显示 Loading 骨架屏弹窗
  showReportModalLoading(jobTitle);

  try {
    // ⚡ 发给后端的 job_id 换成内容哈希（不用 jobId/posHash 那个基于URL的
    // 值）——同一份JD不管URL/用户/访问时间怎么变，这里传给后端的值都一样，
    // 缓存才能真正命中，不会白白重复调用大模型。
    const backendJobId = computeContentJobId(jobTitle, cleanedJd);
    const response = await fetch(`${API_BASE_URL}/api/match/detailed-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        user_id: userId,
        job_id: backendJobId,
        job_title: jobTitle,
        cleaned_jd: cleanedJd })
    });

    const resData = await response.json().catch(() => ({}));

    // ⚡ 3. 处理异常 HTTP 响应
    if (response.status === 429) {
      updateReportModalError(resData.detail || "请求过于频繁，请稍后再试", jobId, jobTitle,cleanedJd);
      return;
    }

    if (!response.ok) {
      updateReportModalError(resData.detail || "生成深度报告失败，请稍后再试", jobId, jobTitle,cleanedJd);
      return;
    }

    // ⚡ 4. 获取成功数据
    const report = resData.data;
    const remainingQuota = resData.remaining_quota;

    // ⚡ 5. 写入本地缓存，带上当前时间戳 timestamp
    localStorage.setItem(cacheKey, JSON.stringify({
      report,
      remainingQuota,
      timestamp: Date.now() // 记录存入时间
    }));

    // ⚡ 6. 更新弹窗页面内容
    updateReportModalContent(report, remainingQuota, false, jobId,jobTitle,cleanedJd);

  } catch (err) {
    console.error("网络请求异常:", err);
    updateReportModalError("网络断开或服务器响应超时", jobId, jobTitle,cleanedJd);
  }
}


// ------------------------------------------------------------------
// 2. 调用 API 发送请求并处理状态
// ------------------------------------------------------------------
async function triggerDetailedReport({ matchCard, idx, jobId, jobTitle, cleanedJd }) {
  const userId = await getUserInfo("user_info");
  const scoreNumEl = document.getElementById(`score-num-${idx}`);
  const originalScoreText = scoreNumEl ? scoreNumEl.innerText : matchCard.innerText;

  // 1. 进入 Loading 状态，防止重复点击
  matchCard.classList.add("loading");
  if (scoreNumEl) scoreNumEl.innerText = "⏳";

  try {
    // ⚡ 同上：发后端用内容哈希，不用URL哈希出来的 jobId。
    const backendJobId = computeContentJobId(jobTitle, cleanedJd);
    const response = await fetch(`${API_BASE_URL}/api/match/detailed-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        job_id: backendJobId,
        job_title: jobTitle,
        cleaned_jd: cleanedJd
      })
    });

    const resData = await response.json();

    // 处理 429 频次受限（每日配额用尽）
    if (response.status === 429) {
      alert(`⚠️ ${resData.detail}`);
      return;
    }

    // 处理其他非 200 错误
    if (!response.ok) {
      alert(`❌ ${resData.detail || "生成深度报告失败，请稍后再试"}`);
      return;
    }

    const report = resData.data;

    // 2. 接口返回最新得分，更新 UI 卡片分值
    if (scoreNumEl) {
      // scoreNumEl.innerText = report.total_score;
    }

    // 3. 打开 深度评估报告 Modal 弹窗
    showReportModal(report, resData.remaining_quota, resData.from_cache);

  } catch (error) {
    console.error("请求深度匹配报告失败:", error);
    alert("网络连接失败，请确认后端 API 是否已启动！");
  } finally {
    // 恢复非 Loading 状态
    matchCard.classList.remove("loading");
    if (scoreNumEl && scoreNumEl.innerText === "⏳") {
      scoreNumEl.innerText = originalScoreText;
    }
  }
}

// ------------------------------------------------------------------
// 3. 渲染 & 弹出匹配分析报告 Modal
// ------------------------------------------------------------------
function showReportModal(report, remainingQuota, fromCache) {
  // 移除旧的 Modal (避免重复叠加)
  const oldModal = document.getElementById("jdp-report-modal");
  if (oldModal) oldModal.remove();

  const { total_score, sub_scores, details, job_title } = report;
  const { matched_skills = [], missing_skills = [], hard_warnings = [], insights = {} } = details;

  // 硬性门槛预警 HTML
  const warningsHtml = hard_warnings.length > 0 
    ? `<div class="jdp-alert-box">⚠️ <b>硬性门槛预警：</b>${hard_warnings.join("；")}</div>`
    : '';

  // 技能碰撞 Tag HTML
  const matchedTags = matched_skills.map(s => `<span class="jdp-tag tag-success">✓ ${s}</span>`).join("");
  const missingTags = missing_skills.map(s => `<span class="jdp-tag tag-danger">✕ ${s}</span>`).join("");

  const modalHtml = `
    <div id="jdp-report-modal" class="jdp-modal-backdrop">
      <div class="jdp-modal-content">
        <!-- 弹窗页头 -->
        <div class="jdp-modal-header">
          <div>
            <h3>⚡ AI 岗位匹配评估报告</h3>
            <p class="subtitle">目标岗位：${job_title}</p>
          </div>
          <button class="jdp-modal-close">&times;</button>
        </div>

        <!-- 弹窗主体内容 -->
        <div class="jdp-modal-body">
          
          <!-- 1. 综合匹配分看板 -->
          <div class="jdp-hero-card">
            <div class="score-circle">
              <span class="score-val">${total_score}</span>
              <span class="score-unit">分</span>
            </div>
            <div class="score-meta">
              <h4>${total_score >= 80 ? '🔥 极高匹配度' : total_score >= 60 ? '👍 匹配度良好' : '⚠️ 匹配度较低'}</h4>
              <span class="quota-badge">
                ${fromCache ? '⚡ 缓存急速加载' : `今日剩余 AI 报告额度: ${remainingQuota ?? '无限制'} 次`}
              </span>
            </div>
          </div>

          ${warningsHtml}

          <!-- 2. 四维评分拆解 -->
          <div class="jdp-grid-subscores">
            <div class="subscore-card">
              <span class="title">硬门槛 (20%)</span>
              <span class="score">${sub_scores.hard}分</span>
            </div>
            <div class="subscore-card">
              <span class="title">必备技能 (30%)</span>
              <span class="score">${sub_scores.must_skill}分</span>
            </div>
            <div class="subscore-card">
              <span class="title">加分项 (15%)</span>
              <span class="score">${sub_scores.bonus_skill}分</span>
            </div>
            <div class="subscore-card">
              <span class="title">业务契合 (35%)</span>
              <span class="score">${sub_scores.business}分</span>
            </div>
          </div>

          <!-- 3. 技能匹配碰撞 -->
          <div class="jdp-section">
            <h5 class="sec-title">🎯 技能重合与缺失</h5>
            <div class="jdp-tags-wrapper">
              ${matchedTags}
              ${missingTags}
              ${matched_skills.length === 0 && missing_skills.length === 0 ? '<span class="text-muted">暂无技能碰撞数据</span>' : ''}
            </div>
          </div>

          <!-- 4. AI 智能诊断洞察 -->
          <div class="jdp-section">
            <h5 class="sec-title">💡 AI 智能诊断</h5>
            
            <div class="insight-item">
              <span class="insight-label text-green">🌟 匹配亮点</span>
              <ul>${(insights.highlights || []).map(h => `<li>${h}</li>`).join("")}</ul>
            </div>

            <div class="insight-item">
              <span class="insight-label text-orange">⚠️ 潜在风险/短板</span>
              <ul>${(insights.risks || []).map(r => `<li>${r}</li>`).join("")}</ul>
            </div>

            <div class="insight-item">
              <span class="insight-label text-blue">📝 简历优化建议</span>
              <ul>${(insights.gaps || []).map(g => `<li>${g}</li>`).join("")}</ul>
            </div>
          </div>

        </div>

        <!-- 弹窗底部 -->
        <div class="jdp-modal-footer">
          <button class="jdp-btn-primary jdp-btn-close-action">关闭报告</button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", modalHtml);

  // 绑定关闭事件
  const modal = document.getElementById("jdp-report-modal");
  const closeBtns = modal.querySelectorAll(".jdp-modal-close, .jdp-btn-close-action");
  
  closeBtns.forEach(btn => {
    btn.addEventListener("click", () => modal.remove());
  });

  // 点击背景遮罩关闭
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });
}

/**
 * ==============================================================================
 * content.js - 支持中英文 JD + 动作近义词直接触发投递/沟通 + 差异化筛选
 * ==============================================================================
 */

function isDetailPage() {
  const url = window.location.href.toLowerCase();
  return [/zhaopin\.com\/job\//, /boss\.com\/job_detail/, /51job\.com\/job\//, /liepin\.com\/job\//, /\/detail\b/].some(p => p.test(url));
}

if (!isDetailPage()) {

const STORAGE_KEY_FILTER = "job_filter_config";
const SALARY_REGEX = /([$€£¥]|\d+[kK千]|万|\d+薪|\/yr|\/hr)/;

let activeIndex = 0;
let jobDataList = [];
let filteredJobList = [];
let isScrolling = false;
let lastJobsHash = "";

let filterConfig = {
  includeKeywords: "",
  excludeKeywords: "外包,驻场,996,大小周,单休,培训",
  companyTypes: []
};

// ------------------------------------------------------------------------------
// 1. 本地配置管理
// ------------------------------------------------------------------------------
async function loadFilterConfig() {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome?.storage?.local) return resolve(filterConfig);
    chrome.storage.local.get([STORAGE_KEY_FILTER], (result) => {
      if (result[STORAGE_KEY_FILTER]) {
        filterConfig = { ...filterConfig, ...result[STORAGE_KEY_FILTER] };
      }
      resolve(filterConfig);
    });
  });
}

function saveFilterConfig(newConfig) {
  filterConfig = newConfig;
  if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
    chrome.storage.local.set({ [STORAGE_KEY_FILTER]: filterConfig });
  }
}
//获取分数
// 存储已发起了打分请求的卡片 ID，防止重复请求
// 全局已请求的 jobId 集合，防止重复发送

// 获取当前页面所有的卡片 DOM 节点数组
// 全局已请求的 jobId 集合
const fetchedJobIds = new Set();
const PRELOAD_AHEAD = 2; // 预加载向后顺延 2 个卡片

const cardObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      const currentCard = entry.target;

      // ⚡ 1. 动态获取【当前最新】的所有卡片 DOM，并强制转为真正的 Array 数组
      const currentAllCardNodes = Array.from(document.querySelectorAll('.jdp-card'));
      
      // ⚡ 2. 此时可以安全使用 .indexOf() 获取索引
      const currentIndex = currentAllCardNodes.indexOf(currentCard);
      if (currentIndex === -1) return;

      // 3. 计算预加载的目标终点
      const maxTargetIndex = Math.min(currentIndex + PRELOAD_AHEAD, currentAllCardNodes.length - 1);

      // 4. 循环触发从 当前卡片 到 预加载卡片 的请求
      for (let i = currentIndex; i <= maxTargetIndex; i++) {
        const targetNode = currentAllCardNodes[i];
        if (!targetNode) continue;

        // ⚡ 5. 稳健提取 jobId（三级容错：节点本身 ➔ 内部元素 ➔ 父级元素）
        let jobId = targetNode.dataset.jobId || targetNode.dataset.id;
        if (!jobId) {
          const innerEl = targetNode.querySelector('[data-job-id], [data-id]');
          if (innerEl) jobId = innerEl.dataset.jobId || innerEl.dataset.id;
        }

        if (!jobId) continue;

        // 6. 拦截已请求过的卡片
        if (!fetchedJobIds.has(jobId)) {
          fetchedJobIds.add(jobId); // 标记已请求
          
          console.log(`🚀 [预加载触发] 当前在第 ${currentIndex + 1} 张，正在请求第 ${i + 1} 张卡片 (jobId: ${jobId})`);
          
          // 执行打分与 UI 渲染
          // fetchAndRenderQuickScore(targetNode, jobId);
        }
      }
    }
  });
}, {
  root: null,             // 默认为视口，如果是局部 div 滚动，请设为 document.querySelector('.scroll-container')
  rootMargin: "150px 0px", // 提前 150px 响应，防滑动速度过快
  threshold: 0.01          // 只要露出一丁点边缘就触发
});

// ⚡ 7. 必须封装一个绑定函数！每次重新渲染或切换列表时调用它
function observeAllCards() {
  // 先解绑之前的观察，防止重复监听旧节点
  cardObserver.disconnect();

  // 获取最新的卡片并重新绑定
  const cards = document.querySelectorAll('.jdp-card');
  cards.forEach(card => cardObserver.observe(card));
  
  console.log(`👀 已重新监听 ${cards.length} 张卡片`);
}

// 5. 绑定所有卡片节点

// const fetchedJobIds = new Set();

// const cardObserver = new IntersectionObserver((entries) => {
//   entries.forEach(async (entry) => {
//     // 🔍 调试日志 1：观察者回调触发
//     console.log("👀 Observer 监听响应！", entry.target, "是否可见(isIntersecting):", entry.isIntersecting);

//     if (entry.isIntersecting) {
//       const cardNode = entry.target;

//       // =========================================================
//       // ⚡【稳健提取 jobId】3 级链式容错提取
//       // =========================================================
//       // 1. 优先拿节点本身的 dataset.jobId (对应 data-job-id) 或 dataset.id (对应 data-id)
//       let jobId = cardNode.dataset.jobId || cardNode.dataset.id;

//       // 2. 如果监听的卡片外层没有，尝试向【子元素】寻找带有 data-job-id 的节点
//       if (!jobId) {
//         const innerEl = cardNode.querySelector('[data-job-id], [data-id]');
//         if (innerEl) {
//           jobId = innerEl.dataset.jobId || innerEl.dataset.id;
//         }
//       }

//       // 3. 如果监听的本身就是子节点，尝试向【父元素】查找
//       if (!jobId && typeof cardNode.closest === 'function') {
//         const parentEl = cardNode.closest('[data-job-id], [data-id]');
//         if (parentEl) {
//           jobId = parentEl.dataset.jobId || parentEl.dataset.id;
//         }
//       }

//       // 🔍 调试日志 2：检查 jobId 提取结果
//       console.log("🆔 当前卡片提取到的 jobId:", jobId);

//       // 排查点 1：缺少 jobId 拦截
//       if (!jobId) {
//         console.warn("❌ 拦截：当前节点及其上下级均未找到 data-job-id 属性！", cardNode);
//         return;
//       }

//       // 排查点 2：已被 Set 记录过，跳过重复请求
//       if (fetchedJobIds.has(jobId)) {
//         console.log(`ℹ️ 忽略：jobId [${jobId}] 已经请求过或正在请求中。`);
//         return;
//       }

//       // 标记为已请求
//       fetchedJobIds.add(jobId);
//       console.log(`🚀 触发 API 请求！jobId: ${jobId}`);

//       // 真正执行打分 API
//       await fetchAndRenderQuickScore(cardNode, jobId);
//     }
//   });
// }, {
//   root: null, 
//   rootMargin: "100px 0px", // 提前 100px 预加载
//   threshold: 0.01          // 只要露出一丁点边缘就触发
// });

/**
 * 快速哈希函数（生成 12 位稳定字符）
 */
function hashString(str) {
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

// ⚡ 发给后端的 job_id 必须基于JD内容本身算出来，不能用 posHash（基于URL）：
// 同一份JD，不同用户/不同时间点/带不同追踪参数访问，URL会不一样，但内容是
// 一份——用URL哈希当job_id，会导致后端 get_or_parse_job 缓存查询
//（WHERE job_id = :jid）永远命中不了同一份已经解析过的内容，白白重复调用
// 大模型解析同样的文本。用内容本身算哈希，天然去重：内容相同，不管谁在
// 什么时候用什么URL访问，算出来的都是同一个值；也不依赖页面有没有提供
// 可靠的原生ID（51job卡片上的<a>是公司URL不是职位URL，用URL哈希在这个
// 平台上本来就不可靠，还会导致同公司下的多个职位互相撞车——用内容哈希
// 这个问题也一起解决了）。
// posHash/job.id 保留不动，继续给本地卡片匹配、localStorage缓存key这些
// 纯本地用途用，跟发后端的这个是两件事，没必要合并成一个。
function computeContentJobId(title, jdText) {
  const normalized = `${String(title || '').trim()}\n${String(jdText || '').trim()}`.replace(/\s+/g, ' ');
  return 'jd_' + hashString(normalized);
}

/**
 * ⚡ 核心逻辑：基于纯净 URL 生成 pos_hash
 */
function getPosHash(url, title = "") {
  if (!url) {
    // 兜底：万一某些节点真的没抓到 URL，用 title 兜底
    return "pos_" + hashString(title || "unknown_job");
  }

  // 1. 规范化：去除问号参数 ? 及锚点 #
  // 例: "https://zhipin.com/job/123.html?ka=search_1#top" -> "https://zhipin.com/job/123.html"
  const cleanUrl = url.split('?')[0].split('#')[0].toLowerCase();

  // 2. 生成 pos_hash (如: pos_8f3a9d21c4b5)
  return "pos_" + hashString(cleanUrl);
}

// 3. 单个卡片请求与 DOM 更新
// async function fetchAndRenderQuickScore(cardNode, jobId) {
//   const scoreContainer = cardNode.querySelector('.jdp-card-match');
//   const scoreNumEl = scoreContainer?.querySelector('.score-text');
//   if (scoreNumEl) scoreNumEl.innerText = "⏳";

//   try {
//     const userId = await getUserInfo("user_info");
//     const jobTitle = cardNode.getAttribute("data-job-title") || "";
//     const cleanedJd = cardNode.querySelector(".job-detail-text")?.innerText || jobTitle;

//     const res = await fetch(`${API_BASE_URL}/api/match/quick-score`, {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({
//         user_id: userId,
//         job_id: jobId,
//         job_title: jobTitle,
//         cleaned_jd: cleanedJd
//       })
//     });

//     if (res.ok) {
//       const data = await res.json();
//       // 渲染匹配分数到页面卡片上
//      if (scoreContainer && data) {
//       // 移除 loading 样式
//       scoreContainer.classList.remove('loading-state');
      
//       // 渲染真实分数与视觉等级
//       renderRichScoreBadge(scoreContainer, data);
//     }
//     }
//   } catch (err) {
//     console.error(`[QuickScore] 岗位 ${jobId} 打分失败:`, err);
//   }
// }


//简略分析
function renderRichScoreBadge(container, data) {
  const score = data.quick_score;
  const warnings = data.hard_warnings || [];
  const matchedCount = data.must_matched_count || 0;
  const missingCount = data.must_missing_count || 0;

  // 1. 根据分数拉开视觉对比度（高分绿、中分黄、低分红）
  let themeClass = "theme-high";
  let tagText = "高度匹配";
  
  if (score < 60) {
    themeClass = "theme-low";
    tagText = "较难匹配";
  } else if (score < 80) {
    themeClass = "theme-mid";
    tagText = "中度匹配";
  }

  // 2. 拼接背后做过的分析细节（让用户看到分析过程）
  let warningBadge = warnings.length > 0 
    ? `<span class="badge-warning">⚠️ ${warnings[0]}</span>` 
    : `<span class="badge-success">✅ 硬性条件全满足</span>`;

  // 3. 动态渲染极富信息密度的 UI 块
  container.className = `jdp-card-match ${themeClass}`;
  container.innerHTML = `
    <div class="match-score-header">
      <span class="main-score">${score}</span>
      <span class="score-unit">分</span>
      <span class="match-level-tag">${tagText}</span>
    </div>
    
    <!-- ⚡ 把后端的深度分析结果暴露出来 -->
    <div class="match-analysis-chips">
      ${warningBadge}
      <span class="chip">🎯 技能重合 ${matchedCount} 项</span>
      ${missingCount > 0 ? `<span class="chip-missing">缺 ${missingCount} 项技能</span>` : ''}
    </div>
    
    <div class="match-hover-tip">查看完整诊断 ➔</div>
  `;
}
// ------------------------------------------------------------------------------
// 2. 提取卡片元数据
// ------------------------------------------------------------------------------
function isJobCardCandidate(el) {
  if (!el || el.nodeType !== 1 || el.tagName === 'BODY' || el.tagName === 'HTML') return false;
  const link = el.tagName === 'A' ? el : el.querySelector('a[href]');
  if (!link) return false;

  const text = el.innerText || "";
  const hasSalaryPattern = SALARY_REGEX.test(text);
  const rect = el.getBoundingClientRect();
  return hasSalaryPattern && rect.width > 180 && rect.height >= 40 && rect.height <= 350;
}

async function getJobCardsData() {
  const allElements = Array.from(document.querySelectorAll('div, li, a'));
  const candidateCards = allElements.filter(el => isJobCardCandidate(el));
  const topNodes = candidateCards.filter(cardA => !candidateCards.some(cardB => cardB !== cardA && cardB.contains(cardA)));

  // ⚡ 1. 回调函数声明为 async，外层加上 await Promise.all 实现并发请求处理
  return await Promise.all(topNodes.map(async (cardNode) => {
    const textLines = (cardNode.innerText || "").split('\n').map(s => s.trim()).filter(Boolean);
    const linkEl = cardNode.tagName === 'A' ? cardNode : cardNode.querySelector('a[href]');
    let targetUrl = linkEl ? linkEl.href : "";

    const salaryLine = textLines.find(line => SALARY_REGEX.test(line)) || t('salary');
    let title = textLines[0] || "未知职位";
    // 之前这里超过35字符会被整体替换成通用占位串"职位详情"——这个字段
    // 同时被用来做网络拦截数据的匹配键（normalizeTitleForMatch），多个
    // 标题较长的职位会全部塌缩成同一个占位串，matchKey 撞车，数据会
    // 被错误分配给数组里第一个占位串职位。展示层面文字太长可以用CSS
    // 的 text-overflow 处理，不该在数据层面把内容改没。

   const posHash = getPosHash(targetUrl, title);
   let  jobId = posHash;
    // cardNode.setAttribute("data-job-id", posHash);
    
    // ⚡ 2. 增加 try...catch 容错机制，避免单个请求失败阻断整个卡片列表解析
    let matchScore = 0;
    try {

    } catch (err) {
      console.warn(`[quick-score] 获取职位 ID: ${jobId} 快速分失败:`, err);
    }

    return {
      id: jobId,
      title: title,
      rawSalary: salaryLine,
      matchScore: matchScore,
      url: targetUrl,
      rawNode: cardNode,
      fullText: cardNode.innerText || "",
      respText: t('loadingResp'),
      reqText: t('loadingReq')
    };
  }));
}

// async function getJobCardsData() {
//   const allElements = Array.from(document.querySelectorAll('div, li, a'));
//   const candidateCards = allElements.filter(el => isJobCardCandidate(el));
//   const topNodes = candidateCards.filter(cardA => !candidateCards.some(cardB => cardB !== cardA && cardB.contains(cardA)));

//   return topNodes.map(cardNode => {
//     const textLines = (cardNode.innerText || "").split('\n').map(s => s.trim()).filter(Boolean);
//     const linkEl = cardNode.tagName === 'A' ? cardNode : cardNode.querySelector('a[href]');
//     let targetUrl = linkEl ? linkEl.href : "";

//     const salaryLine = textLines.find(line => SALARY_REGEX.test(line)) || "薪资面议";
//     let title = textLines[0] || "未知职位";
//     if (title.length > 35) title = "职位详情";

//     const jobId = cardNode.getAttribute('data-job-id') || btoa(encodeURIComponent(targetUrl || title)).slice(-20);
//      //分数匹配
//     const userId = getCurrentUserId();
//     const response = await fetch(`${API_BASE_URL}/api/match/quick-score`, {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({
//         user_id: userId,
//         job_id: jobId,
//       })
//     });

//     const resData = response.json();
//     // const score=await fetchmatchData(jobId,userId);
//     return {
//       id: jobId,
//       title: title,
//       rawSalary: salaryLine,
//       matchScore:resData.score,
//       url: targetUrl,
//       rawNode: cardNode,
//       fullText: cardNode.innerText || "",
//       respText: "⏳ 正在后台解析职责...",
//       reqText: "⏳ 正在后台解析要求..."
//     };
//   });
// }



// ------------------------------------------------------------------------------
// 3. 原网动作近义词触发器（立即沟通/投递/聊一聊）
// ------------------------------------------------------------------------------
function triggerNativeActionBtn(rawCardNode) {
  if (!rawCardNode) return false;

  // 多语言/多平台 投递/沟通 动作近义词
  const actionKeywordsRegex = /^(立即沟通|聊一聊|立即投递|投递简历|投递|应聘|立即申请|申请|Easy Apply|Apply Now|Apply)$/i;

  // 1. 在节点内搜索所有按钮/可点击元素
  const clickableElements = Array.from(rawCardNode.querySelectorAll('button, a, div[role="button"], span.btn, div.btn'));

  let targetBtn = clickableElements.find(el => {
    const txt = (el.innerText || "").trim();
    return actionKeywordsRegex.test(txt);
  });

  // 2. 如果精确正则没命中，进行模糊包含匹配
  if (!targetBtn) {
    targetBtn = clickableElements.find(el => {
      const txt = (el.innerText || "").trim().toLowerCase();
      return /沟通|聊一聊|投递|应聘|apply/.test(txt);
    });
  }

  if (targetBtn) {
    targetBtn.click();
    return true;
  }
  return false;
}

// ------------------------------------------------------------------------------
// 4. 匹配校验逻辑
// ------------------------------------------------------------------------------
function checkJobMatch(job) {
  const searchContent = (job.title + " " + job.fullText + " " + (job.respText || "") + " " + (job.reqText || "")).toLowerCase();

  if (filterConfig.excludeKeywords) {
    const excludes = filterConfig.excludeKeywords.split(/[,，]/).map(s => s.trim().toLowerCase()).filter(Boolean);
    if (excludes.some(kw => searchContent.includes(kw))) return false;
  }

  if (filterConfig.includeKeywords) {
    const includes = filterConfig.includeKeywords.split(/[,，]/).map(s => s.trim().toLowerCase()).filter(Boolean);
    if (includes.length > 0 && !includes.some(kw => searchContent.includes(kw))) return false;
  }

  if (filterConfig.companyTypes && filterConfig.companyTypes.length > 0) {
    if (!filterConfig.companyTypes.some(type => searchContent.includes(type.toLowerCase()))) return false;
  }

  return true;
}

// ------------------------------------------------------------------------------
// 5. “上一页/下一页”分页检测
// ------------------------------------------------------------------------------
function findAndClickPaginationBtn(direction) {
  const isNext = direction === 'next';
  const attrSelector = isNext
    ? '[aria-label*="next" i], [aria-label*="下一页" i], [title*="下一页" i], [title*="next" i], .btn-next, .pagination-next, .next-page, .pager-next'
    : '[aria-label*="prev" i], [aria-label*="上一页" i], [title*="上一页" i], [title*="prev" i], .btn-prev, .pagination-prev, .prev-page, .pager-prev';

  let target = document.querySelector(attrSelector);

  if (!target) {
    const candidates = Array.from(document.querySelectorAll('button, li, a, div[role="button"]'));
    target = candidates.find(el => {
      const html = el.innerHTML.toLowerCase();
      const txt = (el.innerText || "").trim().toLowerCase();
      const textMatched = isNext ? /^(下一页|下一组|>|›|next)$/.test(txt) : /^(上一页|上一组|<|‹|prev)$/.test(txt);
      if (textMatched) return true;

      return isNext
        ? (html.includes('arrow-right') || html.includes('chevron-right') || html.includes('right-icon') || html.includes('icon-next'))
        : (html.includes('arrow-left') || html.includes('chevron-left') || html.includes('left-icon') || html.includes('icon-prev'));
    });
  }

  if (target) target.click();
}

// ------------------------------------------------------------------------------
// 6. 渲染 UI
// ------------------------------------------------------------------------------
async function renderCardGalleryUI() {
  await loadFilterConfig();
  const layout = detectLayoutType();
  console.log(`🚀 [JobEngine] 开始抓取，检测到当前布局为: ${layout}`);

  let rawJobs = [];

  // if (layout === LAYOUT_TYPE.DUAL_PANE) {
  //   // -------------------------------------------------------------
  //   // 【左右栏模式】需要通过滚动/联动右侧面板解析 (processJobCards)
  //   // -------------------------------------------------------------
  //   // 自动寻找卡片容器 winner (如果调用方未传入)
  //   rawJobs = await window.runPipeline();
  //   console.warn('⚠️ [JobEngine] 左右栏');
  //   }else{
  //     rawJobs = await getJobCardsData();
  //     console.warn('⚠️ [JobEngine] 列表栏');
  //   }
  
   rawJobs = await getJobCardsData();
  // rawJobs = await window.runPipeline();
  if (rawJobs.length === 0) return;

  const currentHash = rawJobs.map(j => j.id).join('|');
  const existingWrapper = document.getElementById('jdp-gallery-wrapper');

  if (existingWrapper && currentHash === lastJobsHash) return;
  if (existingWrapper) existingWrapper.remove();

  lastJobsHash = currentHash;
  jobDataList = rawJobs;
  filteredJobList = jobDataList.filter(checkJobMatch);
  activeIndex = 0;

  const firstCard = jobDataList[0].rawNode;
  let parentContainer = firstCard.parentElement;
  while (parentContainer && parentContainer !== document.body) {
    const style = window.getComputedStyle(parentContainer);
    if (style.display !== 'flex' && parentContainer.offsetWidth > 600) break;
    parentContainer = parentContainer.parentElement;
  }

  const wrapper = document.createElement('div');
  wrapper.id = 'jdp-gallery-wrapper';
  wrapper.style.cssText = `
    width: 100% !important; max-width: 1200px !important; clear: both !important;
    margin: 10px auto 25px auto !important; box-sizing: border-box !important;
    display: block !important; position: relative !important; float: none !important;
  `;

  wrapper.innerHTML = `
    <style>
      #jdp-gallery-box {
        width: 100%; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px;
        padding: 20px; box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        box-shadow: 0 4px 20px rgba(0,0,0,0.03); overflow: hidden; position: relative;
      }
      
      .jdp-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
      .jdp-title { font-size: 16px; font-weight: bold; color: #0f172a; display: flex; align-items: center; gap: 8px; }
      .jdp-header-actions { display: flex; align-items: center; gap: 10px; }
      
      .jdp-btn {
        padding: 6px 12px; border-radius: 8px; font-size: 13px; font-weight: 600;
        cursor: pointer; border: 1px solid #cbd5e1; background: #ffffff; color: #334155;
        transition: all 0.2s ease; display: inline-flex; align-items: center; gap: 4px;
      }
      .jdp-btn:hover { background: #2563eb; color: #ffffff; border-color: #2563eb; }
      .jdp-btn-active { background: #eff6ff; border-color: #3b82f6; color: #2563eb; }
      #jdp-gallery-box.is-folded .jdp-card-stage { height: 0 !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; overflow: hidden; opacity: 0; pointer-events: none; }

      #jdp-filter-panel {
        background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px;
        padding: 14px 18px; margin-bottom: 15px; display: none; flex-direction: column; gap: 12px;
      }
      #jdp-filter-panel.show { display: flex; }
      
      .jdp-filter-row { display: flex; align-items: center; gap: 12px; font-size: 13px; color: #334155; }
      .jdp-filter-label { font-weight: bold; width: 90px; shrink: 0; color: #475569; }
      .jdp-input {
        flex: 1; padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 6px;
        font-size: 13px; outline: none; transition: border-color 0.2s;
      }
      .jdp-input:focus { border-color: #2563eb; }
      .jdp-checkbox-group { display: flex; gap: 12px; align-items: center; }
      .jdp-checkbox-label { display: flex; align-items: center; gap: 4px; cursor: pointer; user-select: none; }

      .jdp-card-stage {
        width: 100%; min-height: 520px; position: relative;
        display: flex; align-items: flex-start; justify-content: center;
        padding-top: 10px; box-sizing: border-box;
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

      .jdp-card {
        position: absolute; width: 680px; background: #ffffff;
        border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; box-sizing: border-box;
        display: flex; flex-direction: column; justify-content: space-between;
        cursor: pointer; transition: all 0.45s cubic-bezier(0.25, 1, 0.5, 1);
        box-shadow: 0 4px 12px rgba(0,0,0,0.03); pointer-events: auto;
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
      .jdp-card-title { font-size: 18px; font-weight: bold; color: #0f172a; max-width: 480px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .jdp-card-salary { font-size: 20px; font-weight: bold; color: #ef4444; margin-top: 4px; }

      .jdp-btn-group { display: flex; gap: 8px; align-items: center; }

      /* ⚡ 动态投递/沟通按钮 */
      .jdp-action-btn {
        padding: 6px 14px; background: #10b981; color: #ffffff; border-radius: 6px;
        font-size: 13px; font-weight: bold; border: none; cursor: pointer; transition: all 0.2s ease;
      }
      .jdp-action-btn:hover { background: #059669; }

      .jdp-open-link-btn {
        padding: 6px 14px; background: #2563eb; color: #ffffff; border-radius: 6px;
        font-size: 13px; font-weight: bold; border: none; cursor: pointer; transition: all 0.2s ease;
      }
      .jdp-open-link-btn:hover { background: #1d4ed8; }

      .jdp-card-body { display: flex; flex-direction: column; gap: 14px; margin-bottom: 14px; }
      .jdp-section { background: #f8fafc; padding: 14px; border-radius: 10px; border-left: 4px solid #2563eb; }
      .jdp-section.req { border-left-color: #10b981; }
      .jdp-section-label { font-size: 13px; font-weight: bold; color: #475569; margin-bottom: 8px; }
      .jdp-section-content { font-size: 13px; line-height: 1.6; color: #334155; white-space: pre-line; word-break: break-all; }

      .jdp-empty-tips { padding: 60px 0; text-align: center; color: #64748b; font-size: 14px; }
    </style>

    <div id="jdp-gallery-box">
      <div class="jdp-header">
        <div class="jdp-title">${t('panelTitle')}</div>
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
  // injectWidgetBelowFilter(wrapper, )
//   const modal = window.mountCenteredModal(wrapper, {
//   title: '领英/BOSS AI 辅助工具',
// });
  parentContainer.insertBefore(wrapper, parentContainer.firstChild);

  const stageEl = document.getElementById('jdp-stage');
  const cardsContainer = document.getElementById('jdp-cards-container');
  const counterEl = document.getElementById('jdp-counter');
  const filterPanel = document.getElementById('jdp-filter-panel');
  const filterToggleBtn = document.getElementById('jdp-btn-toggle-filter');
  const foldBtn = document.getElementById('jdp-btn-toggle-fold');
  const galleryBox = document.getElementById('jdp-gallery-box');

  filterToggleBtn.onclick = () => {
    filterPanel.classList.toggle('show');
    filterToggleBtn.classList.toggle('jdp-btn-active');
  };

  foldBtn.onclick = () => {
    const isFolded = galleryBox.classList.toggle('is-folded');
    // foldBtn.innerText = isFolded ? '▼ 展开看板' : '▲ 折叠看板';
    foldBtn.innerText = isFolded ? t('toggleFoldExpand') : t('toggleFoldCollapse');
    foldBtn.classList.toggle('jdp-btn-active', !isFolded);
    
  };

  function renderCards() {
    filteredJobList = jobDataList.filter(checkJobMatch);
    
    jobDataList.forEach(job => {
      const isMatch = checkJobMatch(job);
      if (job.rawNode) {
        job.rawNode.style.opacity = isMatch ? "1" : "0.25";
        job.rawNode.style.filter = isMatch ? "none" : "grayscale(80%)";
      }
    });

    if (filteredJobList.length === 0) {
      cardsContainer.innerHTML = `<div class="jdp-empty-tips">${t('emptyList')}</div>`;
      // cardsContainer.innerHTML = `<div class="jdp-empty-tips">🚫 没有符合条件的岗位</div>`;
      counterEl.innerText = `0 / 0`;
      return;
    }

    cardsContainer.innerHTML = filteredJobList.map((job, idx) =>
      // if (job.rawNode && typeof job.rawNode.setAttribute === 'function') {
      //     job.rawNode.setAttribute('data-job-id', job.id);
      //   }
    
      `
      <div class="jdp-card" data-index="${idx}">
        <div>
          <div class="jdp-card-header">
            <div>
              <div class="jdp-card-title" title="${job.title}">${job.title}</div>
              <div class="jdp-card-salary">${job.rawSalary}</div>
            </div>
            
            <div class="jdp-btn-group">
              <!-- ⚡ 立即沟通/投递按钮 -->
              <!-- 初始 HTML 渲染时：不要写 0分，写评估状态 -->
              <div class="jdp-card-match loading-state" data-job-id="${job.id}" title="${t('matchResumeing')}">
                <span class="score-text pulse-animation" id="score-num-${idx}"> ${t('evaluating')}</span>
              </div>
              
              <button class="jdp-action-btn" data-act-idx="${idx}"> ${t('actionApply')}</button>
              <button class="jdp-open-link-btn" data-link-idx="${idx}">${t('actionOpenLink')} ↗</button>
              <button type="button" class="jdp-refresh-btn" title="${t('refreshTitle')}">🔄</button>
            </div>
          </div>

          <div class="jdp-card-body">
            <div class="jdp-section">
            <div class="jdp-section-label">${t('sectionResp')}</div>
              <div class="jdp-section-content jdp-resp-box">${job.respText}</div>
            </div>
            
            <div class="jdp-section req">
              <div class="jdp-section-label">${t('sectionReq')}</div>
              <div class="jdp-section-content jdp-req-box">${job.reqText}</div>
            </div>
          </div>
        </div>

        <div class="jdp-card-footer">
          <span>${t('showlabel')}</span>
        </div>
      </div>
    `
     ).join('');
     triggerScoreForActiveCards(0);
    bindCardEvents();
    updateCardPositions();
  }

  const onDetailArrived = (e) => {
    const { matchKey, responsibilities, requirements } = e.detail;

    // 用标题匹配，不用 j.id——j.id 是 posHash（url+title算出来的哈希），
    // matchKey 现在是 injected.js 那边标准化过的标题字符串，两边用
    // 同一个 normalizeTitleForMatch 处理才对得上。这里不受 _detailLoaded
    // 限制，就算这张卡片之前已经被标记"处理过"（比如网络数据还没到时
    // 就已经尝试过、退化到别的方式失败了），数据一到还是会被用上，
    // 不会因为"已经放弃过一次"就再也不更新。
    const targetJob = jobDataList.find(j => normalizeTitleForMatch(j.title) === matchKey);
    if (targetJob) {
      targetJob.respText = responsibilities;
      targetJob.reqText = requirements;
      targetJob._detailLoaded = true;

      // 执行渲染刷新
      renderCards();
    }
  };
  
  // 绑定广播监听（防止重复绑定，先移除再添加）
  window.removeEventListener('51job:detail_arrived', onDetailArrived);
  window.addEventListener('51job:detail_arrived', onDetailArrived);

  // 数据层（模块级 networkInterceptedDetails + onDetailReceived 回调）
  // 跟这里的 UI 层解耦：数据到达时不管 UI 存不存在、准备好没有，只管
  // 存进 Map；UI 这边只在自己"准备好了、有能力刷新"的这一刻，把
  // "该怎么响应新数据"的逻辑注册成回调交给数据层。数据层不需要知道
  // renderCards 长什么样，只需要在有新数据时喊一声。
  // onDetailReceived = (matchKey) => {
  //   // 简单起见收到任何一条就整体重绘一次——renderCards 内部本来就是
  //   // 遍历 filteredJobList 重新生成，不区分是不是这条 matchKey 对应的
  //   // 卡片，成本可以接受；如果以后觉得这样太频繁，可以在这里加一层
  //   // "只有 matchKey 对应的是当前 activeIndex 那张时才重绘"的判断。
  //   renderCards();
  // };

  // ---- 详情懒加载：只取用户实际在看的这一张，串行处理，不并发 ----
  //
  // 定义在这里（renderCardGalleryUI 内部），跟 renderCards 同一个闭包，
  // 是因为两者都需要调用 renderCards()——renderCards 是这个函数内部的
  // 局部函数，外面的模块级代码够不到它，这也是之前这段逻辑放在外面
  // 会报错/静默失效的原因。
  //
  // 之前 jobDataList.forEach 会在渲染完成的瞬间把所有卡片的详情请求同时
  // 发出去——对猎聘的 fetch 方式是并发请求量的问题，对 51job 的
  // "真实点击开新标签"方式来说，等于瞬间打开几十个标签页，体验差，
  // 行为模式本身也不像真实用户操作，风控层面反而更可疑。改成：只在
  // 某张卡片变成"当前"时才去取它的详情，同一时间最多一个请求在处理
  //（isFetchingDetail 这个标记做的事）。另外在触发点（updateCardPositions）
  // 那边加了 400ms 防抖，快速划过的卡片从一开始就不会真的发起请求，
  // 不只是靠串行"忙就跳过"来止损。
  let isFetchingDetail = false;
  let ensureActiveJobDetailDebounceTimer = null;

  async function ensureActiveJobDetail() {
    const job = filteredJobList[activeIndex];
    if (!job || job._detailLoaded || job._detailLoading) return;
    if (isFetchingDetail) return; // 已经有一个在跑，等它结束（跑完的那个会重新触发一次)

    job._detailLoading = true;
    isFetchingDetail = true;

    let result = null;
    try {
      result = isFiftyOneJob ? await fetchAndParseJdFor51Job(job) : await fetchAndParseJdByUrl(job.url);
    } finally {
      job._detailLoading = false;
      isFetchingDetail = false;
    }

    if (result && (result.responsibilities || result.requirements)) {
      job.respText = result.responsibilities;
      job.reqText = result.requirements;
      job._detailLoaded = true;
      renderCards();
    } else {
      job._detailLoaded = true; // 失败也标记为"处理过"，避免同一张卡反复重试刷屏；
                                 // 用户切回来这张卡片时如果想重试，走刷新按钮而不是自动重试
    }

    // 当前这张处理完了，如果这段时间用户已经切到了别的卡片、且那张还没
    // 加载过，接着处理那张——不是原地循环，是"一次只处理一个，处理完看
    // 一眼现在该处理谁"，串行链条，不会同时开多个。
    const stillNeedsWork = filteredJobList[activeIndex] && !filteredJobList[activeIndex]._detailLoaded
      && !filteredJobList[activeIndex]._detailLoading;
    if (stillNeedsWork) ensureActiveJobDetail();
  }


  // ⚡ 1. 建立前端内存缓存 Map (Key: jobId, Value: API返回的评分数据)
const scoreCache = new Map();

// ⚡ 2. 建立正在请求中的队列 (防止频繁切换重复发 API)
const pendingJobIds = new Set();

function triggerScoreForActiveCards(activeIndex) {
  const PRELOAD_COUNT = 2; // 当前卡片 + 顺延预加载 2 张

  for (let i = activeIndex; i <= activeIndex + PRELOAD_COUNT; i++) {
    // 越界拦截
    if (i >= filteredJobList.length) break;
    
    const job = filteredJobList[i];
    if (!job) continue;

    const jobId = job.id;

    // ⚡ 3. 稳健定位 DOM 节点（优先使用 data-job-id 匹配）
    const cardNode = document.querySelector(`.jdp-card[data-job-id="${jobId}"]`)
                  || document.querySelector(`.jdp-card[data-index="${i}"]`);

    if (!cardNode) continue;
    const scoreContainer = cardNode.querySelector('.jdp-card-match');
    // =========================================================
    // ⚡【核心逻辑 A】：命中缓存 ➔ 0ms 瞬间渲染，不发网络请求
    // =========================================================
    if (scoreCache.has(jobId)) {
      console.log(`⚡ [命中前端缓存] jobId: ${jobId}, 正在秒刷 UI...`);
      const cachedData = scoreCache.get(jobId);
      
      renderRichScoreBadge(scoreContainer, cachedData);
      // renderScoreToCard(cardNode, cachedData);
      continue; // 命中缓存后，跳过后续网络请求
    }

    // =========================================================
    // ⚡【核心逻辑 B】：未命中缓存 ➔ 检查是否在请求中，没有则发请求
    // =========================================================
    if (!pendingJobIds.has(jobId)) {
      pendingJobIds.add(jobId); // 标记为正在请求
      console.log(`📡 [发起 API 请求] 预加载索引 ${i}, jobId: ${jobId}`);
      fetchAndRenderQuickScore(cardNode, jobId);
    }
  }
}


/**
 * 智能定位并插入 UI 挂件到筛选栏下方
 * @param {HTMLElement} wrapperNode - 你的插件 UI 容器
 * @param {HTMLElement} listContainer - 兜底用的卡片列表容器
 */
function injectWidgetBelowFilter(wrapperNode, listContainer) {
  // 覆盖主流招聘平台的筛选栏 Class 样式
  const FILTER_BAR_SELECTORS = [
    '.condition-filter-box',                   // BOSS直聘 筛选条件栏
    '.job-filter-box',                         // BOSS直聘 选项栏
    '.search-filter-wrapper',                  // 通用筛选栏
    '.jobs-search-box-container',              // LinkedIn 顶部搜索与筛选栏
    '.search-scaffold-layout__filter-options', // LinkedIn 分栏模式筛选栏
    '[class*="filter-box"]',                   // 包含 filter-box 的节点
    '[class*="filter-container"]',
    '[componentkey="JobsSearchFilters"]',
    '[id="JobsSearchFilters"]',
  ];

  // 1. 尝试寻找筛选栏节点
  for (const selector of FILTER_BAR_SELECTORS) {
    const filterEl = document.querySelector(selector);
    // 确保筛选栏可见且有高度
    if (filterEl && filterEl.offsetHeight > 0) {
      // afterend 表示插入到该元素紧随其后的同级位置（即筛选栏正下方）
      filterEl.insertAdjacentElement('afterend', wrapperNode);
      console.log(`✅ [UI Inject] 成功挂载至筛选栏下方: ${selector}`);
      return;
    }
  }

  // 2. 兜底方案：如果找不到筛选栏，插入到列表容器的上方
  if (listContainer && listContainer.parentNode) {
    listContainer.parentNode.insertBefore(wrapperNode, listContainer);
    console.log('⚠️ [UI Inject] 未匹配到筛选栏，兜底插入至列表容器顶部');
  }
}
// -------------------------------------------------------------
// ⚡ 辅助函数 1：统一UI渲染逻辑（缓存和网络返回通用）
// -------------------------------------------------------------
function renderScoreToCard(cardNode, resData) {
  const score = resData.quick_score ?? resData.data?.quick_score ?? resData.score;
  if (score === undefined || score === null) return;

  const scoreTextEl = cardNode.querySelector('.score-text') 
                   || cardNode.querySelector('.jdp-card-match');

  if (scoreTextEl) {
    scoreTextEl.innerText = score;
    // 去除加载动画，展示正式分数
    scoreTextEl.classList.remove('pulse-animation', 'status-evaluating', 'loading-state');
  }
}

// -------------------------------------------------------------
// ⚡ 辅助函数 2：异步请求 API 并存入前端缓存
// -------------------------------------------------------------
async function fetchAndRenderQuickScore(cardNode, jobId) {
      const userId = await getUserInfo("user_info");
    const jobTitle = cardNode.getAttribute("data-job-title") || "";
    const cleanedJd = cardNode.querySelector(".job-detail-text")?.innerText || jobTitle;
  try {
    // ⚡ 发后端用内容哈希，不用调用方传进来的 jobId（那是URL哈希）——
    // scoreCache 本地缓存继续用 jobId 做key（本地用途不用管跨用户稳定性）。
    const backendJobId = computeContentJobId(jobTitle, cleanedJd);
    const response = await fetch(`${API_BASE_URL}/api/match/quick-score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: backendJobId, user_id: userId, job_title: jobTitle, cleaned_jd: cleanedJd })
    });

    const resData = await response.json();

    // ⚡【存入缓存】：将接口返回的数据放入 scoreCache
    scoreCache.set(jobId, resData);

    // 重新获取最新 DOM 节点（防止切卡片过程中 DOM 被重新重绘失联）
    const activeCardNode = document.querySelector(`.jdp-card[data-job-id="${jobId}"]`) || cardNode;
    if (activeCardNode) {
      // renderScoreToCard(activeCardNode, resData);
      const scoreContainer = activeCardNode.querySelector('.jdp-card-match');
      renderRichScoreBadge(scoreContainer, resData);
    }

  } catch (error) {
    console.error(`❌ [请求失败] jobId: ${jobId}`, error);
  } finally {
    // 无论成功还是失败，从正在请求集合中移除
    pendingJobIds.delete(jobId);
  }
}
  // 在 updateCardPositions 或卡片切换时，只对当前卡片及后 2 张卡片按需触发请求
// function triggerScoreForActiveCards(activeIndex) {
//   const PRELOAD_COUNT = 2; // 只预加载后面 2 张
  
//   for (let i = activeIndex; i <= activeIndex + PRELOAD_COUNT; i++) {
//     if (i < filteredJobList.length) {
//       const job = filteredJobList[i];
//       const currentAllCardNodes = Array.from(document.querySelectorAll('.jdp-card'));
//       const cardNode = currentAllCardNodes[i];
//       let jobId = cardNode.dataset.jobId || cardNode.dataset.id||job.id;
//       if (cardNode) {
//         fetchedJobIds.add(jobId);
//         fetchAndRenderQuickScore(cardNode, jobId);
//       }
//     }
//   }
// }

  function updateCardPositions() {
    const cards = Array.from(cardsContainer.querySelectorAll('.jdp-card'));
    if (cards.length === 0) return;

    cards.forEach((card, idx) => {
      card.className = 'jdp-card';
      if (idx === activeIndex) {
        card.classList.add('active');
        setTimeout(() => {
          stageEl.style.height = `${Math.max(card.offsetHeight + 40, 520)}px`;
        }, 50);
        // triggerScoreForActiveCards(idx);
      } else if (idx === activeIndex - 1) {
        card.classList.add('prev');
      } else if (idx === activeIndex + 1) {
        card.classList.add('next');
      } else if (idx < activeIndex - 1) {
        card.classList.add('hidden-left');
      } else {
        card.classList.add('hidden-right');
      }
    });

    counterEl.innerText = `${activeIndex + 1} / ${filteredJobList.length}`;
    // 防抖：快速连续切换时，中途路过的卡片不立刻发起请求，等用户真正停
    // 下来一小段时间再发起——对 51job 尤其重要，它没数据时的兜底是真的
    // 开一个后台标签页，代价比 test1.js 的点击探测更高，快速划过时更不该
    // 白白发起。跟 test1.js 那边同一个思路：不是"发起了再撤销"，是"一开始
    // 就不发起"。
    if (ensureActiveJobDetailDebounceTimer) clearTimeout(ensureActiveJobDetailDebounceTimer);
    ensureActiveJobDetailDebounceTimer = setTimeout(() => {
      ensureActiveJobDetailDebounceTimer = null;
      ensureActiveJobDetail();
    }, 400);
  }

  function bindCardEvents() {
    const cards = Array.from(cardsContainer.querySelectorAll('.jdp-card'));
    cards.forEach((card, idx) => {
      // 1. 点击【⚡ 沟通/投递】按钮
      const actBtn = card.querySelector('.jdp-action-btn');
      actBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const job = filteredJobList[idx];
        const triggered = triggerNativeActionBtn(job.rawNode);
        // if (job.url) window.open(job.url, '_blank');
        if (!triggered) {
          // 如果节点内没找到触发按钮，直接打开详情页
          if (job.url) window.open(job.url, '_blank');
        }
      });

      // 2. 点击【详情 ↗】按钮
      const linkBtn = card.querySelector('.jdp-open-link-btn');
      linkBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const job = filteredJobList[idx];
        if (job.url) window.open(job.url, '_blank');
      });

      // 3. 点击卡片空白处
      card.addEventListener('click', (e) => {
        if (activeIndex !== idx) {
          e.preventDefault();
          e.stopPropagation();
          activeIndex = idx;
          updateCardPositions();
        } else {
          const job = filteredJobList[idx];
          // if (job.url) window.open(job.url, '_blank');
        }
      });

      //刷新详情——用 content3.js 自己真正的取数函数，不是 test1.js 那套
      // ensureRecordDetail/updateCardElementContent（content3.js 里根本
      // 没有这些东西，之前那段照抄过来一直是注释状态，点了没反应）。
      const refreshBtn = card.querySelector('.jdp-refresh-btn');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const job = filteredJobList[idx];
          if (!job) return;
          refreshBtn.classList.add('spinning');
          job._detailLoaded = false;
          job._detailLoading = false;
          job.respText = '⏳ 重新读取中...';
          job.reqText = '⏳ 重新读取中...';
          renderCards();
          try {
            const result = isFiftyOneJob
              ? await fetchAndParseJdFor51Job(job)
              : await fetchAndParseJdByUrl(job.url);
            if (result && (result.responsibilities || result.requirements)) {
              job.respText = result.responsibilities || '（未识别到职责内容）';
              job.reqText = result.requirements || '（未识别到要求内容）';
            } else {
              job.respText = '⚠️ 读取失败，请重试';
              job.reqText = '⚠️ 读取失败，请重试';
            }
            job._detailLoaded = true;
          } finally {
            // renderCards() 会整体重绘卡片列表，重绘出来的新按钮节点默认
            // 不带 spinning，这里不用手动 remove；但 renderCards() 之前
            // 已经把内容换成"重新读取中"触发过一次重绘了，这次重绘会用
            // 新按钮节点覆盖掉旧的（带spinning的）节点，不会一直转。
            renderCards();
          }
        });
      }
    });

  
  }

  let filterTimer = null;
  const triggerFilterUpdate = () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => {
      const excludeVal = document.getElementById('jdp-filter-exclude').value;
      const includeVal = document.getElementById('jdp-filter-include').value;
      const checkedTypes = Array.from(document.querySelectorAll('.jdp-filter-type:checked')).map(el => el.value);

      saveFilterConfig({
        excludeKeywords: excludeVal,
        includeKeywords: includeVal,
        companyTypes: checkedTypes
      });

      activeIndex = 0;
      renderCards();
    }, 200);
  };

  document.getElementById('jdp-filter-exclude').oninput = triggerFilterUpdate;
  document.getElementById('jdp-filter-include').oninput = triggerFilterUpdate;
  document.querySelectorAll('.jdp-filter-type').forEach(cb => cb.onchange = triggerFilterUpdate);

  document.getElementById('jdp-group-prev').onclick = () => findAndClickPaginationBtn('prev');
  document.getElementById('jdp-group-next').onclick = () => findAndClickPaginationBtn('next');

  // stageEl.addEventListener('wheel', (e) => {
  //   e.preventDefault();
  //   if (isScrolling || filteredJobList.length === 0) return;

  //   if (e.deltaY > 0 || e.deltaX > 0) {
  //     if (activeIndex < filteredJobList.length - 1) { activeIndex++; updateCardPositions(); }
  //   } else if (e.deltaY < 0 || e.deltaX < 0) {
  //     if (activeIndex > 0) { activeIndex--; updateCardPositions(); }
  //   }
  //   triggerScoreForActiveCards(activeIndex);
  //   isScrolling = true;
  //   setTimeout(() => { isScrolling = false; }, 150);
  // }, { passive: false });

  document.getElementById('jdp-btn-left').onclick = (e) => {
    e.stopPropagation();
    if (activeIndex > 0) { activeIndex--; 
      triggerScoreForActiveCards(activeIndex);
      updateCardPositions(); }
  };

  document.getElementById('jdp-btn-right').onclick = (e) => {
    e.stopPropagation();
    if (activeIndex < filteredJobList.length - 1) { activeIndex++; 
      triggerScoreForActiveCards(activeIndex);
      updateCardPositions(); }
  };

  renderCards();
  ensureActiveJobDetail(); // 首次渲染后，只取第一张（当前活跃）卡片的详情
}

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

// ---- 51job：网络拦截优先（列表接口自带jobDescribe），开标签页只作兜底 ----
//
// injected.js 拦截 we.51job.com/api/job/search-pc 的响应后，会把每条
// 职位的描述通过 window.postMessage({type:'JOB_HOOK_DETAIL', matchKey, ...})
// 发过来——列表加载的这一次网络请求本来就会发生，不需要额外点击/开
// 标签页。这里存起来，取详情时先查这张表，查到就直接用，查不到
//（比如这条数据凑巧没在这次响应里、或者字段路径跟实测的不一样）
// 才退化到 fetchAndParseJdViaRealClick 那条开标签页的兜底路径。
//
// 数据层和 UI 层解耦：这里（模块级）只管"消息一到就存进 Map，然后喊
// 一声"，不管 UI 存不存在、准备好没有——injected.js 拦截到数据是随时
// 可能发生的事，不受 renderCardGalleryUI() 什么时候跑完控制，数据层
// 必须在文件加载的这一刻就开始监听，不能等 UI 准备好才注册，不然 UI
// 搭建完成之前到达的数据会直接丢失，永远补不回来。
//
// onDetailReceived 是 UI 层留给数据层的"回调钩子"：UI 没准备好之前
// 它是 null，数据层发现是 null 就只存数据、不做别的，数据不会丢
// （下次 ensureActiveJobDetail 查表时依然查得到）；等 UI 层
//（renderCardGalleryUI 内部）准备好了，会把自己的刷新逻辑塞进这个
// 变量，之后数据层每次收到新数据都会调用它。数据层完全不需要知道
// renderCards 长什么样、UI 内部怎么组织，只通过这一个回调交互。
const networkInterceptedDetails = new Map(); // matchKey -> {responsibilities, requirements}

if (isFiftyOneJob && typeof window !== 'undefined') {
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || typeof msg !== 'object' || msg.type !== 'JOB_HOOK_DETAIL' ) return;
    if (msg.type === 'JOB_HOOK_DETAIL') {
    console.log(`[Content.js] 收到【${msg.site}】职位详情数据:`, msg.data);
     const detail = msg.data;
        if (!detail || !detail.matchKey) return;
        const key = String(detail.matchKey);
        networkInterceptedDetails.set(key, {
          responsibilities: detail.responsibilities || '',
          requirements: detail.requirements || '',
        });
        window.dispatchEvent(new CustomEvent('51job:detail_arrived', {
          detail: { matchKey: key, ...detail }
        }));
    
    // if (msg.site === 'liepin') {
    //   handleLiepinDetailData(msg.data);
    // } else if(msg.site="51job"){
       
          
    // }
  }

  // 2. 监听职位列表拦截数据 (JOB_HOOK_LIST)
  if (msg.type === 'JOB_HOOK_LIST') {
    console.log(`[Content.js] 收到【${site}】职位列表数据:`, msg.data);
    
    if (msg.site === 'liepin') {
      handleLiepinListData(msg.data);
    }
  }
});
   
}

function handleLiepinDetailData(detail) {
  const { matchKey, title, responsibilities, requirements } = detail;

  // 示例：将解析得到的数据渲染到对应的 DOM 卡片上
  const cardElement = document.querySelector(`[data-job-id="${matchKey}"], [data-card-id="${matchKey}"]`);
  if (cardElement) {
    cardElement.setAttribute('data-parsed', 'true');
    // 可在此处填充 UI UI 提示框、弹窗或发送到 Background Script
  }

  // 例如通过 chrome.runtime.sendMessage 发送到 extension background
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({
      action: 'SAVE_LIEPIN_JOB',
      payload: detail
    });
  }
}

/**
 * 处理猎聘列表数据示例
 */
function handleLiepinListData(list) {
  list.forEach((item) => {
    // item 包含 jobId, jobName, salaryDesc, brandName, cityName 等简要信息
    console.log('猎聘列表条目:', item.jobId, item.jobName);
  });
}

// 匹配键换成标题，不用数字ID——job.id 是 posHash（url+title 算出来的
// 哈希，跟 51job 接口自己的职位ID是两回事，不能拿来对）；卡片DOM上
// 挂的 <a> 是公司URL、不是职位详情URL，也没法从URL反推ID。标题两边
// 都确定拿得到（这边是 job.title，injected.js 那边是接口返回的
// jobName），不需要猜51job接口内部用哪个字段名做ID。
// normalizeTitleForMatch 要跟 injected.js 里那份保持完全一致的逻辑，
// 两边算出来的字符串对不上就永远匹配不到。
function normalizeTitleForMatch(title) {
  return String(title || '').trim().replace(/\s+/g, ' ');
}

function getFiftyOneJobId(job) {
  return normalizeTitleForMatch(job.title);
}

async function fetchAndParseJdFor51Job(job) {
  const jobId = getFiftyOneJobId(job);
  if (jobId && networkInterceptedDetails.has(jobId)) {
    return { ...networkInterceptedDetails.get(jobId), source: 'Network Intercept (list API)' };
  }
  // 拦截没拿到，退化到开标签页兜底
  return fetchAndParseJdViaRealClick(job.rawNode);
}



function extractJobIdFromNode(url) {
  // 1. 从常见的自定义属性中获取
  // if (node.dataset.jobid) return node.dataset.jobid;
  // if (node.getAttribute('jobid')) return node.getAttribute('jobid');

  // 2. 从节点的 outerHTML 中利用正则匹配 8-10 位纯数字 ID
  // const nodeHtml = node.outerHTML;
  
  // 匹配 /all/173393348.html 或 jobId=173393348 或 jobId":173393348
  // 大小写不敏感——HTML 属性习惯全小写（data-jobid），不一定跟 JS 里
  // 常见的驼峰写法 jobId 一致，两种都要认。
  const match = url.match(/\/(\d{7,10})\.html/) || 
                url.match(/jobId["=:]+(\d{7,10})/i);

  if (match && match[1]) {
    return match[1];
  }

  return null;
}

// 1. 直接请求 51job 的内部岗位详情 API
// 静默提取岗位详情（零弹窗、零新 Tab、过风控验签）


// 2. 全局拦截用户对岗位卡片的点击事件
document.addEventListener('click', async (e) => {
  // 查找是否点击了岗位链接
  const targetLink = e.target.closest('a[href*="jobDetail"]');
  if (!targetLink) return;

  // 关键：阻止浏览器打开 _blank 新标签页
  e.preventDefault();
  e.stopPropagation();

  // 从 a 标签链接中解析 jobId
  const url = new URL(targetLink.href);
  const jobId = url.searchParams.get('jobId');

  if (!jobId) {
    console.error('无法解析 jobId');
    return;
  }

  console.log(`正在静默拦截请求，Job ID: ${jobId}...`);

  // 发起 API 请求
  const jobData = await getJobDetailViaApi(jobId);
  
  if (jobData) {
    console.log('✅ 静默抓取 JSON 成功：', {
      jobName: jobData.jobName,
      salary: jobData.provideSalaryString,
      jobDescribe: jobData.jobDescribe, // 岗位职责详情文本
      companyName: jobData.fullCompanyName
    });
  }
}, true); // 使用事件捕获阶段（true），确保优先拦截




/**
 * 布局类型常量
 */
const LAYOUT_TYPE = {
  DUAL_PANE: 'DUAL_PANE',   // 左右栏模式 (左列表 + 右详情)
  SINGLE_LIST: 'SINGLE_LIST' // 单栏列表模式 (只有卡片列表，需直接解析或跳转)
};

/**
 * 自动识别当前页面是【左右双栏】还是【单栏列表】
 */
function detectLayoutType() {
  // 1. 快速匹配：常见主流平台的右侧详情栏特征 Selector
  const KNOWN_DETAIL_PANEL_SELECTORS = [
    '#job-details',                            // LinkedIn 右侧详情容器
    '.jobs-search__job-details',               // LinkedIn 列表侧栏
    '.job-detail-box',                         // BOSS直聘 弹窗/侧边栏
    '.job-detail-container',                   // Indeed / Glassdoor 侧栏
    '.job-detail-guide',                       // 猎聘侧栏
    '[class*="job-detail"]',                   // 通用特征词
    '[class*="detail-container"]'
  ];

  for (const selector of KNOWN_DETAIL_PANEL_SELECTORS) {
    const el = document.querySelector(selector);
    // 判断节点存在且处于显示状态
    if (el && el.offsetWidth > 250 && el.offsetHeight > 200) {
      const style = window.getComputedStyle(el);
      if (style.display !== 'none' && style.visibility !== 'hidden') {
        console.log(`[LayoutDetector] 命中已知特征词选择器: ${selector}`);
        return LAYOUT_TYPE.DUAL_PANE;
      }
    }
  }

  // 2. 几何算法回退：无视平台的通用右侧栏检测
  // 查找位于屏幕右侧半区 (left > 35% 屏幕宽) 且宽度占比显著的可见块
  const viewportWidth = window.innerWidth;
  const candidatePanes = Array.from(document.querySelectorAll('div, section, main, aside'))
    .filter(el => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      
      const isVisible = rect.width > 300 && rect.height > 300 && style.display !== 'none' && style.visibility !== 'hidden';
      const isRightHalf = rect.left > viewportWidth * 0.35; // 位于屏幕中右侧
      const isNotFullWidth = rect.width < viewportWidth * 0.85; // 不是全屏遮罩

      return isVisible && isRightHalf && isNotFullWidth;
    });

  if (candidatePanes.length > 0) {
    console.log('[LayoutDetector] 几何检测确定为左右双栏布局', candidatePanes[0]);
    return LAYOUT_TYPE.DUAL_PANE;
  }

  console.log('[LayoutDetector] 未检测到右侧详情栏，判定为单栏列表模式');
  return LAYOUT_TYPE.SINGLE_LIST;
}

function init() {
  //  GLOBAL_USER_INFO=await getUserInfo("user_info");
  
  renderCardGalleryUI();
  

  let timer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => { renderCardGalleryUI(); 
      // observeAllCards();
    }, 300);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'complete') init();
else window.addEventListener('load', init);

}