export async function POST(req: Request) {
  try {
    const { conversation } = await req.json()

    // Simple title generation based on conversation content
    const userMessage = conversation.split("\n")[0].replace("User: ", "")

    // Extract key topics and generate a concise title
    const message = userMessage.toLowerCase()

    // AstroLabs specific topics
    if (message.includes("company") || message.includes("companies")) {
      return Response.json({ title: "Company Information" })
    }
    if (message.includes("license") || message.includes("licensing")) {
      return Response.json({ title: "Licensing Questions" })
    }
    if (message.includes("ksa") || message.includes("saudi")) {
      return Response.json({ title: "KSA Operations" })
    }
    if (message.includes("uae") || message.includes("dubai")) {
      return Response.json({ title: "UAE Setup" })
    }
    if (message.includes("visa") || message.includes("visas")) {
      return Response.json({ title: "Visa Requirements" })
    }
    if (message.includes("setup") || message.includes("establish")) {
      return Response.json({ title: "Business Setup" })
    }
    if (message.includes("cost") || message.includes("price") || message.includes("fee")) {
      return Response.json({ title: "Costs & Pricing" })
    }
    if (message.includes("document") || message.includes("documents")) {
      return Response.json({ title: "Documentation" })
    }
    if (message.includes("process") || message.includes("procedure")) {
      return Response.json({ title: "Process Inquiry" })
    }
    if (message.includes("time") || message.includes("duration")) {
      return Response.json({ title: "Timeline Questions" })
    }
    if (message.includes("requirement") || message.includes("requirements")) {
      return Response.json({ title: "Requirements" })
    }
    if (message.includes("astrolabs") || message.includes("summer") || message.includes("ai")) {
      return Response.json({ title: "AstroLabs Program" })
    }

    // Fallback to first few words
    const words = userMessage.split(" ").slice(0, 4).join(" ")
    const title = words.length > 30 ? words.substring(0, 30) + "..." : words

    return Response.json({ title })
  } catch (error) {
    return Response.json({ title: "New Chat" }, { status: 500 })
  }
}
