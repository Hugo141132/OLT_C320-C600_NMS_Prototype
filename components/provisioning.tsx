'use client'

import { useState, useEffect } from 'react'
import { Network, Settings, User, Radio, Plus, Check, AlertCircle, Trash2, WifiOff, Loader2, RefreshCw, X, ShieldCheck, Activity, Wifi } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNetworkAgent } from '@/lib/context/NetworkAgentContext'
import OLTSelector from './olt-selector'
const API_BASE = ''

interface ProvisioningProps {
  page: 'vlan' | 'onu-profile' | 'tcont-profile'
  selectedOLT: string
  onOLTChange: (oltId: string) => void
}

interface VlanEntry {
  id: number
  vlanId: number
  name: string
  description: string
}

interface OnuProfileEntry {
  id: number
  oltId: string
  oltName: string
  profileName: string
  mode: string
  vlanId: string
  priority: string
}

interface TcontEntry {
  id: number
  oltId: string
  oltName: string
  profileName: string
  currentUsed: number
  type: number
  fbw: number
  abw: number
  mbw: number
}

const oltOptions = [
  { id: 'c600', name: 'ZTE C600' },
  { id: 'c300', name: 'ZTE C300' },
  { id: 'c320', name: 'ZTE C320' },
]

function NetworkStatusIsland() {
  const { connectionState, activeIp, detectedOltId } = useNetworkAgent()
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    if (connectionState === 'MATCH') {
      const timer = setTimeout(() => setVisible(false), 3000)
      return () => clearTimeout(timer)
    } else {
      setVisible(true)
    }
  }, [connectionState])
  
  const stateConfig = {
    MATCH: {
      color: 'bg-emerald-500/10',
      border: 'border-emerald-500/20',
      text: 'text-emerald-600',
      icon: <ShieldCheck size={16} className="text-emerald-500" />,
      label: 'Connected',
      glow: 'shadow-emerald-500/20'
    },
    LOADING: {
      color: 'bg-blue-500/10',
      border: 'border-blue-500/20',
      text: 'text-blue-600',
      icon: <Activity size={16} className="text-blue-500 animate-pulse" />,
      label: 'Syncing OLT...',
      glow: 'shadow-blue-500/20'
    },
    NO_CONNECTION: {
      color: 'bg-red-500/10',
      border: 'border-red-500/20',
      text: 'text-red-600',
      icon: <WifiOff size={16} className="text-red-500" />,
      label: 'Agent Offline',
      glow: 'shadow-red-500/20'
    },
    MISMATCH: {
      color: 'bg-amber-500/10',
      border: 'border-amber-500/20',
      text: 'text-amber-600',
      icon: <AlertCircle size={16} className="text-amber-500" />,
      label: 'ID Mismatch',
      glow: 'shadow-amber-500/20'
    },
    NO_PROFILE: {
      color: 'bg-gray-500/10',
      border: 'border-gray-500/20',
      text: 'text-gray-600',
      icon: <Settings size={16} className="text-gray-500" />,
      label: 'No Profile',
      glow: 'shadow-gray-500/10'
    }
  }

  const current = stateConfig[connectionState] || stateConfig.LOADING

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key={connectionState}
          initial={{ y: -50, opacity: 0, scale: 0.9 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: -50, opacity: 0, scale: 0.9 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          className="fixed top-6 left-1/2 -translate-x-1/2 z-[100]"
        >
          <div className={`
            group relative flex items-center gap-3 px-4 py-2 rounded-full 
            backdrop-blur-xl border ${current.border} ${current.color}
            shadow-[0_0_20px_rgba(0,0,0,0.05),_0_0_0_1px_rgba(255,255,255,0.1)_inset]
            hover:shadow-[0_0_25px_rgba(0,0,0,0.1)] transition-all duration-300
            cursor-default
          `}>
            <div className={`absolute inset-0 rounded-full ${current.glow} blur-md opacity-20 group-hover:opacity-40 transition-opacity`} />
            
            <div className="relative flex items-center gap-2.5">
              <span className="flex items-center justify-center p-1 rounded-full bg-white/40 shadow-sm">
                {current.icon}
              </span>
              <div className="flex flex-col">
                <span className={`text-[11px] font-bold uppercase tracking-wider ${current.text}`}>
                  {current.label}
                </span>
                {activeIp && connectionState === 'MATCH' && (
                  <span className="text-[9px] text-gray-500 font-mono -mt-0.5 opacity-80">
                    {activeIp}
                  </span>
                )}
                {connectionState === 'MISMATCH' && detectedOltId && (
                  <span className="text-[9px] text-red-500 font-mono -mt-0.5">
                    Detected: {detectedOltId.toUpperCase()}
                  </span>
                )}
              </div>
            </div>

            {/* Mini Detail Badge on Hover */}
            <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none translate-y-1 group-hover:translate-y-0 duration-300">
              <div className="bg-gray-900/90 text-white text-[10px] px-3 py-1.5 rounded-lg whitespace-nowrap shadow-xl backdrop-blur-md">
                {connectionState === 'MATCH' ? 'Hardware Verified' : 'Network Agent Control'}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default function Provisioning({ page, selectedOLT, onOLTChange }: ProvisioningProps) {
  const { connectionState } = useNetworkAgent()
  const isMatch = connectionState === 'MATCH'

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6">
      <NetworkStatusIsland />
      {page === 'vlan' && <CreateVlanPage selectedOLT={selectedOLT} onOLTChange={onOLTChange} isMatch={isMatch} />}
      {page === 'onu-profile' && <CreateOnuProfilePage selectedOLT={selectedOLT} onOLTChange={onOLTChange} isMatch={isMatch} />}
      {page === 'tcont-profile' && <CreateTcontProfilePage selectedOLT={selectedOLT} onOLTChange={onOLTChange} isMatch={isMatch} />}
    </div>
  )
}

// ==================== CREATE VLAN PAGE ====================
function CreateVlanPage({ selectedOLT, onOLTChange, isMatch }: { selectedOLT: string, onOLTChange: (oltId: string) => void, isMatch: boolean }) {
  const [vlanId, setVlanId] = useState('')
  const [vlanName, setVlanName] = useState('')
  const [vlanDescription, setVlanDescription] = useState('')
  const [vlans, setVlans] = useState<VlanEntry[]>([])
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [showSuccess, setShowSuccess] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isFetching, setIsFetching] = useState(false)
  const { connectionState } = useNetworkAgent()
  const [editingVlan, setEditingVlan] = useState<VlanEntry | null>(null)
  const [editVlanName, setEditVlanName] = useState('')
  const [editVlanDescription, setEditVlanDescription] = useState('')

  const fetchVlans = async (forceRefresh = false) => {
    if (!isMatch) return
    setIsFetching(true)
    try {
      const res = await fetch(`${API_BASE}/api/provisioning/vlans${forceRefresh ? '?refresh=true' : ''}`, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        const formatted = data.map((v: any, i: number) => ({
          id: i,
          vlanId: v.vlanId,
          name: v.name,
          description: v.description || '-'
        }))
        setVlans(formatted)
      }
    } catch (e) {
      console.warn("Failed to fetch vlans", e)
    } finally {
      setIsFetching(false)
    }
  }

  useEffect(() => {
    if (isMatch) fetchVlans()
    else setVlans([])
  }, [isMatch, selectedOLT])

  // Auto-refresh effect (Fixed 20s like other tables)
  useEffect(() => {
    if (!isMatch) return
    
    const interval = setInterval(() => {
      fetchVlans()
    }, 20000)
    
    return () => clearInterval(interval)
  }, [isMatch, selectedOLT])

  const handleInsert = async () => {
    if (!selectedOLT || !vlanId) return
    
    setIsLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/provisioning/vlans`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          vlan_id: parseInt(vlanId), 
          name: vlanName || undefined,
          description: vlanDescription || undefined
        })
      })
      if (res.ok) {
        setVlanId('')
        setVlanName('')
        setVlanDescription('')
        setShowSuccess(true)
        setTimeout(() => setShowSuccess(false), 3000)
        fetchVlans()
      }
    } catch (e) {
      console.warn("Insert failed", e)
    } finally {
      setIsLoading(false)
    }
  }

  const handleUpdateVlan = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingVlan) return
    setIsLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/provisioning/vlans`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vlan_id: editingVlan.vlanId,
          name: editVlanName,
          description: editVlanDescription
        })
      })
      if (res.ok) {
        setEditingVlan(null)
        fetchVlans()
      }
    } catch (e) {
      console.warn("Update failed", e)
    } finally {
      setIsLoading(false)
    }
  }

  const handleCheckboxChange = (id: number) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    )
  }

  const handleSelectAll = () => {
    if (selectedIds.length === vlans.length && vlans.length > 0) {
      setSelectedIds([])
    } else {
      setSelectedIds(vlans.map(v => v.id))
    }
  }

  const handleDelete = async () => {
    const idsToDelete = vlans.filter(v => selectedIds.includes(v.id)).map(v => v.vlanId)
    if (idsToDelete.length === 0) return
    setIsLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/provisioning/vlans`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vlan_ids: idsToDelete })
      })
      if (res.ok) {
        setSelectedIds([])
        fetchVlans()
      }
    } catch (e) {
      console.warn("Delete failed", e)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-blue-500/20 rounded-lg">
          <Network className="w-6 h-6 text-blue-400" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900">Create VLAN</h2>
      </div>

      {/* Form Card */}
      {/* Form Card */}
      <div className="bg-white/80 backdrop-blur-md border border-gray-200/50 rounded-xl p-6 shadow-lg relative z-20 overflow-visible">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
          {/* Select OLT */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">Select OLT</label>
            <OLTSelector
              selectedOLT={selectedOLT}
              onOLTChange={(newOlt) => {
                onOLTChange(newOlt)
                setSelectedIds([])
              }}
              variant="form"
            />
          </div>

          {/* VLAN ID */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">VLAN ID</label>
            <input
              type="number"
              value={vlanId}
              onChange={(e) => setVlanId(e.target.value)}
              placeholder="Enter VLAN ID (1-4094)"
              min="1"
              max="4094"
              className="w-full px-4 py-2.5 bg-white/90 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all text-gray-900 placeholder:text-gray-400"
            />
          </div>

          {/* VLAN Name */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">Name</label>
            <input
              type="text"
              value={vlanName}
              onChange={(e) => setVlanName(e.target.value)}
              maxLength={32}
              placeholder="e.g. INTERNET"
              className="w-full px-4 py-2.5 bg-white/90 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all text-gray-900 placeholder:text-gray-400"
            />
          </div>

          {/* VLAN Description */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">Description</label>
            <input
              type="text"
              value={vlanDescription}
              onChange={(e) => setVlanDescription(e.target.value)}
              maxLength={64}
              placeholder="e.g. Fiber to Home"
              className="w-full px-4 py-2.5 bg-white/90 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all text-gray-900 placeholder:text-gray-400"
            />
          </div>

          {/* Insert Button */}
          <button
            onClick={handleInsert}
            disabled={!selectedOLT || !vlanId || !isMatch || isLoading}
            className="flex items-center justify-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors shadow-md"
          >
            {isLoading ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />}
            {isLoading ? 'Inserting...' : 'Insert'}
          </button>
        </div>

        {showSuccess && (
          <div className="mt-4 flex items-center gap-2 text-emerald-600 bg-emerald-50 px-4 py-2 rounded-lg">
            <Check size={18} />
            <span className="text-sm font-medium">VLAN added successfully!</span>
          </div>
        )}
      </div>

      {/* Counter per OLT */}
      <div className="grid grid-cols-1 gap-4">
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200/50 rounded-lg px-4 py-3">
          <p className="text-sm font-semibold text-blue-700">
            {oltOptions.find(o => o.id === selectedOLT)?.name || 'Unknown'}: <span className="text-blue-900">{vlans.length} VLANs</span>
          </p>
        </div>
      </div>



      {/* VLAN Table */}
      <div className="bg-white/80 backdrop-blur-md border border-gray-200/50 rounded-xl overflow-hidden shadow-lg">
        <div className="px-4 py-3 bg-gray-50/80 border-b border-gray-200/50 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Registered VLANs {selectedOLT && `(${oltOptions.find(o => o.id === selectedOLT)?.name})`}</h3>
          
          <div className="flex items-center gap-3">
            {/* Manual Refresh Button */}
            <button
              onClick={() => fetchVlans(true)}
              disabled={isFetching || !isMatch}
              className={`p-2 rounded-lg transition-all ${
                isFetching ? 'text-blue-600 bg-blue-50' : 'text-gray-500 hover:text-blue-600 hover:bg-blue-50'
              }`}
              title="Refresh Data"
            >
              <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
            </button>

            {selectedIds.length > 0 && (
              <button
                onClick={handleDelete}
                className="flex items-center gap-2 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg transition-colors shadow-sm"
              >
                <Trash2 size={14} />
                <span className="hidden sm:inline">Delete Selected ({selectedIds.length})</span>
                <span className="sm:hidden">{selectedIds.length}</span>
              </button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-100/80 text-left">
                <th className="px-4 py-3 w-12">
                  <input
                    type="checkbox"
                    checked={vlans.length > 0 && selectedIds.length === vlans.length}
                    onChange={handleSelectAll}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wider">VLAN ID</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wider">Name</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wider max-w-[150px]">Description</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200/50">
              {vlans.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-gray-500">
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4 }}
                      className="flex flex-col items-center justify-center gap-3 py-6 max-w-md mx-auto"
                    >
                      {connectionState === 'LOADING' || isFetching ? (
                        <div className="flex flex-col items-center gap-3 p-6 rounded-2xl bg-blue-50/50 border border-blue-100/50 backdrop-blur-md shadow-sm w-full">
                          <div className="relative">
                            <div className="absolute inset-0 rounded-full bg-blue-500/20 blur-md animate-ping" />
                            <Loader2 size={32} className="relative text-blue-600 animate-spin" />
                          </div>
                          <span className="text-sm font-semibold text-blue-700">Syncing with OLT Hardware...</span>
                          <span className="text-xs text-blue-500/80 -mt-1">Establishing SNMP connection to fetch live data</span>
                        </div>
                      ) : connectionState !== 'MATCH' ? (
                        <div className="flex flex-col items-center gap-3 p-6 rounded-2xl bg-rose-50/50 border border-rose-100/50 backdrop-blur-md shadow-sm w-full">
                          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-rose-100 text-rose-600 shadow-inner">
                            <WifiOff size={24} className="animate-pulse" />
                          </div>
                          <span className="text-sm font-semibold text-rose-700">No Hardware Connection</span>
                          <span className="text-xs text-rose-500/80 -mt-1">Please verify that OLT agent is online and IP is reachable</span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-2 p-6 rounded-2xl bg-gray-50/50 border border-gray-100/50 backdrop-blur-md shadow-sm w-full">
                          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 text-gray-400">
                            <AlertCircle size={24} />
                          </div>
                          <span className="text-sm font-medium text-gray-700">No VLANs Registered Yet</span>
                          <span className="text-xs text-gray-400 -mt-0.5">Use the form above to provision your first VLAN</span>
                        </div>
                      )}
                    </motion.div>
                  </td>
                </tr>
              ) : (
                vlans.map(vlan => (
                  <tr key={vlan.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(vlan.id)}
                        onChange={() => handleCheckboxChange(vlan.id)}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-4 py-3 text-sm font-mono text-gray-900">{vlan.vlanId}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 font-medium">{vlan.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 whitespace-normal break-words max-w-[200px]">{vlan.description}</td>
                    <td className="px-4 py-3 text-sm text-right">
                      <button
                        onClick={() => {
                          setEditingVlan(vlan)
                          setEditVlanName(vlan.name)
                          setEditVlanDescription(vlan.description === '-' ? '' : vlan.description)
                        }}
                        className="text-blue-600 hover:text-blue-800 font-medium px-3 py-1 rounded bg-blue-50 hover:bg-blue-100 transition-colors"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit VLAN Modal */}
      {editingVlan && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md border border-gray-200 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-gray-900">Edit VLAN: {editingVlan.vlanId}</h3>
              <button onClick={() => setEditingVlan(null)} className="text-gray-400 hover:text-gray-600 transition-colors">
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleUpdateVlan} className="space-y-5">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">VLAN Name</label>
                <input
                  type="text"
                  value={editVlanName}
                  onChange={(e) => setEditVlanName(e.target.value)}
                  maxLength={32}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all outline-none"
                  placeholder="e.g. INTERNET"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">Description</label>
                <input
                  type="text"
                  value={editVlanDescription}
                  onChange={(e) => setEditVlanDescription(e.target.value)}
                  maxLength={64}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all outline-none"
                  placeholder="e.g. Fiber to Home"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingVlan(null)}
                  className="flex-1 px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors shadow-md disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isLoading ? <Loader2 className="animate-spin" size={18} /> : <Check size={18} />}
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}


// ==================== CREATE ONU PROFILE PAGE ====================
function CreateOnuProfilePage({ selectedOLT, onOLTChange, isMatch }: { selectedOLT: string, onOLTChange: (oltId: string) => void, isMatch: boolean }) {
  const [formData, setFormData] = useState({
    profileName: '',
    vlanId: '',
    priority: '',
  })
  const [profiles, setProfiles] = useState<OnuProfileEntry[]>([])
  const [vlans, setVlans] = useState<VlanEntry[]>([])
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [showSuccess, setShowSuccess] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isFetching, setIsFetching] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const { connectionState } = useNetworkAgent()
  
  // Edit state
  const [editingProfile, setEditingProfile] = useState<OnuProfileEntry | null>(null)
  const [editFormData, setEditFormData] = useState({ vlanId: '', priority: '' })
  const [isEditing, setIsEditing] = useState(false)

  const fetchProfiles = async (forceRefresh = false) => {
    if (!isMatch) return
    setIsFetching(true)
    try {
      const res = await fetch(`${API_BASE}/api/provisioning/onu-profiles${forceRefresh ? '?refresh=true' : ''}`, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        const formatted = data.map((p: any, i: number) => ({
          id: i,
          oltId: selectedOLT,
          oltName: oltOptions.find(o => o.id === selectedOLT)?.name || '',
          profileName: p.profileName,
          mode: p.mode,
          vlanId: p.vlanId,
          priority: p.priority
        }))
        setProfiles(formatted)
        setErrorMessage(null)
      } else {
        setErrorMessage("Backend failed to retrieve ONU profiles.")
      }
    } catch (e) {
      console.warn("Failed to fetch onu profiles", e)
      setErrorMessage("Network error: Could not reach backend.")
    } finally {
      setIsFetching(false)
    }
  }

  const fetchVlans = async () => {
    if (!isMatch) return
    try {
      const res = await fetch(`${API_BASE}/api/provisioning/vlans`, { credentials: 'include' })
      if (res.ok) {
        setVlans(await res.json())
      }
    } catch (e) {
      console.warn("Failed to fetch vlans", e)
    }
  }

  useEffect(() => {
    if (isMatch) {
      fetchProfiles()
      fetchVlans()
    } else {
      setProfiles([])
      setVlans([])
    }
  }, [isMatch, selectedOLT])

  // Auto-refresh every 60 seconds
  useEffect(() => {
    if (!isMatch) return
    const interval = setInterval(() => {
      fetchProfiles() // Background fetch
      fetchVlans()
    }, 60000)
    return () => clearInterval(interval)
  }, [isMatch, selectedOLT])

  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleCreate = async () => {
    const priority = parseInt(formData.priority)
    if (!selectedOLT || !formData.profileName || !formData.vlanId || isNaN(priority) || priority < 0 || priority > 7) return
    
    setIsLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/provisioning/onu-profiles`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile_name: formData.profileName,
          vlan_id: formData.vlanId,
          priority: formData.priority
        })
      })
      if (res.ok) {
        setShowSuccess(true)
        setTimeout(() => {
          setShowSuccess(false)
          setFormData({ profileName: '', vlanId: '', priority: '' })
        }, 3000)
        fetchProfiles()
      }
    } catch (e) {
      console.warn("Insert failed", e)
    } finally {
      setIsLoading(false)
    }
  }

  const handleCheckboxChange = (id: number) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    )
  }

  const handleSelectAll = () => {
    if (selectedIds.length === profiles.length && profiles.length > 0) {
      setSelectedIds([])
    } else {
      setSelectedIds(profiles.map(p => p.id))
    }
  }

  const handleDelete = async () => {
    const profilesToDelete = profiles.filter(p => selectedIds.includes(p.id))
    if (profilesToDelete.length === 0 || !isMatch) return

    setIsLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/provisioning/onu-profiles`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile_names: profilesToDelete.map(p => p.profileName)
        })
      })
      if (res.ok) {
        setSelectedIds([])
        fetchProfiles()
      }
    } catch (e) {
      console.warn("Delete failed", e)
    } finally {
      setIsLoading(false)
    }
  }

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingProfile || !isMatch) return

    const vlan = parseInt(editFormData.vlanId)
    const prio = parseInt(editFormData.priority)

    if (isNaN(vlan) || vlan < 1 || vlan > 4094 || isNaN(prio) || prio < 0 || prio > 7) {
      alert("Invalid VLAN (1-4094) or Priority (0-7)")
      return
    }

    setIsEditing(true)
    try {
      const res = await fetch(`${API_BASE}/api/provisioning/onu-profiles`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile_name: editingProfile.profileName,
          vlan_id: editFormData.vlanId,
          priority: editFormData.priority
        })
      })
      if (res.ok) {
        setEditingProfile(null)
        fetchProfiles(true)
        fetchVlans()
      } else {
        const err = await res.json()
        alert(err.detail || "Failed to update profile")
      }
    } catch (e) {
      console.warn("Edit failed", e)
      alert("Network error: Could not reach backend")
    } finally {
      setIsEditing(false)
    }
  }

  const isValid = selectedOLT && formData.profileName && formData.vlanId && formData.priority

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-emerald-500/20 rounded-lg">
          <User className="w-6 h-6 text-emerald-400" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900">Create ONU Profile</h2>
      </div>

      {/* Form Card */}
      {/* Form Card */}
      <div className="bg-white/80 backdrop-blur-md border border-gray-200/50 rounded-xl p-6 shadow-lg relative z-20 overflow-visible">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
          {/* Select OLT */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">Select OLT</label>
            <OLTSelector
              selectedOLT={selectedOLT}
              onOLTChange={(newOlt) => {
                onOLTChange(newOlt)
                setSelectedIds([])
              }}
              variant="form"
            />
          </div>

          {/* Profile Name */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">Profile Name</label>
            <input
              type="text"
              value={formData.profileName}
              onChange={(e) => handleChange('profileName', e.target.value)}
              placeholder="e.g., FTTH_HOME"
              className="w-full px-4 py-2.5 bg-white/90 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all text-gray-900 placeholder:text-gray-400"
            />
          </div>

          {/* VLAN ID Dropdown */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">VLAN ID</label>
            <select
              value={formData.vlanId}
              onChange={(e) => handleChange('vlanId', e.target.value)}
              className="w-full px-4 py-2.5 bg-white/90 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all text-gray-900"
            >
              <option value="">-- Select VLAN --</option>
              {vlans.map((v) => (
                <option key={v.vlanId} value={v.vlanId}>
                  {v.vlanId} - {v.name}
                </option>
              ))}
            </select>
          </div>

          {/* Priority */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">Priority</label>
            <select
              value={formData.priority}
              onChange={(e) => handleChange('priority', e.target.value)}
              className="w-full px-4 py-2.5 bg-white/90 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all text-gray-900"
            >
              <option value="">-- Priority --</option>
              {[0, 1, 2, 3, 4, 5, 6, 7].map(num => (
                <option key={num} value={num}>{num}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Create Button */}
        <div className="mt-6 flex items-center gap-4">
          <button
            onClick={handleCreate}
            disabled={!isValid || !isMatch || isLoading}
            className="flex items-center justify-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors shadow-md"
          >
            {isLoading ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />}
            {isLoading ? 'Creating...' : 'Create Profile'}
          </button>

          {showSuccess && (
            <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 px-4 py-2 rounded-lg">
              <Check size={18} />
              <span className="text-sm font-medium">ONU Profile created successfully!</span>
            </div>
          )}
        </div>
      </div>


      {/* Edit Modal */}
      {editingProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md border border-gray-200">
            <h3 className="text-lg font-bold text-gray-800 mb-4">Edit Profile: {editingProfile.profileName}</h3>
            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">CVLAN</label>
                <select
                  required
                  value={editFormData.vlanId}
                  onChange={e => setEditFormData({ ...editFormData, vlanId: e.target.value })}
                  className="w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none transition-all text-gray-900"
                >
                  <option value="" disabled>Select VLAN</option>
                  {vlans.map((v) => (
                    <option key={v.vlanId} value={v.vlanId}>
                      {v.vlanId} - {v.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                <select
                  required
                  value={editFormData.priority}
                  onChange={e => setEditFormData({ ...editFormData, priority: e.target.value })}
                  className="w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                >
                  <option value="" disabled>Select Priority</option>
                  {[0,1,2,3,4,5,6,7].map(num => (
                    <option key={num} value={num}>{num}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setEditingProfile(null)}
                  className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isEditing}
                  className="flex-1 flex justify-center items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors disabled:opacity-70"
                >
                  {isEditing ? <Loader2 className="animate-spin" size={18} /> : <Check size={18} />}
                  {isEditing ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ONU Profile Table */}
      <div className="bg-white/80 backdrop-blur-md border border-gray-200/50 rounded-xl overflow-hidden shadow-lg">
        <div className="px-4 py-3 bg-gray-50/80 border-b border-gray-200/50 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">ONU Profiles</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                fetchProfiles(true)
                fetchVlans()
              }}
              disabled={isFetching || !isMatch}
              className="p-1.5 text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all disabled:opacity-50"
              title="Refresh Data (Bypass Cache)"
            >
              <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
            </button>
            {selectedIds.length > 0 && (
              <button
                onClick={handleDelete}
                className="flex items-center gap-2 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg transition-colors"
              >
                <Trash2 size={14} />
                Delete Selected ({selectedIds.length})
              </button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-100/80 text-left">
                <th className="px-4 py-3 w-12">
                  <input
                    type="checkbox"
                    checked={profiles.length > 0 && selectedIds.length === profiles.length}
                    onChange={handleSelectAll}
                    className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                  />
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wider">Profile Name</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wider">Tag Mode</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wider">CVLAN</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wider">Priority</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200/50">
              {profiles.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4 }}
                      className="flex flex-col items-center justify-center gap-3 py-6 max-w-md mx-auto"
                    >
                      {connectionState === 'LOADING' || isFetching ? (
                        <div className="flex flex-col items-center gap-3 p-6 rounded-2xl bg-emerald-50/50 border border-emerald-100/50 backdrop-blur-md shadow-sm w-full">
                          <div className="relative">
                            <div className="absolute inset-0 rounded-full bg-emerald-500/20 blur-md animate-ping" />
                            <Loader2 size={32} className="relative text-emerald-600 animate-spin" />
                          </div>
                          <span className="text-sm font-semibold text-emerald-700">Syncing with OLT Hardware...</span>
                          <span className="text-xs text-emerald-500/80 -mt-1">Retrieving live ONU profiles from device</span>
                        </div>
                      ) : connectionState !== 'MATCH' ? (
                        <div className="flex flex-col items-center gap-3 p-6 rounded-2xl bg-rose-50/50 border border-rose-100/50 backdrop-blur-md shadow-sm w-full">
                          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-rose-100 text-rose-600 shadow-inner">
                            <WifiOff size={24} className="animate-pulse" />
                          </div>
                          <span className="text-sm font-semibold text-rose-700">No Hardware Connection</span>
                          <span className="text-xs text-rose-500/80 -mt-1">Please verify that OLT agent is online and IP is reachable</span>
                        </div>
                      ) : errorMessage ? (
                        <div className="flex flex-col items-center gap-3 p-6 rounded-2xl bg-amber-50/50 border border-amber-100/50 backdrop-blur-md shadow-sm w-full">
                          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-amber-100 text-amber-600 shadow-inner">
                            <AlertCircle size={24} />
                          </div>
                          <span className="text-sm font-semibold text-amber-700">Operation Warning</span>
                          <span className="text-sm text-amber-600 font-medium">{errorMessage}</span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-2 p-6 rounded-2xl bg-gray-50/50 border border-gray-100/50 backdrop-blur-md shadow-sm w-full">
                          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 text-gray-400">
                            <AlertCircle size={24} />
                          </div>
                          <span className="text-sm font-medium text-gray-700">No ONU Profiles Created Yet</span>
                          <span className="text-xs text-gray-400 -mt-0.5">Use the form above to provision your first ONU profile</span>
                        </div>
                      )}
                    </motion.div>
                  </td>
                </tr>
              ) : (
                profiles.map(profile => (
                  <tr key={profile.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(profile.id)}
                        onChange={() => handleCheckboxChange(profile.id)}
                        className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                      />
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{profile.profileName}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        profile.mode === 'tag' ? 'bg-blue-100 text-blue-800' : 
                        profile.mode === 'untag' ? 'bg-gray-100 text-gray-800' : 
                        'bg-amber-100 text-amber-800'
                      }`}>
                        {profile.mode}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm font-mono text-gray-700">{profile.vlanId}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{profile.priority}</td>
                    <td className="px-4 py-3 text-sm text-right">
                      <button 
                        onClick={() => {
                          setEditingProfile(profile)
                          setEditFormData({ vlanId: profile.vlanId, priority: profile.priority })
                        }}
                        className="text-blue-600 hover:text-blue-800 font-medium px-3 py-1 rounded bg-blue-50 hover:bg-blue-100 transition-colors"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ==================== CREATE TCONT PROFILE PAGE ====================
