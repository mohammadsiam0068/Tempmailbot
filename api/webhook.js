const TELEGRAM_API_URL = "https://api.telegram.org/bot";

// একাধিক চ্যানেলের লিস্ট (Force Sub)
const REQUIRED_CHATS = [
  { id: "@premiumify19", url: "https://t.me/premiumify19" },
  { id: "@premiumify20", url: "https://t.me/premiumify20" }
];

const FRONTEND_URL = "https://echomail.eu.cc/";

// আপনার অ্যাডমিন আইডি
const ADMIN_IDS = ["7880714253"];

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
      ["📜 Mail List", "ℹ️ My Email"],
      ["🗑 Delete", "❓ Help"],
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

async function checkMembership(token, userId, chatId) {
  try {
    const response = await fetch(`${TELEGRAM_API_URL}${token}/getChatMember?chat_id=${chatId}&user_id=${userId}`);
    const data = await response.json();
    if (data.ok) {
      const status = data.result.status;
      return ["creator", "administrator", "member", "restricted"].includes(status);
    }
    return false;
  } catch (err) {
    return false;
  }
}

async function handleRequest(request, env) {
  if (request.method !== "POST") {
    return new Response("OK", { status: 200 });
  }

  try {
    const update = await request.json();
    let chatId, userId, text, firstName;
    let isCallback = false;
    let callbackData = "";

    if (update.message && update.message.text) {
      chatId = update.message.chat.id;
      userId = update.message.from.id.toString();
      text = update.message.text.trim();
      firstName = update.message.from.first_name || "there";
    } else if (update.callback_query) {
      isCallback = true;
      chatId = update.callback_query.message.chat.id;
      userId = update.callback_query.from.id.toString();
      firstName = update.callback_query.from.first_name || "there";
      callbackData = update.callback_query.data;
    } else {
      return new Response("OK", { status: 200 });
    }

    // মাল্টিপল ফোর্স সাব চেক (Multiple Force Sub Check)
    let unjoinedChats = [];
    for (const chat of REQUIRED_CHATS) {
      const isMember = await checkMembership(env.BOT_TOKEN, userId, chat.id);
      if (!isMember) unjoinedChats.push(chat);
    }

    if (unjoinedChats.length > 0) {
      if (isCallback) {
        await fetch(`${TELEGRAM_API_URL}${env.BOT_TOKEN}/answerCallbackQuery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callback_query_id: update.callback_query.id, text: "আপনাকে চ্যানেলগুলোতে জয়েন করতে হবে!", show_alert: true })
        });
      }
      
      let inlineKeyboard = unjoinedChats.map(chat => [{ text: `➕ Join ${chat.id}`, url: chat.url }]);
      
      await sendTelegramMessage(
        env.BOT_TOKEN,
        chatId,
        `⚠️ <b>দুঃখিত, বটটি ব্যবহার করতে হলে আপনাকে নিচের চ্যানেলগুলোতে জয়েন করতে হবে!</b>\n\nজয়েন করার পর আবার /start দিন।`,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: inlineKeyboard,
          },
        }
      );
      return new Response("OK", { status: 200 });
    }

    const apiBase = env.TEMPMAIL_API_URL || "https://tempmail-ao8.pages.dev";
    const defaultDomains = "echoinbox.eu.cc,echomail.eu.cc,echotemp.eu.cc,mailecho.eu.cc,mailr.eu.cc,mailrly.eu.cc,multisms.eu.cc,tapmail.eu.cc,telegramtg.eu.cc";
    const domains = (env.TEMPMAIL_DOMAINS || defaultDomains).split(",").map((d) => d.trim()).filter(Boolean);

    let session = await env.KV_SESSIONS.get(chatId.toString(), "json") || { email: null, messages: [], history: [] };
    if (!session.history) session.history = [];
    if (session.email && !session.history.includes(session.email)) {
      session.history.unshift(session.email);
    }

    if (isCallback) {
      await fetch(`${TELEGRAM_API_URL}${env.BOT_TOKEN}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: update.callback_query.id })
      });

      if (callbackData.startsWith("switch_")) {
        const index = parseInt(callbackData.split("_")[1]);
        if (session.history[index]) {
          session.email = session.history[index];
          session.messages = [];
          await env.KV_SESSIONS.put(chatId.toString(), JSON.stringify(session));
          
          const encodedEmail = btoa(session.email);
          const webLink = `${FRONTEND_URL}?email=${encodeURIComponent(encodedEmail)}`;

          await sendTelegramMessage(
            env.BOT_TOKEN,
            chatId,
            `✅ <b>সফলভাবে মেইল পরিবর্তন করা হয়েছে:</b>\n<code>${session.email}</code>\n\n🌐 <a href="${webLink}">Open Inbox in Web Browser</a>`,
            { parse_mode: "HTML", reply_markup: mainKeyboard(), disable_web_page_preview: true }
          );
        }
      }
      return new Response("OK", { status: 200 });
    }

    if (text === "/start") {
      await sendTelegramMessage(
        env.BOT_TOKEN,
        chatId,
        `👋 <b>Welcome, ${escapeHtml(firstName)}!</b>\n\n📬 I'm your <b>Temp Mail Bot</b> — get disposable email addresses instantly!\n\nUse the buttons below:`,
        { parse_mode: "HTML", reply_markup: mainKeyboard() }
      );
    } else if (text === "/admin" || text === "⚙️ Admin") {
      if (!ADMIN_IDS.includes(userId)) {
        await sendTelegramMessage(env.BOT_TOKEN, chatId, "❌ <b>অ্যাক্সেস ডিনাইড!</b>\nআপনার এই কমান্ডটি ব্যবহার করার অনুমতি নেই।", { parse_mode: "HTML", reply_markup: mainKeyboard() });
      } else {
        await sendTelegramMessage(
          env.BOT_TOKEN,
          chatId,
          `👑 <b>Admin Control Panel</b>\n\nস্বাগতম বস! আপনি এই বটের অ্যাডমিন। বটের স্ট্যাটাস ঠিক আছে।`,
          { parse_mode: "HTML", reply_markup: mainKeyboard() }
        );
      }
    } else if (text === "/help" || text === "❓ Help") {
      await sendTelegramMessage(
        env.BOT_TOKEN,
        chatId,
        `🤖 <b>Temp Mail Bot — Help</b>\n\n📧 New Mail — Generate a new email\n📜 Mail List — View last 20 emails\n📥 Inbox — Check received emails\nℹ️ My Email — Show current email\n🗑 Delete — Delete current email\n\n<i>Reply with a number to read that email.</i>`,
        { parse_mode: "HTML", reply_markup: mainKeyboard() }
      );
    } else if (text === "/newmail" || text === "📧 New Mail") {
      const domain = domains[Math.floor(Math.random() * domains.length)];
      const email = `${randomString(10)}@${domain}`;
      
      session.email = email;
      session.messages = [];
      session.history.unshift(email);
      session.history = [...new Set(session.history)].slice(0, 20);
      
      await env.KV_SESSIONS.put(chatId.toString(), JSON.stringify(session));
      
      const encodedEmail = btoa(email);
      const webLink = `${FRONTEND_URL}?email=${encodeURIComponent(encodedEmail)}`;

      await sendTelegramMessage(
        env.BOT_TOKEN,
        chatId,
        `✅ <b>Your Temp Email is Ready!</b>\n\n📧 <code>${email}</code>\n\n🌐 <a href="${webLink}">Open Inbox in Web Browser</a>\n<i>👆 Tap the email to copy, or click the link to view on the website!</i>`,
        { parse_mode: "HTML", reply_markup: mainKeyboard(), disable_web_page_preview: true }
      );
    } else if (text === "/maillist" || text === "📜 Mail List") {
      if (!session.history || session.history.length === 0) {
        await sendTelegramMessage(env.BOT_TOKEN, chatId, "❌ No email history found.", { reply_markup: mainKeyboard() });
      } else {
        let inlineKeyboard = [];
        session.history.forEach((histEmail, index) => {
          let prefix = (histEmail === session.email) ? "🟢 " : "⚪️ ";
          inlineKeyboard.push([{ text: prefix + histEmail, callback_data: "switch_" + index }]);
        });
        await sendTelegramMessage(
          env.BOT_TOKEN,
          chatId,
          `📜 <b>Your Last ${session.history.length} Emails:</b>\n\n<i>Tap on any email to switch to its inbox:</i>\n(🟢 = Active, ⚪️ = Inactive)`,
          { parse_mode: "HTML", reply_markup: { inline_keyboard: inlineKeyboard } }
        );
      }
    } else if (text === "/myemail" || text === "ℹ️ My Email") {
      if (!session.email) {
        await sendTelegramMessage(env.BOT_TOKEN, chatId, "❌ No active email. Create one first.", { reply_markup: mainKeyboard() });
      } else {
        const encodedEmail = btoa(session.email);
        const webLink = `${FRONTEND_URL}?email=${encodeURIComponent(encodedEmail)}`;
        await sendTelegramMessage(
          env.BOT_TOKEN,
          chatId,
          `📧 <b>Your current email:</b>\n<code>${session.email}</code>\n\n🌐 <a href="${webLink}">Open Inbox in Web Browser</a>`,
          { parse_mode: "HTML", reply_markup: mainKeyboard(), disable_web_page_preview: true }
        );
      }
    } else if (text === "/inbox" || text === "📥 Inbox") {
      if (!session.email) {
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
      if (!session.email) {
        await sendTelegramMessage(env.BOT_TOKEN, chatId, "❌ No active email to delete.", { reply_markup: mainKeyboard() });
      } else {
        try {
          await fetch(`${apiBase}/api/messages?email=${encodeURIComponent(session.email)}`, { method: "DELETE" });
        } catch (err) {}
        
        session.history = session.history.filter(e => e !== session.email);
        session.email = session.history.length > 0 ? session.history[0] : null;
        session.messages = [];
        await env.KV_SESSIONS.put(chatId.toString(), JSON.stringify(session));
        
        await sendTelegramMessage(
          env.BOT_TOKEN,
          chatId,
          `🗑 <b>Email deleted successfully!</b>\n\nUse New Mail to generate a fresh one.`,
          { parse_mode: "HTML", reply_markup: mainKeyboard() }
        );
      }
    } else if (/^\d+$/.test(text)) {
      const index = parseInt(text) - 1;
      if (!session.email) {
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
            const otpLine = otp ? `\n🔐 <b>OTP Detected:</b> <code>${escapeHtml(otp)}</code> <i>(Tap to copy)</i>\n` : "";
            const safeSubject = escapeHtml(full.subject || "(No subject)");

            await sendTelegramMessage(
              env.BOT_TOKEN,
              chatId,
              `📩 <b>Email #${index + 1}</b>\n\n<b>From:</b> <code>${escapeHtml(full.from_address)}</code>\n<b>Subject:</b> ${safeSubject}\n<b>Date:</b> ${new Date(full.received_at.replace(" ", "T") + "Z").toLocaleString("en-BD", { timeZone: "Asia/Dhaka" })}${otpLine}`,
              { parse_mode: "HTML" }
            );
            await sendTelegramMessage(env.BOT_TOKEN, chatId, `─────────────────\n${escapeHtml(rawBody)}`, { parse_mode: "HTML", disable_web_page_preview: true, reply_markup: mainKeyboard() });
          }
        } catch (err) {
          await sendTelegramMessage(env.BOT_TOKEN, chatId, "⚠️ Error fetching email.", { reply_markup: mainKeyboard() });
        }
      }
    } else {
      await sendTelegramMessage(env.BOT_TOKEN, chatId, "💡 Use the buttons below.", { reply_markup: mainKeyboard() });
    }
  } catch (err) {
  }

  return new Response("OK", { status: 200 });
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
};
