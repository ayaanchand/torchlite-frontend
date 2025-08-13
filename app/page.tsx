"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { MessageSquare, Plus, Send, User, Zap, Menu, X, Database, AlertCircle } from "lucide-react"

interface ChatSession {
  id: string
  title: string
  lastMessage: string
  timestamp: Date
  messages: Message[]
}

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
}

interface ConnectionStatus {
  status: "connected" | "disconnected" | "checking"
  error?: string
  troubleshooting?: string[]
  url?: string
  hasApiKey?: boolean
}

export default function TorchliteChat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [connectionInfo, setConnectionInfo] = useState<ConnectionStatus>({ status: "checking" })
  const [currentChatId, setCurrentChatId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const [chatSessions, setChatSessions] = useState<ChatSession[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Check RAG backend connection on mount
  useEffect(() => {
    checkBackendConnection()
  }, [])

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const checkBackendConnection = async () => {
    try {
      const response = await fetch("/api/health", { method: "GET" })
      const data = await response.json()
      setConnectionInfo(data)
    } catch (error) {
      setConnectionInfo({
        status: "disconnected",
        error: "Failed to check connection status",
        troubleshooting: ["Check browser console for errors", "Verify Next.js server is running"],
      })
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value)
  }

  const generateChatTitle = async (firstMessage: string, assistantResponse: string): Promise<string> => {
    // Create a smart title based on the conversation context
    const conversationContext = `User: ${firstMessage}\nAssistant: ${assistantResponse.substring(0, 200)}`

    try {
      const response = await fetch("/api/generate-title", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversation: conversationContext,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        return data.title || generateFallbackTitle(firstMessage)
      }
    } catch (error) {
      console.log("Failed to generate AI title, using fallback")
    }

    return generateFallbackTitle(firstMessage)
  }

  const generateFallbackTitle = (firstMessage: string): string => {
    // Extract key topics/entities from the message
    const message = firstMessage.toLowerCase()

    // Common AstroLabs topics
    if (message.includes("company") || message.includes("companies")) return "Company Information"
    if (message.includes("license") || message.includes("licensing")) return "Licensing Questions"
    if (message.includes("ksa") || message.includes("saudi")) return "KSA Operations"
    if (message.includes("uae") || message.includes("dubai")) return "UAE Setup"
    if (message.includes("visa") || message.includes("visas")) return "Visa Requirements"
    if (message.includes("setup") || message.includes("establish")) return "Business Setup"
    if (message.includes("cost") || message.includes("price") || message.includes("fee")) return "Costs & Pricing"
    if (message.includes("document") || message.includes("documents")) return "Documentation"
    if (message.includes("process") || message.includes("procedure")) return "Process Inquiry"
    if (message.includes("time") || message.includes("duration")) return "Timeline Questions"
    if (message.includes("requirement") || message.includes("requirements")) return "Requirements"
    if (message.includes("astrolabs") || message.includes("summer") || message.includes("ai"))
      return "AstroLabs Program"

    // Fallback to first few words
    const words = firstMessage.split(" ").slice(0, 4).join(" ")
    return words.length > 30 ? words.substring(0, 30) + "..." : words
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input,
    }

    const isFirstMessage = messages.length === 0
    let chatId = currentChatId

    // If this is the first message in a new chat, create a new chat session
    if (!currentChatId) {
      chatId = Date.now().toString()
      const newChat: ChatSession = {
        id: chatId,
        title: "New Chat", // Temporary title
        lastMessage: input,
        timestamp: new Date(),
        messages: [userMessage],
      }
      setChatSessions((prev) => [newChat, ...prev])
      setCurrentChatId(chatId)
    } else {
      // Update existing chat session with new user message
      setChatSessions((prev) =>
        prev.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                messages: [...chat.messages, userMessage],
                lastMessage: input,
                timestamp: new Date(),
              }
            : chat,
        ),
      )
    }

    setMessages((prev) => [...prev, userMessage])
    setInput("")
    setIsLoading(true)

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [...messages, userMessage].map((msg) => ({
            role: msg.role,
            content: msg.content,
          })),
          chatId: chatId, // Send chat ID for backend context
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.details || errorData.error || `Server returned ${response.status}`)
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "",
      }

      setMessages((prev) => [...prev, assistantMessage])

      const reader = response.body?.getReader()
      if (!reader) throw new Error("No response stream")

      const decoder = new TextDecoder()
      let buffer = ""
      let fullAssistantResponse = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""

        for (const line of lines) {
          if (line.startsWith("0:")) {
            try {
              const data = JSON.parse(line.slice(2))
              if (data.type === "text-delta" && data.textDelta) {
                fullAssistantResponse += data.textDelta
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessage.id ? { ...msg, content: msg.content + data.textDelta } : msg,
                  ),
                )
              }
            } catch (parseError) {
              console.warn("Failed to parse streaming data:", line)
            }
          }
        }
      }

      // Update the final assistant message
      const finalAssistantMessage = { ...assistantMessage, content: fullAssistantResponse }

      // Update the chat session with the final assistant message
      setChatSessions((prev) =>
        prev.map((chat) =>
          chat.id === chatId ? { ...chat, messages: [...chat.messages, finalAssistantMessage] } : chat,
        ),
      )

      // Generate smart title for new chats after getting the first response
      if (isFirstMessage && fullAssistantResponse) {
        const smartTitle = await generateChatTitle(userMessage.content, fullAssistantResponse)
        setChatSessions((prev) => prev.map((chat) => (chat.id === chatId ? { ...chat, title: smartTitle } : chat)))
      }

      setConnectionInfo((prev) => ({ ...prev, status: "connected" }))
    } catch (error) {
      console.error("Chat Error:", error)
      setConnectionInfo((prev) => ({ ...prev, status: "disconnected" }))
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `I'm having trouble accessing the AstroLabs knowledge base. ${error instanceof Error ? error.message : "Please check the connection and try again."}`,
      }
      setMessages((prev) => [...prev, errorMessage])

      // Update chat session with error message
      if (chatId) {
        setChatSessions((prev) =>
          prev.map((chat) => (chat.id === chatId ? { ...chat, messages: [...chat.messages, errorMessage] } : chat)),
        )
      }
    } finally {
      setIsLoading(false)
    }
  }

  const startNewChat = () => {
    setMessages([])
    setInput("")
    setCurrentChatId(null)
    setSidebarOpen(false) // Close sidebar on mobile after starting new chat
  }

  const loadChat = (chatId: string) => {
    const chat = chatSessions.find((c) => c.id === chatId)
    if (chat) {
      setMessages([...chat.messages]) // Create a copy to avoid reference issues
      setCurrentChatId(chatId)
      setSidebarOpen(false) // Close sidebar on mobile after selecting chat
    }
  }

  const formatTime = (date: Date) => {
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const minutes = Math.floor(diff / (1000 * 60))
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))

    if (minutes < 1) return "Just now"
    if (minutes < 60) return `${minutes}m ago`
    if (hours < 24) return `${hours}h ago`
    return `${days}d ago`
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          style={{
            backdropFilter: "blur(4px)",
            WebkitBackdropFilter: "blur(4px)",
            backgroundColor: "rgba(0, 0, 0, 0.1)",
          }}
        />
      )}

      {/* Sidebar */}
      <div
        className={`
        fixed lg:static inset-y-0 left-0 z-50 w-80 bg-white border-r border-gray-200 transform transition-transform duration-300 ease-in-out
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
      `}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-700 rounded-lg flex items-center justify-center">
                <Zap className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="font-bold text-lg text-gray-900">Torchlite</h1>
                <p className="text-xs text-gray-500">AstroLabs AI Assistant</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => setSidebarOpen(false)}>
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* Connection Status */}
          <div className="px-4 py-2 border-b border-gray-100">
            <div className="flex items-center space-x-2 text-xs">
              <Database className="w-3 h-3" />
              <span
                className={`font-medium ${
                  connectionInfo.status === "connected"
                    ? "text-green-600"
                    : connectionInfo.status === "disconnected"
                      ? "text-red-600"
                      : "text-yellow-600"
                }`}
              >
                Knowledge Base:{" "}
                {connectionInfo.status === "connected"
                  ? "Connected"
                  : connectionInfo.status === "disconnected"
                    ? "Disconnected"
                    : "Checking..."}
              </span>
              {connectionInfo.status === "disconnected" && (
                <Button variant="ghost" size="sm" onClick={checkBackendConnection} className="h-5 px-2 text-xs">
                  Retry
                </Button>
              )}
            </div>

            {/* Connection Debug Info */}
            {connectionInfo.status === "disconnected" && connectionInfo.error && (
              <div className="mt-2 p-2 bg-red-50 rounded text-xs">
                <div className="flex items-start space-x-1">
                  <AlertCircle className="w-3 h-3 text-red-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="font-medium text-red-700">Error:</div>
                    <div className="text-red-600">{connectionInfo.error}</div>
                    {connectionInfo.url && <div className="text-red-600 mt-1">URL: {connectionInfo.url}</div>}
                    {connectionInfo.troubleshooting && connectionInfo.troubleshooting.length > 0 && (
                      <div className="mt-1">
                        <div className="font-medium text-red-700">Check:</div>
                        <ul className="list-disc list-inside text-red-600">
                          {connectionInfo.troubleshooting.map((tip, index) => (
                            <li key={index}>{tip}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* New Chat Button */}
          <div className="p-4">
            <Button
              onClick={startNewChat}
              className="w-full bg-gradient-to-r from-blue-500 to-blue-700 hover:from-blue-600 hover:to-blue-800 text-white"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Chat
            </Button>
          </div>

          {/* Chat History */}
          <ScrollArea className="flex-1 px-4">
            <div className="space-y-2">
              {chatSessions.length > 0 && (
                <>
                  <h3 className="text-sm font-medium text-gray-500 mb-3">Recent Chats</h3>
                  {chatSessions.map((session) => (
                    <div
                      key={session.id}
                      onClick={() => loadChat(session.id)}
                      className={`p-3 rounded-lg cursor-pointer transition-colors ${
                        currentChatId === session.id ? "bg-blue-50 border border-blue-200" : "hover:bg-gray-100"
                      }`}
                    >
                      <div className="flex items-start space-x-3">
                        <MessageSquare className="w-4 h-4 text-gray-400 mt-1 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-medium text-gray-900 truncate">{session.title}</h4>
                          <p className="text-xs text-gray-500 truncate mt-1">{session.lastMessage}</p>
                          <div className="flex items-center justify-between mt-1">
                            <p className="text-xs text-gray-400">{formatTime(session.timestamp)}</p>
                            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                              {session.messages.length} msgs
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </ScrollArea>

          {/* Footer */}
          <div className="p-4 border-t border-gray-200">
            <div className="flex items-center space-x-3">
              <Avatar className="w-8 h-8">
                <AvatarFallback className="bg-blue-100 text-blue-600">
                  <User className="w-4 h-4" />
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">User</p>
                <p className="text-xs text-gray-500">AstroLabs Assistant</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Mobile Header */}
        <div className="lg:hidden flex items-center justify-between p-4 bg-white border-b border-gray-200">
          <Button variant="ghost" size="sm" onClick={() => setSidebarOpen(true)}>
            <Menu className="w-5 h-5" />
          </Button>
          <div className="flex items-center space-x-3">
            <div className="w-6 h-6 bg-gradient-to-br from-blue-500 to-blue-700 rounded flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold text-gray-900">
              {currentChatId ? chatSessions.find((c) => c.id === currentChatId)?.title || "Torchlite" : "Torchlite"}
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={startNewChat}>
            <Plus className="w-4 h-4" />
          </Button>
        </div>

        {/* Messages Area */}
        <ScrollArea className="flex-1 p-4">
          <div className="max-w-4xl mx-auto">
            {messages.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-gradient-to-br from-blue-100 to-blue-200 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Zap className="w-8 h-8 text-blue-600" />
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Welcome to Torchlite</h2>
                <p className="text-gray-600 mb-6 max-w-md mx-auto">Your AI-powered assistant for AstroLabs.</p>

                {/* Show connection warning if disconnected */}
                {connectionInfo.status === "disconnected" && (
                  <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg max-w-md mx-auto">
                    <div className="flex items-center space-x-2 text-yellow-800">
                      <AlertCircle className="w-4 h-4" />
                      <span className="text-sm font-medium">Knowledge base disconnected</span>
                    </div>
                    <p className="text-xs text-yellow-700 mt-1">
                      Please check your RAG backend connection before asking questions.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              messages.map((message, index) => (
                <div
                  key={message.id}
                  className={`flex ${message.role === "user" ? "justify-end" : "justify-start"} ${index > 0 ? "mt-8" : ""}`}
                >
                  {message.role === "user" ? (
                    // User message without avatar
                    <div className="max-w-3xl">
                      <div className="bg-gradient-to-br from-blue-500 to-blue-700 text-white rounded-lg p-4">
                        <div className="prose prose-sm max-w-none">{message.content}</div>
                      </div>
                    </div>
                  ) : (
                    // Assistant message with avatar
                    <div className="flex space-x-3 max-w-3xl">
                      <Avatar className="w-8 h-8 flex-shrink-0">
                        <AvatarFallback className="bg-gray-100 text-gray-600">
                          <Zap className="w-4 h-4" />
                        </AvatarFallback>
                      </Avatar>
                      <div className="bg-white border border-gray-200 rounded-lg p-4">
                        <div className="prose prose-sm max-w-none">{message.content}</div>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
            {isLoading && (
              <div className="flex justify-start mt-8">
                <div className="flex space-x-3 max-w-3xl">
                  <Avatar className="w-8 h-8 flex-shrink-0">
                    <AvatarFallback className="bg-gray-100 text-gray-600">
                      <Zap className="w-4 h-4" />
                    </AvatarFallback>
                  </Avatar>
                  <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <span className="text-sm text-gray-500 italic animate-pulse">Thinking</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* Input Area */}
        <div className="border-t border-gray-200 bg-white p-4">
          <div className="max-w-4xl mx-auto">
            <form onSubmit={handleSubmit} className="flex space-x-3">
              <div className="flex-1 relative">
                <Input
                  value={input}
                  onChange={handleInputChange}
                  placeholder="Ask about AstroLabs processes, licenses, or operations..."
                  className="pr-12 py-3 text-base border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                  disabled={isLoading}
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={!input.trim() || isLoading}
                  className="absolute right-2 top-1/2 transform -translate-y-1/2 bg-gradient-to-r from-blue-500 to-blue-700 hover:from-blue-600 hover:to-blue-800 text-white"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </form>
            <p className="text-xs text-gray-500 mt-2 text-center">
              Torchlite searches AstroLabs knowledge base. Verify important information independently.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
