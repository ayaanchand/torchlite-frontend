export const maxDuration = 30

export async function POST(req: Request) {
  try {
    console.log("Chat API starting...")
    const { messages, chatId } = await req.json()
    const latestMessage = messages[messages.length - 1]

    if (!process.env.RAG_BACKEND_URL) {
      throw new Error("RAG_BACKEND_URL environment variable is not set")
    }

    // Clean and validate the URL (base only — no path)
    let cleanUrl = process.env.RAG_BACKEND_URL.trim()
    if (cleanUrl.includes("->")) cleanUrl = cleanUrl.split("->")[0].trim()
    if (cleanUrl.includes(" ") && !cleanUrl.includes("://")) cleanUrl = cleanUrl.split(" ")[0].trim()
    try { new URL(cleanUrl) } catch { throw new Error(`Invalid RAG_BACKEND_URL format: "${cleanUrl}"`) }

    // ✅ single endpoint (FastAPI)
    const endpoint = `${cleanUrl.replace(/\/$/, "")}/api/v1/ask`

    console.log("Trying chat endpoint:", endpoint)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.RAG_API_KEY && { Authorization: `Bearer ${process.env.RAG_API_KEY}` }),
      },
      body: JSON.stringify({
        query: latestMessage.content,
        question: latestMessage.content,        // backend accepts either
        history: messages.slice(0, -1),         // send convo history
        chat_id: chatId,
      }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)
    console.log(`Response from ${endpoint}: ${response.status}`)

    if (!response.ok) {
      const errorText = await response.text()
      if (
        errorText.includes("ERR_NGROK_3200") ||
        errorText.includes("ngrok-free.app is offline") ||
        (errorText.includes("ngrok") && errorText.includes("offline"))
      ) {
        throw new Error("NGROK_OFFLINE: Your ngrok tunnel is not running or has expired")
      }
      throw new Error(`${response.status} - ${errorText.substring(0, 200)}`)
    }

    // -------- parse backend response --------
    const rawResponse = await response.text()
    console.log("Raw response:", rawResponse.substring(0, 300))

    // ⬇️ NEW: collect all URLs from backend text (keep order, de-dupe)
    const allUrls: string[] = Array.from(
      new Set((rawResponse.match(/https?:\/\/[^\s)\]]+/gi) || []))
    )

    let answerText = ""
    const emojiAnswerMatch = rawResponse.match(/🟢\s*Answer:\s*(.*?)(?=⏱️|$)/s)
    if (emojiAnswerMatch) {
      answerText = emojiAnswerMatch[1].trim()
    } else {
      try {
        const data = JSON.parse(rawResponse)
        if (data.answer !== undefined) answerText = data.answer
        else if (data.response !== undefined) answerText = data.response
        else if (data.result !== undefined) answerText = data.result
        else if (data.text !== undefined) answerText = data.text
        else if (typeof data === "string") answerText = data
        else answerText = JSON.stringify(data)
      } catch {
        answerText = rawResponse
      }
    }

    // strip labels/sources/timers (but DO NOT strip URLs)
    answerText = answerText.replace(/^(Answer|Ans|A):\s*/i, "").trim()
    answerText = answerText.replace(/^🟢\s*(Answer|Ans|A):\s*/i, "").trim()
    answerText = answerText.replace(/\s*Sources?:\s*.*$/is, "").trim()
    answerText = answerText.replace(/\s*📄\s*.*$/is, "").trim()
    answerText = answerText.replace(/\s*Top\s*\d*\s*sources?:.*$/is, "").trim()
    // ❌ removed the line that stripped trailing URLs
    answerText = answerText.replace(/⏱️.*$/g, "").trim()

    const cleanAnswer = answerText
      .replace(/^["']|["']$/g, "")
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .trim()

    // ⬇️ NEW: append multiple clickable links (Markdown)
    const linksSuffix =
      allUrls.length > 0
        ? "\n\n" + allUrls.map((u, i) => `[Source ${i + 1}](${u})`).join("  ")
        : ""

    const finalAnswer = cleanAnswer + linksSuffix

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        const out =
          finalAnswer || "I couldn't find a specific answer to your question. Please try rephrasing or ask about something else."
        const words = out.split(" ")
        let index = 0
        const tick = () => {
          if (index < words.length) {
            controller.enqueue(
              encoder.encode(`0:${JSON.stringify({ type: "text-delta", textDelta: words[index] + (index < words.length - 1 ? " " : "") })}\n`)
            )
            index++
            setTimeout(tick, 30)
          } else {
            controller.close()
          }
        }
        tick()
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8", // keep as-is; UI likely renders Markdown
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    })
  } catch (error) {
    console.error("Chat error:", error)
    let errorMessage = "Failed to connect to knowledge base"
    let details = error instanceof Error ? error.message : "Unknown error"
    if (details.includes("NGROK_OFFLINE")) {
      errorMessage = "ngrok tunnel is offline"
      details = "Your ngrok tunnel has stopped or expired. Please restart ngrok and update the URL."
    }
    return new Response(JSON.stringify({ error: errorMessage, details, url: process.env.RAG_BACKEND_URL || "Not set" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }
};
