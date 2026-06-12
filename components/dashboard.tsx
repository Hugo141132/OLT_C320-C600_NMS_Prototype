'use client'

import { useState, useEffect } from 'react'

import { Upload, Loader2, AlertCircle, WifiOff } from 'lucide-react'
import OLTSelector from './olt-selector'
import { useNetworkAgent } from '@/lib/context/NetworkAgentContext'



interface DashboardProps {
  userRole: 'admin' | 'guest'
  onNavigateToONUList?: (status: string) => void
  selectedOLT: string
  onOLTChange: (oltId: string) => void
}

export default function Dashboard({ userRole, onNavigateToONUList, selectedOLT, onOLTChange }: DashboardProps) {
  const { connectionState } = useNetworkAgent()
  const isLoading = connectionState === 'LOADING'
  const isMatch = connectionState === 'MATCH'

  
  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6">
      {/* Top Action Bar */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <h2 className="text-3xl md:text-4xl font-extrabold text-white tracking-tight drop-shadow-sm">
            OLT <span className="text-red-500">Info</span>
          </h2>
          <div className="flex flex-wrap gap-2">
            {isLoading && (
              <div className="flex items-center gap-2 px-3 py-1 bg-blue-500/10 text-blue-400 rounded-full border border-blue-500/20 backdrop-blur-md text-xs font-bold uppercase tracking-widest animate-pulse">
                <Loader2 className="animate-spin" size={12} />
                Scanning Hardware
              </div>
            )}
            {connectionState === 'MISMATCH' && (
              <div className="flex items-center gap-2 px-3 py-1 bg-amber-500/10 text-amber-400 rounded-full border border-amber-500/20 backdrop-blur-md text-xs font-bold uppercase tracking-widest">
                <AlertCircle size={12} />
                Identity Mismatch
              </div>
            )}
            {connectionState === 'NO_PROFILE' && (
              <div className="flex items-center gap-2 px-3 py-1 bg-purple-500/10 text-purple-400 rounded-full border border-purple-500/20 backdrop-blur-md text-xs font-bold uppercase tracking-widest">
                <AlertCircle size={12} />
                Profile Missing
              </div>
            )}
            {connectionState === 'NO_CONNECTION' && (
              <div className="flex items-center gap-2 px-3 py-1 bg-white/5 text-white/40 rounded-full border border-white/10 backdrop-blur-md text-xs font-bold uppercase tracking-widest animate-pulse">
                <Loader2 className="animate-spin" size={12} />
                Establishing Bridge
              </div>
            )}
          </div>
        </div>
      </div>

      {/* OLT Hardware Selector Section */}
      <OLTSelector selectedOLT={selectedOLT} onOLTChange={onOLTChange} />


    </div>
  )
}

