export async function GET() {
  try {
    console.log("Health check starting...")
    if (!process.env.RAG_BACKEND_URL) {
      throw new Error("RAG_BACKEND_URL environment variable is not set")
    }

    // Clean base URL
    let cleanUrl = process.env.RAG_BACKEND_URL.trim()
    if (cleanUrl.includes("->")) cleanUrl = cleanUrl.split("->")[0].trim()
    if (cleanUrl.includes(" ") && !cleanUrl.includes("://")) {
      cleanUrl = cleanUrl.split(" ")[0].trim()
    }

    // Validate URL
    let backendUrl: URL
    try {
      backendUrl = new URL(cleanUrl)
      console.log("Parsed URL - Protocol:", backendUrl.protocol, "Host:", backendUrl.host, "Path:", backendUrl.pathname)
    } catch {
      throw new Error(`Invalid RAG_BACKEND_URL format after cleaning: "${cleanUrl}". Check your .env.local.`)
    }

    const base = cleanUrl.replace(/\/$/, "")
    // Try most likely endpoints first
    const endpointsToTry = [
      `${base}/api/v1/ask`, // FastAPI common pattern
      `${base}/ask`,
      `${base}/api/chat`,
      `${base}/chat`,
      `${base}/query`,
      `${base}/health`,
      base, // root last
    ]

    let lastError: any = null

    for (const endpoint of endpointsToTry) {
      try {
        const isGet = /\/(health|docs|openapi\.json)$/.test(endpoint)
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 8000)

        const resp = await fetch(endpoint, {
          method: isGet ? "GET" : "POST",
          headers: {
            ...(isGet ? {} : { "Content-Type": "application/json" }),
            ...(process.env.RAG_API_KEY && { Authorization: `Bearer ${process.env.RAG_API_KEY}` }),
          },
          body: isGet
            ? undefined
            : JSON.stringify({
                query: "test connection",
                question: "test connection",
              }),
          signal: controller.signal,
        })

        clearTimeout(timeoutId)
        console.log(`Response from ${endpoint}: ${resp.status}`)

        // Check for ngrok offline error
        if (!resp.ok) {
          const errorText = await resp.text()

          // Detect ngrok offline error (ERR_NGROK_3200)
          if (
            errorText.includes("ERR_NGROK_3200") ||
            (errorText.includes("endpoint") && errorText.includes("is offline")) ||
            errorText.includes("ngrok-free.app is offline") ||
            (errorText.includes("ngrok") && errorText.includes("offline"))
          ) {
            throw new Error("NGROK_OFFLINE: Your ngrok tunnel is not running or has expired")
          }

          // Detect other ngrok errors
          if (errorText.includes("ngrok") && errorText.includes("Visit Site")) {
            throw new Error(
              "NGROK_WARNING: ngrok is showing a warning page. You may need to add ngrok-skip-browser-warning header or visit the URL in browser first",
            )
          }

          lastError = { endpoint, status: resp.status, error: errorText.substring(0, 200) }
          continue
        }

        const data = await resp.text()
        return new Response(
          JSON.stringify({
            status: "connected",
            url: endpoint,
            originalUrl: process.env.RAG_BACKEND_URL,
            cleanedUrl: cleanUrl,
            hasApiKey: !!process.env.RAG_API_KEY,
            responsePreview: data.substring(0, 120),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      } catch (e: any) {
        // Handle specific ngrok errors
        if (e?.message?.includes("NGROK_OFFLINE")) {
          throw e
        }
        if (e?.message?.includes("NGROK_WARNING")) {
          throw e
        }

        lastError = { endpoint, error: e?.message ?? "Unknown error" }
        console.log(`Failed to connect to ${endpoint}:`, lastError.error)
      }
    }

    throw new Error(
      `All endpoints failed. Last error from ${lastError?.endpoint}: ${lastError?.status ? `${lastError.status} - ` : ""}${lastError?.error}`,
    )
  } catch (error: any) {
    console.error("Health check error details:", {
      name: error?.name ?? "Unknown",
      message: error?.message ?? "Unknown error",
      cause: error?.cause,
    })

    const troubleshooting: string[] = []
    let errorMessage = "Unknown error"

    if (error?.message?.includes("NGROK_OFFLINE")) {
      errorMessage = "ngrok tunnel is offline"
      troubleshooting.push("Your ngrok tunnel has stopped or expired")
      troubleshooting.push("Start your ngrok tunnel: ngrok http 8000 (or your backend port)")
      troubleshooting.push("Copy the new HTTPS URL from ngrok output")
      troubleshooting.push("Update RAG_BACKEND_URL in .env.local with the new URL")
      troubleshooting.push("Restart your Next.js server")
    } else if (error?.message?.includes("NGROK_WARNING")) {
      errorMessage = "ngrok warning page detected"
      troubleshooting.push("Visit your ngrok URL in a browser first to dismiss the warning")
      troubleshooting.push("Or add 'ngrok-skip-browser-warning: true' header to requests")
    } else if (error?.message?.includes("Invalid RAG_BACKEND_URL format")) {
      errorMessage = "Invalid URL format in .env.local"
      troubleshooting.push("Set RAG_BACKEND_URL to the base URL only, e.g. https://xxxx.ngrok-free.app")
    } else if (error?.name === "AbortError") {
      errorMessage = "Connection timeout"
      troubleshooting.push("Check if your RAG backend is running")
      troubleshooting.push("Verify ngrok tunnel is active")
    } else if (error?.message?.includes("All endpoints failed")) {
      errorMessage = "No valid endpoint found"
      troubleshooting.push("Make sure your RAG backend is running on the correct port")
      troubleshooting.push("Check that ngrok is tunneling to the right local port")
      troubleshooting.push("Verify your backend exposes an API endpoint")
    } else {
      errorMessage = error?.message ?? "Unknown error"
    }

    return new Response(
      JSON.stringify({
        status: "disconnected",
        error: errorMessage,
        troubleshooting,
        originalUrl: process.env.RAG_BACKEND_URL || "Not set",
        hasApiKey: !!process.env.RAG_API_KEY,
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    )
  }
}
