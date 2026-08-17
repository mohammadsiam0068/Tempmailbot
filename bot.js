const TELEGRAM_API_URL = "https://api.telegram.org/bot";

function randomString(len = 10) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < len; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
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

function escapeHtml(text) {
  return (text || "").toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

async function sendTelegramMessage(token, chatId, text, options = {}) {
  const payload = {
    chat_id: chatId,
    text: text,
    ...options,
  };
  await fetch(`${TELEGRAM_API_URL}${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function handleRequest(request, env) {
  if (request.method !== "POST") {
    return new Response("OK", { status: 200 });
  }

  const update = await request.json();
  if (!update.message || !update.message.text) {
    return new Response("OK", { status: 200 });
  }

  const chatId = update.message.chat.id;
  const text = update.message.text.trim();
  const firstName = update.message.from.first_name || "there";

  const apiBase = env.TEMPMAIL_API_URL || "https://tempmail-ao8.pages.dev";
  const domains = [
    "echoinbox.eu.cc",
    "echomail.eu.cc",
    "echotemp.eu.cc",
    "mailecho.eu.cc",
    "mailr.eu.cc",
    "mailrly.eu.cc",
    "multisms.eu.cc",
    "tapmail.eu.cc",
    "telegramtg.eu.cc"
  ];

  let session = await env.KV_SESSIONS.get(chatId.toString(), "json");

  if (text === "/start") {
    await sendTelegramMessage(
      env.BOT_TOKEN,
      chatId,
      `👋 <b>Welcome, ${escapeHtml(firstName)}!</b>\n\n📬 I'm your <b>Temp Mail Bot</b> — get disposable email addresses instantly!\n\nUse the buttons below:`,
      { parse_mode: "HTML", reply_markup: mainKeyboard() }
    );
  } else if (text === "/help" || text === "❓ Help") {
    await sendTelegramMessage(
      env.BOT_TOKEN,
      chatId,
      `🤖 <b>Temp Mail Bot — Help</b>\n\n📧 New Mail — Generate a new disposable email\n📥 Inbox — Check received emails\nℹ️ My Email — Show your current email\n🗑 Delete — Delete current email session\n\n<i>Reply with a number to read that email.</i>`,
      { parse_mode: "HTML", reply_markup: mainKeyboard() }
    );
  } else if (text === "/newmail" || text === "📧 New Mail") {
    const domain = domains[Math.floor(Math.random() * domains.length)];
    const email = `${randomString(10)}@${domain}`;
    session = { email, messages: [] };
    await env.KV_SESSIONS.put(chatId.toString(), JSON.stringify(session));
    await sendTelegramMessage(
      env.BOT_TOKEN,
      chatId,
      `✅ <b>Your Temp Email is Ready!</b>\n\n📧 <code>${email}</code>\n\n👆 Tap to copy!`,
      { parse_mode: "HTML", reply_markup: mainKeyboard() }
    );
  } else if (text === "/myemail" || text === "ℹ️ My Email") {
    if (!session) {
      await sendTelegramMessage(env.BOT_TOKEN, chatId, "❌ No active email. Create one first.", { reply_markup: mainKeyboard() });
    } else {
      await sendTelegramMessage(
        env.BOT_TOKEN,
        chatId,
        `📧 <b>Your current email:</b>\n<code>${session.email}</code>`,
        { parse_mode: "HTML", reply_markup: mainKeyboard() }
      );
    }
  } else if (text === "/inbox" || text === "📥 Inbox") {
    if (!session) {
      await sendTelegramMessage(env.BOT_TOKEN, chatId, "❌ No active email. Create one first.", { reply_markup: mainKeyboard() });
    } else {
      await sendTelegramMessage(env.BOT_TOKEN, chatId, "🔄 Checking your inbox...", { reply_markup: mainKeyboard() });
      try {
        const res = await fetch(`${apiBase}/api/messages?email=${encodeURIComponent(session.email)}`);
        const messages = res.ok ? await res.json() : [];
        if (!messages || messages.length === 0) {
          await sendTelegramMessage(
            env.BOT_TOKEN,
            chatId,
            `📭 <b>Inbox is empty.</b>\n\nNo emails received yet for:\n<code>${session.email}</code>`,
            { parse_mode: "HTML", reply_markup: mainKeyboard() }
          );
        } else {
          session.messages = messages;
          await env.KV_SESSIONS.put(chatId.toString(), JSON.stringify(session));
          const inboxText =
            `📬 <b>You have ${messages.length} email(s):</b>\n\n` +
            messages
              .map(
                (m, i) =>
                  `<b>${i + 1}.</b> 📩 From: <code>${escapeHtml(m.from_address)}</code>\n    📌 Subject: ${escapeHtml(m.subject || "(No subject)")}\n    🕐 ${new Date(m.received_at.replace(" ", "T") + "Z").toLocaleString("en-BD", { timeZone: "Asia/Dhaka" })}`
              )
              .join("\n\n") +
            `\n\nReply with the number (1, 2, 3...) to read a message`;
          await sendTelegramMessage(env.BOT_TOKEN, chatId, inboxText, { parse_mode: "HTML", reply_markup: mainKeyboard() });
        }
      } catch (err) {
        await sendTelegramMessage(env.BOT_TOKEN, chatId, "❌ Error checking inbox.", { reply_markup: mainKeyboard() });
      }
    }
  } else if (text === "/delete" || text === "🗑 Delete") {
    if (!session) {
      await sendTelegramMessage(env.BOT_TOKEN, chatId, "❌ No active email to delete.", { reply_markup: mainKeyboard() });
    } else {
      try {
        await fetch(`${apiBase}/api/messages?email=${encodeURIComponent(session.email)}`, { method: "DELETE" });
      } catch (err) {}
      await env.KV_SESSIONS.delete(chatId.toString());
      await sendTelegramMessage(
        env.BOT_TOKEN,
        chatId,
        `🗑 <b>Email deleted successfully!</b>\n\nUse New Mail to generate a fresh one.`,
        { parse_mode: "HTML", reply_markup: mainKeyboard() }
      );
    }
  } else if (/^\d+$/.test(text)) {
    const index = parseInt(text) - 1;
    if (!session) {
      await sendTelegramMessage(env.BOT_TOKEN, chatId, "❌ No active session. Create one first.", { reply_markup: mainKeyboard() });
    } else if (!session.messages || !session.messages[index]) {
      await sendTelegramMessage(env.BOT_TOKEN, chatId, "❌ Invalid message number.", { reply_markup: mainKeyboard() });
    } else {
      const msgId = session.messages[index].id;
      try {
        const res = await fetch(`${apiBase}/api/messages/${msgId}?email=${encodeURIComponent(session.email)}`);
        const full = res.ok ? await res.json() : null;
        if (!full) {
          await sendTelegramMessage(env.BOT_TOKEN, chatId, "⚠️ Could not fetch email.", { reply_markup: mainKeyboard() });
        } else {
          let rawBody = "";
          if (full.text_content) rawBody = full.text_content.substring(0, 4000);
          else if (full.html_content) rawBody = stripHtml(full.html_content).substring(0, 4000);
          else if (full.preview) rawBody = full.preview;
          else rawBody = "(Empty message)";

          const otp = detectOtp(`${full.subject || ""}\n${rawBody}`);
          const otpLine = otp ? `\n🔐 OTP Detected: <code>${otp}</code>\n` : "";
          const safeSubject = escapeHtml(full.subject || "(No subject)");

          await sendTelegramMessage(
            env.BOT_TOKEN,
            chatId,
            `📩 <b>Email #${index + 1}</b>\n\n<b>From:</b> <code>${escapeHtml(full.from_address)}</code>\n<b>Subject:</b> ${safeSubject}\n<b>Date:</b> ${new Date(full.received_at.replace(" ", "T") + "Z").toLocaleString("en-BD", { timeZone: "Asia/Dhaka" })}${otpLine}`,
            { parse_mode: "HTML" }
          );
          await sendTelegramMessage(env.BOT_TOKEN, chatId, `─────────────────\n${rawBody}`, { disable_web_page_preview: true, reply_markup: mainKeyboard() });
        }
      } catch (err) {
        await sendTelegramMessage(env.BOT_TOKEN, chatId, "⚠️ Error fetching email.", { reply_markup: mainKeyboard() });
      }
    }
  } else {
    await sendTelegramMessage(env.BOT_TOKEN, chatId, "💡 Use the buttons below.", { reply_markup: mainKeyboard() });
  }

  return new Response("OK", { status: 200 });
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
};
