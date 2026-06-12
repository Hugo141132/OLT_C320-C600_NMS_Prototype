'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, Wifi, WifiOff, Settings } from 'lucide-react'
import { useNetworkAgent } from '@/lib/context/NetworkAgentContext'

interface OLTModel {
  id: string
  name: string
  image: string
  description: string
}

export const oltModels: OLTModel[] = [
  {
    id: 'c600',
    name: 'ZTE C600',
    image: '/images/olt/c600.png',
    description: 'Ultra-large capacity OLT'
  },
  {
    id: 'c300',
    name: 'ZTE C300',
    image: '/images/olt/c300.png',
    description: 'Large capacity OLT'
  },
  {
    id: 'c320',
    name: 'ZTE C320',
    image: '/images/olt/c320.png',
    description: 'Compact 2U OLT'
  }
]

interface OLTSelectorProps {
  selectedOLT?: string
  onOLTChange?: (oltId: string) => void
  variant?: 'compact' | 'full' | 'form'
}

interface OLTPerformance {
  temperature: number | null
  thresholds: {
    low: number | null
    high: number | null
    critical: number | null
  }
  uptime: string
  ip: string
  olt_type: string
}

export default function OLTSelector({ 
  selectedOLT: externalSelectedOLT, 
  onOLTChange,
  variant = 'full'
}: OLTSelectorProps = {}) {
  const [internalSelectedOLT, setInternalSelectedOLT] = useState<string>('c600')
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const selectedOLT = externalSelectedOLT ?? internalSelectedOLT

  const [vitals, setVitals] = useState<OLTPerformance | null>(null)
  
  const { connectionState, activeIp } = useNetworkAgent()
  
  useEffect(() => {
    if (externalSelectedOLT) {
      setInternalSelectedOLT(externalSelectedOLT)
    }
  }, [externalSelectedOLT])

  useEffect(() => {
    // [GHOST DATA FIX] Immediately clear vitals on any OLT switch
    setVitals(null)

    // Notify the backend of the currently selected OLT on mount/change
    fetch('/api/agent/switch-target', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ olt_id: selectedOLT }),
      credentials: 'include'
    }).catch(e => console.warn('SyncAgent notification failed:', e.message))
    
    // Save to localStorage for session persistence
    localStorage.setItem('last_selected_olt_type', selectedOLT)

    // Vitals polling - ONLY on Dashboard (full variant)
    if (variant !== 'full') return
    
    // Initial vitals fetch
    const fetchVitals = async () => {
      // Don't fetch while switching or if agent is verifying identity
      if (connectionState === 'LOADING') return 

      try {
        const res = await fetch('/api/agent/vitals', {
          credentials: 'include'
        })
        if (res.ok) {
          const data = await res.json()
          setVitals(data)
        }
      } catch (e) {
        console.warn('Vitals fetch failed:', e)
      }
    }
    
    fetchVitals()
    const interval = setInterval(fetchVitals, 10000)
    return () => clearInterval(interval)
  }, [selectedOLT])
  
  const handleOLTChange = (oltId: string) => {
    setInternalSelectedOLT(oltId)
    setVitals(null) // Reset vitals while switching
    onOLTChange?.(oltId)
    setIsDropdownOpen(false)
  }
  
  const currentOLT = oltModels.find(olt => olt.id === selectedOLT) || oltModels[0]

  // Compact Variant (Just the dropdown)
  if (variant === 'compact') {
    return (
      <div className="relative inline-block">
        <button
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          className="flex items-center gap-2 px-3 py-1.5 bg-white border border-red-200 rounded-lg shadow-sm hover:border-red-400 transition-colors min-w-[140px] justify-between text-sm"
        >
          <span className="font-medium text-gray-900">{currentOLT.name}</span>
          <ChevronDown size={14} className={`text-gray-500 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
        </button>
        
        {isDropdownOpen && (
          <div className="absolute right-0 mt-2 w-full bg-white border border-red-200 rounded-lg shadow-lg z-50 overflow-hidden min-w-[140px]">
            {oltModels.map((olt) => (
              <button
                key={olt.id}
                onClick={() => handleOLTChange(olt.id)}
                className={`w-full px-3 py-2 text-left hover:bg-red-50 transition-colors flex items-center justify-between text-sm ${
                  selectedOLT === olt.id ? 'bg-red-50 text-red-600' : 'text-gray-700'
                }`}
              >
                <span className="font-medium">{olt.name}</span>
                {selectedOLT === olt.id && (
                  <div className="w-1.5 h-1.5 bg-red-600 rounded-full"></div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Form Variant (Matches input fields)
  if (variant === 'form') {
    return (
      <div className="relative w-full">
        <button
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          className={`flex items-center gap-2 w-full px-4 py-2.5 bg-white border rounded-lg shadow-sm transition-all justify-between text-gray-900 ${
            isDropdownOpen ? 'border-emerald-500 ring-2 ring-emerald-500/20' : 'border-gray-300 hover:border-gray-400'
          }`}
        >
          <span className="font-medium">{currentOLT.name}</span>
          <ChevronDown size={18} className={`text-gray-500 transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`} />
        </button>
        
        {isDropdownOpen && (
          <div className="absolute right-0 left-0 mt-2 w-full bg-white border border-gray-200 rounded-lg shadow-xl z-[100] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {oltModels.map((olt) => (
              <button
                key={olt.id}
                onClick={() => handleOLTChange(olt.id)}
                className={`w-full px-4 py-2.5 text-left hover:bg-emerald-50 transition-colors flex items-center justify-between ${
                  selectedOLT === olt.id ? 'bg-emerald-50 text-emerald-600 font-bold' : 'text-gray-700'
                }`}
              >
                <span className="font-medium">{olt.name}</span>
                {selectedOLT === olt.id && (
                  <div className="w-2 h-2 bg-emerald-600 rounded-full"></div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Full Variant (Dashboard Style)
  return (
    <div className="space-y-6">
      {/* Active OLT Hardware View Section */}
      <div className="bg-white/10 backdrop-blur-2xl border border-white/20 rounded-2xl shadow-2xl overflow-hidden group">
        {/* Header with Dropdown */}
        <div className="bg-white/5 px-6 py-4 border-b border-white/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-600 rounded-lg shadow-lg shadow-red-600/20">
              <Wifi size={20} className="text-white" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Hardware Control Center</h3>
              <div className="flex items-center gap-2 mt-0.5">
                {connectionState === 'MATCH' && (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 uppercase tracking-widest">
                    <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" /> Live Connected
                  </span>
                )}
                {connectionState === 'MISMATCH' && (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-amber-400 uppercase tracking-widest">
                    <div className="w-1.5 h-1.5 bg-amber-400 rounded-full" /> ID Mismatch
                  </span>
                )}
                {connectionState === 'LOADING' && (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-blue-400 uppercase tracking-widest">
                    <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-ping" /> Synchronizing...
                  </span>
                )}
              </div>
            </div>
          </div>
          
          {/* Dropdown Selector */}
          <div className="relative w-full sm:w-auto">
            <button
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="flex items-center gap-3 px-4 py-2.5 bg-white/10 border border-white/10 rounded-xl shadow-inner hover:bg-white/20 transition-all w-full sm:min-w-[200px] justify-between group"
            >
              <span className="font-bold text-white">{currentOLT.name}</span>
              <ChevronDown size={18} className={`text-white/60 transition-transform duration-300 ${isDropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            
            {isDropdownOpen && (
              <div className="absolute right-0 mt-2 w-full bg-[#1a1a1a]/95 backdrop-blur-2xl border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {oltModels.map((olt) => (
                  <button
                    key={olt.id}
                    onClick={() => handleOLTChange(olt.id)}
                    className={`w-full px-4 py-3 text-left hover:bg-white/10 transition-colors flex items-center justify-between group ${
                      selectedOLT === olt.id ? 'bg-white/10 text-white' : 'text-white/60'
                    }`}
                  >
                    <span className="font-medium group-hover:translate-x-1 transition-transform">{olt.name}</span>
                    {selectedOLT === olt.id && (
                      <div className="w-1.5 h-1.5 bg-red-500 rounded-full shadow-[0_0_8px_rgba(239,68,68,0.8)]"></div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Content - Responsive Layout */}
        <div className="p-4 sm:p-8 grid grid-cols-1 lg:grid-cols-5 gap-12 items-center">
          {/* OLT Image with floor reflection */}
          <div className="lg:col-span-3 flex justify-center relative order-1">
            {/* Floor Glow - Hidden on mobile to prevent overlap */}
            <div className="absolute bottom-0 w-4/5 h-4 bg-red-600/20 blur-2xl rounded-[100%] hidden sm:block" />
            
            <div className="relative w-full max-w-[100px] sm:max-w-xs lg:max-w-sm h-12 sm:h-40 lg:h-48 flex items-center justify-center group">
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentOLT.id}
                  initial={{ opacity: 0, scale: 0.9, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -10 }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                  className="relative flex items-center justify-center w-full h-full"
                >
                  <Image
                    src={currentOLT.image}
                    alt={currentOLT.name}
                    width={500}
                    height={400}
                    className={`object-contain drop-shadow-[0_10px_20px_rgba(0,0,0,0.3)] mix-blend-multiply brightness-110 contrast-110 transition-transform duration-700 ${
                      currentOLT.id === 'c600' || currentOLT.id === 'c300' ? 'scale-[0.75]' : ''
                    }`}
                    priority
                  />
                  <div className={`absolute -bottom-12 sm:-bottom-16 w-full h-full opacity-10 [mask-image:linear-gradient(to_bottom,transparent,black)] pointer-events-none scale-y-[-1] hidden sm:block ${
                      currentOLT.id === 'c600' || currentOLT.id === 'c300' ? 'scale-[0.75]' : ''
                    }`}>
                    <Image
                      src={currentOLT.image}
                      alt={currentOLT.name}
                      width={500}
                      height={400}
                      className="object-contain mix-blend-multiply"
                    />
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

          <div className="lg:col-span-2 space-y-4 sm:space-y-6 order-2">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentOLT.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="space-y-4 sm:space-y-6"
              >
                <div className="p-5 bg-white/5 rounded-2xl border border-white/10 space-y-4 group">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-white/80 uppercase tracking-widest">Hardware Vitality</span>
                    <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-[10px] font-bold rounded-md border border-emerald-500/30">OPTIMAL</span>
                  </div>
                  
                  <div className="flex flex-col items-center">
                    {/* Premium Thermal Gauge (USD 1k Look) */}
                    <div className="relative w-full max-w-[200px] aspect-[1.5/1] flex items-center justify-center">
                      <svg className="w-full h-full drop-shadow-[0_0_15px_rgba(16,185,129,0.2)]" viewBox="0 0 100 65">
                        {/* Track */}
                        <path
                          d="M 10 55 A 40 40 0 0 1 90 55"
                          fill="none"
                          stroke="rgba(255,255,255,0.05)"
                          strokeWidth="10"
                          strokeLinecap="round"
                        />
                        {/* Active Progress */}
                        <path
                          d="M 10 55 A 40 40 0 0 1 90 55"
                          fill="none"
                          stroke="url(#premiumTempGradient)"
                          strokeWidth="10"
                          strokeLinecap="round"
                          strokeDasharray={`${((vitals?.temperature || 0) / 100) * 126} 126`}
                          className="transition-all duration-1000 ease-in-out"
                        />
                        
                        {/* Alarm Indicators (Strategic Markers) */}
                        <circle cx="18" cy="45" r="1.5" fill="#3b82f6" className={vitals && vitals.temperature !== null && vitals.thresholds.low !== null && vitals.temperature <= vitals.thresholds.low ? "animate-pulse" : ""} />
                        <circle cx="72" cy="24" r="1.5" fill="#f59e0b" className={vitals && vitals.temperature !== null && vitals.thresholds.high !== null && vitals.temperature >= vitals.thresholds.high ? "animate-pulse" : ""} />
                        <circle cx="86" cy="42" r="1.5" fill="#ef4444" className={vitals && vitals.temperature !== null && vitals.thresholds.critical !== null && vitals.temperature >= vitals.thresholds.critical ? "animate-pulse" : ""} />

                        <defs>
                          <linearGradient id="premiumTempGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="#3b82f6" />
                            <stop offset="30%" stopColor="#10b981" />
                            <stop offset="70%" stopColor="#f59e0b" />
                            <stop offset="100%" stopColor="#ef4444" />
                          </linearGradient>
                        </defs>
                      </svg>
                      
                      {/* Digital Readout */}
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 translate-y-[-5%] text-center">
                        <AnimatePresence mode="wait">
                          <motion.span 
                            key={vitals?.temperature}
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -5 }}
                            className="text-4xl font-black text-white tracking-tighter inline-block"
                          >
                            {vitals?.temperature !== undefined && vitals?.temperature !== null ? vitals?.temperature : '-'}
                          </motion.span>
                        </AnimatePresence>
                        <span className="text-sm text-white/60 ml-0.5">°C</span>
                        <div className="text-[8px] font-bold text-white/50 uppercase tracking-[0.3em] mt-[-5px]">Thermal Core</div>
                      </div>
                    </div>

                    {/* Alarm Threshold Legends */}
                    <div className="grid grid-cols-3 w-full gap-1 mt-4 px-2">
                      <div className="text-center">
                        <p className="text-[8px] text-blue-400 font-bold uppercase">Low</p>
                        <p className="text-[10px] text-white/80">{vitals?.thresholds.low !== null ? `${vitals?.thresholds.low}°C` : '-'}</p>
                      </div>
                      <div className="text-center border-x border-white/5">
                        <p className="text-[8px] text-amber-400 font-bold uppercase">High</p>
                        <p className="text-[10px] text-white/80">{vitals?.thresholds.high !== null ? `${vitals?.thresholds.high}°C` : '-'}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[8px] text-red-500 font-bold uppercase tracking-tighter">Critical</p>
                        <p className="text-[10px] text-white/80">{vitals?.thresholds.critical !== null ? `${vitals?.thresholds.critical}°C` : '-'}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                    <p className="text-[10px] font-bold text-white/80 uppercase mb-1">Management IP</p>
                    <AnimatePresence mode="wait">
                      <motion.p 
                        key={activeIp}
                        initial={{ opacity: 0, x: 5 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="text-sm font-mono text-white tracking-wider"
                      >
                        {activeIp || '—'}
                      </motion.p>
                    </AnimatePresence>
                  </div>
                  <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                    <p className="text-[10px] font-bold text-white/80 uppercase mb-1">System Uptime</p>
                    <AnimatePresence mode="wait">
                      <motion.p 
                        key={vitals?.uptime}
                        initial={{ opacity: 0, x: 5 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="text-sm font-mono text-white"
                      >
                        {vitals?.uptime || '—'}
                      </motion.p>
                    </AnimatePresence>
                  </div>
                </div>
                
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  )
}
