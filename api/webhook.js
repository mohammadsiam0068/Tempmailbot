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

function escapeMarkdown(text) {
  return (text || "").replace(/[_*`[\]()~>#+=|{}.!-]/g, "\\$&");
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

  try {
    const update = await request.json();
    if (!update.message || !update.message.text) {
      return new Response("OK", { status: 200 });
    }

    const chatId = update.message.chat.id;
    const text = update.message.text.trim();
    const firstName = update.message.from.first_name || "there";

    const apiBase = env.TEMPMAIL_API_URL || "https://tempmail-ao8.pages.dev";
    
    const defaultDomains = "echoinbox.eu.cc,echomail.eu.cc,echotemp.eu.cc,mailecho.eu.cc,mailr.eu.cc,mailrly.eu.cc,multisms.eu.cc,tapmail.eu.cc,telegramtg.eu.cc";
    const domains = (env.TEMPMAIL_DOMAINS || defaultDomains)
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);

    let session = await env.KV_SESSIONS.get(chatId.toString(), "json");

    if (text === "/start") {
      await sendTelegramMessage(
        env.BOT_TOKEN,
        chatId,
        `👋 *Welcome, ${escapeMarkdown(firstName)}!*\n\n📬 I'm your *Temp Mail Bot* — get disposable email addresses instantly!\n\nUse the buttons below:`,
        { parse_mode: "Markdown", reply_markup: mainKeyboard() }
      );
    } else if (text === "/help" || text === "❓ Help") {
      await sendTelegramMessage(
        env.BOT_TOKEN,
        chatId,
        `🤖 *Temp Mail Bot — Help*\n\n📧 New Mail — Generate a new disposable email\n📥 Inbox — Check received emails\nℹ️ My Email — Show your current email\n🗑 Delete — Delete current email session\n\n_Reply with a number to read that email._`,
        { parse_mode: "Markdown", reply_markup: mainKeyboard() }
      );
    } else if (text === "/newmail" || text === "📧 New Mail") {
      const domain = domains[Math.floor(Math.random() * domains.length)];
      const email = `${randomString(10)}@${domain}`;
      session = { email, messages: [] };
      await env.KV_SESSIONS.put(chatId.toString(), JSON.stringify(session));
      await sendTelegramMessage(
        env.BOT_TOKEN,
        chatId,
        `✅ *Your Temp Email is Ready!*\n\n📧 \`${email}\`\n\n👆 Tap to copy!`,
        { parse_mode: "Markdown", reply_markup: mainKeyboard() }
      );
    } else if (text === "/myemail" || text === "ℹ️ My Email") {
      if (!session) {
        await sendTelegramMessage(env.BOT_TOKEN, chatId, "❌ No active email. Create one first.", { reply_markup: mainKeyboard() });
      } else {
        await sendTelegramMessage(
          env.BOT_TOKEN,
          chatId,
          `📧 *Your current email:*\n\`${session.email}\``,
          { parse_mode: "Markdown", reply_markup: mainKeyboard() }
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
              `📭 *Inbox is empty.*\n\nNo emails received yet for:\n\`${session.email}\``,
              { parse_mode: "Markdown", reply_markup: mainKeyboard() }
            );
          } else {
            session.messages = messages;
            await env.KV_SESSIONS.put(chatId.toString(), JSON.stringify(session));
            const inboxText =
              `📬 *You have ${messages.length} email(s):*\n\n` +
              messages
                .map(
                  (m, i) =>
                    `*${i + 1}.* 📩 From: \`${escapeMarkdown(m.from_address)}\`\n    📌 Subject: ${escapeMarkdown(m.subject || "(No subject)")}\n    🕐 ${new Date(m.received_at.replace(" ", "T") + "Z").toLocaleString("en-BD", { timeZone: "Asia/Dhaka" })}`
                )
                .join("\n\n") +
              `\n\nReply with the number (1, 2, 3...) to read a message`;
            await sendTelegramMessage(env.BOT_TOKEN, chatId, inboxText, { parse_mode: "Markdown", reply_markup: mainKeyboard() });
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
          `🗑 *Email deleted successfully!*\n\nUse New Mail to generate a fresh one.`,
          { parse_mode: "Markdown", reply_markup: mainKeyboard() }
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
            const otpLine = otp ? `\n🔐 OTP Detected: \`${otp}\`\n` : "";
            const safeSubject = escapeMarkdown(full.subject || "(No subject)");

            await sendTelegramMessage(
              env.BOT_TOKEN,
              chatId,
              `📩 *Email #${index + 1}*\n\n*From:* \`${full.from_address}\`\n*Subject:* ${safeSubject}\n*Date:* ${new Date(full.received_at.replace(" ", "T") + "Z").toLocaleString("en-BD", { timeZone: "Asia/Dhaka" })}${otpLine}`,
              { parse_mode: "Markdown" }
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
  } catch (err) {
  }

  return new Response("OK", { status: 200 });
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
};
