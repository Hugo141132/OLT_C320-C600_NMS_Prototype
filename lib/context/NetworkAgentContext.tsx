'use client'

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react'

export type ConnectionState = 'MATCH' | 'MISMATCH' | 'NO_CONNECTION' | 'LOADING' | 'NO_PROFILE'

interface AgentState {
  connectionState: ConnectionState
  verifiedOltId: string | null
  detectedOltId: string | null
  activeIp: string | null
}

interface NetworkAgentContextType extends AgentState {
  isAgentReady: boolean
}

const NetworkAgentContext = createContext<NetworkAgentContextType>({
  connectionState: 'NO_CONNECTION',
  verifiedOltId: null,
  detectedOltId: null,
  activeIp: null,
  isAgentReady: false
})

export const useNetworkAgent = () => useContext(NetworkAgentContext)

export function NetworkAgentProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AgentState>({
    connectionState: 'NO_CONNECTION',
    verifiedOltId: null,
    detectedOltId: null,
    activeIp: null
  })
  const [isAgentReady, setIsAgentReady] = useState(false)

  useEffect(() => {
    let ws: WebSocket
    let reconnectTimer: NodeJS.Timeout
    let stateResetTimer: NodeJS.Timeout
    let reconnectDelay = 1000
    const maxDelay = 10000

    const connect = () => {
      console.log(`Connecting to Network Agent (Attempt delay: ${reconnectDelay}ms)...`)
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      ws = new WebSocket(`${protocol}//${window.location.host}/ws/global-state`)

      ws.onopen = () => {
        console.log('Connected to Live Network Agent WS')
        setIsAgentReady(true)
        reconnectDelay = 1000 // Reset delay on success
        clearTimeout(stateResetTimer) // Cancel any pending state reset
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'agent_state_update') {
            setState({
              connectionState: data.state,
              verifiedOltId: data.activeOltId,
              detectedOltId: data.detectedOltId,
              activeIp: data.activeIp
            })
          }
        } catch (e) {
          console.error("Failed to parse agent state update", e)
        }
      }

      ws.onclose = () => {
        console.log('Disconnected from Live Network Agent WS')
        setIsAgentReady(false)
        
        // Don't clear state immediately to prevent UI flickering on brief drops
        // Wait 1.5 seconds before showing the 'No Connection' UI
        stateResetTimer = setTimeout(() => {
          setState({
            connectionState: 'NO_CONNECTION',
            verifiedOltId: null,
            detectedOltId: null,
            activeIp: null
          })
        }, 2500)
        
        // Exponential backoff for reconnection
        reconnectTimer = setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 2, maxDelay)
          connect()
        }, reconnectDelay)
      }
      
      ws.onerror = (err) => {
         // Use warn instead of error to prevent Next.js dev overlay when backend is offline
         console.warn('Network Agent WS: Connection failed or error occurred')
      }
    }

    connect()

    return () => {
      clearTimeout(reconnectTimer)
      if (ws) {
        ws.close()
      }
    }
  }, [])

  return (
    <NetworkAgentContext.Provider value={{ ...state, isAgentReady }}>
      {children}
    </NetworkAgentContext.Provider>
  )
}
