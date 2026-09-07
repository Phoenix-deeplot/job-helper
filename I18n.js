// // =========================================================
// // 中英文适配：探测主站语言 + 关键词字典 + 取值函数
// // 加在文件顶层，跟其他常量放一起，renderCardGalleryUI 之前。
// // =========================================================

// // 检测主站当前用的是中文还是英文——优先看主站自己在 <html lang="..">
// // 上声明的语言（大部分网站都会正确设置，比猜域名可靠），网站没声明
// // 时才退化到按域名兜底判断。
// function detectHostLanguage() {
//   const htmlLang = (document.documentElement.lang || '').toLowerCase();
//   if (htmlLang.startsWith('zh')) return 'zh';
//   if (htmlLang.startsWith('en')) return 'en';

//   const CN_HOST_KEYWORDS = ['zhipin.com', '51job.com', 'liepin.com', 'zhaopin.com', 'zhilian.com'];
//   const host = location.hostname;
//   if (CN_HOST_KEYWORDS.some((k) => host.includes(k))) return 'zh';

//   return 'en'; // linkedin/indeed/glassdoor 等海外站点，或者未识别的站点，默认英文
// }

// // 关键词字典——UI 上会用到的文案都放这里，不要在模板字符串里直接写死
// // 中文。要新增一条文案：两边语言都补一个同名 key，忘了补哪边，t() 会
// // 退化用中文兜底，不会渲染出 undefined。
// const I18N_STRINGS = {
//   zh: {
//     panelTitle: '🎴 岗位对比看板',
//     toggleFilter: '⚙️ 避坑与精细筛选',
//     groupPrev: '❮ 上一组',
//     groupNext: '下一组 ❯',
//     toggleFoldCollapse: '▲ 折叠看板',
//     toggleFoldExpand: '▼ 展开看板',
//     filterExcludeLabel: '🚫 避坑黑名单:',
//     filterExcludePlaceholder: '逗号分隔，如：外包, 驻场, 996, 单休',
//     filterIncludeLabel: '🎯 必含关键词:',
//     filterIncludePlaceholder: '逗号分隔，如：React, TypeScript, Vue3',
//     filterCompanyTypeLabel: '🏢 公司性质:',
//     companyTypes: ['国企', '央企', '外企', '事业单位', '民营'],
//     sectionResp: '📌 岗位职责 (Responsibilities)',
//     sectionReq: '🎓 任职要求 (Requirements)',
//     actionApply: '⚡ 沟通/投递',
//     actionOpenLink: '详情 ↗',
//     refreshTitle: '重新读取这条职位的详情',
//     loadingResp: '⏳ 正在后台解析职责...',
//     loadingReq: '⏳ 正在后台解析要求...',
//     reloading: '⏳ 重新读取中...',
//     reloadFailed: '⚠️ 读取失败，请重试',
//     emptyList: '🚫 🔍 暂无符合条件的筛选岗位数据',
//     evaluating: '⚡ 评估中...',
//     showlabel:"❮ ❯ 单步浏览本组 ｜ 上一组/下一组翻页 ｜ 点击空白处切到该卡片",
//     matchResumeing:"AI 正在比对您的简历与 JD...",
//     number:"第",
//     group:"组",
//     salary:"面议",
//     respisNull:"暂无明确职责",
//     reqisNull:"resquiremnets is nothing",
//     detaileloding:"详情获取中",
//     Targetposition:"目标岗位"
//   },
//   en: {
//     panelTitle: '🎴 Job Comparison Board',
//     toggleFilter: '⚙️ Filters & Red Flags',
//     groupPrev: '❮ Prev',
//     groupNext: 'Next ❯',
//     toggleFoldCollapse: '▲ Collapse',
//     toggleFoldExpand: '▼ Expand',
//     filterExcludeLabel: '🚫 Exclude keywords:',
//     filterExcludePlaceholder: 'Comma-separated, e.g. outsourced, onsite-only, 996',
//     filterIncludeLabel: '🎯 Must include:',
//     filterIncludePlaceholder: 'Comma-separated, e.g. React, TypeScript, Vue3',
//     filterCompanyTypeLabel: '🏢 Company type:',
//     companyTypes: ['State-owned', 'Central SOE', 'Foreign', 'Public sector', 'Private'],
//     sectionResp: '📌 Responsibilities',
//     sectionReq: '🎓 Requirements',
//     actionApply: '⚡ Apply / Message',
//     actionOpenLink: 'Details ↗',
//     refreshTitle: 'Reload details for this job',
//     loadingResp: '⏳ Parsing responsibilities...',
//     loadingReq: '⏳ Parsing requirements...',
//     reloading: '⏳ Reloading...',
//     reloadFailed: '⚠️ Failed to load, please retry',
//     emptyList: '🚫 No matching jobs',
//     evaluating: '⚡ Evaluating...',
//     showlabel:"<> switch card | prev and next  group  | click blank to show detail",
//     matchResumeing:"your resume macthing  with JD by AI",
//     number:"No.",
//     group:"group",
//     salary:"Salary negotiable",
//     respisNull:"responsibilties is nothing",
//     reqisNull:"resquiremnets is nothing",
//     detaileloding:"detail is loding",
//     Targetposition:"Target position"
//   },
// };

