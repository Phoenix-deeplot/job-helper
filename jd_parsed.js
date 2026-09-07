// jd_parsed.js —— jd_parsed.py 的 JS 移植版
// ---------------------------------------------------------------------------
// 纯规则解析，不含任何模型调用，逻辑上和 jd_parsed.py 里 `import re` 往下
// 的活跃代码一一对应（Python 文件前面一大段是注释掉的旧参考实现，没有转）。
//
// 用法（假设跟你们现有的 _JD_parser 全局命名空间集成）：
//   window._JD_parser = window._JD_parser || {};
//   Object.assign(window._JD_parser, JdParsed);
//   const result = window._JD_parser.parseJd(rawText);
//
// 同时支持 Node require()（写测试用），文件底部有 module.exports。
// ---------------------------------------------------------------------------

(function (root) {
  'use strict';

  function round3(x) {
    return Math.round(x * 1000) / 1000;
  }

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ==========================================================
  // Vocab（跟 Python 版 SECTION_VOCAB 逐条对应）
  // ==========================================================

  const SECTION_VOCAB = [
    {
      type: 'responsibilities',
      tiers: [
        { weight: 0.85, phrases: [
          "岗位职责", '工作职责', '职责描述', "主要职责", '核心职责', '工作内容',"职位介绍",
          '岗位描述', '职位描述', '职位职责', '工作内容及职责', '职责范围', '工作任务',"工作内容",
          'Responsibilities', 'Key Responsibilities', 'Primary Responsibilities',
          'Core Responsibilities', 'Main Responsibilities', 'Job Responsibilities',
          'Duties and Responsibilities', 'Essential Duties', 'Essential Functions',
          "What You'll Build",
        ] },
        { weight: 0.65, phrases: [
          "What you'll do", 'What you will do', "What You'll Be Doing",
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
          '任职要求', '任职资格', '岗位要求', '招聘条件', '职位要求', '能力要求',"工作要求",
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
        '福利待遇', '员工福利', '薪酬福利', '公司福利', '员工待遇', '薪资福利', '我们提供',
        'Benefits', 'Employee Benefits', 'Perks', 'What We Offer', 'Total Rewards',
        'What You Get', 'Perks and Benefits',
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
        '公司简介', '关于我们', '企业文化', '工作地点', '投递方式',"其他信息","温馨提示","猜你喜欢",
        'About Us', 'About the Company', 'Who We Are',
        'Our Story', 'Our Mission', 'Why Join Us',
        'Equal Opportunity', 'EEO', 'EEO Statement', 'Equal Employment Opportunity',
        'How to Apply', 'Application Process', 'Next Steps',
        'Working Conditions', 'Work Environment', 'Physical Requirements',
        'Disclaimer', 'Legal',
        'What This Is Not',
      ] }],
    },
  ];

 const STOP_SECTIONS = new Set([
    '福利待遇','薪资福利','公司简介','关于我们','企业文化','工作地点','投递方式','我们提供',"其他信息",
    'Benefits','What We Offer','Perks','Perks and Benefits','Compensation','Salary','Pay Range',
    'Working Conditions','Work Environment','Physical Requirements',
    'EEO Statement','Equal Opportunity','Equal Employment Opportunity','EEO',
    'About Us','About the Company','Our Story','Our Mission','Why Join Us','Who We Are',
    'How to Apply','Application Process','Next Steps','Disclaimer','Legal',"What We Offer"
  ])

  // ==========================================================
  // Normalize
  // ==========================================================

  function allHeadingPhrases() {
    const out = [];
    for (const cat of SECTION_VOCAB) {
      for (const tier of cat.tiers) out.push(...tier.phrases);
    }
    // 长的优先，避免 "Requirements" 抢先匹配掉 "Technical Requirements"
    return out.sort((a, b) => b.length - a.length);
  }

  // 只取高权重(≥0.8)的标题短语，供 normalizeText 里"标题和正文粘连时
  // 强制切行"那一步使用。弱权重短语（比如"负责"这种两个字的常见词）
  // 只该参与"这一行本身是不是标题"的判断（detectHeading 里已有覆盖率
  // 门槛保护），不该被用来在任意文本中强制插入换行——那样会把
  // "负责过千万级DAU项目优先"这种一整条内容硬拆成两截，拆出来的
  // "负责"独占一行后还会在 detectHeading 里被判成【精确命中】，
  // 精确命中不受覆盖率门槛约束，等于绕过了保护。
  function strongHeadingPhrases() {
    const out = [];
    for (const cat of SECTION_VOCAB) {
      for (const tier of cat.tiers) {
        if (tier.weight >= 0.8) out.push(...tier.phrases);
      }
    }
    return out.sort((a, b) => b.length - a.length);
  }

  // 常见的驼峰式专有名词/产品名——内部就是"小写接大写"，不能被下面那条
  // 通用兜底规则拆开。这是个可枚举、变化很慢的专有名词表，跟
  // SECTION_VOCAB 那种要覆盖无穷措辞的词表不是一回事，可以放心持续
  // 往这里加。
  const CAMELCASE_PROTECT_TERMS = [
    'ChatGPT', 'GPTBot', 'ClaudeBot', 'PerplexityBot', 'OpenAI', 'DeepMind',
    'JavaScript', 'TypeScript', 'WordPress', 'GraphQL', 'GitHub', 'GitLab',
    'DevOps', 'PostgreSQL', 'MySQL', 'PowerPoint', 'PayPal', 'WeChat', 'TikTok',
    'LinkedIn', 'YouTube', 'iPhone', 'iPad', 'iCloud', 'macOS', 'eBay',
    'Salesforce', 'HubSpot', 'Zendesk', 'FedEx', 'GoDaddy', 'SharePoint',
    'OneDrive', 'OneNote', 'LangChain', 'LangGraph', 'AutoGen', 'CrewAI',
    'LlamaIndex', 'TensorFlow', 'PyTorch', 'FastAPI', 'MongoDB', 'DynamoDB',
    'Kubernetes', 'Kubectl', 'GoLang', 'ObjectiveC', 'SwiftUI', 'ReactNative',
    'GraphRAG', 'OpenSearch', 'LangSmith', 'PubSub', 'BigQuery', 'RedShift',
  ];

  function protectCamelcaseTerms(text) {
    const placeholders = {};
    CAMELCASE_PROTECT_TERMS.forEach((w, i) => {
      if (text.includes(w)) {
        const key = `\u0000CC${i}\u0000`;
        text = text.split(w).join(key);
        placeholders[key] = w;
      }
    });
    return [text, placeholders];
  }

  function restoreCamelcaseTerms(text, placeholders) {
    for (const [key, w] of Object.entries(placeholders)) {
      text = text.split(key).join(w);
    }
    return text;
  }

  function normalizeText(raw) {
    raw = (raw || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    raw = raw.replace(/<\/?(div|p|li|h[1-6]|br|tr)[^>]*>/gi, '\n');
    raw = raw.replace(/<[^>]+>/g, ''); // 去掉残余标签
    raw = raw.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
    raw = raw.replace(/[•●▪◦]/g, '\n- ');
    raw = raw.replace(/(?<!\n)(\d+[.、)）]\s*)(?=\S)/g, '\n$1');

    // 行内标题切分：标题和正文粘一起时，把标题拆成独立行。
    // 只在"行首或句末标点之后"切，避免正文里顺带提到关键词的句子被误切。
    //
    // 下面两条规则风险不对称，用的短语范围也不一样：第一条要求短语后面
    // 紧跟冒号（"负责："这种确实像标签的写法），冒号本身就是够强的安全阀，
    // 全部权重的短语都能用；第二条只要求短语后面接一个字母/汉字，没有
    // 冒号这道过滤，对短小常见的弱权重短语来说太容易在正常句子中间触发，
    // 所以第二条只用强权重短语。
    for (const h of allHeadingPhrases()) {
      const esc = escapeRegex(h);
      raw = raw.replace(new RegExp(`(^|[\\n.!?。；;]\\s*)(${esc})\\s*[:：]`, 'gi'), '$1\n$2:\n');
    }
    for (const h of strongHeadingPhrases()) {
      const esc = escapeRegex(h);
      raw = raw.replace(new RegExp(`(?<!\\n)(${esc})(?=[A-Z\\u4e00-\\u9fa5])`, 'gi'), '\n$1\n');
    }

    // 句末粘连的条目
    raw = raw.replace(/([a-z0-9),\]])\.([A-Z])/g, '$1.\n$2');
    raw = raw.replace(/([。；])(?=[^\s\n])/g, '$1\n');

    // 通用兜底：小写字母紧接大写字母、中间没有任何空格/标点——这是英文
    // 原文本来的空格/换行被提取流程吃掉后留下的痕迹，不依赖任何具体
    // 词汇，比标题词表通用得多。代价是 LangChain/ChatGPT/WordPress 这类
    // 驼峰式产品名内部同样是"小写接大写"，拆了就是破坏——先保护起来
    // 再做这条替换，替换完再还原。
    let ccPlaceholders;
    [raw, ccPlaceholders] = protectCamelcaseTerms(raw);
    raw = raw.replace(/([a-z]{3,})(?=[A-Z])/g, '$1\n');
    raw = restoreCamelcaseTerms(raw, ccPlaceholders);

    raw = raw.replace(/[ \t]+/g, ' ');
    raw = raw.replace(/\n{3,}/g, '\n\n');
    return raw.trim();
  }

  // ==========================================================
  // Heading detection
  // ==========================================================

  function matchSectionPhrase(text) {
    const low = text.toLowerCase().trim().replace(/[:：]+$/, '').trim();
    let best = { type: 'unknown', score: 0.0, phrase: '', exact: false };
    for (const cat of SECTION_VOCAB) {
      for (const tier of cat.tiers) {
        for (const p of tier.phrases) {
          const pl = p.toLowerCase();
          const exact = low === pl;
          const hit = exact || low.includes(pl);
          if (!hit) continue;
          const score = tier.weight + (exact ? 0.10 : 0.0);
          if (score > best.score || (score === best.score && pl.length > best.phrase.length)) {
            best = { type: cat.type, score, phrase: pl, exact };
          }
        }
      }
    }
    return best;
  }

  /** 返回 {type, confidence}；不是标题则 type=null。 */
  function detectHeading(line) {
    const t = (line || '').trim();
    if (!t) return { type: null, confidence: 0.0 };

    const bare = t.replace(/[:：]+$/, '').trim();
    const isCjk = /[\u4e00-\u9fa5]/.test(bare);
    const maxLen = isCjk ? 24 : 60;

    const m = matchSectionPhrase(bare);

    // 词表精确命中且行够短 → 确定是标题
    if (m.exact && bare.length <= maxLen) {
      return { type: m.type, confidence: Math.min(1.0, m.score) };
    }

    // 包含命中：除了"够短、像标题结尾"，还要求匹配到的短语占了这一行
    // 足够高的比例（覆盖率）——区分"这行本身就是个标题"和"正文里顺带
    // 出现了这个词"，跟词表权重高低无关。没有这道门槛，任何短小常见
    // 的弱词（比如"负责"）只要出现在够短、不以句号结尾的正文里，
    // 就会把整行吞成标题，导致这条内容从结果里彻底消失。
    if (m.score > 0 && bare.length <= maxLen) {
      const coverage = m.phrase.length / Math.max(1, bare.length);
      const looksHeading = /[:：]$/.test(t) || !/[.。!?！？]$/.test(t);
      if (looksHeading && coverage >= 0.6) return { type: m.type, confidence: m.score };
    }

    return { type: null, confidence: 0.0 };
  }

  // ==========================================================
  // Recover Blocks
  // ==========================================================

  /**
   * 判断 curLine 是不是 prevLine 软换行的续行，而不是独立的新条目。
   * 只有上一行【不像完整陈述的结尾】且这一行【看起来像句子中间】时才判定为
   * 续行；否则各自成块，宁可多切、不可错并。
   */
  function isWrapContinuation(prevLine, curLine) {
    if (!prevLine) return false;
    if (/[.!?。！？:：;；]$/.test(prevLine)) return false;
    if (/^[a-z]/.test(curLine)) return true;
    if (/^(and|or|but|which|that|with|for|to|of)\b/i.test(curLine)) return true;
    return false;
  }

  // "X including:" 后面跟一串短语、每个短语单独一行、不带 bullet——这是
  // "一句话的子项列表被换行拆开"，不是"每行一条独立要求"。
  const COLON_LIST_ITEM_MAX_LEN = 40;

  function looksLikeColonListItem(t) {
    if (t.length > COLON_LIST_ITEM_MAX_LEN) return false;
    if (/[.!?。！？:：]$/.test(t)) return false;
    return true;
  }

  function looksLikeBulletLine(s) {
    return /^[-*]\s+/.test(s) || /^\d+[.、)）]\s*\S/.test(s);
  }

  function nextNonblankLine(lines, startIdx) {
    for (let j = startIdx + 1; j < lines.length; j++) {
      const s = lines[j].trim();
      if (s) return s;
    }
    return null;
  }

  /**
   * 冒号后面跟的这批行，更像"短语枚举"（沿用 colonIntro 合并逻辑）还是
   * "没有 bullet 符号、但每行本身就是一条完整的职责/要求陈述"（应该当成
   * 结构性标题的开始，具体类型交给内容投票去推断）？
   *
   * 判据优先级：
   *   1. 带 bullet 符号 → 明确是独立内容。
   *   2. 收集到的行只要有任何一条长到/带标点到不可能是个"短语"——直接
   *      判定为独立标题，不用再看内容有没有规则信号（"你会同时负责搭建:"
   *      后面跟一整句 55 字的技术栈描述这种）。
   *   3. 都像短语、但其中有条目能被规则独立识别出类型 → 独立陈述。
   *   4. 都像短语、规则也挑不出类型、且数量很少（≤1条）时，才退回去看
   *      冒号句自己的措辞兜底——条目数量偏多时不做这个兜底，因为真正的
   *      短语枚举的引导句本身经常也会命中规则（比如含 "Strong
   *      understanding of"），不代表后面那批短语该被拆开。
   */
  function classifyColonFollowup(lines, startIdx, colonLineText = '') {
    const items = [];
    let j = startIdx + 1;
    while (j < lines.length) {
      const s = lines[j].trim();
      if (!s) break;
      if (looksLikeBulletLine(s)) return 'content';
      const { type: htype } = detectHeading(s);
      if (htype || /[:：]$/.test(s)) break;
      items.push(s);
      j += 1;
      if (items.length >= 6) break;
    }

    if (!items.length) {
      if (colonLineText && classifyRule(colonLineText.replace(/[:：]+$/, '')).label !== 'unknown') {
        return 'content';
      }
      return 'unclear';
    }

    const looksLikePhrases = items.every((it) => looksLikeColonListItem(it));
    if (!looksLikePhrases) return 'content';

    const contentVotes = items.filter((it) => classifyRule(it).label !== 'unknown').length;
    if (contentVotes > 0) return 'content';

    if (items.length <= 1 && colonLineText
        && classifyRule(colonLineText.replace(/[:：]+$/, '')).label !== 'unknown') {
      return 'content';
    }

    return 'phrase_list';
  }

  /**
   * 把标题以外的每一行都当独立条目切成自己的 block，只有确认是软换行续行、
   * 或"冒号引导的短语子列表"时才合并。另外识别"结构性标题"：词表里没有
   * 的措辞，但后面紧跟着看起来像独立陈述的内容——具体属于哪一类交给
   * inferUnknownHeadingTypes 用内容投票判断。
   */
  function recoverBlocks(text) {
    const lines = text.split('\n');
    const blocks = [];
    let bid = 1;
    let buffer = [];
    let colonIntro = null;
    let colonItems = [];

    function flushParagraph() {
      if (buffer.length) {
        const txt = buffer.join(' ').trim();
        if (txt) {
          blocks.push({ id: bid++, text: txt, type: 'paragraph', confidence: 0.8, section: 'unknown' });
        }
        buffer = [];
      }
    }

    function flushColonList() {
      if (colonIntro === null) return;
      let txt;
      if (colonItems.length) {
        const sep = /[\u4e00-\u9fa5]/.test(colonIntro) ? '、' : ', ';
        txt = colonIntro.replace(/[:：]+$/, '').trim() + ': ' + colonItems.join(sep);
      } else {
        txt = colonIntro;
      }
      blocks.push({ id: bid++, text: txt, type: 'paragraph', confidence: 0.85, section: 'unknown' });
      colonIntro = null;
      colonItems = [];
    }

    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!t) {
        flushParagraph();
        flushColonList();
        continue;
      }

      // Markdown 风格的 "#+ " 标题标记（比如 domToStructuredText 转换
      // <h1>~<h6>/独立加粗块时会加的 "## " 前缀）——是页面作者真实标记过
      // 的标题标签转换来的，比冒号结尾这种间接猜测可靠得多，直接当结构性
      // 标题处理，不需要再满足覆盖率门槛或者"后面跟着独立陈述"这些间接
      // 判据。先去掉标记看词表能不能直接命中，命不中就走跟冒号标题相同的
      // "结构确认、类型交给 inferUnknownHeadingTypes 去推断"路径。
      const mdHeadingMatch = t.match(/^#{1,6}\s+(\S.*)$/);
      if (mdHeadingMatch) {
        const bareMd = mdHeadingMatch[1].trim();
        flushParagraph();
        flushColonList();
        const { type: vocabType, confidence: vocabConf } = detectHeading(bareMd);
        if (vocabType) {
          blocks.push({ id: bid++, text: bareMd, type: 'heading', confidence: vocabConf, section: vocabType });
        } else {
          blocks.push({ id: bid++, text: bareMd, type: 'heading', confidence: 0.55, section: 'unknown' });
        }
        continue;
      }

      // 带 bullet/编号符号的行不可能是标题——这是比关键词匹配更可靠的
      // 结构信号，成本几乎为零，排在关键词匹配之前，直接短路掉一整类
      // 误判（不用等 detectHeading 内部的覆盖率门槛去补救）。
      if (looksLikeBulletLine(t)) {
        flushParagraph();
        flushColonList();
        const clean = t.replace(/^[-*]\s+/, '').replace(/^\d+[.、)）]\s*/, '');
        blocks.push({ id: bid++, text: clean, type: 'bullet', confidence: 0.95, section: 'unknown' });
        continue;
      }

      const { type: htype, confidence: conf } = detectHeading(t);
      if (htype) {
        flushParagraph();
        flushColonList();
        blocks.push({ id: bid++, text: t, type: 'heading', confidence: conf, section: htype });
        continue;
      }

      if (colonIntro !== null) {
        if (looksLikeColonListItem(t)) {
          colonItems.push(t);
          continue;
        }
        flushColonList();
        // 不是列表子项，落到下面的正常逻辑继续处理这一行
      }

      if (/[:：]$/.test(t)) {
        const bareH = t.replace(/[:：]+$/, '').trim();
        const isCjkH = /[\u4e00-\u9fa5]/.test(bareH);
        const shortEnough = bareH.length <= (isCjkH ? 24 : 60);

        if (shortEnough && classifyColonFollowup(lines, i, t) === 'content') {
          // 词表认不出这个标题措辞，但结构上（后面跟的是独立陈述、不是
          // 短语碎片）明显是个新小节的开始——先占住这个位置，具体属于
          // 哪一类交给 inferUnknownHeadingTypes 用内容投票推断；推断
          // 不出来时会被那一步自动降级回普通段落，不会比原来更差。
          flushParagraph();
          flushColonList();
          blocks.push({ id: bid++, text: t, type: 'heading', confidence: 0.5, section: 'unknown' });
          continue;
        }

        flushParagraph();
        colonIntro = t;
        colonItems = [];
        continue;
      }

      if (buffer.length && !isWrapContinuation(buffer[buffer.length - 1], t)) {
        flushParagraph();
      }
      buffer.push(t);
    }

    flushParagraph();
    flushColonList();
    return blocks;
  }

  // ==========================================================
  // 小节状态机：遇到标题就切换，一直持续到下一个标题为止（不衰减）
  // ==========================================================

  /**
   * 有些 JD 的小节标题写法完全不在词表里，但结构上仍然是"短行+冒号+
   * 后面跟着独立陈述"，recoverBlocks 已经把这种行识别成了一个 heading
   * block（section 先标 unknown）。
   *
   * 推断顺序（一层比一层弱）：
   *   1. 先看标题自己的措辞——本身就带着强信号的话，比往下看内容猜要
   *      直接、可靠得多。
   *   2. 标题自己没信号，看它后面紧跟的内容做投票。
   *   3. 都没信号——大概率是同一个大类下的子标题，沿用最近一次已经
   *      确定类型的小节，比降级成普通段落、继续挂着 intro 或者更早
   *      一个不相关小节要更合理。
   *   4. 前面往上翻都找不到任何确定过的小节，才真的降级回普通段落。
   */
  const MAX_VOTE_WINDOW = 5; // 内容投票只看标题后面紧跟的这么多条

  function inferUnknownHeadingTypes(blocks) {
    const n = blocks.length;
    let lastConfirmed = null;

    for (let idx = 0; idx < n; idx++) {
      const b = blocks[idx];
      if (b.type !== 'heading') continue;

      if (b.section !== 'unknown') {
        lastConfirmed = b.section;
        continue;
      }

      const ownLabel = classifyRule(b.text.replace(/[:：]+$/, '')).label;
      if (ownLabel !== 'unknown') {
        b.section = ownLabel;
        b.confidence = 0.6;
        lastConfirmed = ownLabel;
        continue;
      }

      // 只看紧跟标题后面的几条内容，不无限扫到下一个标题——小节很长时，
      // 隔了好几段的一条孤立误判命中也能单独决定整个标题的类型，
      // 而它跟标题的相关性本该随距离衰减。
      const votes = {};
      let j = idx + 1;
      let scanned = 0;
      while (j < n && blocks[j].type !== 'heading' && scanned < MAX_VOTE_WINDOW) {
        const lb = classifyRule(blocks[j].text).label;
        if (lb !== 'unknown') votes[lb] = (votes[lb] || 0) + 1;
        j += 1;
        scanned += 1;
      }

      const entries = Object.entries(votes);
      if (entries.length) {
        entries.sort((a, b2) => b2[1] - a[1]);
        b.section = entries[0][0];
        b.confidence = 0.5;
        lastConfirmed = entries[0][0];
      } else if (lastConfirmed) {
        b.section = lastConfirmed;
        b.confidence = 0.4;
      } else {
        b.type = 'paragraph';
      }
    }
  }

  function propagateSections(blocks) {
    let current = 'intro';
    for (const b of blocks) {
      if (b.type === 'heading') {
        current = b.section;
        continue;
      }
      b.section = current;
    }
  }

  // ==========================================================
  // Blocks -> Chunks
  // ==========================================================

  function blocksToChunks(blocks) {
    const chunks = [];
    let cid = 1;
    for (const b of blocks) {
      if (b.type === 'heading') continue; // 标题本身不进正文

      let texts = [b.text];
      // 段落一律按句末标点切句，避免一个 chunk 里混了职责和要求。
      if (b.type === 'paragraph') {
        const parts = b.text.split(/(?<=[.!?。！？])\s+/).map((s) => s.trim()).filter(Boolean);
        const filtered = parts.filter((p) => p.length >= 8);
        texts = filtered.length ? filtered : [b.text];

        // 标点切句完全没生效（只切出了1段）、而且这一段长到不像一句话——
        // 大概率是源文本没有换行也没有句末标点，多条内容粘在了一起。
        // 尝试用内容触发词的位置再切一次；找不到就保持原样。
        if (texts.length === 1 && isOverlongSingleStatement(texts[0])) {
          const retried = resplitByContentTriggers(texts[0]);
          if (retried.length > 1) texts = retried;
        }
      }

      for (const t of texts) {
        chunks.push({
          id: cid++, text: t, source_type: b.type, block_id: b.id,
          section_hint: b.section, rule_label: 'unknown', rule_conf: 0.0,
          label: 'unknown', confidence: 0.0, agreement: true, core: '',
        });
      }
    }
    return chunks;
  }

  // ==========================================================
  // 规则预分类（词面特征，与标题上下文互相独立）
  // ==========================================================

  const RESP_VERBS = new Set([
    'build', 'develop', 'design', 'own', 'monitor', 'create', 'manage', 'lead',
    'drive', 'implement', 'translate', 'turn', 'wire', 'run', 'collaborate',
    'partner', 'define', 'deliver', 'maintain', 'optimize', 'support', 'coordinate',
    '负责', '参与', '推动', '搭建', '设计', '维护', '优化', '主导', '协同',
  ]);

  // 这些词位置更灵活——不要求必须是句首第一个词，只要求出现在句子靠前的
  // 位置就行。中文里"和产品经理对齐需求"这类介词短语开头的句子，真正的
  // 动词在后面，严格要求句首是动词会漏掉这类结构。不放进 RESP_VERBS
  // 一起做句首严格匹配，是因为放宽位置要求后，混进"负责"这种极短词
  // 风险会变大（"负责任心强"这类复合词会被误伤），这里只收不容易在
  // 无关复合词/软技能描述里出现的词。
  const RESP_VERBS_LOOSE = new Set([
    '对齐', '拆解', '排查', '保障', '跟进', '撰写', '制定', '落地', '推进',
    '打磨', '迭代', '梳理', '对接', '支撑',
  ]);

  const REQ_PATTERNS = [
    /\b\d+\+?\s*years?\b/, /\bexperience\s+(?:with|in|building)\b/,
    /\bproficien\w*\b/, /\bfamiliar\w*\b/, /\bstrong\s+(?:understanding|knowledge|proficiency)\b/,
    /\bmust\b/, /\brequired\b/, /\bdegree\b/, /\bbachelor\b/, /\bmaster\b/,
    /\bneed(?:s|ed)?\s+to\s+have\b/, /\bshould\s+have\b/, /\bexpected\s+to\b/,
    /\d+\s*年(?:以上)?[^，,。！!？?；;]{0,8}?经验/, /本科|硕士|博士|大专/, /熟悉|精通|掌握/,
    /需要具备|须具备|应具备|要求具备/,
  ];

  const PREFERRED_PATTERNS = [
    /\bplus\b/, /\bpreferred\b/, /\bnice to have\b/, /\bbonus\b/,
    /\bstrong signal\b/, /\bideally\b/, /\ba plus\b/,
    /优先|加分/,
  ];

  // 专门给"正文里找条目边界"用的动词/模式子集——比 RESP_VERBS/REQ_PATTERNS
  // 更保守，只收平时几乎只会出现在小句开头的词。"设计""维护""优化"
  // （中文）、"experience in/with"（英文）这类太容易正常出现在句子内部
  // （"服务的设计与开发"、"years of experience in X"），拿来切分会把
  // 正常短语从中间切断，所以不放进来。
  const BOUNDARY_TRIGGER_VERBS = new Set(['负责', '参与', '主导', '推动']);

  const BOUNDARY_TRIGGER_PATTERNS = [
    /\b\d+\+?\s*years?\b/,
    /\bmust\b/, /\brequired\b/,
    /\bneed(?:s|ed)?\s+to\s+have\b/, /\bshould\s+have\b/, /\bexpected\s+to\b/,
    /\d+\s*年(?:以上)?[^，,。！!？?；;]{0,8}?经验/, /本科|硕士|博士|大专/, /熟悉|精通|掌握/,
    /需要具备|须具备|应具备|要求具备/,
    /优先|加分/,
  ];

  // 前缀窗口里额外检查这几个高价值动词——用负向前瞻排除"负责任"这种
  // 复合词误伤（"负责"作动词几乎总是直接接宾语，不会紧跟"任"字）。
  const RESP_PREFIX_PATTERNS = [
    /负责(?!任)/, /参与/, /主导/, /推动/,
  ];

  function classifyRule(text) {
    const t = text.toLowerCase();

    for (const p of PREFERRED_PATTERNS) if (p.test(t)) return { label: 'preferred', conf: 0.85 };

    // "never be required"/"not required" 这类否定语境不是任职要求信号——
    // 反诈骗声明("你永远不会被要求付费")、免责声明这类文本经常含
    // required/must，字面命中但语义相反。只在喂给 REQ_PATTERNS 之前
    // 把这类否定表达抹掉，不影响其他判断路径。
    const tForReq = t.replace(
      /\b(?:never|not|n't|no)\s+(?:be\s+)?(?:required|must|need(?:ed)?)\b/g, ' '
    );
    for (const p of REQ_PATTERNS) if (p.test(tForReq)) return { label: 'requirements', conf: 0.80 };

    // 动词开头 → 职责。中英文分开取首词。
    const m = t.match(/^\s*([a-z]+)/);
    if (m && RESP_VERBS.has(m[1])) return { label: 'responsibilities', conf: 0.85 };
    for (const v of RESP_VERBS) {
      if (/^[\u4e00-\u9fa5]/.test(v) && t.startsWith(v)) return { label: 'responsibilities', conf: 0.85 };
    }

    // 位置放宽到"前8个字内出现"，用信号更安全、置信度也相应更低的动词表。
    const prefix = text.slice(0, 8);
    for (const v of RESP_VERBS_LOOSE) {
      if (prefix.includes(v)) return { label: 'responsibilities', conf: 0.70 };
    }
    for (const pat of RESP_PREFIX_PATTERNS) {
      if (pat.test(prefix)) return { label: 'responsibilities', conf: 0.70 };
    }

    // "你会有很大空间去打造/创造…"这类中文JD里常见的铺垫句式，动词位置
    // 比一般情况更靠后——"打造""创造"本身是低误伤风险的词，单独给一个
    // 更宽的窗口。
    const widePrefix = text.slice(0, 20);
    for (const v of ['打造', '创造']) {
      if (widePrefix.includes(v)) return { label: 'responsibilities', conf: 0.65 };
    }

    return { label: 'unknown', conf: 0.30 };
  }

  // ------------------------------------------------------------
  // 无换行/无句末标点兜底：靠内容触发词的复现位置找回条目边界
  // ------------------------------------------------------------

  // 段落长到这个程度、又完全没有被句末标点切开，基本可以确定不是"一句
  // 很长的话"，而是多条内容粘在了一起。这道长度门槛只是"值不值得尝试"
  // 的粗筛，真正的安全网是 resplitByContentTriggers 本身——只有真的找到
  // 2 个以上触发词位置时才会真的切开，找不到就原样返回。
  const OVERLONG_CJK_THRESHOLD = 20;
  const OVERLONG_LATIN_THRESHOLD = 50;

  function isOverlongSingleStatement(text) {
    const isCjk = /[\u4e00-\u9fa5]/.test(text);
    return text.length > (isCjk ? OVERLONG_CJK_THRESHOLD : OVERLONG_LATIN_THRESHOLD);
  }

  function contentTriggerPositions(text) {
    const positions = new Set();
    const low = text.toLowerCase();

    for (const v of BOUNDARY_TRIGGER_VERBS) {
      let start = 0;
      while (true) {
        const idx = text.indexOf(v, start);
        if (idx === -1) break;
        if (idx > 0) positions.add(idx);
        start = idx + 1;
      }
    }

    for (const p of BOUNDARY_TRIGGER_PATTERNS) {
      const re = new RegExp(p.source, p.flags.includes('g') ? p.flags : p.flags + 'g');
      let m;
      while ((m = re.exec(low)) !== null) {
        if (m.index > 0) positions.add(m.index);
        if (m[0].length === 0) re.lastIndex += 1; // 防止零宽匹配死循环
      }
    }

    return [...positions].sort((a, b) => a - b);
  }

  /**
   * 完全没有换行、也没有句末标点可用时，靠内容触发词的复现位置切出
   * 多条陈述。触发词来自 classifyRule 已经在用的那几张表的保守子集，
   * 只在段落长到不像一句话、标点切句法完全没派上用场时才会被调用
   * （见 blocksToChunks 里的调用点）。局限很直接：如果某条陈述的开头
   * 恰好不在触发词表里，这里就找不到边界，两条会继续粘在一起——真正
   * 彻底不规范到连触发词都用不上的场景，需要交给 LLM 兜底判断。
   */
  function resplitByContentTriggers(text) {
    const positions = contentTriggerPositions(text);
    if (!positions.length) return [text];

    const filtered = [];
    let last = -999;
    for (const p of positions) {
      if (p - last >= 6) {
        filtered.push(p);
        last = p;
      }
    }
    if (!filtered.length) return [text];

    const parts = [];
    let prev = 0;
    for (const p of filtered) {
      const seg = text.slice(prev, p).trim();
      if (seg) parts.push(seg);
      prev = p;
    }
    const tail = text.slice(prev).trim();
    if (tail) parts.push(tail);

    return parts.length > 1 ? parts : [text];
  }

  // ==========================================================
  // 融合：标题上下文 + 规则
  // ==========================================================

  /**
   * 标题上下文是强先验（作者明确划分的），规则是词面证据。
   * 两者一致 → 高置信；不一致 → agreement=false，优先交给后端裁决。
   */
  function fuseLabels(chunks) {
    for (const c of chunks) {
      const { label: ruleLabel, conf: ruleConf } = classifyRule(c.text);
      c.rule_label = ruleLabel;
      c.rule_conf = ruleConf;
      const hint = c.section_hint;

      if (STOP_SECTIONS.has(hint)) {
        c.label = 'other'; c.confidence = 0.90; c.agreement = true;
        continue;
      }

      if (hint === 'responsibilities' || hint === 'requirements' || hint === 'preferred') {
        if (ruleLabel === hint) {
          c.label = hint; c.confidence = 0.95; c.agreement = true;
        } else if (ruleLabel === 'unknown') {
          // 规则没意见 → 信标题
          c.label = hint; c.confidence = 0.80; c.agreement = true;
        } else {
          // 冲突：标题说A、词面像B，最需要后端裁决，先用标题
          c.label = hint; c.confidence = 0.55; c.agreement = false;
        }
        continue;
      }

      // intro / unknown：只能靠规则
      if (ruleLabel !== 'unknown') {
        c.label = ruleLabel; c.confidence = ruleConf; c.agreement = true;
      } else {
        c.label = 'unknown'; c.confidence = 0.25; c.agreement = true;
      }
    }
  }

  // ==========================================================
  // Core：只做保真的格式清理，不做任何语义裁剪
  // ==========================================================

  function compressCore(text /* , label */) {
    return text.trim().replace(/[.。]+$/, '').trim();
  }

  // ==========================================================
  // Main
  // ==========================================================

  function parseJd(raw) {
    const normalized = normalizeText(raw);
    const blocks = recoverBlocks(normalized);
    inferUnknownHeadingTypes(blocks);
    propagateSections(blocks);
    const chunks = blocksToChunks(blocks);
    fuseLabels(chunks);

    for (const c of chunks) c.core = compressCore(c.text, c.label);

    const by = (lb) => chunks.filter((c) => c.label === lb && c.core).map((c) => c.core);

    const nUnknown = chunks.filter((c) => c.label === 'unknown').length;

    return {
      responsibilities: by('responsibilities'),
      requirements: by('requirements'),
      preferred: by('preferred'),
      other: by('other'),
      unknown: by('unknown'),
      chunks,
      blocks,
      normalized,
      stats: {
        n_chunks: chunks.length,
        n_unknown: nUnknown,
        n_disagree: chunks.filter((c) => !c.agreement).length,
        coverage: round3(1 - nUnknown / Math.max(1, chunks.length)),
        total_chunks: chunks.length,
        headers: blocks.filter((b) => b.type === 'heading').length,
      },
    };
  }

  const JdParsed = {
    normalizeText, detectHeading, matchSectionPhrase, recoverBlocks,
    propagateSections, blocksToChunks, classifyRule, fuseLabels,
    compressCore, parseJd, SECTION_VOCAB, STOP_SECTIONS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = JdParsed;
  } else {
    // 挂两个名字：window.JdParsed 是 test1.js 里实际在用的名字
    // （`window.JdParsed.parseJd(input)`，第4142行），window._JD_parser
    // 是按你们插件架构描述留的名字——两个都指向同一份对象，不管现有代码
    // 用哪个名字调用都能找到，不用去改 test1.js 里已经写好的调用点。
    root.JdParsed = Object.assign(root.JdParsed || {}, JdParsed);
    root._JD_parser = root.JdParsed;
  }
})(typeof window !== 'undefined' ? window : globalThis);