'use client'

import { useState, useEffect } from 'react'
import { Lock, Settings, Eye, EyeOff, CheckCircle, AlertCircle, Loader2, Wifi, WifiOff, Users, UserPlus, Trash2, Plus, Key } from 'lucide-react'
import { useNetworkAgent } from '@/lib/context/NetworkAgentContext'

interface ProfilePageProps {
  userRole: 'admin' | 'guest'
  selectedOLT?: string
}

export default function ProfilePage({ userRole, selectedOLT = 'c600' }: ProfilePageProps) {
  const { connectionState, verifiedOltId, detectedOltId } = useNetworkAgent()
  const [activeTab, setActiveTab] = useState<'security' | 'olt' | 'users'>('security')
  
  const oltNames: Record<string, string> = {
    'c600': 'ZTE C600 (SFUB/SFUL/SFQD)',
    'c300': 'ZTE C300 (SCXN/SCXM/SCXL)',
    'c320': 'ZTE C320 (SMXA)'
  }
  
  // Security Tab State
  const [currentPassword, setCurrentPassword] = useState('')
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [securityStatus, setSecurityStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null)

  // OLT Config State
  const [telnetPort, setTelnetPort] = useState('')
  const [enablePassword, setEnablePassword] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showEnablePassword, setShowEnablePassword] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [oltStatus, setOltStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null)

  const handleUpdateAccount = async (e: React.FormEvent) => {
    e.preventDefault()
    setSecurityStatus(null)

    if (!currentPassword) {
      setSecurityStatus({ type: 'error', message: 'Current password is required' })
      return
    }

    if (newPassword && newPassword !== confirmPassword) {
      setSecurityStatus({ type: 'error', message: 'New passwords do not match' })
      return
    }

    if (newPassword && newPassword.length < 6) {
      setSecurityStatus({ type: 'error', message: 'Password must be at least 6 characters' })
      return
    }

    try {
      
      const res = await fetch(`/api/auth/change-account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          current_password: currentPassword, 
          new_username: newUsername || undefined,
          new_password: newPassword || undefined
        }),
        credentials: 'include'
      })

      if (res.ok) {
        setSecurityStatus({ type: 'success', message: 'Account details updated successfully' })
        setCurrentPassword('')
        setNewUsername('')
        setNewPassword('')
        setConfirmPassword('')
      } else {
        const data = await res.json()
        setSecurityStatus({ type: 'error', message: data.detail || 'Failed to update account' })
      }
    } catch (err) {
      setSecurityStatus({ type: 'error', message: 'Cannot connect to backend' })
    }
  }

  const [isLoadingConfig, setIsLoadingConfig] = useState(false)
  const [isSavingConfig, setIsSavingConfig] = useState(false)
  const [isProbing, setIsProbing] = useState(false)
  const [showCredentials, setShowCredentials] = useState(false)
  const [noData, setNoData] = useState(false)
  const [activeInBandIp, setActiveInBandIp] = useState('')
  const [backendError, setBackendError] = useState<string | null>(null)
  const [pingStatus, setPingStatus] = useState<'loading' | 'online' | 'offline' | null>(null)
  const [isPingRunning, setIsPingRunning] = useState(false)
  const [isVerifyingNewIp, setIsVerifyingNewIp] = useState(false)
  const [newIpInput, setNewIpInput] = useState('')

  // Auto-fetch profile from database on mount
  useEffect(() => {
    const fetchConfig = async () => {
      setIsLoadingConfig(true)
      setNoData(false)
      setBackendError(null)
      try {
        
        const res = await fetch(`/api/profile/olt-config?olt_type=${selectedOLT}`)
        if (res.ok) {
          const data = await res.json()
          setActiveInBandIp(data.in_band_ip || '')
          setTelnetPort(data.telnet_port?.toString() || '23')
          setEnablePassword(data.enable_password || '')
          setUsername(data.username || '')
          setPassword(data.password || '')
          
          if (data.in_band_ip) {
            setShowCredentials(true)
          } else {
            setNoData(true)
            setShowCredentials(true)
          }
        } else {
          setNoData(true)
        }
      } catch (err) {
        console.warn('Failed to fetch OLT profile:', err)
        setBackendError(`Cannot connect to backend service. Please ensure the NMS is running.`)
      } finally {
        setIsLoadingConfig(false)
      }
    }
    
    fetchConfig()
  }, [selectedOLT])

  const handleVerifyNewIp = async () => {
    if (!newIpInput || newIpInput.length < 7) {
      setOltStatus({ type: 'error', message: 'Please enter a valid IP address' })
      return
    }
    
    setIsVerifyingNewIp(true)
    setOltStatus(null)
    
    try {
      
      const res = await fetch(`/api/profile/verify-ip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: newIpInput, target_olt_type: selectedOLT })
      })

      if (res.ok) {
        const data = await res.json()
        setOltStatus({ type: 'success', message: data.message })
        setActiveInBandIp(newIpInput)
        setShowCredentials(true)
        setNoData(false)
      } else {
        const data = await res.json()
        setOltStatus({ type: 'error', message: data.detail || 'Verification failed' })
      }
    } catch (err) {
      setOltStatus({ type: 'error', message: 'Cannot connect to hardware agent' })
    } finally {
      setIsVerifyingNewIp(false)
    }
  }

  // Automatic Ping Effect
  useEffect(() => {
    if (!activeInBandIp || activeInBandIp.length < 7 || !activeInBandIp.includes('.')) {
      setPingStatus(null)
      return
    }

    const timer = setTimeout(async () => {
      setPingStatus('loading')
      setIsPingRunning(true)
      try {
        
        const res = await fetch(`/api/network/ping`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ip: activeInBandIp, port: parseInt(telnetPort) || 23 })
        })
        const data = await res.json()
        setPingStatus(data.is_online ? 'online' : 'offline')
        
        // If ping succeeds, we should definitely show credentials form
        if (data.is_online) {
          setShowCredentials(true)
        }
      } catch (err) {
        setPingStatus('offline')
      } finally {
        setIsPingRunning(false)
      }
    }, 800)

    return () => clearTimeout(timer)
  }, [activeInBandIp, telnetPort])

  useEffect(() => {
    // Automatically show credentials form if we have an IP
    if (activeInBandIp && activeInBandIp.length >= 7) {
      setShowCredentials(true)
    }
  }, [activeInBandIp])

  const handleProbeDiscovery = async (ip: string) => {
    setIsProbing(true)
    setOltStatus(null)
    
    try {
      
      const res = await fetch(`/api/profile/probe-discovery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ in_band_ip: ip })
      })

      if (res.ok) {
        const data = await res.json()
        setTelnetPort(data.telnet_port || '23')
        setUsername(data.username || '')
        setShowCredentials(true)
        setOltStatus({ type: 'success', message: `OLT Discovery successful! Found ${data.hostname}.` })
      } else {
        const errData = await res.json()
        setOltStatus({ type: 'error', message: `Discovery failed: ${errData.detail || 'Hardware not responding'}` })
      }
    } catch (err) {
      setOltStatus({ type: 'error', message: 'Hardware Agent unreachable during discovery.' })
    } finally {
      setIsProbing(false)
    }
  }

  const handleSaveConfiguration = async (e: React.FormEvent) => {
    e.preventDefault()
    setOltStatus(null)
    setIsSavingConfig(true)

    try {
      // 1. Ping the OLT before saving
      const pingRes = await fetch(`/api/network/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: activeInBandIp, port: parseInt(telnetPort) || 23 })
      })
      const pingData = await pingRes.json()
      
      if (!pingData.is_online) {
        throw new Error(`Connection Test Failed. OLT at ${activeInBandIp}:${telnetPort || 23} is unreachable. Please verify IP and Port.`)
      }

      // 2. Save if ping succeeds
      const payload = {
        olt_name: `ZTE OLT`,
        olt_type: selectedOLT,
        in_band_ip: activeInBandIp,
        telnet_port: telnetPort,
        enable_password: enablePassword,
        username: username,
        password: password
      }

      
      const res = await fetch(`/api/profile/olt-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.detail || 'Failed to save profile')
      }
      setOltStatus({ type: 'success', message: 'Connection successful. Credentials saved and synchronized.' })
      setNoData(false)
    } catch (err: any) {
      setOltStatus({ type: 'error', message: err.message })
    } finally {
      setIsSavingConfig(false)
    }
  }


  // User Management State
  const [usersList, setUsersList] = useState<any[]>([])
  const [isUsersLoading, setIsUsersLoading] = useState(false)
  const [newAccUsername, setNewAccUsername] = useState('')
  const [newAccPassword, setNewAccPassword] = useState('')
  const [showNewAccPassword, setShowNewAccPassword] = useState(false)
  const [newAccRole, setNewAccRole] = useState<'admin' | 'guest'>('guest')
  const [userActionStatus, setUserActionStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null)

  const fetchUsers = async () => {
    setIsUsersLoading(true)
    try {
      const res = await fetch('/api/auth/users')
      if (res.ok) {
        const data = await res.json()
        setUsersList(data.users || [])
      }
    } catch (err) {
      console.warn("Failed to fetch users:", err)
    } finally {
      setIsUsersLoading(false)
    }
  }

  useEffect(() => {
    if (activeTab === 'users') {
      fetchUsers()
    }
  }, [activeTab])

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setUserActionStatus(null)
    if (!newAccUsername || !newAccPassword) {
      setUserActionStatus({ type: 'error', message: 'Username and password are required' })
      return
    }
    if (newAccPassword.length < 6) {
      setUserActionStatus({ type: 'error', message: 'Password must be at least 6 characters' })
      return
    }

    try {
      const res = await fetch('/api/auth/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: newAccUsername, password: newAccPassword, role: newAccRole })
      })
      if (res.ok) {
        setUserActionStatus({ type: 'success', message: 'User created successfully' })
        setNewAccUsername('')
        setNewAccPassword('')
        setNewAccRole('guest')
        fetchUsers()
      } else {
        const data = await res.json()
        setUserActionStatus({ type: 'error', message: data.detail || 'Failed to create user' })
      }
    } catch (err) {
      setUserActionStatus({ type: 'error', message: 'Network error while creating user' })
    }
  }

  const handleDeleteUser = async (userId: number) => {
    if (!confirm("Are you sure you want to delete this user?")) return
    setUserActionStatus(null)
    try {
      const res = await fetch(`/api/auth/users/${userId}`, { method: 'DELETE' })
      if (res.ok) {
        setUserActionStatus({ type: 'success', message: 'User deleted successfully' })
        fetchUsers()
      } else {
        const data = await res.json()
        setUserActionStatus({ type: 'error', message: data.detail || 'Failed to delete user' })
      }
    } catch (err) {
      setUserActionStatus({ type: 'error', message: 'Network error while deleting user' })
    }
  }

  const handleResetPassword = async (userId: number, username: string) => {
    const newPass = prompt(`Enter new password for ${username} (min. 6 characters):`)
    if (!newPass) return
    if (newPass.length < 6) {
      alert("Password must be at least 6 characters.")
      return
    }

    setUserActionStatus(null)
    try {
      const res = await fetch(`/api/auth/users/${userId}/reset-password`, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_password: newPass })
      })
      if (res.ok) {
        setUserActionStatus({ type: 'success', message: `Password for ${username} reset successfully` })
      } else {
        const data = await res.json()
        setUserActionStatus({ type: 'error', message: data.detail || 'Failed to reset password' })
      }
    } catch (err) {
      setUserActionStatus({ type: 'error', message: 'Network error while resetting password' })
    }
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6">
      <div>
        <h2 className="text-2xl md:text-3xl font-bold text-gray-900">Profile</h2>
        <p className="text-sm text-gray-600 mt-1">Manage credentials and OLT auto-discovery</p>
      </div>

      <div className="bg-white/95 backdrop-blur-md rounded-xl shadow-lg border border-red-100 overflow-hidden">
        <div className="flex border-b border-red-100 bg-gradient-to-r from-red-50 to-white">
          <button
            onClick={() => setActiveTab('security')}
            className={`flex items-center gap-2 px-6 py-4 text-sm font-medium transition-all ${
              activeTab === 'security'
                ? 'text-red-600 bg-white border-b-2 border-red-600 -mb-px'
                : 'text-gray-600 hover:bg-white/50'
            }`}
          >
            <Lock size={18} />
            {userRole === 'admin' ? 'Admin Security' : 'Guest Security'}
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`flex items-center gap-2 px-6 py-4 text-sm font-medium transition-all ${
              activeTab === 'users'
                ? 'text-red-600 bg-white border-b-2 border-red-600 -mb-px'
                : 'text-gray-600 hover:bg-white/50'
            }`}
          >
            <Users size={18} />
            User Management
          </button>
          {userRole === 'admin' && (
            <button
              onClick={() => setActiveTab('olt')}
              className={`flex items-center gap-2 px-6 py-4 text-sm font-medium transition-all ${
                activeTab === 'olt'
                  ? 'text-red-600 bg-white border-b-2 border-red-600 -mb-px'
                  : 'text-gray-600 hover:bg-white/50'
              }`}
            >
              <Settings size={18} />
              OLT Discovery
            </button>
          )}
        </div>

        <div className="p-6 md:p-8">
          {activeTab === 'security' ? (
            <div className="max-w-lg">
              <h3 className="text-lg font-semibold text-gray-900 mb-6">Change Account Details</h3>
              {securityStatus && (
                <div className={`mb-6 p-4 rounded-lg flex items-center gap-3 ${
                  securityStatus.type === 'success' ? 'bg-emerald-50' : 'bg-red-50'
                }`}>
                  {securityStatus.type === 'success' ? <CheckCircle className="text-emerald-600" size={20} /> : <AlertCircle className="text-red-600" size={20} />}
                  <p className="text-sm">{securityStatus.message}</p>
                </div>
              )}
              <form onSubmit={handleUpdateAccount} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Current Password (Required to Save)</label>
                  <div className="relative">
                    <input type={showCurrentPassword ? 'text' : 'password'} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-100 outline-none" required />
                    <button type="button" onClick={() => setShowCurrentPassword(!showCurrentPassword)} className="absolute right-3 top-3.5 text-gray-400 hover:text-gray-600">
                      {showCurrentPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                    </button>
                  </div>
                </div>
                
                <hr className="border-gray-100 my-2" />
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">New Username (Optional)</label>
                  <input type="text" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-100 outline-none" placeholder="Leave blank to keep current" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">New Password (Optional)</label>
                  <div className="relative">
                    <input type={showNewPassword ? 'text' : 'password'} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-100 outline-none" placeholder="Leave blank to keep current" />
                    <button type="button" onClick={() => setShowNewPassword(!showNewPassword)} className="absolute right-3 top-3.5 text-gray-400 hover:text-gray-600">
                      {showNewPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Confirm New Password</label>
                  <div className="relative">
                    <input type={showConfirmPassword ? 'text' : 'password'} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-100 outline-none" />
                    <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-3 top-3.5 text-gray-400 hover:text-gray-600">
                      {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                    </button>
                  </div>
                </div>
                <button type="submit" className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-3 rounded-lg mt-4 shadow-md transition-all active:scale-95">Update Account</button>
              </form>
            </div>
          ) : activeTab === 'olt' && userRole === 'admin' ? (
            <div className="max-w-2xl">
              {isLoadingConfig ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2 size={32} className="animate-spin text-red-500" />
                  <p className="text-gray-500">Synchronizing with database...</p>
                </div>
              ) : backendError ? (
                <div className="mb-6 p-6 rounded-lg bg-red-50 border border-red-200">
                  <AlertCircle className="text-red-500 mb-2" size={24} />
                  <p className="text-red-700">{backendError}</p>
                </div>
              ) : (
                <>
                  {noData && (
                    <div className="mb-6 p-6 rounded-lg bg-amber-50 border border-amber-200">
                      <AlertCircle className="text-amber-500 mb-2" size={24} />
                      <p className="text-amber-700 font-semibold">No Configuration for {selectedOLT.toUpperCase()}</p>
                      <p className="text-amber-600 text-sm mt-1">Please enter the OLT In-Band IP below to start management.</p>
                    </div>
                  )}
                  {connectionState === 'MISMATCH' && (
                    <div className="mb-6 p-4 bg-orange-50 border border-orange-200 rounded-lg flex items-center gap-4 shadow-sm">
                      <div className="w-12 h-12 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
                        <WifiOff className="text-orange-600" size={24} />
                      </div>
                      <div className="flex-1">
                        <p className="font-bold text-orange-900 leading-tight">Identity Mismatch Detected</p>
                        <p className="text-sm text-orange-700 mt-1">
                          You selected <strong>{selectedOLT.toUpperCase()}</strong>, but the hardware responds as <strong>{(detectedOltId || 'Unknown OLT').toUpperCase()}</strong>.
                        </p>
                        <p className="text-xs text-orange-600 mt-1 italic">
                          Change your selection in the dashboard or verify your Configuration Profile below.
                        </p>
                      </div>
                    </div>
                  )}

                  {oltStatus && (
                    <div className={`mb-6 p-4 rounded-lg flex items-center gap-3 ${oltStatus.type === 'success' ? 'bg-emerald-50' : 'bg-red-50'}`}>
                      {oltStatus.type === 'success' ? <CheckCircle className="text-emerald-600" size={20} /> : <AlertCircle className="text-red-600" size={20} />}
                      <p className="text-sm">{oltStatus.message}</p>
                    </div>
                  )}

                  {isProbing ? (
                    <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-4 animate-pulse">
                      <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                        <Loader2 className="animate-spin text-red-600" size={20} />
                      </div>
                      <div>
                        <p className="font-semibold text-red-900">Probing OLT configurations via Serial...</p>
                        <p className="text-xs text-red-700">Communicating with hardware console...</p>
                      </div>
                    </div>
                  ) : showCredentials && pingStatus === 'online' && connectionState === 'MATCH' && (
                    <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
                        <CheckCircle className="text-emerald-600" size={24} />
                      </div>
                      <div>
                        <p className="font-semibold text-emerald-900">Connected via Network (Telnet)</p>
                        <p className="text-xs text-emerald-700">Session restored using saved PostgreSQL credentials.</p>
                      </div>
                    </div>
                  )}


                  <form onSubmit={handleSaveConfiguration} className={`space-y-6 transition-all duration-700 ease-in-out ${showCredentials ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center justify-between">
                          <span>In-Band IP Address</span>
                          {pingStatus === 'online' ? (
                            <span className="text-emerald-600 text-xs font-bold flex items-center gap-1">
                              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Online
                            </span>
                          ) : pingStatus === 'offline' ? (
                            <span className="text-red-600 text-xs font-bold flex items-center gap-1">
                              <div className="w-1.5 h-1.5 rounded-full bg-red-500" /> Offline
                            </span>
                          ) : pingStatus === 'loading' ? (
                            <span className="text-gray-500 text-xs font-bold flex items-center gap-1">
                              <Loader2 className="animate-spin" size={12} /> Probing...
                            </span>
                          ) : null}
                        </label>
                        <input type="text" value={activeInBandIp} onChange={(e) => setActiveInBandIp(e.target.value)} className="w-full px-4 py-3 border border-gray-300 rounded-lg font-mono bg-white focus:ring-2 focus:ring-red-100 outline-none" placeholder="10.x.x.x" required />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Telnet Port</label>
                        <input type="text" value={telnetPort} onChange={(e) => setTelnetPort(e.target.value)} className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white" placeholder="23" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Login Username</label>
                        <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white" placeholder="admin" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Login Password</label>
                        <div className="relative">
                          <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white" />
                          <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-3.5 text-gray-400">
                            {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                          </button>
                        </div>
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-2">Enable Password</label>
                        <div className="relative">
                          <input type={showEnablePassword ? 'text' : 'password'} value={enablePassword} onChange={(e) => setEnablePassword(e.target.value)} className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white" />
                          <button type="button" onClick={() => setShowEnablePassword(!showEnablePassword)} className="absolute right-3 top-3.5 text-gray-400">
                            {showEnablePassword ? <EyeOff size={20} /> : <Eye size={20} />}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-3">
                      <button
                        type="submit"
                        disabled={isSavingConfig || isProbing}
                        className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-4 rounded-xl transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        {isSavingConfig ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle size={20} />}
                        <span>Save Configuration & Resume Sync</span>
                      </button>
                    </div>
                  </form>
                </>
              )}
            </div>
          ) : activeTab === 'users' ? (
            <div className="max-w-4xl space-y-8 animate-in fade-in zoom-in-95 duration-300">
              <div>
                <h3 className="text-xl font-bold text-gray-900 mb-6">User Accounts</h3>
                {userActionStatus && (
                  <div className={`mb-6 p-4 rounded-xl flex items-center gap-3 backdrop-blur-sm border ${
                    userActionStatus.type === 'success' ? 'bg-emerald-50/80 border-emerald-200' : 'bg-red-50/80 border-red-200'
                  }`}>
                    {userActionStatus.type === 'success' ? <CheckCircle className="text-emerald-600" size={20} /> : <AlertCircle className="text-red-600" size={20} />}
                    <p className="text-sm font-medium">{userActionStatus.message}</p>
                  </div>
                )}
                
                {isUsersLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 size={32} className="animate-spin text-red-500" />
                  </div>
                ) : (
                  <div className="bg-white/60 backdrop-blur-xl border border-red-100 rounded-2xl overflow-hidden shadow-sm">
                    <table className="w-full text-left text-sm text-gray-600">
                      <thead className="bg-gradient-to-r from-red-50/50 to-white text-gray-700 font-semibold border-b border-red-100">
                        <tr>
                          <th className="px-6 py-5">Username</th>
                          <th className="px-6 py-5">Role</th>
                          <th className="px-6 py-5">Created At</th>
                          {userRole === 'admin' && <th className="px-6 py-5 text-right">Actions</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-red-50">
                        {usersList.map((u) => (
                          <tr key={u.id} className="hover:bg-red-50/30 transition-colors">
                            <td className="px-6 py-4 font-semibold text-gray-900">{u.username}</td>
                            <td className="px-6 py-4">
                              <span className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider ${u.role === 'admin' ? 'bg-red-100 text-red-700 border border-red-200' : 'bg-gray-100 text-gray-700 border border-gray-200'}`}>
                                {u.role}
                              </span>
                            </td>
                            <td className="px-6 py-4">{new Date(u.created_at).toLocaleDateString()}</td>
                            {userRole === 'admin' && (
                              <td className="px-6 py-4 text-right flex items-center justify-end gap-1">
                                <button onClick={() => handleResetPassword(u.id, u.username)} className="text-gray-400 hover:text-amber-600 transition-all p-2.5 rounded-xl hover:bg-amber-100 active:scale-95" title="Reset Password">
                                  <Key size={18} />
                                </button>
                                <button onClick={() => handleDeleteUser(u.id)} className="text-gray-400 hover:text-red-600 transition-all p-2.5 rounded-xl hover:bg-red-100 active:scale-95" title="Delete User">
                                  <Trash2 size={18} />
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                        {usersList.length === 0 && (
                          <tr><td colSpan={4} className="px-6 py-12 text-center text-gray-500 font-medium">No users found.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {userRole === 'admin' && (
                <div className="pt-8 border-t border-red-100">
                  <h3 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                    <UserPlus size={22} className="text-red-600" />
                    Create New User
                  </h3>
                  <form onSubmit={handleCreateUser} className="grid grid-cols-1 md:grid-cols-4 gap-5 items-end bg-gradient-to-br from-red-50/50 to-white p-7 rounded-2xl border border-red-100 shadow-sm">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Username</label>
                      <input type="text" value={newAccUsername} onChange={(e) => setNewAccUsername(e.target.value)} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-red-200 focus:border-red-400 outline-none bg-white/80 backdrop-blur-sm transition-all" placeholder="Enter username" required />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Password</label>
                      <div className="relative">
                        <input type={showNewAccPassword ? 'text' : 'password'} value={newAccPassword} onChange={(e) => setNewAccPassword(e.target.value)} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-red-200 focus:border-red-400 outline-none bg-white/80 backdrop-blur-sm transition-all" placeholder="Min. 8 chars (Abc1)" required />
                        <button type="button" onClick={() => setShowNewAccPassword(!showNewAccPassword)} className="absolute right-3 top-3.5 text-gray-400 hover:text-gray-600">
                          {showNewAccPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Role</label>
                      <select value={newAccRole} onChange={(e: any) => setNewAccRole(e.target.value)} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-red-200 focus:border-red-400 outline-none bg-white/80 backdrop-blur-sm transition-all">
                        <option value="guest">Guest (Read Only)</option>
                        <option value="admin">Admin (Full Access)</option>
                      </select>
                    </div>
                    <div>
                      <button type="submit" className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-3.5 rounded-xl shadow-md transition-all active:scale-95 flex items-center justify-center gap-2">
                        <Plus size={18} /> Add User
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
