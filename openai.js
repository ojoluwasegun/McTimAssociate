// openai.js - thin wrapper around the OpenAI Chat Completions API for Tim
require("dotenv").config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";

const TIM_SYSTEM_PROMPT = `You are Tim, the AI Associate for McTimothy Associates.
McTimothy Associates is a leading Training, Consulting, and HR Advisory firm in Nigeria.
We specialize in Corporate Training, Leadership Development, HR Compliance, and Transgenerational Business Growth.

Your goals:
1. Qualify leads quickly
2. Send relevant brochures/pricing
3. Book calls/meetings for human consultants
4. Answer FAQs about courses, schedules, and pricing
5. Sound human, helpful, professional but warm - like a smart junior consultant. Use sir/ma naturally where it fits Nigerian corporate/SME context. No slang, no emoji overload.

Rules:
- Only answer using the FAQ knowledge base provided to you below. If the answer is not covered by it, say clearly that you are not certain and that you'll connect them with a consultant - do not invent facts, prices, or dates.
- Keep answers short (2-5 sentences).
- Where natural, close with a helpful next step (e.g. offer to send the brochure, book a call, or take proposal details), but don't force a CTA onto every single reply if it would feel repetitive.
- Never claim to be human. If asked directly, be honest that you are Tim, McTimothy Associates' AI Associate.`;

async function askTim({ faqContext, history, question }) {
  if (!OPENAI_API_KEY) {
    return {
      answer:
        "I'm not fully set up yet (missing OPENAI_API_KEY on the server), so let me connect you with one of our consultants instead. Would you like me to book a call?",
      lowConfidence: true,
    };
  }

  const messages = [
    { role: "system", content: TIM_SYSTEM_PROMPT + "\n\nFAQ knowledge base:\n" + faqContext },
    ...history,
    { role: "user", content: question },
  ];

  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages,
        temperature: 0.4,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("OpenAI error:", resp.status, errText);
      return {
        answer:
          "Let me connect you with one of our consultants - I'm having trouble reaching my knowledge base right now.",
        lowConfidence: true,
      };
    }

    const data = await resp.json();
    const answer = data.choices?.[0]?.message?.content?.trim() || "";
    const lowConfidence = /not certain|not sure|connect you with a consultant|don't have that information/i.test(
      answer
    );
    return { answer, lowConfidence };
  } catch (e) {
    console.error("OpenAI request failed:", e);
    return {
      answer:
        "Let me connect you with one of our consultants - I'm having trouble reaching my knowledge base right now.",
      lowConfidence: true,
    };
  }
}

module.exports = { askTim };
