const TelegramBot = require("node-telegram-bot-api");

const BOT_TOKEN = process.env.BOT_TOKEN;
const API_BASE = process.env.TEMPMAIL_API_URL;
const DOMAINS = (process.env.TEMPMAIL_DOMAINS || "temporaries.email")
  .split(",")
  .map((d) => d.trim())
  .filter(Boolean);

const bot = new TelegramBot(BOT_TOKEN, { webHook: true });

const sessions = {};

// ─── Helpers ────────────────────────────────────────────────────────────────

function randomString(len = 10) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < len; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function pickDomain() {
  return DOMAINS[Math.floor(Math.random() * DOMAINS.length)];
}

function detectOtp(text) {
  if (!text) return null;
  const patterns = [
    /(?:code|otp|pin|verification code|verify)[^\d]{0,15}(\d{4,8})\b/i,
    /\b(\d{3}[- ]?\d{3})\b/,
    /\b(\d{4,8})\b/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) {
      const code = m[1].replace(/[-\s]/g, "");
      if (code.length >= 4 && code.length <= 8) return code;
    }
  }
  return null;
}

function escapeMarkdown(text) {
  return (text || "").replace(/[_*`[\]()~>#+=|{}.!-]/g, "\\$&");
}

function mainKeyboard() {
  return {
    keyboard: [
      ["📧 New Mail", "📥 Inbox"],
      ["ℹ️ My Email", "🗑 Delete"],
      ["❓ Help"],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  };
}

async function fetchInbox(email) {
  try {
    const res = await fetch(`${API_BASE}/api/messages?email=${encodeURIComponent(email)}`);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

async function fetchMessage(email, id) {
  try {
    const res = await fetch(`${API_BASE}/api/messages/${id}?email=${encodeURIComponent(email)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function deleteInbox(email) {
  try {
    await fetch(`${API_BASE}/api/messages?email=${encodeURIComponent(email)}`, { method: "DELETE" });
  } catch {}
}

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/ {2,}/g, " ")
    .trim();
}

// ─── Command handlers ────────────────────────────────────────────────────────

async function handleStart(chatId, firstName) {
  await bot.sendMessage(
    chatId,
    `👋 *Welcome, ${escapeMarkdown(firstName || "there")}!*\n\n` +
      `📬 I'm your *Temp Mail Bot* — get disposable email addresses instantly!\n\n` +
      `Use the buttons below:`,
    { parse_mode: "Markdown", reply_markup: mainKeyboard() }
  );
}

async function showHelp(chatId) {
  await bot.sendMessage(
    chatId,
    `🤖 *Temp Mail Bot — Help*\n\n` +
      `📧 New Mail — Generate a new disposable email\n` +
      `📥 Inbox — Check received emails\n` +
      `ℹ️ My Email — Show your current email\n` +
      `🗑 Delete — Delete current email session\n\n` +
      `_Reply with a number to read that email._`,
    { parse_mode: "Markdown", reply_markup: mainKeyboard() }
  );
}

async function createNewMail(chatId) {
  const username = randomString(10);
  const domain = pickDomain();
  const email = `${username}@${domain}`;

  sessions[chatId] = { email, messages: [] };

  await bot.sendMessage(
    chatId,
    `✅ *Your Temp Email is Ready!*\n\n📧 \`${email}\`\n\n👆 Tap to copy!`,
    { parse_mode: "Markdown", reply_markup: mainKeyboard() }
  );
}

async function showMyEmail(chatId) {
  if (!sessions[chatId]) {
    await bot.sendMessage(chatId, "❌ No active email. Create one first.", {
      reply_markup: mainKeyboard(),
    });
    return;
  }
  await bot.sendMessage(
    chatId,
    `📧 *Your current email:*\n\`${sessions[chatId].email}\``,
    { parse_mode: "Markdown", reply_markup: mainKeyboard() }
  );
}

async function showInbox(chatId) {
  if (!sessions[chatId]) {
    await bot.sendMessage(chatId, "❌ No active email. Create one first.", {
      reply_markup: mainKeyboard(),
    });
    return;
  }

  await bot.sendMessage(chatId, "🔄 Checking your inbox...", {
    reply_markup: mainKeyboard(),
  });

  const messages = await fetchInbox(sessions[chatId].email);

  if (!messages || messages.length === 0) {
    await bot.sendMessage(
      chatId,
      `📭 *Inbox is empty.*\n\nNo emails received yet for:\n\`${sessions[chatId].email}\``,
      { parse_mode: "Markdown", reply_markup: mainKeyboard() }
    );
    return;
  }

  sessions[chatId].messages = messages;

  const text =
    `📬 *You have ${messages.length} email(s):*\n\n` +
    messages
      .map(
        (m, i) =>
          `*${i + 1}.* 📩 From: \`${escapeMarkdown(m.from_address)}\`\n` +
          `    📌 Subject: ${escapeMarkdown(m.subject || "(No subject)")}\n` +
          `    🕐 ${new Date(m.received_at.replace(" ", "T") + "Z").toLocaleString("en-BD", {
            timeZone: "Asia/Dhaka",
          })}`
      )
      .join("\n\n") +
    `\n\nReply with the number (1, 2, 3...) to read a message`;

  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: mainKeyboard(),
  });
}

