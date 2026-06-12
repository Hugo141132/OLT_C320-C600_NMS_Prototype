'use client'

/**
 * useSerialConnection — React hook for communicating with the 
 * local OLT-WEB Hardware Agent (Python/FastAPI backend).
 *
 * Provides:
 *  - Port scanning and connection status polling
 *  - REST-based connect/disconnect
 *  - WebSocket terminal I/O (raw keystroke forwarding)
 */

import { useState, useEffect, useRef, useCallback } from 'react'

const API_BASE = ''
const WS_URL = typeof window !== 'undefined' ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/terminal` : ''

// ── Types ──────────────────────────────────────────────────────────────

export interface DetectedPort {
  device: string
  description: string
  adapter_name: string
  vid?: number
  pid?: number
}

export interface ConnectionStatus {
  is_connected: boolean
  port: string | null
  baudrate: number
  olt_type: string
  adapter_name: string
  error: string | null
  detected_ports: DetectedPort[]
}

export interface UseSerialConnectionReturn {
  // State
  status: ConnectionStatus
  backendOnline: boolean
  terminalOutput: string
  isConnecting: boolean

  // Actions
  scanPorts: () => Promise<DetectedPort[]>
  connect: (port: string, baudrate: number, oltType: string) => Promise<ConnectionStatus>
  disconnect: () => Promise<void>
  sendInput: (data: string) => void
  refreshStatus: () => Promise<void>
  clearTerminal: () => void

  // WebSocket lifecycle
  openTerminalWs: (opts?: { onWarning?: (msg: string) => void }) => void
  closeTerminalWs: () => void
  wsConnected: boolean
}

// ── Hook ───────────────────────────────────────────────────────────────

export function useSerialConnection(): UseSerialConnectionReturn {
  const [status, setStatus] = useState<ConnectionStatus>({
    is_connected: false,
    port: null,
    baudrate: 9600,
    olt_type: 'c600',
    adapter_name: '',
    error: null,
    detected_ports: [],
  })
  const [backendOnline, setBackendOnline] = useState(false)
  const [terminalOutput, setTerminalOutput] = useState('')
  const [isConnecting, setIsConnecting] = useState(false)
  const [wsConnected, setWsConnected] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const statusPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const onWarningRef = useRef<((msg: string) => void) | undefined>(undefined)

  // ── Status Polling ─────────────────────────────────────────────────

  const refreshStatus = useCallback(async () => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 3000)

    try {
      const res = await fetch(`${API_BASE}/api/status`, { 
        signal: controller.signal 
      })
      clearTimeout(timeoutId)
      if (res.ok) {
        const data: ConnectionStatus = await res.json()
        setStatus(data)
        setBackendOnline(true)
      } else {
        setBackendOnline(false)
      }
    } catch (err) {
      clearTimeout(timeoutId)
      setBackendOnline(false)
    }
  }, [])

  // Poll status every 3 seconds
  useEffect(() => {
    refreshStatus()
    statusPollRef.current = setInterval(refreshStatus, 3000)
    return () => {
      if (statusPollRef.current) clearInterval(statusPollRef.current)
    }
  }, [refreshStatus])

  // ── REST Actions ───────────────────────────────────────────────────

  const scanPorts = useCallback(async (): Promise<DetectedPort[]> => {
    try {
      const res = await fetch(`${API_BASE}/api/ports`)
      if (res.ok) {
        const ports: DetectedPort[] = await res.json()
        // Also refresh full status
        await refreshStatus()
        return ports
      }
    } catch {
      // backend offline
    }
    return []
  }, [refreshStatus])

  const connect = useCallback(async (
    port: string,
    baudrate: number,
    oltType: string,
  ): Promise<ConnectionStatus> => {
    setIsConnecting(true)
    try {
      const res = await fetch(`${API_BASE}/api/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port, baudrate, olt_type: oltType }),
      })
      const data: ConnectionStatus = await res.json()
      setStatus(data)

      // If connected, signal the WS to start reading
      if (data.is_connected && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'start_read' }))
      }

      setTerminalOutput('')

      return data
    } catch (err) {
      const errorStatus: ConnectionStatus = {
        ...status,
        is_connected: false,
        error: 'Backend unreachable',
      }
      setStatus(errorStatus)
      return errorStatus
    } finally {
      setIsConnecting(false)
    }
  }, [status])

  const disconnect = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/disconnect`, { method: 'POST' })
      if (res.ok) {
        const data: ConnectionStatus = await res.json()
        setStatus(data)
        setTerminalOutput('')
      }
    } catch {
      // best effort
    }
  }, [])

  // ── WebSocket Terminal ─────────────────────────────────────────────

  const openTerminalWs = useCallback((opts?: { onWarning?: (msg: string) => void }) => {
    if (opts?.onWarning) {
      onWarningRef.current = opts.onWarning
    }
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return

    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      setWsConnected(true)
      // If already serial-connected, tell backend to start reading
      if (status.is_connected) {
        ws.send(JSON.stringify({ type: 'start_read' }))
      }
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        switch (msg.type) {
          case 'output':
            setTerminalOutput((prev) => prev + msg.data)
            break
          case 'warning':
            if (onWarningRef.current) {
              onWarningRef.current(msg.message)
            }
            break
          case 'disconnect':
            refreshStatus()
            break
          case 'error':
            // Optionally display errors in terminal
            setTerminalOutput((prev) => prev + `\r\n[Error] ${msg.message}\r\n`)
            break
          case 'pong':
            break
        }
      } catch {
        // raw text fallback
        setTerminalOutput((prev) => prev + event.data)
      }
    }

    ws.onclose = () => {
      setWsConnected(false)
      // Auto-reconnect after 2s if not intentionally closed
      reconnectTimerRef.current = setTimeout(() => {
        if (wsRef.current === ws) {
          openTerminalWs()
        }
      }, 2000)
    }

    ws.onerror = () => {
      setWsConnected(false)
    }
  }, [status.is_connected, refreshStatus])

  const closeTerminalWs = useCallback(() => {
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
    if (wsRef.current) {
      const ws = wsRef.current
      wsRef.current = null // prevent auto-reconnect
      ws.close()
    }
    setWsConnected(false)
  }, [])

  const sendInput = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'input', data }))
    }
  }, [])

  const clearTerminal = useCallback(() => {
    setTerminalOutput('')
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      closeTerminalWs()
      if (statusPollRef.current) clearInterval(statusPollRef.current)
    }
  }, [closeTerminalWs])

  return {
    status,
    backendOnline,
    terminalOutput,
    isConnecting,
    scanPorts,
    connect,
    disconnect,
    sendInput,
    refreshStatus,
    clearTerminal,
    openTerminalWs,
    closeTerminalWs,
    wsConnected,
  }
}
