


const BASE_URL = "http://127.0.0.1:3000";
const USER_INFO_TTL_MS = 5 * 60 * 60 * 1000; // 5小时

// 获取/生成 Device-ID (用于访客模式)
async function getDeviceId() {
  const data = await chrome.storage.local.get(["device_id"]);
  if (data.device_id) {
    return data.device_id;
  }
  const newDeviceId = "dev_" + crypto.randomUUID();
  await chrome.storage.local.set({ device_id: newDeviceId });
  return newDeviceId;
}

// 存储用户信息——统一存成 { data, savedAt } 的形状，savedAt 是写入时的
// 时间戳，读的时候靠它判断是否过期。用同一个 key（"user_info"）存，
// 临时/会员切换天然就是覆盖，不用额外处理。
async function saveUserInfo(key, result) {
  await chrome.storage.local.set({
    [key]: { data: result, savedAt: Date.now() },
  });
  console.log("用户数据已成功同步存储至插件中央数据库");
}

// 读取用户信息——过期或者压根没存过都返回 null，调用方不用关心细节，
// 拿到 null 就当"没有可用数据"处理。过期的顺手清掉，不用等下次写入
// 才覆盖，避免看着数据"还在"但其实早就该失效了。
async function getUserInfo(key) {
  const data = await chrome.storage.local.get([key]);
  const entry = data[key];

  if (!entry) {
    console.warn("未登录或未存储 用户信息，返回 null");
    return null;
  }

  const expired = Date.now() - entry.savedAt > USER_INFO_TTL_MS;
  if (expired) {
    console.log(`${key} 已超过5小时有效期，清除`);
    await chrome.storage.local.remove([key]);
    return null;
  }

  console.log("成功获取到插件用户:", entry.data);
  return entry.data;
}

let currentTab = "guest"; // 默认为访客模式

// 初始化 DOM 与事件绑定
document.addEventListener("DOMContentLoaded", async () => {
  // 恢复记住的邮箱和密钥——getUserInfo 是 async 函数，必须 await，
  // 不然拿到的是 Promise 对象本身，不是真正存的值（这是之前"没生效"
  // 的另一半原因，跟 TTL 缺失是两个独立的问题）。
  const savedEmail = await getUserInfo("saved_email");
  const savedKey = await getUserInfo("saved_key");
  document.getElementById("userEmail").value = savedEmail || "";
  document.getElementById("userSecretKey").value = savedKey || "";

  const tabBtns = document.querySelectorAll(".tab-btn");
  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      tabBtns.forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
      btn.classList.add("active");
      currentTab = btn.dataset.tab;
      document.getElementById(`tab-${currentTab}`).classList.add("active");
      setStatus("");
    });
  });

  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");
  dropZone.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => {
    if (e.target.files.length > 0) handleFileUpload(e.target.files[0]);
  });
});

// 文件上传核心逻辑
async function handleFileUpload(file) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("login_type", currentTab);
  const checkbox = document.getElementById('privacyConsent');
  if(!checkbox.checked){
    setStatus("请先勾选隐私协议！", "error");
    return;
  }

  if (currentTab === "user") {
    const email = document.getElementById("userEmail").value.trim();
    const secretKey = document.getElementById("userSecretKey").value.trim();

    if (!email || !secretKey) {
      setStatus("请先填写邮箱和激活密钥！", "error");
      return;
    }

    formData.append("email", email);
    formData.append("secret_key", secretKey);

    await saveUserInfo("saved_email", email);
    await saveUserInfo("saved_key", secretKey);
  }

  showLoading(true);
  setStatus("");

  try {
    const res = await fetch(`${BASE_URL}/api/resume/parse-file`, {
      method: "POST",
      headers: { "X-Device-Id": await getDeviceId() }, // 原来这里也漏了 await
      body: formData,
    });

    const result = await res.json();

    if (!res.ok) {
      setStatus(`❌ ${result.detail || "请求失败"}`, "error");
      return;
    }

    setStatus("🎉 " + result.msg, "success");
    showResult(result);

    // 存真正的简历解析结果（+ user_id），不是只存一个 user_id 字符串——
    // 这才是你说的"临时存简历信息、5小时后清除"要存的东西。
    await saveUserInfo("user_info", {
      user_id: result.user_id,
      user_type: result.user_type,
      parsed_data: result.parsed_data,
    });
  } catch (err) {
    setStatus("❌ 网络请求失败，请检查后端服务是否启动");
  } finally {
    showLoading(false);
  }
}

function showResult(data) {
  document.getElementById("uploadArea").classList.add("hidden");
  document.getElementById("resultView").classList.remove("hidden");

  const parsed = data.parsed_data;
  document.getElementById("res_name").value = parsed.name || "";
  document.getElementById("res_role").value = parsed.role || "";
  document.getElementById("res_tel").value = parsed.tel || "";
  document.getElementById("res_email").value = parsed.email || "";

  const badge = document.getElementById("quotaBadge");
  badge.textContent = `身份: ${data.user_type === 'user' ? '👑 注册会员 (永久保存)' : '👤 访客 (5小时后删除)'} | 今日剩余解析: ${data.remaining_uploads}`;
}

document.getElementById("reuploadBtn").addEventListener("click", () => {
  document.getElementById("resultView").classList.add("hidden");
  document.getElementById("uploadArea").classList.remove("hidden");
  document.getElementById("fileInput").value = "";
  setStatus("");
});

function showLoading(isLoading) {
  document.getElementById("dropZone").style.display = isLoading ? "none" : "block";
  document.getElementById("loading").classList.toggle("hidden", !isLoading);
}

function setStatus(msg, type = "") {
  const el = document.getElementById("statusMsg");
  el.textContent = msg;
  el.style="color:red"
  el.className = `status-msg ${type}`;
}