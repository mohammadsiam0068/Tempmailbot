const TELEGRAM_API_URL = "https://api.telegram.org/bot";

function randomString(len = 10) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < len; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
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

// Inline keyboard shown right under a freshly generated email
function emailInlineKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "🔄 New Address", callback_data: "newmail" },
        { text: "📥 Refresh Inbox", callback_data: "inbox" },
      ],
    ],
  };
}

// Inline keyboard shown under the inbox list
function inboxInlineKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "📥 Refresh", callback_data: "inbox" },
        { text: "🔄 New Address", callback_data: "newmail" },
      ],
    ],
  };
}

// Inline keyboard shown under an opened message (adds OTP popup button if otp exists)
function messageInlineKeyboard(index, otp) {
  const row1 = [{ text: "📥 Back to Inbox", callback_data: "inbox" }];
  const rows = [row1];
  if (otp) {
    rows.unshift([{ text: `🔐 Show OTP (${otp})`, callback_data: `otp:${otp}` }]);
  }
  return { inline_keyboard: rows };
}

async function tg(token, method, payload) {
  const res = await fetch(`${TELEGRAM_API_URL}${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.ok ? res.json() : null;
}

async function sendTelegramMessage(token, chatId, text, options = {}) {
  return tg(token, "sendMessage", { chat_id: chatId, text, ...options });
}

async function editTelegramMessage(token, chatId, messageId, text, options = {}) {
  return tg(token, "editMessageText", { chat_id: chatId, message_id: messageId, text, ...options });
}

async function answerCallbackQuery(token, callbackQueryId, options = {}) {
  return tg(token, "answerCallbackQuery", { callback_query_id: callbackQueryId, ...options });
}

function inboxEmptyText(email) {
  return `📭 <b>Inbox is empty.</b>\n\nNo emails received yet for:\n<code>${escapeHtml(email)}</code>`;
}

function inboxListText(messages) {
  return (
    `📬 <b>You have ${messages.length} email(s):</b>\n\n` +
    messages
      .map(
        (m, i) =>
          `<b>${i + 1}.</b> 📩 From: <code>${escapeHtml(m.from_address)}</code>\n    📌 Subject: ${escapeHtml(m.subject || "(No subject)")}\n    🕐 ${new Date(m.received_at.replace(" ", "T") + "Z").toLocaleString("en-BD", { timeZone: "Asia/Dhaka" })}`
      )
      .join("\n\n") +
    `\n\nReply with the number (1, 2, 3...) to read a message`
  );
}

async function doNewMail(env, chatId) {
  const domains = ["echoinbox.eu.cc", "echomail.eu.cc", "echotemp.eu.cc", "mailecho.eu.cc", "mailr.eu.cc", "mailrly.eu.cc", "multisms.eu.cc", "tapmail.eu.cc", "telegramtg.eu.cc"];
  const domain = domains[Math.floor(Math.random() * domains.length)];
  const email = `${randomString(10)}@${domain}`;
  const session = { email, messages: [] };
  await env.KV_SESSIONS.put(chatId.toString(), JSON.stringify(session));
  return { session, text: `✅ <b>Your Temp Email is Ready!</b>\n\n📧 <code>${escapeHtml(email)}</code>\n\n👆 Tap the email to copy!` };
}

async function doInboxFetch(env, apiBase, session) {
  const res = await fetch(`${apiBase}/api/messages?email=${encodeURIComponent(session.email)}`);
  return res.ok ? res.json() : [];
}

async function handleRequest(request, env) {
  if (request.method !== "POST") return new Response("OK", { status: 200 });

  let update;
  try {
    update = await request.json();
  } catch {
    return new Response("OK", { status: 200 });
  }

  const apiBase = env.TEMPMAIL_API_URL || "https://tempmail-ao8.pages.dev";
  const token = env.BOT_TOKEN;

  // ── Handle inline button presses ─────────────────────────────
  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message.chat.id;
    const messageId = cq.message.message_id;
    const data = cq.data || "";

    let session = await env.KV_SESSIONS.get(chatId.toString(), "json");

    if (data === "newmail") {
      const { session: newSession, text } = await doNewMail(env, chatId);
      await answerCallbackQuery(token, cq.id, { text: "New address generated!" });
      await editTelegramMessage(token, chatId, messageId, text, { parse_mode: "HTML", reply_markup: emailInlineKeyboard() });
      return new Response("OK", { status: 200 });
    }

    if (data === "inbox") {
      if (!session) {
        await answerCallbackQuery(token, cq.id, { text: "No active email. Tap New Mail first.", show_alert: true });
        return new Response("OK", { status: 200 });
      }
      await answerCallbackQuery(token, cq.id, { text: "Refreshing..." });
      const messages = await doInboxFetch(env, apiBase, session);
      session.messages = messages;
      await env.KV_SESSIONS.put(chatId.toString(), JSON.stringify(session));
      const text = messages.length === 0 ? inboxEmptyText(session.email) : inboxListText(messages);
      await editTelegramMessage(token, chatId, messageId, text, { parse_mode: "HTML", reply_markup: inboxInlineKeyboard() });
      return new Response("OK", { status: 200 });
    }

    if (data.startsWith("otp:")) {
      const otp = data.slice(4);
      await answerCallbackQuery(token, cq.id, { text: `🔐 OTP: ${otp}\n\nPress and hold to copy.`, show_alert: true });
      return new Response("OK", { status: 200 });
    }

    await answerCallbackQuery(token, cq.id, {});
    return new Response("OK", { status: 200 });
  }

  // ── Handle regular text messages ─────────────────────────────
  if (!update.message || !update.message.text) return new Response("OK", { status: 200 });

  const chatId = update.message.chat.id;
  const text = update.message.text.trim();
  const firstName = update.message.from.first_name || "there";

  let session = await env.KV_SESSIONS.get(chatId.toString(), "json");

  if (text === "/start") {
    await sendTelegramMessage(
      token,
      chatId,
      `👋 <b>Welcome, ${escapeHtml(firstName)}!</b>\n\n📬 I'm your <b>Temp Mail Bot</b> — get disposable email addresses instantly!\n\nUse the buttons below:`,
      { parse_mode: "HTML", reply_markup: mainKeyboard() }
    );
  } else if (text === "/help" || text === "❓ Help") {
    await sendTelegramMessage(
      token,
      chatId,
      `🤖 <b>Temp Mail Bot — Help</b>\n\n📧 New Mail — Generate a new disposable email\n📥 Inbox — Check received emails\nℹ️ My Email — Show your current email\n🗑 Delete — Delete current email session\n\n<i>Reply with a number to read that email.</i>`,
      { parse_mode: "HTML", reply_markup: mainKeyboard() }
    );
  } else if (text === "/newmail" || text === "📧 New Mail") {
    const { text: msgText } = await doNewMail(env, chatId);
    await sendTelegramMessage(token, chatId, msgText, { parse_mode: "HTML", reply_markup: emailInlineKeyboard() });
  } else if (text === "/myemail" || text === "ℹ️ My Email") {
    if (!session) {
      await sendTelegramMessage(token, chatId, "❌ No active email. Create one first.", { reply_markup: mainKeyboard() });
    } else {
      await sendTelegramMessage(token, chatId, `📧 <b>Your current email:</b>\n<code>${escapeHtml(session.email)}</code>`, { parse_mode: "HTML", reply_markup: emailInlineKeyboard() });
    }
  } else if (text === "/inbox" || text === "📥 Inbox") {
    if (!session) {
      await sendTelegramMessage(token, chatId, "❌ No active email. Create one first.", { reply_markup: mainKeyboard() });
    } else {
      try {
        const messages = await doInboxFetch(env, apiBase, session);
        session.messages = messages;
        await env.KV_SESSIONS.put(chatId.toString(), JSON.stringify(session));
        const msgText = messages.length === 0 ? inboxEmptyText(session.email) : inboxListText(messages);
        await sendTelegramMessage(token, chatId, msgText, { parse_mode: "HTML", reply_markup: inboxInlineKeyboard() });
      } catch (err) {
        await sendTelegramMessage(token, chatId, "❌ Error checking inbox.", { reply_markup: mainKeyboard() });
      }
    }
  } else if (text === "/delete" || text === "🗑 Delete") {
    if (!session) {
      await sendTelegramMessage(token, chatId, "❌ No active email to delete.", { reply_markup: mainKeyboard() });
    } else {
      try {
        await fetch(`${apiBase}/api/messages?email=${encodeURIComponent(session.email)}`, { method: "DELETE" });
      } catch {}
      await env.KV_SESSIONS.delete(chatId.toString());
      await sendTelegramMessage(token, chatId, `🗑 <b>Email deleted successfully!</b>\n\nUse New Mail to generate a fresh one.`, { parse_mode: "HTML", reply_markup: mainKeyboard() });
    }
  } else if (/^\d+$/.test(text)) {
    const index = parseInt(text) - 1;
    if (!session) {
      await sendTelegramMessage(token, chatId, "❌ No active session. Create one first.", { reply_markup: mainKeyboard() });
    } else if (!session.messages || !session.messages[index]) {
      await sendTelegramMessage(token, chatId, "❌ Invalid message number.", { reply_markup: mainKeyboard() });
    } else {
      const msgId = session.messages[index].id;
      try {
        const res = await fetch(`${apiBase}/api/messages/${msgId}?email=${encodeURIComponent(session.email)}`);
        const full = res.ok ? await res.json() : null;
        if (!full) {
          await sendTelegramMessage(token, chatId, "⚠️ Could not fetch email.", { reply_markup: mainKeyboard() });
        } else {
          let rawBody = "";
          if (full.text_content) rawBody = full.text_content.substring(0, 3500);
          else if (full.html_content) rawBody = stripHtml(full.html_content).substring(0, 3500);
          else if (full.preview) rawBody = full.preview;
          else rawBody = "(Empty message)";

          const otp = detectOtp(`${full.subject || ""}\n${rawBody}`);
          const otpLine = otp ? `\n🔐 OTP Detected: <code>${escapeHtml(otp)}</code>\n` : "";
          const safeSubject = escapeHtml(full.subject || "(No subject)");

          await sendTelegramMessage(
            token,
            chatId,
            `📩 <b>Email #${index + 1}</b>\n\n<b>From:</b> <code>${escapeHtml(full.from_address)}</code>\n<b>Subject:</b> ${safeSubject}\n<b>Date:</b> ${new Date(full.received_at.replace(" ", "T") + "Z").toLocaleString("en-BD", { timeZone: "Asia/Dhaka" })}${otpLine}\n─────────────────\n${escapeHtml(rawBody)}`,
            { parse_mode: "HTML", disable_web_page_preview: true, reply_markup: messageInlineKeyboard(index, otp) }
          );
        }
      } catch (err) {
        await sendTelegramMessage(token, chatId, "⚠️ Error fetching email.", { reply_markup: mainKeyboard() });
      }
    }
  } else {
    await sendTelegramMessage(token, chatId, "💡 Use the buttons below.", { reply_markup: mainKeyboard() });
  }

  return new Response("OK", { status: 200 });
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
};
