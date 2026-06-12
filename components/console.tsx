'use client'

import { useState, useEffect, useRef, KeyboardEvent, useCallback } from 'react'
import { X, Loader2, CheckCircle, Cable, Search, Save, ToggleLeft, ToggleRight, Power, PowerOff, CheckCircle2, XCircle, AlertCircle, RefreshCw, Usb, MonitorSmartphone, Trash2 } from 'lucide-react'
import type { UseSerialConnectionReturn, DetectedPort } from '@/hooks/use-serial-connection'
const API_BASE = ''

interface ConsoleProps {
  page: 'inspect' | 'outband' | 'inband' | 'terminal' | 'telnet' | 'ssh'
  serial: UseSerialConnectionReturn
}

// Toast notification component
function Toast({ 
  message, 
  type, 
  onClose 
}: { 
  message: string
  type: 'success' | 'error' | 'info'
  onClose: () => void 
}) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000)
    return () => clearTimeout(timer)
  }, [onClose])

  const bgColor = type === 'success' ? 'bg-emerald-50 border-emerald-200' : 
                  type === 'error' ? 'bg-red-50 border-red-200' : 
                  'bg-blue-50 border-blue-200'
  const textColor = type === 'success' ? 'text-emerald-700' : 
                    type === 'error' ? 'text-red-700' : 
                    'text-blue-700'
  const Icon = type === 'success' ? CheckCircle2 : type === 'error' ? XCircle : AlertCircle

  return (
    <div className={`fixed top-20 right-4 z-50 p-4 rounded-lg border shadow-lg ${bgColor} animate-in slide-in-from-right duration-300`}>
      <div className="flex items-center gap-3">
        <Icon size={20} className={textColor} />
        <p className={`text-sm font-medium ${textColor}`}>{message}</p>
        <button onClick={onClose} className={`ml-2 ${textColor} hover:opacity-70`}>
          <X size={16} />
        </button>
      </div>
    </div>
  )
}

const oltIdToName: Record<string, string> = {
  'c600': 'ZTE C600',
  'c300': 'ZTE C300',
  'c320': 'ZTE C320'
}

// ────────────────────────────────────────────────────────────────────────
// Connection Wizard Modal — now triggers real Python serial connection
// ────────────────────────────────────────────────────────────────────────