// const CURRENT_LANG = detectHostLanguage();

// // 取字典里的文案——当前语言没有这个key就退化用中文，中文也没有就
// // 直接把key本身打出来（比渲染出 undefined 更容易一眼看出漏配了）。
// function t(key) {
//   const dict = I18N_STRINGS[CURRENT_LANG] || I18N_STRINGS.zh;
//   if (dict[key] !== undefined) return dict[key];
//   if (I18N_STRINGS.zh[key] !== undefined) return I18N_STRINGS.zh[key];
//   return key;
// }

// =========================================================
// 中英文适配：探测主站语言 + 关键词字典 + 取值函数
// =========================================================

function detectHostLanguage() {
  // 1. 优先校验知名国内站点域名（规避猎聘等网站 <html lang="en"> 模板误标问题）
  const CN_HOST_KEYWORDS = ['zhipin.com', '51job.com', 'liepin.com', 'zhaopin.com', 'zhilian.com'];
  const host = location.hostname;
  if (CN_HOST_KEYWORDS.some((k) => host.includes(k))) return 'zh';

  // 2. 其次校验 HTML 声明的语言
  const htmlLang = (document.documentElement.lang || '').toLowerCase();
  if (htmlLang.startsWith('zh')) return 'zh';
  if (htmlLang.startsWith('en')) return 'en';

  // 3. 兜底（如 LinkedIn、Indeed 等海外站点或未知站点）
  return 'en';
}

