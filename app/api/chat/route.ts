export const maxDuration = 30

export async function POST(req: Request) {
  try {
    console.log("Chat API starting...")
    const { messages, chatId } = await req.json()
    const latestMessage = messages[messages.length - 1]

    if (!process.env.RAG_BACKEND_URL) {
      throw new Error("RAG_BACKEND_URL environment variable is not set")
    }

    // Clean and validate the URL
    let cleanUrl = process.env.RAG_BACKEND_URL.trim()
    if (cleanUrl.includes("->")) {
      cleanUrl = cleanUrl.split("->")[0].trim()
    }
    if (cleanUrl.includes(" ") && !cleanUrl.includes("://")) {
      cleanUrl = cleanUrl.split(" ")[0].trim()
    }

    try {
      new URL(cleanUrl)
    } catch (urlError) {
      throw new Error(`Invalid RAG_BACKEND_URL format: "${cleanUrl}"`)
    }

    const endpointsToTry = [
      cleanUrl.replace(/\/$/, "") + "/api/v1/ask",
      cleanUrl.replace(/\/$/, "") + "/ask",
      cleanUrl.replace(/\/$/, "") + "/chat",
      cleanUrl.replace(/\/$/, "") + "/query",
      cleanUrl.replace(/\/$/, "") + "/api/chat",
      cleanUrl, // Original cleaned URL last
    ]

    let lastError = null

    for (const endpoint of endpointsToTry) {
      try {
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
            question: latestMessage.content, // Some APIs expect 'question' instead
            history: messages.slice(0, -1), // Send conversation history to backend
            chat_id: chatId, // Send chat ID for backend session management
          }),
          signal: controller.signal,
        })

        clearTimeout(timeoutId)
        console.log(`Response from ${endpoint}: ${response.status}`)

        // Check for ngrok offline error
        if (!response.ok) {
          const errorText = await response.text()

          // Detect ngrok offline error (ERR_NGROK_3200)
          if (
            errorText.includes("ERR_NGROK_3200") ||
            (errorText.includes("endpoint") && errorText.includes("is offline")) ||
            errorText.includes("ngrok-free.app is offline") ||
            (errorText.includes("ngrok") && errorText.includes("offline"))
          ) {
            throw new Error("NGROK_OFFLINE: Your ngrok tunnel is not running or has expired")
          }

          lastError = { endpoint, status: response.status, error: errorText.substring(0, 200) }
          continue
        }

        // Process successful response
        const rawResponse = await response.text()
        console.log("Raw response:", rawResponse.substring(0, 300))

        let answerText = ""

        // Handle the specific format from your RAG backend
        // Format: 🟢 Answer:AstroLabs currently hosts more than 130 companies.⏱️ retrieval: 2.29s...
        const emojiAnswerMatch = rawResponse.match(/🟢\s*Answer:\s*(.*?)(?=⏱️|$)/s)
        if (emojiAnswerMatch) {
          answerText = emojiAnswerMatch[1].trim()
          console.log("Extracted from emoji format:", answerText)
        } else {
          // Try JSON parsing as fallback
          try {
            const data = JSON.parse(rawResponse)
            console.log("Parsed JSON data:", data)

            if (data.answer !== undefined) {
              answerText = data.answer
            } else if (data.response !== undefined) {
              answerText = data.response
            } else if (data.result !== undefined) {
              answerText = data.result
            } else if (data.text !== undefined) {
              answerText = data.text
            } else if (typeof data === "string") {
              answerText = data
            } else {
              answerText = JSON.stringify(data)
            }
          } catch (parseError) {
            console.log("Failed to parse as JSON, using raw response")
            answerText = rawResponse
          }
        }

        // Remove "Answer:" prefix if it exists (case insensitive, with various formats)
        answerText = answerText.replace(/^(Answer|Ans|A):\s*/i, "").trim()
        answerText = answerText.replace(/^🟢\s*(Answer|Ans|A):\s*/i, "").trim()

        // Remove sources section completely - everything after "Sources:"
        answerText = answerText.replace(/\s*Sources?:\s*.*$/is, "").trim()

        // Remove sources section with different patterns
        answerText = answerText.replace(/\s*📄\s*.*$/is, "").trim()
        answerText = answerText.replace(/\s*Top\s*\d*\s*sources?:.*$/is, "").trim()

        // Remove any trailing URLs or source references
        answerText = answerText.replace(/\s*https?:\/\/[^\s]*$/g, "").trim()
        answerText = answerText.replace(/\s*\|\s*→\s*.*$/g, "").trim()

        // Remove timing information like "⏱️ retrieval: 2.29s"
        answerText = answerText.replace(/⏱️.*$/g, "").trim()

        console.log("Final extracted answer:", answerText.substring(0, 200))

        // Clean up the answer text
        const cleanAnswer = answerText
          .replace(/^["']|["']$/g, "") // Remove surrounding quotes
          .replace(/\\n/g, "\n") // Convert escaped newlines
          .replace(/\\"/g, '"') // Convert escaped quotes
          .trim()

        console.log("Final clean answer:", cleanAnswer.substring(0, 200))

        // Stream the response without sources
        const encoder = new TextEncoder()
        const stream = new ReadableStream({
          start(controller) {
            if (!cleanAnswer) {
              controller.enqueue(
                encoder.encode(
                  `0:${JSON.stringify({
                    type: "text-delta",
                    textDelta: "I couldn't find an answer to your question. Please try rephrasing.",
                  })}\n`,
                ),
              )
              controller.close()
              return
            }

            const words = cleanAnswer.split(" ")
            let index = 0

            const streamWord = () => {
              if (index < words.length) {
                const word = words[index] + (index < words.length - 1 ? " " : "")
                controller.enqueue(
                  encoder.encode(
                    `0:${JSON.stringify({
                      type: "text-delta",
                      textDelta: word,
                    })}\n`,
                  ),
                )
                index++
                setTimeout(streamWord, 30)
              } else {
                controller.close()
              }
            }

            streamWord()
          },
        })

        return new Response(stream, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        })
      } catch (fetchError) {
        if (fetchError instanceof Error && fetchError.message.includes("NGROK_OFFLINE")) {
          throw fetchError
        }

        lastError = {
          endpoint,
          error: fetchError instanceof Error ? fetchError.message : "Unknown error",
        }
      }
    }

    throw new Error(`All endpoints failed. Last: ${lastError?.endpoint} - ${lastError?.error}`)
  } catch (error) {
    console.error("Chat error:", error)

    let errorMessage = "Failed to connect to knowledge base"
    let details = "Unknown error"

    if (error instanceof Error) {
      if (error.message.includes("NGROK_OFFLINE")) {
        errorMessage = "ngrok tunnel is offline"
        details = "Your ngrok tunnel has stopped or expired. Please restart ngrok and update the URL."
      } else {
        details = error.message
      }
    }

    return new Response(
      JSON.stringify({
        error: errorMessage,
        details: details,
        url: process.env.RAG_BACKEND_URL || "Not set",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    )
  }
}