export function ConnectionWizardModal({ 
  isOpen, 
  onClose, 
  onSuccess,
  selectedOLT,
  onOLTChange,
  serial,
}: { 
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  selectedOLT: string
  onOLTChange: (oltId: string) => void
  serial: UseSerialConnectionReturn
}) {
  const [step, setStep] = useState<'question' | 'oltType' | 'baudrate' | 'connecting' | 'success' | 'error'>('question')
  const [baudrate, setBaudrate] = useState('9600')
  const [detectedPorts, setDetectedPorts] = useState<DetectedPort[]>([])
  const [selectedPort, setSelectedPort] = useState('')
  const [isScanning, setIsScanning] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [isHardwareError, setIsHardwareError] = useState(false)
  const baudrateOptions = ['9600', '19200', '38400', '57600', '115200']

  // Scan for ports when entering the baudrate/port selection step
  const doScan = useCallback(async () => {
    setIsScanning(true)
    const ports = await serial.scanPorts()
    setDetectedPorts(ports)
    if (ports.length > 0 && !selectedPort) {
      setSelectedPort(ports[0].device)
    }
    setIsScanning(false)
  }, [serial, selectedPort])

  const handleYes = () => {
    setStep('oltType')
  }

  const handleNo = () => {
    onClose()
    setStep('question')
  }

  const handleOltTypeNext = () => {
    setStep('baudrate')
    doScan()
  }

  const handleConnect = async () => {
    if (!selectedPort) {
      setErrorMessage('No serial port selected. Please plug in a console cable and scan again.')
      setIsHardwareError(false)
      setStep('error')
      return
    }
    setStep('connecting')

    const result = await serial.connect(selectedPort, parseInt(baudrate), selectedOLT)
    
    if (result.is_connected) {
      setIsHardwareError(false)
      setStep('success')
    } else {
      const err = result.error || 'Failed to connect to the serial port.'
      setErrorMessage(err)
      // Detect hardware mismatch / unrecognized errors from the backend
      const isHwErr = err.includes('mismatch') || err.includes('not recognised') || err.includes('Hardware')
      setIsHardwareError(isHwErr)
      setStep('error')
    }
  }

  const handleContinue = () => {
    onSuccess()
    setStep('question')
  }

  const handleRetry = () => {
    setStep('baudrate')
    doScan()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white/95 backdrop-blur-md rounded-xl shadow-2xl border border-red-100 w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-red-100 bg-gradient-to-r from-red-50 to-white rounded-t-xl">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 rounded-lg">
              <Cable size={20} className="text-red-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Console Connection</h3>
              {serial.backendOnline ? (
                <span className="text-xs text-emerald-600 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  Hardware Agent Online
                </span>
              ) : (
                <span className="text-xs text-red-500 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400"></span>
                  Hardware Agent Offline
                </span>
              )}
            </div>
          </div>
          <button
            onClick={handleNo}
            className="p-2 hover:bg-red-100 rounded-lg transition-colors"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        <div className="p-6">
          {/* Step 1: Connection Question */}
          {step === 'question' && (
            <div className="text-center space-y-6">
              {!serial.backendOnline && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-700">
                    <span className="font-medium">Backend not running.</span> Start the Hardware Agent first:
                  </p>
                  <code className="text-xs bg-red-100 px-2 py-1 rounded mt-1 block text-red-800 font-mono">
                    cd backend && python main.py
                  </code>
                </div>
              )}
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-gray-700 font-medium">
                  Is the device connected to the OLT console cable?
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleNo}
                  className="flex-1 px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg transition-colors border border-gray-300"
                >
                  No
                </button>
                <button
                  onClick={handleYes}
                  disabled={!serial.backendOnline}
                  className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Yes
                </button>
              </div>
            </div>
          )}

          {/* Step 2: OLT Type Selection */}
          {step === 'oltType' && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select OLT Type
                </label>
                <select
                  value={selectedOLT}
                  onChange={(e) => onOLTChange(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white/80 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-gray-900"
                >
                  {Object.entries(oltIdToName).map(([id, name]) => (
                    <option key={id} value={id}>{name}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-2">Select the OLT model you are connecting to</p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setStep('question')}
                  className="flex-1 px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg transition-colors border border-gray-300"
                >
                  Back
                </button>
                <button
                  onClick={handleOltTypeNext}
                  className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors shadow-md"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Port & Baudrate Selection */}
          {step === 'baudrate' && (
            <div className="space-y-5">
              {/* Detected ports */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Serial Port
                  </label>
                  <button
                    onClick={doScan}
                    disabled={isScanning}
                    className="flex items-center gap-1.5 px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg transition-colors border border-gray-300 disabled:opacity-50"
                  >
                    <RefreshCw size={12} className={isScanning ? 'animate-spin' : ''} />
                    {isScanning ? 'Scanning...' : 'Rescan'}
                  </button>
                </div>

                {detectedPorts.length === 0 ? (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-center">
                    <Usb size={24} className="text-amber-500 mx-auto mb-2" />
                    <p className="text-sm text-amber-700 font-medium">No serial ports detected</p>
                    <p className="text-xs text-amber-600 mt-1">Plug in your USB-to-Serial console cable and click Rescan</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {detectedPorts.map((port) => (
                      <button
                        key={port.device}
                        onClick={() => setSelectedPort(port.device)}
                        className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left ${
                          selectedPort === port.device
                            ? 'border-red-400 bg-red-50 ring-2 ring-red-200'
                            : 'border-gray-200 bg-white hover:border-red-200 hover:bg-red-50/50'
                        }`}
                      >
                        <MonitorSmartphone size={18} className={selectedPort === port.device ? 'text-red-600' : 'text-gray-400'} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900">{port.device}</p>
                          <p className="text-xs text-gray-500 truncate">{port.adapter_name || port.description}</p>
                        </div>
                        {selectedPort === port.device && (
                          <CheckCircle2 size={16} className="text-red-600 flex-shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Baudrate */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Speed / Baudrate
                </label>
                <select
                  value={baudrate}
                  onChange={(e) => setBaudrate(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white/80 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-gray-900"
                >
                  {baudrateOptions.map((rate) => (
                    <option key={rate} value={rate}>{rate} baud</option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-2">Default: 9600 baud for most ZTE OLT devices</p>
              </div>

              {/* Summary */}
              <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-1">
                <p className="text-sm text-gray-600">
                  <span className="font-medium">OLT:</span> {oltIdToName[selectedOLT] || 'ZTE C600'}
                </p>
                <p className="text-sm text-gray-600">
                  <span className="font-medium">Port:</span> {selectedPort || 'None selected'}
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep('oltType')}
                  className="flex-1 px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg transition-colors border border-gray-300"
                >
                  Back
                </button>
                <button
                  onClick={handleConnect}
                  disabled={!selectedPort || serial.isConnecting}
                  className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {serial.isConnecting ? 'Connecting...' : 'Connect'}
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Connecting */}
          {step === 'connecting' && (
            <div className="text-center space-y-6 py-8">
              <Loader2 size={48} className="text-red-600 animate-spin mx-auto" />
              <div>
                <p className="text-gray-700 font-medium">Connecting to {selectedPort}...</p>
                <p className="text-sm text-gray-500 mt-2">{oltIdToName[selectedOLT] || 'ZTE C600'} @ {baudrate} baud</p>
              </div>
            </div>
          )}

          {/* Step 5: Success */}
          {step === 'success' && (
            <div className="text-center space-y-6 py-4">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-center gap-3">
                <CheckCircle size={24} className="text-emerald-600" />
                <div className="text-left">
                  <p className="text-emerald-700 font-semibold">Successfully connected!</p>
                  <p className="text-sm text-emerald-600">
                    {selectedPort} @ {baudrate} baud
                    {serial.status.adapter_name && ` (${serial.status.adapter_name})`}
                  </p>
                </div>
              </div>
              <button
                onClick={handleContinue}
                className="w-full px-4 py-3 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors shadow-md"
              >
                Continue to Console
              </button>
            </div>
          )}

          {/* Error */}
          {step === 'error' && (
            <div className="text-center space-y-6 py-4">
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center justify-center gap-3">
                <XCircle size={24} className="text-red-600" />
                <div className="text-left">
                  <p className="text-red-700 font-semibold">Connection Failed</p>
                  <p className="text-sm text-red-600">{errorMessage}</p>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleNo}
                  className="flex-1 px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg transition-colors border border-gray-300"
                >
                  Cancel
                </button>
                {isHardwareError ? (
                  <button
                    onClick={() => setStep('oltType')}
                    className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors shadow-md"
                  >
                    Change OLT Type
                  </button>
                ) : (
                  <button
                    onClick={handleRetry}
                    className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors shadow-md"
                  >
                    Retry
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Inspect Page
// ────────────────────────────────────────────────────────────────────────

interface RouteInfo {
  destination: string
  mask: string
  gateway: string
  interface: string
  owner: string
}

function InspectPage({ serial }: { serial: UseSerialConnectionReturn }) {
  const [isChecking, setIsChecking] = useState(false)
  const [results, setResults] = useState<RouteInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleCheckIPs = async () => {
    if (!serial.status.is_connected) {
      setError('Not connected to OLT. Please connect via the Console cable first.')
      return
    }
    setIsChecking(true)
    setResults(null)
    setError(null)

    try {
      const res = await fetch(`${API_BASE}/api/console/inspect-ip`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(body.detail || 'Failed to fetch interface data')
      }
      const data: RouteInfo[] = await res.json()
      setResults(data)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setError(message)
    } finally {
      setIsChecking(false)
    }
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6">
      <div>
        <h2 className="text-2xl md:text-3xl font-bold text-gray-900">Console Inspect</h2>
        <p className="text-sm text-gray-600 mt-1">Query IP interfaces live from the connected OLT</p>
      </div>

      <div className="bg-white/95 backdrop-blur-md rounded-xl shadow-lg border border-red-100 p-6 space-y-5">
        {/* Connection banner */}
        {!serial.status.is_connected && (
          <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <AlertCircle size={18} className="text-amber-500 flex-shrink-0" />
            <p className="text-sm text-amber-700">Connect to an OLT first via the console cable wizard.</p>
          </div>
        )}

        {/* Action button */}
        <button
          id="btn-check-ips"
          onClick={handleCheckIPs}
          disabled={isChecking || !serial.status.is_connected}
          className="flex items-center gap-3 px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors shadow-md disabled:opacity-70 disabled:cursor-not-allowed"
        >
          {isChecking ? (
            <Loader2 size={20} className="animate-spin" />
          ) : (
            <Search size={20} />
          )}
          <span>{isChecking ? 'Querying OLT...' : 'Show Routing Table'}</span>
        </button>

        {/* Error toast-style banner */}
        {error && (
          <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
            <XCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-700">Error</p>
              <p className="text-sm text-red-600 mt-0.5">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">
              <X size={16} />
            </button>
          </div>
        )}

        {/* Results table */}
        {results && results.length === 0 && (
          <p className="text-sm text-gray-500 text-center py-6">No routing data returned by the OLT.</p>
        )}

        {results && results.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-gray-200 shadow-sm">
            {/* Table header */}
            <div className="grid grid-cols-5 bg-gray-900 text-gray-300 text-[10px] font-semibold uppercase tracking-wider px-4 py-3">
              <span>Destination</span>
              <span>Mask</span>
              <span>Gateway</span>
              <span>Interface</span>
              <span>Owner</span>
            </div>

            {/* Table rows */}
            <div className="divide-y divide-gray-100">
              {results.map((row, idx) => (
                <div
                  key={idx}
                  className={`grid grid-cols-5 px-4 py-3 text-[11px] items-center ${
                    idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'
                  } hover:bg-red-50/40 transition-colors`}
                >
                  <span className="font-mono font-medium text-gray-800">{row.destination}</span>
                  <span className="font-mono text-gray-600">{row.mask}</span>
                  <span className={`font-mono ${row.gateway === '0.0.0.0' ? 'text-gray-400' : 'text-gray-700'}`}>
                    {row.gateway}
                  </span>
                  <span className="text-gray-700 truncate pr-2" title={row.interface}>{row.interface}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium w-fit ${
                    row.owner.toLowerCase() === 'direct' ? 'bg-emerald-100 text-emerald-700' : 
                    row.owner.toLowerCase() === 'static' ? 'bg-blue-100 text-blue-700' : 
                    'bg-gray-100 text-gray-700'
                  }`}>
                    {row.owner}
                  </span>
                </div>
              ))}
            </div>

            {/* Footer summary */}
            <div className="bg-gray-50 border-t border-gray-200 px-4 py-2 flex items-center justify-between">
              <span className="text-xs text-gray-500">{results.length} route{results.length !== 1 ? 's' : ''} found</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}


// ────────────────────────────────────────────────────────────────────────
// Out-Band IP Page
// ────────────────────────────────────────────────────────────────────────

function OutBandIPPage({ serial }: { serial: UseSerialConnectionReturn }) {
  const [ipAddress, setIpAddress] = useState('')
  const [subnet, setSubnet] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null)

  useEffect(() => {
    if (!serial.status.is_connected) {
      setToast({ message: 'Please connect the console cable first.', type: 'error' })
      return
    }

    const fetchData = async () => {
      setIsLoading(true)
      try {
        const res = await fetch(`${API_BASE}/api/console/out-band`)
        if (!res.ok) {
          const body = await res.json().catch(() => ({ detail: res.statusText }))
          throw new Error(body.detail || 'Failed to fetch config')
        }
        const data = await res.json()
        if (data.ip) setIpAddress(data.ip)
        if (data.subnet) setSubnet(data.subnet)
        
        setToast({ message: 'Out-band configuration fetched from OLT', type: 'success' })
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        setToast({ message: `Failed to fetch: ${message}`, type: 'error' })
      } finally {
        setIsLoading(false)
      }
    }
    
    fetchData()
  }, [serial.status.is_connected])

  const handleSave = async () => {
    if (!serial.status.is_connected) {
       setToast({ message: 'Please connect the console cable first.', type: 'error' })
       return
    }
    if (!ipAddress || !subnet) {
       setToast({ message: 'IP and Subnet cannot be empty', type: 'error' })
       return
    }
    setIsSaving(true)
    setSaved(false)
    try {
      const res = await fetch(`${API_BASE}/api/console/out-band`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: ipAddress, subnet })
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(body.detail || 'Failed to save config')
      }
      setSaved(true)
      setToast({ message: 'Settings saved successfully to OLT', type: 'success' })
      setTimeout(() => setSaved(false), 2000)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setToast({ message: `Failed to save: ${message}`, type: 'error' })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6">
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      <div>
        <h2 className="text-2xl md:text-3xl font-bold text-gray-900">Out-Band IP Configuration</h2>
        <p className="text-sm text-gray-600 mt-1">Configure out-of-band management IP address</p>
      </div>

      <div className="bg-white/95 backdrop-blur-md rounded-xl shadow-lg border border-red-100 p-6 max-w-xl">
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">IP Address</label>
            <div className="relative">
              <input
                type="text"
                value={ipAddress}
                onChange={(e) => setIpAddress(e.target.value)}
                disabled={isLoading || !serial.status.is_connected}
                placeholder={isLoading ? 'Fetching IP...' : 'e.g. 192.168.1.1'}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-amber-50/50 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-gray-900 font-mono disabled:opacity-50"
              />
              {isLoading && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <Loader2 size={16} className="animate-spin text-gray-400" />
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Subnet</label>
            <div className="relative">
              <input
                type="text"
                value={subnet}
                onChange={(e) => setSubnet(e.target.value)}
                disabled={isLoading || !serial.status.is_connected}
                placeholder={isLoading ? 'Fetching Subnet...' : 'e.g. 255.255.255.0'}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-amber-50/50 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-gray-900 font-mono disabled:opacity-50"
              />
              {isLoading && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <Loader2 size={16} className="animate-spin text-gray-400" />
                </div>
              )}
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors shadow-md disabled:opacity-70"
          >
            {isSaving ? (
              <Loader2 size={18} className="animate-spin" />
            ) : saved ? (
              <CheckCircle size={18} />
            ) : (
              <Save size={18} />
            )}
            <span>{isSaving ? 'Saving...' : saved ? 'Saved!' : 'Save'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// In-Band IP Page
// ────────────────────────────────────────────────────────────────────────

function InBandIPPage({ serial }: { serial: UseSerialConnectionReturn }) {
  const [enabled, setEnabled] = useState(true)
  const [ipAddress, setIpAddress] = useState('')
  const [subnet, setSubnet] = useState('')
  const [gateway, setGateway] = useState('')
  const [vlanId, setVlanId] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null)

  useEffect(() => {
    setEnabled(true)
    if (!serial.status.is_connected) {
      setToast({ message: 'Please connect the console cable first.', type: 'error' })
      return
    }

    const fetchData = async () => {
      setIsLoading(true)
      try {
        const res = await fetch(`${API_BASE}/api/console/in-band`)
        if (!res.ok) {
          const body = await res.json().catch(() => ({ detail: res.statusText }))
          throw new Error(body.detail || 'Failed to fetch config')
        }
        const data = await res.json()
        if (data.ip) setIpAddress(data.ip)
        if (data.subnet) setSubnet(data.subnet)
        if (data.gateway) setGateway(data.gateway)
        if (data.vlan_id) setVlanId(data.vlan_id)
        
        setToast({ message: 'In-Band config synchronized', type: 'success' })
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        setToast({ message: `Failed to load: ${message}`, type: 'error' })
      } finally {
        setIsLoading(false)
      }
    }
    
    fetchData()
  }, [serial.status.is_connected])

  const handleSave = async () => {
    if (!serial.status.is_connected) {
       setToast({ message: 'Please connect the console cable first.', type: 'error' })
       return
    }
    if (!ipAddress || !subnet || !vlanId) {
       setToast({ message: 'IP, Subnet, and VLAN ID are required', type: 'error' })
       return
    }
    setIsSaving(true)
    setSaved(false)
    try {
      const res = await fetch(`${API_BASE}/api/console/in-band`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, ip: ipAddress, subnet, gateway, vlan_id: vlanId })
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(body.detail || 'Failed to save config')
      }
      setSaved(true)
      setToast({ message: 'In-Band config applied successfully', type: 'success' })
      setTimeout(() => setSaved(false), 2000)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setToast({ message: `Failed to save: ${message}`, type: 'error' })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6">
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      <div>
        <h2 className="text-2xl md:text-3xl font-bold text-gray-900">In-Band IP Configuration</h2>
        <p className="text-sm text-gray-600 mt-1">Configure in-band management network settings</p>
      </div>

      <div className="relative bg-white/95 backdrop-blur-md rounded-xl shadow-lg border border-red-100 p-6 max-w-xl">
        {/* Loading Overlay */}
        {isLoading && (
          <div className="absolute inset-0 z-10 bg-white/60 backdrop-blur-[2px] rounded-xl flex items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <Loader2 size={32} className="animate-spin text-red-600" />
              <p className="text-sm font-medium text-gray-700">Synchronizing with OLT...</p>
            </div>
          </div>
        )}

        <div className={`space-y-5 ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}>
          {/* Enable Toggle */}
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div>
              <p className="font-medium text-gray-900">Enable In-Band Management</p>
              <p className="text-sm text-gray-500">Allow management via in-band VLAN</p>
            </div>
            <button
              onClick={() => setEnabled(!enabled)}
              disabled={!serial.status.is_connected}
              className={`p-1 rounded-full transition-colors ${enabled ? 'bg-red-600' : 'bg-gray-300'}`}
            >
              {enabled ? (
                <ToggleRight size={32} className="text-white" />
              ) : (
                <ToggleLeft size={32} className="text-gray-600" />
              )}
            </button>
          </div>

          {/* Form fields - only show when enabled */}
          {enabled && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">IP Address</label>
                <input
                  type="text"
                  value={ipAddress}
                  onChange={(e) => setIpAddress(e.target.value)}
                  disabled={!serial.status.is_connected}
                  placeholder="e.g. 10.10.10.2"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white/80 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-gray-900 font-mono disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Subnet</label>
                <input
                  type="text"
                  value={subnet}
                  onChange={(e) => setSubnet(e.target.value)}
                  disabled={!serial.status.is_connected}
                  placeholder="e.g. 255.255.255.0"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white/80 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-gray-900 font-mono disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Gateway</label>
                <input
                  type="text"
                  value={gateway}
                  onChange={(e) => setGateway(e.target.value)}
                  disabled={!serial.status.is_connected}
                  placeholder="e.g. 10.10.10.1"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white/80 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-gray-900 font-mono disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">VLAN ID</label>
                <input
                  type="text"
                  value={vlanId}
                  onChange={(e) => setVlanId(e.target.value)}
                  disabled={!serial.status.is_connected}
                  placeholder="e.g. 100"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white/80 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-gray-900 font-mono disabled:opacity-50"
                />
              </div>

              <button
                onClick={handleSave}
                disabled={isSaving || !serial.status.is_connected}
                className="flex items-center gap-2 px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors shadow-md disabled:opacity-70"
              >
                {isSaving ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : saved ? (
                  <CheckCircle size={18} />
                ) : (
                  <Save size={18} />
                )}
                <span>{isSaving ? 'Saving...' : saved ? 'Saved!' : 'Save'}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Live Terminal Page — WebSocket-backed, raw keystroke forwarding
// ────────────────────────────────────────────────────────────────────────

function TerminalPage({ serial }: { serial: UseSerialConnectionReturn }) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const hiddenInputRef = useRef<HTMLTextAreaElement>(null)
  const [toastMsg, setToastMsg] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null)

  // Open WebSocket on mount, close on unmount
  useEffect(() => {
    serial.openTerminalWs({
      onWarning: (msg) => setToastMsg({ message: msg, type: 'info' }),
    })
    return () => {
      serial.closeTerminalWs()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-scroll to bottom when output changes
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [serial.terminalOutput])

  // Focus hidden input when clicking terminal
  const focusTerminal = () => {
    const selection = window.getSelection()
    if (selection && selection.toString().length > 0) {
      // User is currently highlighting/selecting text, do not steal focus
      return
    }
    hiddenInputRef.current?.focus()
  }

  // Handle raw keystrokes → send to backend
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault()

    let data = ''

    // Map special keys to their terminal escape / control codes
    switch (e.key) {
      case 'Enter':
        data = '\r'
        break
      case 'Tab':
        data = '\t'
        break
      case 'Backspace':
        data = '\x7f'  // DEL
        break
      case 'Delete':
        data = '\x1b[3~'
        break
      case 'Escape':
        data = '\x1b'
        break
      case 'ArrowUp':
        data = '\x1b[A'
        break
      case 'ArrowDown':
        data = '\x1b[B'
        break
      case 'ArrowRight':
        data = '\x1b[C'
        break
      case 'ArrowLeft':
        data = '\x1b[D'
        break
      case 'Home':
        data = '\x1b[H'
        break
      case 'End':
        data = '\x1b[F'
        break
      case 'PageUp':
        data = '\x1b[5~'
        break
      case 'PageDown':
        data = '\x1b[6~'
        break
      case 'F1': data = '\x1bOP'; break
      case 'F2': data = '\x1bOQ'; break
      case 'F3': data = '\x1bOR'; break
      case 'F4': data = '\x1bOS'; break
      case 'F5': data = '\x1b[15~'; break
      case 'F6': data = '\x1b[17~'; break
      case 'F7': data = '\x1b[18~'; break
      case 'F8': data = '\x1b[19~'; break
      case 'F9': data = '\x1b[20~'; break
      case 'F10': data = '\x1b[21~'; break
      case 'F11': data = '\x1b[23~'; break
      case 'F12': data = '\x1b[24~'; break
      default:
        // Ctrl+key combos
        if (e.ctrlKey && e.key.length === 1) {
          const code = e.key.toUpperCase().charCodeAt(0) - 64
          if (code >= 0 && code <= 31) {
            data = String.fromCharCode(code)
          }
        } else if (e.key === '?' || (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey)) {
          // Regular printable characters (including '?' for OLT help)
          data = e.key
        }
        break
    }

    if (data) {
      serial.sendInput(data)
    }
  }

  // Render terminal output with basic ANSI-aware display
  const renderOutput = () => {
    const raw = serial.terminalOutput
    let result = ''
    
    // Clean up basic ANSI escape codes first (colors, etc)
    const sanitized = raw
      .replace(/\x1b\[[0-9;]*m/g, '') // colors
      .replace(/\x1b\[[0-9;]*[ABCDHJ]/g, '') // cursor movement
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '') // other ESC sequences
    
    // Process characters one by one to handle \b (backspace) and \r (carriage return)
    for (let i = 0; i < sanitized.length; i++) {
      const char = sanitized[i]
      if (char === '\b') {
        // Backspace: remove last character
        result = result.slice(0, -1)
      } else if (char === '\r') {
        // Only render \r or translate appropriately if needed, but not forcing extra \n
        result += '\r'
      } else {
        result += char
      }
    }
    
    return result
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6">
      {/* Hardware mismatch warning toast */}
      {toastMsg && (
        <Toast
          message={toastMsg.message}
          type={toastMsg.type}
          onClose={() => setToastMsg(null)}
        />
      )}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-gray-900">Console Terminal</h2>
          <p className="text-sm text-gray-600 mt-1">
            Live serial console — keystrokes forwarded directly to the OLT
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Connection indicator */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-white/90 rounded-lg border border-gray-200 shadow-sm">
            <span className={`w-2 h-2 rounded-full ${
              serial.status.is_connected && serial.wsConnected
                ? 'bg-emerald-500 animate-pulse'
                : serial.status.is_connected
                  ? 'bg-yellow-500'
                  : 'bg-red-400'
            }`}></span>
            <span className="text-xs font-medium text-gray-600">
              {serial.status.is_connected && serial.wsConnected
                ? 'Live'
                : serial.status.is_connected
                  ? 'Serial OK / WS Connecting...'
                  : 'Disconnected'}
            </span>
          </div>
          {/* Clear button */}
          <button
            onClick={serial.clearTerminal}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg transition-colors border border-gray-300"
            title="Clear terminal output"
          >
            <Trash2 size={14} />
            Clear
          </button>
        </div>
      </div>

      <div className="relative">
        {/* Terminal Window */}
        <div className="bg-gray-950 rounded-xl shadow-2xl border border-gray-700 overflow-hidden">
          {/* Terminal Header */}
          <div className="flex items-center gap-2 px-4 py-2 bg-gray-900 border-b border-gray-700">
            <div className="w-3 h-3 rounded-full bg-red-500"></div>
            <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
            <div className="w-3 h-3 rounded-full bg-green-500"></div>
            <span className="ml-4 text-sm text-gray-400 font-mono">
              {serial.status.is_connected
                ? `${serial.status.port} — ${oltIdToName[serial.status.olt_type] || 'OLT'} Console @ ${serial.status.baudrate} baud`
                : 'No serial connection'
              }
            </span>
            {serial.status.adapter_name && (
              <span className="ml-auto text-xs text-gray-500 font-mono">{serial.status.adapter_name}</span>
            )}
          </div>

          {/* Terminal Content */}
          <div
            ref={terminalRef}
            className="p-4 h-[500px] overflow-y-auto font-mono text-sm cursor-text"
            onClick={focusTerminal}
          >
            {!serial.status.is_connected ? (
              <div className="h-full flex flex-col items-center justify-center text-gray-500 space-y-3">
                <Cable size={40} className="text-gray-600" />
                <p className="text-gray-400">No active serial connection</p>
                <p className="text-xs text-gray-600">Use the Console menu in the sidebar to connect</p>
              </div>
            ) : serial.terminalOutput ? (
              <pre className="text-gray-200 whitespace-pre-wrap break-words leading-relaxed">
                <span>{renderOutput()}</span>
                {serial.status.is_connected && (
                  <span className="inline-block w-2 h-4 bg-emerald-400 animate-pulse align-middle"></span>
                )}
              </pre>
            ) : (
              <div className="text-gray-500">
                <p>Connected to {serial.status.port}. Waiting for data...</p>
                <p className="text-xs mt-1 text-gray-600">Press Enter to wake the OLT CLI.</p>
                <span className="inline-block w-2 h-4 bg-emerald-400 animate-pulse ml-1 align-middle"></span>
              </div>
            )}

            {/* Blinking cursor is now inline inside pre block if output exists */}
            {serial.status.is_connected && !serial.terminalOutput && (
              <span className="inline-block w-2 h-4 bg-emerald-400 animate-pulse align-middle"></span>
            )}
          </div>

          {/* Hidden input to capture keystrokes */}
          <textarea
            ref={hiddenInputRef}
            className="absolute opacity-0 w-0 h-0 overflow-hidden"
            onKeyDown={handleKeyDown}
            autoFocus
            aria-label="Terminal input"
          />
        </div>
      </div>

      {/* Keyboard hints */}
      <div className="flex flex-wrap gap-2 text-xs text-gray-500">
        <span className="px-2 py-1 bg-gray-100 rounded border border-gray-200 font-mono">?</span>
        <span>Help</span>
        <span className="text-gray-300">|</span>
        <span className="px-2 py-1 bg-gray-100 rounded border border-gray-200 font-mono">Tab</span>
        <span>Autocomplete</span>
        <span className="text-gray-300">|</span>
        <span className="px-2 py-1 bg-gray-100 rounded border border-gray-200 font-mono">↑↓</span>
        <span>History</span>
        <span className="text-gray-300">|</span>
        <span className="px-2 py-1 bg-gray-100 rounded border border-gray-200 font-mono">Ctrl+C</span>
        <span>Interrupt</span>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Telnet Config Page
// ────────────────────────────────────────────────────────────────────────

function TelnetConfigPage() {
  const [telnetEnabled, setTelnetEnabled] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null)

  const handleEnableTelnet = () => {
    if (telnetEnabled) {
      setToast({ message: 'Telnet is already enabled', type: 'info' })
    } else {
      setTelnetEnabled(true)
      setToast({ message: 'Telnet successfully enabled', type: 'success' })
    }
  }

  const handleDisableTelnet = () => {
    if (!telnetEnabled) {
      setToast({ message: 'Telnet is not enabled yet', type: 'error' })
    } else {
      setTelnetEnabled(false)
      setToast({ message: 'Telnet successfully disabled', type: 'success' })
    }
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6">
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      <div>
        <h2 className="text-2xl md:text-3xl font-bold text-gray-900">Telnet Configuration</h2>
        <p className="text-sm text-gray-600 mt-1">Enable or disable Telnet access to the OLT</p>
      </div>

      <div className="bg-white/95 backdrop-blur-md rounded-xl shadow-lg border border-red-100 p-6 max-w-xl">
        <div className="space-y-6">
          {/* Status Indicator */}
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div>
              <p className="font-medium text-gray-900">Telnet Service Status</p>
              <p className="text-sm text-gray-500">Current state of Telnet access</p>
            </div>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${
              telnetEnabled 
                ? 'bg-emerald-100 text-emerald-700' 
                : 'bg-gray-200 text-gray-600'
            }`}>
              {telnetEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-4">
            <button
              onClick={handleEnableTelnet}
              className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors shadow-md"
            >
              <Power size={18} />
              <span>Enable Telnet</span>
            </button>
            <button
              onClick={handleDisableTelnet}
              className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors shadow-md"
            >
              <PowerOff size={18} />
              <span>Disable Telnet</span>
            </button>
          </div>

          {/* Info Note */}
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-sm text-amber-700">
              <span className="font-medium">Note:</span> Disabling Telnet will only allow console access. Make sure you have physical access to the device before disabling.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// SSH Config Page
// ────────────────────────────────────────────────────────────────────────

function SSHConfigPage() {
  const [sshEnabled, setSSHEnabled] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null)

  const handleEnableSSH = () => {
    if (sshEnabled) {
      setToast({ message: 'SSH is already enabled', type: 'info' })
    } else {
      setSSHEnabled(true)
      setToast({ message: 'SSH successfully enabled', type: 'success' })
    }
  }

  const handleDisableSSH = () => {
    if (!sshEnabled) {
      setToast({ message: 'SSH is not enabled yet', type: 'error' })
    } else {
      setSSHEnabled(false)
      setToast({ message: 'SSH successfully disabled', type: 'success' })
    }
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6">
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      <div>
        <h2 className="text-2xl md:text-3xl font-bold text-gray-900">SSH Configuration</h2>
        <p className="text-sm text-gray-600 mt-1">Enable or disable SSH access to the OLT</p>
      </div>

      <div className="bg-white/95 backdrop-blur-md rounded-xl shadow-lg border border-red-100 p-6 max-w-xl">
        <div className="space-y-6">
          {/* Status Indicator */}
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div>
              <p className="font-medium text-gray-900">SSH Service Status</p>
              <p className="text-sm text-gray-500">Current state of SSH access</p>
            </div>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${
              sshEnabled 
                ? 'bg-emerald-100 text-emerald-700' 
                : 'bg-gray-200 text-gray-600'
            }`}>
              {sshEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-4">
            <button
              onClick={handleEnableSSH}
              className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors shadow-md"
            >
              <Power size={18} />
              <span>Enable SSH</span>
            </button>
            <button
              onClick={handleDisableSSH}
              className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors shadow-md"
            >
              <PowerOff size={18} />
              <span>Disable SSH</span>
            </button>
          </div>

          {/* Info Note */}
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-sm text-amber-700">
              <span className="font-medium">Note:</span> SSH provides encrypted remote access. It is recommended to keep SSH enabled and disable Telnet for better security.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Main Console Component
// ────────────────────────────────────────────────────────────────────────

export default function Console({ page, serial }: ConsoleProps) {
  switch (page) {
    case 'inspect':
      return <InspectPage serial={serial} />
    case 'outband':
      return <OutBandIPPage serial={serial} />
    case 'inband':
      return <InBandIPPage serial={serial} />
    case 'terminal':
      return <TerminalPage serial={serial} />
    case 'telnet':
      return <TelnetConfigPage />
    case 'ssh':
      return <SSHConfigPage />
    default:
      return <InspectPage serial={serial} />
  }
}