const I18N_STRINGS = {
  zh: {
    panelTitle: '🎴 岗位对比看板',
    toggleFilter: '⚙️ 避坑与精细筛选',
    groupPrev: '❮ 上一组',
    groupNext: '下一组 ❯',
    toggleFoldCollapse: '▲ 折叠看板',
    toggleFoldExpand: '▼ 展开看板',
    filterExcludeLabel: '🚫 避坑黑名单:',
    filterExcludePlaceholder: '逗号分隔，如：外包, 驻场, 996, 单休',
    filterIncludeLabel: '🎯 必含关键词:',
    filterIncludePlaceholder: '逗号分隔，如：React, TypeScript, Vue3',
    filterCompanyTypeLabel: '🏢 公司性质:',
    companyTypes: ['国企', '央企', '外企', '事业单位', '民营'],
    sectionResp: '📌 岗位职责 (Responsibilities)',
    sectionReq: '🎓 任职要求 (Requirements)',
    actionApply: '⚡ 沟通/投递',
    actionOpenLink: '详情 ↗',
    refreshTitle: '重新读取这条职位的详情',
    loadingResp: '⏳ 正在后台解析职责...',
    loadingReq: '⏳ 正在后台解析要求...',
    reloading: '⏳ 重新读取中...',
    reloadFailed: '⚠️ 读取失败，请重试',
    emptyList: '🚫 🔍 暂无符合条件的筛选岗位数据',
    evaluating: '⚡ 评估中...',
    showlabel: '❮ ❯ 单步浏览本组 ｜ 上一组/下一组翻页 ｜ 点击空白处切到该卡片',
    matchResumeing: 'AI 正在比对您的简历与 JD...',
    number: '第',
    group: '组',
    salary: '面议',
    respisNull: '暂无明确职责',
    reqisNull: '暂无明确要求',
    detaileloding: '详情获取中',
    Targetposition: '目标岗位：',

    // --- ⬇️ 补充报告 Modal 相关 key ⬇️ ---
    reportModalTitle: '⚡ AI 岗位匹配评估报告',
    reportModalAnalyzing: '正在分析岗位匹配度...',
    reportModalRefreshBtn: '🔄 重新诊断',
    reportModalRetryBtn: '🔄 重试请求',
    reportModalCloseX: '关闭',
    reportModalCloseBtn: '关闭报告',
    reportLoadingTitle: 'AI 正在深度解析简历与 JD...',
    reportLoadingSub: '提取硬性要求、碰撞技能交集与核查短板中',
    unknownJob: '未知岗位',
    hardWarningLabel: '⚠️ <b>硬性门槛预警：</b>',
    matchDegreeHigh: '🔥 极高匹配度',
    matchDegreeGood: '👍 匹配度良好',
    matchDegreeLow: '⚠️ 匹配度较低',
    cachedNotice: '⚡ 5分钟内缓存',
    remainingQuota: '今日剩余 AI 报告额度: {quota} 次',
    quotaUnlimited: '无限制',
    subscoreHard: '硬门槛 (20%)',
    subscoreMustSkill: '必备技能 (30%)',
    subscoreBonusSkill: '加分项 (15%)',
    subscoreBusiness: '业务契合 (35%)',
    unitScore: '分',
    secTitleSkills: '🎯 技能重合与缺失',
    noSkillData: '暂无技能碰撞数据',
    secTitleDiagnosis: '💡 AI 智能诊断',
    insightHighlights: '🌟 匹配亮点',
    insightRisks: '⚠️ 潜在风险/短板',
    insightGaps: '📝 简历优化建议',
    reportErrorTitle: '报告生成失败',
    reportErrorDefaultMsg: '服务器繁忙或网络异常，请稍后再试。',
    rateLimitErrorMsg: '请求过于频繁，请稍后再试',
    reportFailedErrorMsg: '生成深度报告失败，请稍后再试',
    networkErrorMsg: '网络断开或服务器响应超时'
  },
  en: {
    panelTitle: '🎴 Job Comparison Board',
    toggleFilter: '⚙️ Filters & Red Flags',
    groupPrev: '❮ Prev',
    groupNext: 'Next ❯',
    toggleFoldCollapse: '▲ Collapse',
    toggleFoldExpand: '▼ Expand',
    filterExcludeLabel: '🚫 Exclude keywords:',
    filterExcludePlaceholder: 'Comma-separated, e.g. outsourced, onsite-only, 996',
    filterIncludeLabel: '🎯 Must include:',
    filterIncludePlaceholder: 'Comma-separated, e.g. React, TypeScript, Vue3',
    filterCompanyTypeLabel: '🏢 Company type:',
    companyTypes: ['State-owned', 'Central SOE', 'Foreign', 'Public sector', 'Private'],
    sectionResp: '📌 Responsibilities',
    sectionReq: '🎓 Requirements',
    actionApply: '⚡ Apply / Message',
    actionOpenLink: 'Details ↗',
    refreshTitle: 'Reload details for this job',
    loadingResp: '⏳ Parsing responsibilities...',
    loadingReq: '⏳ Parsing requirements...',
    reloading: '⏳ Reloading...',
    reloadFailed: '⚠️ Failed to load, please retry',
    emptyList: '🚫 No matching jobs',
    evaluating: '⚡ Evaluating...',
    showlabel: '<> switch card | prev and next group | click blank to show detail',
    matchResumeing: 'Matching your resume with JD via AI...',
    number: 'No.',
    group: 'group',
    salary: 'Negotiable',
    respisNull: 'No explicit responsibilities listed',
    reqisNull: 'No explicit requirements listed',
    detaileloding: 'Loading details...',
    Targetposition: 'Target Position: ',

    // --- ⬇️ 补充报告 Modal 相关 key ⬇️ ---
    reportModalTitle: '⚡ AI Job Match Report',
    reportModalAnalyzing: 'Analyzing match score...',
    reportModalRefreshBtn: '🔄 Re-evaluate',
    reportModalRetryBtn: '🔄 Retry Request',
    reportModalCloseX: 'Close',
    reportModalCloseBtn: 'Close Report',
    reportLoadingTitle: 'AI is deeply analyzing Resume and JD...',
    reportLoadingSub: 'Extracting key criteria, matching skills & identifying gaps',
    unknownJob: 'Unknown Job',
    hardWarningLabel: '⚠️ <b>Hard Criteria Alert: </b>',
    matchDegreeHigh: '🔥 Excellent Match',
    matchDegreeGood: '👍 Good Match',
    matchDegreeLow: '⚠️ Low Match',
    cachedNotice: '⚡ Cached (within 5 min)',
    remainingQuota: 'AI Reports left today: {quota}',
    quotaUnlimited: 'Unlimited',
    subscoreHard: 'Hard Criteria (20%)',
    subscoreMustSkill: 'Must-haves (30%)',
    subscoreBonusSkill: 'Nice-to-haves (15%)',
    subscoreBusiness: 'Business Fit (35%)',
    unitScore: 'pts',
    secTitleSkills: '🎯 Skill Matches & Gaps',
    noSkillData: 'No skill match data available',
    secTitleDiagnosis: '💡 AI Diagnostic Insights',
    insightHighlights: '🌟 Key Highlights',
    insightRisks: '⚠️ Potential Risks & Shortfalls',
    insightGaps: '📝 Resume Improvement Tips',
    reportErrorTitle: 'Failed to Generate Report',
    reportErrorDefaultMsg: 'Server busy or network error, please try again later.',
    rateLimitErrorMsg: 'Too many requests, please try again later.',
    reportFailedErrorMsg: 'Failed to generate deep report, please try again later.',
    networkErrorMsg: 'Network disconnected or request timed out.'
  },
};

const CURRENT_LANG = detectHostLanguage();

// 取字典里的文案支持 {variable} 格式参数替换
function t(key, params = {}) {
  const dict = I18N_STRINGS[CURRENT_LANG] || I18N_STRINGS.zh;
  let str = dict[key] !== undefined ? dict[key] : (I18N_STRINGS.zh[key] !== undefined ? I18N_STRINGS.zh[key] : key);

  if (typeof str === 'string' && Object.keys(params).length > 0) {
    Object.keys(params).forEach((pKey) => {
      str = str.replace(new RegExp(`\\{${pKey}\\}`, 'g'), params[pKey]);
    });
  }
  return str;
}