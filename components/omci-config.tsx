'use client'

import { useState, useEffect } from 'react'
import { ArrowLeft, CheckCircle, AlertCircle } from 'lucide-react'
import { ONU } from '@/lib/types'


interface OMCIConfigProps {
  onu: ONU
  onBack: () => void
  onComplete?: (onuId: string) => void
}

export default function OMCIConfig({ onu, onBack, onComplete }: OMCIConfigProps) {
  const [profileType, setProfileType] = useState('bridge')
  const [isExecuting, setIsExecuting] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [displayedLog, setDisplayedLog] = useState('')

  // Form state for different profiles
  const [formData, setFormData] = useState({
    vlanId: '100',
    username: '',
    password: '',
    ports: ['LAN1', 'LAN2', 'LAN3', 'LAN4'],
  })

  const mockLogs = [
    `[${new Date().toLocaleTimeString()}] Initiating OMCI configuration...`,
    `[${new Date().toLocaleTimeString()}] Target Device: ${onu.onuType} | SN: ${onu.sn}`,
    `[${new Date().toLocaleTimeString()}] Connecting to OLT...`,
    `[${new Date().toLocaleTimeString()}] ✓ Connection established`,
    `[${new Date().toLocaleTimeString()}] Setting VLAN ID: ${formData.vlanId}`,
    `[${new Date().toLocaleTimeString()}] ✓ VLAN configuration applied`,
    profileType === 'pppoe' && `[${new Date().toLocaleTimeString()}] Configuring PPPoE mode...`,
    profileType === 'pppoe' && `[${new Date().toLocaleTimeString()}] Setting PPPoE credentials...`,
    profileType === 'pppoe' && `[${new Date().toLocaleTimeString()}] ✓ PPPoE setup complete`,
    profileType === 'bridge' && `[${new Date().toLocaleTimeString()}] Configuring Bridge Mode...`,
    profileType === 'bridge' && `[${new Date().toLocaleTimeString()}] Binding ports: ${formData.ports.join(', ')}`,
    profileType === 'bridge' && `[${new Date().toLocaleTimeString()}] ✓ Bridge configuration complete`,
    profileType === 'iptv' && `[${new Date().toLocaleTimeString()}] Configuring IPTV/VLAN Tagging...`,
    profileType === 'iptv' && `[${new Date().toLocaleTimeString()}] ✓ IPTV setup complete`,
    profileType === 'voice' && `[${new Date().toLocaleTimeString()}] Configuring Voice/SIP...`,
    profileType === 'voice' && `[${new Date().toLocaleTimeString()}] ✓ Voice configuration complete`,
    `[${new Date().toLocaleTimeString()}] Verifying ONU status...`,
    `[${new Date().toLocaleTimeString()}] ✓ ONU status: Online and configured`,
    `[${new Date().toLocaleTimeString()}] Configuration completed successfully!`,
  ].filter(Boolean) as string[]

  const handleExecute = async () => {
    setIsExecuting(true)
    setLogs([])
    setDisplayedLog('')

    // Simulate typing effect
    let currentIndex = 0
    const typeNextLog = () => {
      if (currentIndex < mockLogs.length) {
        const newLogs = [...logs, mockLogs[currentIndex]]
        setLogs(newLogs)
        setDisplayedLog(newLogs.join('\n'))
        currentIndex++
        setTimeout(typeNextLog, 200)
      } else {
        setIsExecuting(false)
        // Auto-return to ONU list after completion
        setTimeout(() => {
          onComplete?.(onu.id) || onBack()
        }, 1500)
      }
    }

    typeNextLog()
  }

  const handlePortChange = (port: string) => {
    setFormData(prev => ({
      ...prev,
      ports: prev.ports.includes(port)
        ? prev.ports.filter(p => p !== port)
        : [...prev.ports, port]
    }))
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6">
      {/* Back Button and Title */}
      <div className="flex items-center gap-4">
        <button
          onClick={onBack}
          className="p-2 hover:bg-red-50 rounded-lg transition-colors"
        >
          <ArrowLeft size={24} className="text-red-600" />
        </button>
        <h1 className="text-3xl font-bold text-gray-900">OMCI Configuration</h1>
      </div>

      {/* Target Information Card */}
      <div className="bg-white/95 backdrop-blur-md rounded-lg p-6 shadow-md border border-red-100">
        <h3 className="text-sm font-semibold text-gray-700 mb-4 uppercase tracking-wide">Target Device</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-gray-600 mb-1">Model</p>
            <p className="text-lg font-semibold text-gray-900">{onu.onuType}</p>
          </div>
          <div>
            <p className="text-xs text-gray-600 mb-1">Serial Number</p>
            <p className="text-lg font-mono font-semibold text-gray-900">{onu.sn}</p>
          </div>
          <div>
            <p className="text-xs text-gray-600 mb-1">Status</p>
            <div className="flex items-center gap-2">
              {onu.status === 'online' ? (
                <CheckCircle size={20} className="text-emerald-600" />
              ) : (
                <AlertCircle size={20} className="text-red-600" />
              )}
              <p className="text-lg font-semibold text-gray-900 capitalize">{onu.status}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Configuration Form */}
      <div className="bg-white/95 backdrop-blur-md rounded-lg p-6 shadow-md border border-red-100 space-y-6">
        {/* OMCI Profile Selector */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-3">Select OMCI Profile/Type</label>
          <select
            value={profileType}
            onChange={(e) => setProfileType(e.target.value)}
            className="w-full px-4 py-3 border border-red-200 rounded-lg bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
          >
            <option value="bridge">Bridge Mode (Internet)</option>
            <option value="pppoe">Route Mode (PPPoE)</option>
            <option value="iptv">IPTV/VLAN Tagging</option>
            <option value="voice">Voice/SIP</option>
          </select>
        </div>

        {/* Dynamic Form Fields */}
        <div className="space-y-4 border-t border-gray-200 pt-6">
          {/* Common: VLAN ID */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">VLAN ID</label>
            <input
              type="number"
              value={formData.vlanId}
              onChange={(e) => setFormData(prev => ({ ...prev, vlanId: e.target.value }))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
              min="1"
              max="4094"
            />
          </div>

          {/* PPPoE Mode Fields */}
          {profileType === 'pppoe' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">PPPoE Username</label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData(prev => ({ ...prev, username: e.target.value }))}
                  placeholder="Enter PPPoE username"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">PPPoE Password</label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                  placeholder="Enter PPPoE password"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
            </>
          )}

          {/* Bridge Mode: Port Binding */}
          {profileType === 'bridge' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">Bind to Ports</label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {['LAN1', 'LAN2', 'LAN3', 'LAN4'].map(port => (
                  <label key={port} className="flex items-center gap-2 cursor-pointer p-3 border border-gray-300 rounded-lg hover:bg-red-50 transition-colors">
                    <input
                      type="checkbox"
                      checked={formData.ports.includes(port)}
                      onChange={() => handlePortChange(port)}
                      className="w-4 h-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                    />
                    <span className="text-sm font-medium text-gray-700">{port}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* IPTV Mode */}
          {profileType === 'iptv' && (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800">IPTV/VLAN Tagging will be applied with VLAN ID <span className="font-semibold">{formData.vlanId}</span>. Multicast traffic will be prioritized.</p>
            </div>
          )}

          {/* Voice Mode */}
          {profileType === 'voice' && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-800">Voice/SIP configuration will be applied. QoS priority will be set to ensure call quality.</p>
            </div>
          )}
        </div>
      </div>

      {/* Execute Button */}
      <button
        onClick={handleExecute}
        disabled={isExecuting}
        className={`w-full py-3 px-4 rounded-lg font-semibold text-white text-lg transition-all ${
          isExecuting
            ? 'bg-gray-400 cursor-not-allowed'
            : 'bg-red-600 hover:bg-red-700 shadow-lg'
        }`}
      >
        {isExecuting ? 'Executing...' : 'Run'}
      </button>

      {/* Live Execution Logs */}
      <div className="bg-gray-900 rounded-lg p-6 shadow-lg border border-gray-700">
        <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
          <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
          Live Execution Logs
        </h3>
        <div className="bg-black rounded p-4 font-mono text-sm text-green-400 h-64 overflow-y-auto whitespace-pre-wrap">
          {displayedLog || <span className="text-gray-600">Execute OMCI command to see logs...</span>}
        </div>
      </div>
    </div>
  )
}