async function readEmail(chatId, index) {
  if (!sessions[chatId]) {
    await bot.sendMessage(chatId, "❌ No active session. Create one first.", {
      reply_markup: mainKeyboard(),
    });
    return;
  }

  if (!sessions[chatId].messages || !sessions[chatId].messages[index]) {
    await bot.sendMessage(chatId, "❌ Invalid message number.", {
      reply_markup: mainKeyboard(),
    });
    return;
  }

  const msgId = sessions[chatId].messages[index].id;
  const full = await fetchMessage(sessions[chatId].email, msgId);

  if (!full) {
    await bot.sendMessage(chatId, "⚠️ Could not fetch email.", {
      reply_markup: mainKeyboard(),
    });
    return;
  }

  let rawBody = "";
  if (full.text_content) {
    rawBody = full.text_content.substring(0, 4000);
  } else if (full.html_content) {
    rawBody = stripHtml(full.html_content).substring(0, 4000);
  } else if (full.preview) {
    rawBody = full.preview;
  } else {
    rawBody = "(Empty message)";
  }

  const otp = detectOtp(`${full.subject || ""}\n${rawBody}`);
  const otpLine = otp ? `\n🔐 OTP Detected: \`${otp}\`\n` : "";
  const safeSubject = escapeMarkdown(full.subject || "(No subject)");

  await bot.sendMessage(
    chatId,
    `📩 *Email #${index + 1}*\n\n` +
      `*From:* \`${full.from_address}\`\n` +
      `*Subject:* ${safeSubject}\n` +
      `*Date:* ${new Date(full.received_at.replace(" ", "T") + "Z").toLocaleString("en-BD", {
        timeZone: "Asia/Dhaka",
      })}` +
      otpLine,
    { parse_mode: "Markdown" }
  );

  await bot.sendMessage(chatId, `─────────────────\n${rawBody}`, {
    disable_web_page_preview: true,
    reply_markup: mainKeyboard(),
  });
}

async function deleteMail(chatId) {
  if (!sessions[chatId]) {
    await bot.sendMessage(chatId, "❌ No active email to delete.", {
      reply_markup: mainKeyboard(),
    });
    return;
  }

  await deleteInbox(sessions[chatId].email);
  delete sessions[chatId];

  await bot.sendMessage(
    chatId,
    `🗑 *Email deleted successfully!*\n\nUse New Mail to generate a fresh one.`,
    { parse_mode: "Markdown", reply_markup: mainKeyboard() }
  );
}

// ─── Message router ───────────────────────────────────────────────────────

async function routeMessage(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();

  if (text === "/start") return handleStart(chatId, msg.from.first_name);
  if (text === "/help") return showHelp(chatId);
  if (text === "/newmail") return createNewMail(chatId);
  if (text === "/myemail") return showMyEmail(chatId);
  if (text === "/inbox") return showInbox(chatId);
  if (text === "/delete") return deleteMail(chatId);

  if (text === "📧 New Mail") return createNewMail(chatId);
  if (text === "📥 Inbox") return showInbox(chatId);
  if (text === "ℹ️ My Email") return showMyEmail(chatId);
  if (text === "🗑 Delete") return deleteMail(chatId);
  if (text === "❓ Help") return showHelp(chatId);

  if (/^\d+$/.test(text)) return readEmail(chatId, parseInt(text) - 1);

  return bot.sendMessage(chatId, "💡 Use the buttons below.", {
    reply_markup: mainKeyboard(),
  });
}

// ─── Vercel handler (webhook entrypoint) ───────────────────────────────────

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(200).send("Tempmail Bot webhook is running.");
    return;
  }

  try {
    const update = req.body;
    if (update.message) {
      await routeMessage(update.message);
    }
  } catch (err) {
    console.error("Webhook error:", err);
  }

  res.status(200).send("OK");
};