function CreateTcontProfilePage({ selectedOLT, onOLTChange, isMatch }: { selectedOLT: string, onOLTChange: (oltId: string) => void, isMatch: boolean }) {
  const [formData, setFormData] = useState({
    profileName: '',
    type: '',
    fbw: '',
    abw: '',
    mbw: '',
  })
  const [tconts, setTconts] = useState<TcontEntry[]>([])
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [showSuccess, setShowSuccess] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isFetching, setIsFetching] = useState(false)

  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [editingTcont, setEditingTcont] = useState<TcontEntry | null>(null)
  const [tcontEditFormData, setTcontEditFormData] = useState({ type: '', fbw: '', abw: '', mbw: '' })
  const [isEditingTcont, setIsEditingTcont] = useState(false)
  const { connectionState } = useNetworkAgent()


  const fetchTconts = async (forceRefresh = false) => {
    if (!isMatch) return
    setIsFetching(true)
    try {
      const res = await fetch(`${API_BASE}/api/provisioning/tcont-profiles${forceRefresh ? '?refresh=true' : ''}`, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        const formatted = data.map((t: any, i: number) => ({
          id: i,
          oltId: selectedOLT,
          oltName: oltOptions.find(o => o.id === selectedOLT)?.name || '',
          profileName: t.profileName,
          type: t.type,
          fbw: t.fbw,
          abw: t.abw,
          mbw: t.mbw,
          currentUsed: 0
        }))
        setTconts(formatted)
        setErrorMessage(null)
      } else {
        setErrorMessage("Backend failed to retrieve TCONT profiles.")
      }
    } catch (e) {
      console.warn("Failed to fetch tcont profiles", e)
      setErrorMessage("Network error: Could not reach backend.")
    } finally {
      setIsFetching(false)
    }
  }

  useEffect(() => {
    if (isMatch) fetchTconts()
    else setTconts([])
  }, [isMatch, selectedOLT])

  // Auto-refresh every 60 seconds
  useEffect(() => {
    if (!isMatch) return
    const interval = setInterval(() => {
      fetchTconts() // Background fetch (cached unless 1m passed)
    }, 60000)
    return () => clearInterval(interval)
  }, [isMatch, selectedOLT])

  const handleChange = (field: string, value: string) => {
    setErrorMessage(null) // Clear error when typing
    // If it's profileName, allow any characters
    if (field === 'profileName') {
      setFormData(prev => ({ ...prev, [field]: value }))
      return
    }

    // For other fields, remove any non-digit characters (prevents minus sign)
    const cleanValue = value.replace(/\D/g, '')
    
    if (cleanValue === "") {
      setFormData(prev => ({ ...prev, [field]: "" }))
      return
    }

    let num = parseInt(cleanValue)
    if (isNaN(num)) return

    // 2. Prevent 0 for all fields
    if (num === 0) num = 1

    if (field === 'type') {
      if (num < 1) num = 1
      if (num > 5) num = 5
    } else if (['fbw', 'abw', 'mbw'].includes(field)) {
      if (num > 9953280) num = 9953280
      if (num > 9953280) num = 9953280
      // Min 64 is handled on blur to avoid blocking typing 1, 2, etc.
    }

    setFormData(prev => ({ ...prev, [field]: num.toString() }))
  }

  const handleBlur = (field: string) => {
    const value = formData[field as keyof typeof formData]
    if (!value) return

    let num = parseInt(value)
    if (['fbw', 'abw', 'mbw'].includes(field)) {
      if (num < 64) num = 64
      setFormData(prev => ({ ...prev, [field]: num.toString() }))
    }
  }

  const type = parseInt(formData.type)
  const fValue = parseInt(formData.fbw) || 0
  const aValue = parseInt(formData.abw) || 0
  const mValue = parseInt(formData.mbw) || 0
  
  // Real-time Bandwidth Rule Check
  let showOverlapWarning = false
  if (type === 3 && aValue >= mValue && formData.abw && formData.mbw) {
    showOverlapWarning = true
  } else if (type === 5 && (fValue + aValue) > mValue && formData.fbw && formData.abw && formData.mbw) {
    showOverlapWarning = true
  }
  
  const bwError = showOverlapWarning ? (type === 3 ? "Assured BW must be LESS than Maximum BW" : "Fixed + Assured must be ≤ Maximum BW") : null

  const handleCreate = async () => {
    if (!selectedOLT || !formData.profileName || !formData.type || bwError) return
    
    setIsLoading(true)
    setErrorMessage(null)
    try {
      const clampBw = (val: string) => {
        const n = parseInt(val) || 0
        return n < 64 ? 64 : n
      }

      const payload = {
        profile_name: formData.profileName,
        type: type,
        fbw: showFixed ? clampBw(formData.fbw) : 0,
        abw: showAssured ? clampBw(formData.abw) : 0,
        mbw: showMaximum ? clampBw(formData.mbw) : 0
      }
      
      const res = await fetch(`${API_BASE}/api/provisioning/tcont-profiles`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      
      const result = await res.json()
      if (res.ok) {
        setShowSuccess(true)
        fetchTconts(true) // Trigger refresh bypass cache
        setTimeout(() => {
          setShowSuccess(false)
          setFormData({ profileName: '', type: '', fbw: '', abw: '', mbw: '' })
        }, 3000)
        fetchTconts()
      } else {
        setErrorMessage(result.detail || "Failed to create TCONT profile")
      }
    } catch (e) {
      setErrorMessage("Network error: Could not connect to backend")
    } finally {
      setIsLoading(false)
    }
  }



  const handleCheckboxChange = (id: number) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    )
  }

  const handleSelectAll = () => {
    if (selectedIds.length === tconts.length && tconts.length > 0) {
      setSelectedIds([])
    } else {
      setSelectedIds(tconts.map(t => t.id))
    }
  }

  const handleDelete = async () => {
    const namesToDelete = tconts.filter(t => selectedIds.includes(t.id)).map(t => t.profileName)
    if (namesToDelete.length === 0) return
    
    setIsLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/provisioning/tcont-profiles`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_names: namesToDelete })
      })
      if (res.ok) {
        setSelectedIds([])
        fetchTconts(true)
      }
    } catch (e) {
      console.warn("Delete failed", e)
    } finally {
      setIsLoading(false)
    }
  }

  const handleTcontEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingTcont || !isMatch) return

    const type = parseInt(tcontEditFormData.type)
    const fbw = parseInt(tcontEditFormData.fbw) || 0
    const abw = parseInt(tcontEditFormData.abw) || 0
    const mbw = parseInt(tcontEditFormData.mbw) || 0

    setIsEditingTcont(true)
    try {
      const res = await fetch(`${API_BASE}/api/provisioning/tcont-profiles`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile_name: editingTcont.profileName,
          type,
          fbw,
          abw,
          mbw
        })
      })
      if (res.ok) {
        setEditingTcont(null)
        fetchTconts(true)
      } else {
        const err = await res.json()
        alert(err.detail || "Failed to update TCONT profile")
      }
    } catch (err) {
      console.error("Edit failed", err)
      alert("Network error: Could not reach backend")
    } finally {
      setIsEditingTcont(false)
    }
  }

  const handleTcontEditChange = (field: string, value: string) => {
    const cleanValue = value.replace(/\D/g, '')
    if (cleanValue === "") {
      setTcontEditFormData(prev => ({ ...prev, [field]: "" }))
      return
    }

    let num = parseInt(cleanValue)
    if (isNaN(num)) return
    if (num === 0) num = 1

    if (field === 'type') {
      if (num < 1) num = 1
      if (num > 5) num = 5
    } else if (['fbw', 'abw', 'mbw'].includes(field)) {
      if (num > 9953280) num = 9953280
    }

    setTcontEditFormData(prev => ({ ...prev, [field]: num.toString() }))
  }

  const handleTcontEditBlur = (field: string) => {
    const value = tcontEditFormData[field as keyof typeof tcontEditFormData]
    if (!value) return

    let num = parseInt(value)
    if (['fbw', 'abw', 'mbw'].includes(field)) {
      if (num < 64) num = 64
      setTcontEditFormData(prev => ({ ...prev, [field]: num.toString() }))
    }
  }

  const editTypeNum = parseInt(tcontEditFormData.type)
  const efValue = parseInt(tcontEditFormData.fbw) || 0
  const eaValue = parseInt(tcontEditFormData.abw) || 0
  const emValue = parseInt(tcontEditFormData.mbw) || 0

  let editBwError = null
  if (editTypeNum === 3 && eaValue >= emValue && tcontEditFormData.abw && tcontEditFormData.mbw) {
    editBwError = "Assured BW must be LESS than Maximum BW"
  } else if (editTypeNum === 5 && (efValue + eaValue) > emValue && tcontEditFormData.fbw && tcontEditFormData.abw && tcontEditFormData.mbw) {
    editBwError = "Fixed + Assured must be ≤ Maximum BW"
  }


  const isTypeValid = type >= 1 && type <= 5
  
  const showFixed = type === 1 || type === 5
  const showAssured = type === 2 || type === 3 || type === 5
  const showMaximum = type === 3 || type === 4 || type === 5

  const isValid = selectedOLT && formData.profileName && isTypeValid && (
    (type === 1 && formData.fbw) ||
    (type === 2 && formData.abw) ||
    (type === 3 && formData.abw && formData.mbw) ||
    (type === 4 && formData.mbw) ||
    (type === 5 && formData.fbw && formData.abw && formData.mbw)
  ) && !showOverlapWarning

  const generateCLI = () => {
    if (!formData.profileName || !isTypeValid) return "# Fill in the form to preview CLI commands"
    
    const getVal = (v: string) => v || '64'

    let args = ""
    if (type === 1) args = `fixed ${getVal(formData.fbw)}`
    else if (type === 2) args = `assured ${getVal(formData.abw)}`
    else if (type === 3) args = `assured ${getVal(formData.abw)} maximum ${getVal(formData.mbw)}`
    else if (type === 4) args = `maximum ${getVal(formData.mbw)} priority 0 weight 0`
    else if (type === 5) args = `fixed ${getVal(formData.fbw)} assured ${getVal(formData.abw)} maximum ${getVal(formData.mbw)} priority 0 weight 0`
    
    return `conf t\ngpon\nprofile tcont ${formData.profileName} type ${type} ${args}`
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-orange-500/20 rounded-lg">
          <Radio className="w-6 h-6 text-orange-400" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900">TCONT Profile Management</h2>
      </div>

      {/* Form Card */}
      {/* Form Card */}
      <div className="bg-white/80 backdrop-blur-md border border-gray-200/50 rounded-xl p-6 shadow-lg relative z-20 overflow-visible">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Select OLT */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">Select OLT</label>
            <OLTSelector
              selectedOLT={selectedOLT}
              onOLTChange={(newOlt) => {
                onOLTChange(newOlt)
                setSelectedIds([])
              }}
              variant="form"
            />
          </div>

          {/* Profile Name */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">Profile Name</label>
            <input
              type="text"
              value={formData.profileName}
              onChange={(e) => handleChange('profileName', e.target.value)}
              placeholder="e.g., TCONT_100M"
              className="w-full px-4 py-2.5 bg-white/90 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-all text-gray-900"
            />
          </div>

          {/* Type */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">Type (1 - 5)</label>
            <input
              type="number"
              value={formData.type}
              onChange={(e) => handleChange('type', e.target.value)}
              placeholder="Select Type"
              min="1"
              max="5"
              className="w-full px-4 py-2.5 bg-white/90 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-all text-gray-900"
            />
          </div>

          {/* Fixed */}
          {showFixed && (
            <div className="space-y-2 animate-in fade-in slide-in-from-top-1">
              <label className="block text-sm font-medium text-gray-700">Fixed BW (kbps)</label>
              <input
                type="number"
                value={formData.fbw}
                onChange={(e) => handleChange('fbw', e.target.value)}
                onBlur={() => handleBlur('fbw')}
                placeholder="64 - 9953280"
                min="64"
                max="9953280"
                className="w-full px-4 py-2.5 bg-white/90 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-all text-gray-900"
              />
            </div>
          )}

          {/* Assured */}
          {showAssured && (
            <div className="space-y-2 animate-in fade-in slide-in-from-top-1">
              <label className="block text-sm font-medium text-gray-700">Assured BW (kbps)</label>
              <input
                type="number"
                value={formData.abw}
                onChange={(e) => handleChange('abw', e.target.value)}
                onBlur={() => handleBlur('abw')}
                placeholder="64 - 9953280"
                min="64"
                max="9953280"
                className="w-full px-4 py-2.5 bg-white/90 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-all text-gray-900"
              />
            </div>
          )}
          {/* Maximum */}
          {showMaximum && (
            <div className="space-y-2 animate-in fade-in slide-in-from-top-1">
              <label className="block text-sm font-medium text-gray-700">Maximum BW (kbps)</label>
              <input
                type="number"
                value={formData.mbw}
                onChange={(e) => handleChange('mbw', e.target.value)}
                onBlur={() => handleBlur('mbw')}
                placeholder="64 - 9953280"
                min="64"
                max="9953280"
                className="w-full px-4 py-2.5 bg-white/90 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-all text-gray-900"
              />
            </div>
          )}

        </div>

        {/* Create Button */}
        <div className="mt-8 space-y-4">
          {(bwError || errorMessage) && (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 px-4 py-3 rounded-lg border border-red-200 animate-in fade-in slide-in-from-top-1">
              <AlertCircle size={18} />
              <span className="text-sm font-bold uppercase tracking-tight">
                {bwError || errorMessage}
              </span>
            </div>
          )}

          <div className="flex items-center gap-4">
            <button
              onClick={handleCreate}
              disabled={!isValid || !isMatch || isLoading || !!bwError}
              className="flex items-center justify-center gap-2 px-8 py-3 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg font-bold transition-all shadow-lg active:scale-95"
            >
              {isLoading ? <Loader2 className="animate-spin" size={20} /> : <Plus size={20} />}
              {isLoading ? 'Creating Profile...' : 'Create TCONT Profile'}
            </button>

            {showSuccess && (
              <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 px-4 py-2 rounded-lg border border-emerald-200">
                <Check size={18} />
                <span className="text-sm font-medium">TCONT Profile created successfully!</span>
              </div>
            )}
          </div>
        </div>
      </div>


      {/* TCONT Table */}
      <div className="bg-white/80 backdrop-blur-md border border-gray-200/50 rounded-xl overflow-hidden shadow-xl">
        <div className="px-5 py-4 bg-gray-50/80 border-b border-gray-200/50 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-gray-800">TCONT Profile List</h3>
            <p className="text-xs text-gray-500 mt-0.5">Showing registered TCONT bandwidth profiles on hardware</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchTconts(true)}
              disabled={isFetching || !isMatch}
              className="p-2 text-gray-600 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-all disabled:opacity-50"
              title="Refresh Data (Bypass Cache)"
            >
              <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
            </button>
            {selectedIds.length > 0 && (
              <button
                onClick={handleDelete}
                disabled={isLoading}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-lg transition-all shadow-md active:scale-95"
              >
                {isLoading ? <Loader2 className="animate-spin" size={14} /> : <Trash2 size={14} />}
                Delete Selected ({selectedIds.length})
              </button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-100/80 text-left border-b border-gray-200/50">
                <th className="px-5 py-4 w-12">
                  <input
                    type="checkbox"
                    checked={tconts.length > 0 && selectedIds.length === tconts.length}
                    onChange={handleSelectAll}
                    className="w-4 h-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                  />
                </th>
                <th className="px-5 py-4 text-xs font-bold text-gray-600 uppercase tracking-wider">Profile Name</th>
                <th className="px-5 py-4 text-xs font-bold text-gray-600 uppercase tracking-wider">Type</th>
                <th className="px-5 py-4 text-xs font-bold text-gray-600 uppercase tracking-wider">FBW (kbps)</th>
                <th className="px-5 py-4 text-xs font-bold text-gray-600 uppercase tracking-wider">ABW (kbps)</th>
                <th className="px-5 py-4 text-xs font-bold text-gray-600 uppercase tracking-wider">MBW (kbps)</th>
                <th className="px-5 py-4 text-xs font-bold text-gray-600 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200/50">
              {tconts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-gray-500">
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4 }}
                      className="flex flex-col items-center justify-center gap-3 py-6 max-w-md mx-auto"
                    >
                      {connectionState === 'LOADING' || isFetching ? (
                        <div className="flex flex-col items-center gap-3 p-6 rounded-2xl bg-orange-50/50 border border-orange-100/50 backdrop-blur-md shadow-sm w-full">
                          <div className="relative">
                            <div className="absolute inset-0 rounded-full bg-orange-500/20 blur-md animate-ping" />
                            <Loader2 size={32} className="relative text-orange-600 animate-spin" />
                          </div>
                          <span className="text-sm font-semibold text-orange-700">Syncing with OLT Hardware...</span>
                          <span className="text-xs text-orange-500/80 -mt-1">Retrieving live TCONT bandwidth profiles</span>
                        </div>
                      ) : connectionState !== 'MATCH' ? (
                        <div className="flex flex-col items-center gap-3 p-6 rounded-2xl bg-rose-50/50 border border-rose-100/50 backdrop-blur-md shadow-sm w-full">
                          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-rose-100 text-rose-600 shadow-inner">
                            <WifiOff size={24} className="animate-pulse" />
                          </div>
                          <span className="text-sm font-semibold text-rose-700">No Hardware Connection</span>
                          <span className="text-xs text-rose-500/80 -mt-1">Please verify that OLT agent is online and IP is reachable</span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-2 p-6 rounded-2xl bg-gray-50/50 border border-gray-100/50 backdrop-blur-md shadow-sm w-full">
                          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 text-gray-400">
                            <AlertCircle size={24} />
                          </div>
                          <span className="text-sm font-medium text-gray-700">No TCONT Profiles Created Yet</span>
                          <span className="text-xs text-gray-400 -mt-0.5">Use the form above to provision your first TCONT profile</span>
                        </div>
                      )}
                    </motion.div>
                  </td>
                </tr>
              ) : (
                tconts.map(tcont => (
                  <tr key={tcont.id} className="hover:bg-orange-50/30 transition-colors group">
                    <td className="px-5 py-4">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(tcont.id)}
                        onChange={() => handleCheckboxChange(tcont.id)}
                        className="w-4 h-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                      />
                    </td>
                    <td className="px-5 py-4 text-sm font-bold text-gray-900">{tcont.profileName}</td>
                    <td className="px-5 py-4">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-orange-100 text-orange-800 border border-orange-200">
                        Type {tcont.type}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-sm font-mono text-gray-700">{tcont.fbw.toLocaleString()}</td>
                    <td className="px-5 py-4 text-sm font-mono text-gray-700">{tcont.abw.toLocaleString()}</td>
                    <td className="px-5 py-4 text-sm font-mono text-gray-700">{tcont.mbw.toLocaleString()}</td>
                    <td className="px-5 py-4 text-sm text-right">
                      <button 
                        onClick={() => {
                          setEditingTcont(tcont)
                          setTcontEditFormData({ 
                            type: tcont.type.toString(),
                            fbw: tcont.fbw.toString(),
                            abw: tcont.abw.toString(),
                            mbw: tcont.mbw.toString()
                          })
                        }}
                        className="text-blue-600 hover:text-blue-800 font-bold px-3 py-1 rounded bg-blue-50 hover:bg-blue-100 transition-all active:scale-95"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Modal */}
      {editingTcont && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-lg border border-gray-100 transform animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Radio className="w-5 h-5 text-blue-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-900">Edit TCONT: {editingTcont.profileName}</h3>
            </div>
            
            <form onSubmit={handleTcontEditSubmit} className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-bold text-gray-700 mb-1.5 uppercase tracking-wider">TCONT Type (1-5)</label>
                  <input
                    type="number"
                    value={tcontEditFormData.type}
                    onChange={e => handleTcontEditChange('type', e.target.value)}
                    min="1"
                    max="5"
                    required
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-medium"
                  />
                </div>

                {(tcontEditFormData.type === '1' || tcontEditFormData.type === '5') && (
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1.5 uppercase tracking-wider">Fixed BW</label>
                    <input
                      type="number"
                      value={tcontEditFormData.fbw}
                      onChange={e => handleTcontEditChange('fbw', e.target.value)}
                      onBlur={() => handleTcontEditBlur('fbw')}
                      placeholder="64 - 9953280"
                      min="64"
                      max="9953280"
                      required
                      className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-mono"
                    />
                  </div>
                )}

                {(tcontEditFormData.type === '2' || tcontEditFormData.type === '3' || tcontEditFormData.type === '5') && (
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1.5 uppercase tracking-wider">Assured BW</label>
                    <input
                      type="number"
                      value={tcontEditFormData.abw}
                      onChange={e => handleTcontEditChange('abw', e.target.value)}
                      onBlur={() => handleTcontEditBlur('abw')}
                      placeholder="64 - 9953280"
                      min="64"
                      max="9953280"
                      required
                      className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-mono"
                    />
                  </div>
                )}

                {(tcontEditFormData.type === '3' || tcontEditFormData.type === '4' || tcontEditFormData.type === '5') && (
                  <div className={tcontEditFormData.type === '4' ? 'col-span-2' : ''}>
                    <label className="block text-sm font-bold text-gray-700 mb-1.5 uppercase tracking-wider">Maximum BW</label>
                    <input
                      type="number"
                      value={tcontEditFormData.mbw}
                      onChange={e => handleTcontEditChange('mbw', e.target.value)}
                      onBlur={() => handleTcontEditBlur('mbw')}
                      placeholder="64 - 9953280"
                      min="64"
                      max="9953280"
                      required
                      className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-mono"
                    />
                  </div>
                )}
              </div>

              {editBwError && (
                <div className="flex items-center gap-2 text-red-600 bg-red-50 px-4 py-2 rounded-lg border border-red-200 animate-in fade-in slide-in-from-top-1">
                  <AlertCircle size={14} />
                  <span className="text-xs font-bold uppercase">{editBwError}</span>
                </div>
              )}

              <div className="flex gap-4 pt-6 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setEditingTcont(null)}
                  className="flex-1 px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl transition-all active:scale-95"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isEditingTcont || !!editBwError}
                  className="flex-1 flex justify-center items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-blue-200 active:scale-95 disabled:opacity-70 disabled:bg-gray-400"
                >
                  {isEditingTcont ? <Loader2 className="animate-spin" size={20} /> : <Check size={20} />}
                  {isEditingTcont ? 'Updating...' : 'Update Profile'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>

  )
}
