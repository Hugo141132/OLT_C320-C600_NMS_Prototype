'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronUp, ChevronDown, AlertCircle, CheckCircle, CheckCircle2, Wifi, WifiOff, HelpCircle, X, Trash2, MapPin, Settings, ChevronRight, Lock, Unlock, Plus, PlusCircle, ToggleLeft, ToggleRight, Loader2, Search, RefreshCw, Terminal, Eye, EyeOff, Activity, BarChart3 as BarChart, Globe, Edit, Thermometer } from 'lucide-react'
import { useNetworkAgent } from '@/lib/context/NetworkAgentContext'
import OLTSelector from './olt-selector'
import type L from 'leaflet'
// Leaflet is loaded dynamically client-side to avoid SSR `window is not defined`
let leafletModule: typeof import('leaflet') | null = null
if (typeof window !== 'undefined') {
  import('leaflet').then((mod) => { leafletModule = mod })
  import('leaflet/dist/leaflet.css')
}
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceArea } from 'recharts'
import { ONU } from '@/lib/types'

interface LanPortConfig {
  enabled: boolean
  targetPort: number
  mode: 'tag' | 'transparent'
  taggedVlanId: string
}

interface WifiPortConfig {
  slot: number
  port: number
  ssidName: string
  state: 'lock' | 'unlock'
  authType: 'Open System' | 'WPA-PSK' | 'WPA/WPA2-PSK' | 'WPA2-PSK' | 'WPA3-SAE' | 'WPA2-PSK/WPA3-SAE'
  passphrase?: string
  maxUsers?: number
  hide?: boolean
}

interface ConfigFormData {
  // Step 1
  rack: string
  slot: string
  port: string
  onuIndex: string
  tcontProfile: string
  tcontNo: string
  gemportNo: string
  servicePort: string
  vport: string
  // Step 2
  connectionType: 'bridge' | 'pppoe' | 'dhcp' | 'static' | ''
  vlanId: string
  numLanPorts: number
  lanPorts: LanPortConfig[]
  // PPPoE specific
  username: string
  password: string
  vlanProfile: string
  mode: 'tag' | 'transparent'
  taggedVlanId: string
  serviceName: string
  veipName: string
  wanIpIndex: string
  host: string
  wan: string
  securityMgmtNum: string
  protocols: string[]
  // Static specific
  ipAddress: string
  subnet: string
  gateway: string
  dnsPrimary: string
  dnsSecondary: string
  // Step 3
  numWifiPorts: number
  wifiConfigs: WifiPortConfig[]
}

// Mock data for different OLT types
const mockONUsZTEC600: ONU[] = [
  { id: '1', status: 'online', oltCard: 1, port: 1, onuNumber: 1, sn: 'ZTE-ONU-001', onuType: 'ZTE F601', trafficUp: 120, trafficDown: 450, opticalPower: -18.2, powerTx: 2.1, lat: -6.2088, lng: 106.8456, address: 'Jl. Sudirman No. 123, Jakarta Pusat 10270', ip: '192.168.1.101' },
  { id: '2', status: 'online', oltCard: 1, port: 1, onuNumber: 2, sn: 'ZTE-ONU-002', onuType: 'ZTE F601', trafficUp: 85, trafficDown: 320, opticalPower: -17.9, powerTx: 2.3, lat: -6.2150, lng: 106.8300, address: 'Jl. Gatot Subroto Kav. 52, Jakarta Selatan 12950', ip: '192.168.1.102' },
  { id: '3', status: 'offline', oltCard: 1, port: 2, onuNumber: 1, sn: 'ZTE-ONU-003', onuType: 'ZTE F601', trafficUp: 0, trafficDown: 0, opticalPower: -32.1, lat: -6.1751, lng: 106.8650, address: 'Jl. Pemuda No. 45, Jakarta Timur 13220' },
  { id: '4', status: 'online', oltCard: 1, port: 2, onuNumber: 2, sn: 'ZTE-ONU-004', onuType: 'ZTE F602', trafficUp: 280, trafficDown: 680, opticalPower: -18.0, powerTx: 2.0, lat: -6.2200, lng: 106.8100, address: 'Jl. Rasuna Said Kav. B-10, Jakarta Selatan 12940', ip: '192.168.1.104' },
  { id: '5', status: 'unconfigured', oltCard: 1, port: 3, onuNumber: 1, sn: 'ZTE-ONU-005', onuType: 'ZTE F601', trafficUp: 0, trafficDown: 0, opticalPower: -19.5, powerTx: 2.2, lat: -6.1900, lng: 106.7950, address: 'Jl. Kebon Sirih No. 78, Jakarta Pusat 10110' },
  { id: '6', status: 'online', oltCard: 2, port: 1, onuNumber: 1, sn: 'ZTE-ONU-006', onuType: 'ZTE F602', trafficUp: 156, trafficDown: 512, opticalPower: -18.5, powerTx: 2.4, lat: -6.2300, lng: 106.7800, address: 'Jl. Palmerah Utara No. 22, Jakarta Barat 11480', ip: '192.168.1.106' },
  { id: '7', status: 'offline', oltCard: 2, port: 1, onuNumber: 2, sn: 'ZTE-ONU-007', onuType: 'ZTE F601', trafficUp: 0, trafficDown: 0, opticalPower: -35.0, lat: -6.1650, lng: 106.9000, address: 'Jl. Raya Bekasi KM 25, Jakarta Timur 13930' },
  { id: '8', status: 'online', oltCard: 2, port: 2, onuNumber: 1, sn: 'ZTE-ONU-008', onuType: 'ZTE F602', trafficUp: 95, trafficDown: 380, opticalPower: -18.3, powerTx: 2.5, lat: -6.1500, lng: 106.8200, address: 'Jl. Pluit Selatan Raya No. 15, Jakarta Utara 14450', ip: '192.168.1.108' },
  { id: '9', status: 'unregistered', oltCard: 2, port: 3, onuNumber: 1, sn: 'ZTEGC7890123', onuType: 'ZTE F601', trafficUp: 0, trafficDown: 0, opticalPower: -20.1, powerTx: 2.0, lat: -6.2050, lng: 106.8400, address: 'Jl. Thamrin No. 55, Jakarta Pusat 10350' },
  { id: '10', status: 'unregistered', oltCard: 2, port: 3, onuNumber: 2, sn: 'ZTEGC4567890', onuType: 'ZTE F602', trafficUp: 0, trafficDown: 0, opticalPower: -19.8, powerTx: 2.1, lat: -6.1980, lng: 106.8520, address: 'Jl. Menteng Raya No. 12, Jakarta Pusat 10310' },
]

const mockONUsZTEC300: ONU[] = [
  { id: 'c300-1', status: 'online', oltCard: 1, port: 1, onuNumber: 1, sn: 'C300-ONU-001', onuType: 'ZTE F660', trafficUp: 200, trafficDown: 600, opticalPower: -19.1, powerTx: 2.2, distance: 2.5, lastSeen: '2026-04-16 08:00', ip: '10.0.1.101' },
  { id: 'c300-2', status: 'online', oltCard: 1, port: 2, onuNumber: 1, sn: 'C300-ONU-002', onuType: 'ZTE F660', trafficUp: 150, trafficDown: 480, opticalPower: -18.5, powerTx: 2.1, distance: 1.8, lastSeen: '2026-04-16 08:05', ip: '10.0.1.102' },
  { id: 'c300-3', status: 'unconfigured', oltCard: 1, port: 3, onuNumber: 1, sn: 'C300-ONU-003', onuType: 'ZTE F670', trafficUp: 0, trafficDown: 0, opticalPower: -20.2, powerTx: 2.0, distance: 3.2, lastSeen: '2026-04-16 07:55' },
  { id: 'c300-4', status: 'offline', oltCard: 2, port: 1, onuNumber: 1, sn: 'C300-ONU-004', onuType: 'ZTE F660', trafficUp: 0, trafficDown: 0, opticalPower: -33.0, distance: 4.1, lastSeen: '2026-04-15 23:30' },
  { id: 'c300-5', status: 'online', oltCard: 2, port: 2, onuNumber: 1, sn: 'C300-ONU-005', onuType: 'ZTE F670', trafficUp: 320, trafficDown: 750, opticalPower: -17.8, powerTx: 2.3, distance: 1.2, lastSeen: '2026-04-16 08:10', ip: '10.0.1.105' },
  { id: 'c300-6', status: 'unregistered', oltCard: 2, port: 3, onuNumber: 1, sn: 'C300GC123456', onuType: 'ZTE F660', trafficUp: 0, trafficDown: 0, opticalPower: -21.0, powerTx: 2.0, distance: 2.8, lastSeen: '2026-04-16 08:12' },
]

const mockONUsZTEC320: ONU[] = [
  { id: 'c320-1', status: 'online', oltCard: 1, port: 1, onuNumber: 1, sn: 'C320-ONU-001', onuType: 'ZTE F680', trafficUp: 180, trafficDown: 550, opticalPower: -18.8, powerTx: 2.1, firmwareVersion: 'V6.0.10P2N1', macAddress: '00:1A:2B:3C:4D:01', ip: '172.16.1.101' },
  { id: 'c320-2', status: 'online', oltCard: 1, port: 2, onuNumber: 1, sn: 'C320-ONU-002', onuType: 'ZTE F680', trafficUp: 220, trafficDown: 620, opticalPower: -19.2, powerTx: 2.2, firmwareVersion: 'V6.0.10P2N1', macAddress: '00:1A:2B:3C:4D:02', ip: '172.16.1.102' },
  { id: 'c320-3', status: 'unconfigured', oltCard: 1, port: 3, onuNumber: 1, sn: 'C320-ONU-003', onuType: 'ZTE F680', trafficUp: 0, trafficDown: 0, opticalPower: -20.5, powerTx: 2.0, firmwareVersion: 'V6.0.10P2N1', macAddress: '00:1A:2B:3C:4D:03' },
  { id: 'c320-4', status: 'offline', oltCard: 2, port: 1, onuNumber: 1, sn: 'C320-ONU-004', onuType: 'ZTE F680', trafficUp: 0, trafficDown: 0, opticalPower: -34.5, firmwareVersion: 'V6.0.10P2N1', macAddress: '00:1A:2B:3C:4D:04' },
  { id: 'c320-5', status: 'unregistered', oltCard: 2, port: 2, onuNumber: 1, sn: 'C320GC789012', onuType: 'ZTE F680', trafficUp: 0, trafficDown: 0, opticalPower: -19.9, powerTx: 2.1, firmwareVersion: 'V6.0.10P2N1', macAddress: '00:1A:2B:3C:4D:05' },
]

const pastOMCICommands = [
  { timestamp: '2026-04-10 10:23:45', command: 'get-onu-config', output: 'ONU Configuration retrieved successfully. Status: Active' },
  { timestamp: '2026-04-10 10:15:12', command: 'set-traffic-policy', output: 'Traffic policy updated. QoS: High Priority' },
  { timestamp: '2026-04-10 09:58:33', command: 'restart-onu', output: 'ONU restarted successfully. Boot time: 45 seconds' },
  { timestamp: '2026-04-10 09:45:20', command: 'get-optical-stats', output: 'Optical Power: -18.2 dBm | Signal Quality: 95%' },
  { timestamp: '2026-04-10 09:30:15', command: 'enable-port', output: 'Port 1 enabled. Status: Up' },
]

const onuPowerData = [
  { time: '00:00', power: -18.5 },
  { time: '04:00', power: -18.2 },
  { time: '08:00', power: -17.9 },
  { time: '12:00', power: -18.1 },
  { time: '16:00', power: -18.3 },
  { time: '20:00', power: -18.0 },
  { time: '23:59', power: -17.8 },
]

const trafficData = [
  { time: '00:00', upload: 240, download: 380 },
  { time: '04:00', upload: 320, download: 450 },
  { time: '08:00', upload: 480, download: 520 },
  { time: '12:00', upload: 520, download: 600 },
  { time: '16:00', upload: 450, download: 550 },
  { time: '20:00', upload: 380, download: 480 },
  { time: '23:59', upload: 290, download: 400 },
]



function LocationMapTab({ onu }: { onu: ONU }) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)

  useEffect(() => {
    if (!mapContainerRef.current || !onu.lat || !onu.lng) return

    // Dynamically load leaflet on the client side
    let cancelled = false
    import('leaflet').then((L) => {
      if (cancelled || !mapContainerRef.current) return

      mapRef.current = L.map(mapContainerRef.current).setView([onu.lat!, onu.lng!], 16)

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(mapRef.current)

      const statusColor = onu.status === 'online' ? '#10b981' : 
                          onu.status === 'offline' ? '#ef4444' : 
                          onu.status === 'unregistered' ? '#8b5cf6' : '#f59e0b'
      const html = `
        <div style="
          width: 32px;
          height: 32px;
          background-color: ${statusColor};
          border: 3px solid white;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          font-weight: bold;
          color: white;
          font-size: 14px;
        ">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
        </div>
      `

      L.marker([onu.lat!, onu.lng!], {
        icon: L.divIcon({
          html,
          className: '',
          iconSize: [40, 40],
          iconAnchor: [20, 20],
          popupAnchor: [0, -20],
        }),
      }).addTo(mapRef.current)
    })

    return () => {
      cancelled = true
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [onu])

  return (
    <div className="space-y-4">
      <div className="bg-white border border-red-100 rounded-lg overflow-hidden">
        <div
          ref={mapContainerRef}
          className="w-full bg-gray-100"
          style={{ height: '300px' }}
        />
        <div className="p-4 space-y-3">
          <div className="flex items-start gap-3">
            <MapPin className="text-red-600 flex-shrink-0 mt-1" size={18} />
            <div>
              <p className="text-xs text-gray-500 mb-1">Coordinates</p>
              <p className="text-sm font-mono text-gray-900">
                {(onu.lat || -6.2088).toFixed(4)}, {(onu.lng || 106.8456).toFixed(4)}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-[18px] flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500 mb-1">Alamat</p>
              <p className="text-sm text-gray-900">
                {onu.address || 'Alamat tidak tersedia'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ONU Configuration Wizard Modal Component
function ONUConfigWizard({
  onu,
  isC6xx = false,
  onClose,
  onApply
}: {
  onu: ONU
  isC6xx?: boolean
  onClose: () => void
  onApply: (onuId: string) => void
}) {
  const [currentStep, setCurrentStep] = useState(1)
  const [step1Completed, setStep1Completed] = useState(false)
  const [formData, setFormData] = useState<ConfigFormData>({
    rack: '1',
    slot: onu.oltCard.toString(),
    port: onu.port.toString(),
    onuIndex: onu.onuNumber.toString(),
    tcontProfile: '',
    tcontNo: '1',
    gemportNo: '1',
    servicePort: '1',
    vport: '1',
    connectionType: 'pppoe',
    vlanId: '',
    numLanPorts: 0,
    lanPorts: [],
    username: '',
    password: '',
    vlanProfile: '',
    mode: 'transparent',
    taggedVlanId: '',
    serviceName: '',
    veipName: '1',
    wanIpIndex: '1',
    host: '1',
    wan: '1',
    securityMgmtNum: '1',
    protocols: ['web', 'tr069'],
    ipAddress: '',
    subnet: '',
    gateway: '',
    dnsPrimary: '',
    dnsSecondary: '',
    numWifiPorts: 0,
    wifiConfigs: [],
  })
  const [showPassphrases, setShowPassphrases] = useState<Record<number, boolean>>({})
  const [tcontProfiles, setTcontProfiles] = useState<any[]>([])
  const [vlanList, setVlanList] = useState<any[]>([])
  const [vlanProfiles, setVlanProfiles] = useState<any[]>([])
  const [isLoadingTcont, setIsLoadingTcont] = useState(false)
  const [isLoadingVlans, setIsLoadingVlans] = useState(false)
  const [isApplyingStep1, setIsApplyingStep1] = useState(false)
  const [isApplyingStep2, setIsApplyingStep2] = useState(false)
  const [isApplyingStep3, setIsApplyingStep3] = useState(false)
  const [showWizardPassword, setShowWizardPassword] = useState(false)
  const [step2Completed, setStep2Completed] = useState(false)
  const [step3Completed, setStep3Completed] = useState(false)
  const [cliLogs, setCliLogs] = useState<string[]>([])
  const [isVerifying, setIsVerifying] = useState(false)
  const [verificationResult, setVerificationResult] = useState<any>(null)
  const [countdown, setCountdown] = useState<number | null>(null)

  useEffect(() => {
    const fetchTcontProfiles = async () => {
      setIsLoadingTcont(true)
      try {
        const res = await fetch('/api/provisioning/tcont-profiles', {
          credentials: 'include'
        })
        if (res.ok) {
          const data = await res.json()
          setTcontProfiles(data)
        }
      } catch (err) {
        console.error('Failed to fetch TCONT profiles:', err)
      } finally {
        setIsLoadingTcont(false)
      }
    }

    const fetchVlansAndProfiles = async () => {
      setIsLoadingVlans(true)
      try {
        const [vlanRes, profileRes] = await Promise.all([
          fetch('/api/provisioning/vlans', { credentials: 'include' }),
          fetch('/api/provisioning/onu-profiles', { credentials: 'include' })
        ])

        if (vlanRes.ok) {
          const vlanData = await vlanRes.json()
          setVlanList(vlanData)
        }

        if (profileRes.ok) {
          const profileData = await profileRes.json()
          setVlanProfiles(profileData)
        }
      } catch (err) {
        console.error('Failed to fetch VLANs or profiles:', err)
      } finally {
        setIsLoadingVlans(false)
      }
    }

    fetchTcontProfiles()
    fetchVlansAndProfiles()
  }, [])

  const handleStep1Complete = async () => {
    if (!canApplyStep1()) return

    setIsApplyingStep1(true)
    const onuIdx = `${formData.rack}/${formData.slot}/${formData.port}:${formData.onuIndex}`

    try {
      const res = await fetch('/api/provisioning/onu/step1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          onu_index: onuIdx,
          tcont_profile: formData.tcontProfile,
          vlan_id: parseInt(formData.vlanId),
          tcont_no: parseInt(formData.tcontNo),
          gemport_no: parseInt(formData.gemportNo),
          service_port: isC6xx ? null : parseInt(formData.servicePort),
          vport: isC6xx ? null : parseInt(formData.vport)
        }),
        credentials: 'include'
      })

      const data = await res.json()
      if (data.output) setCliLogs(prev => [...prev, `--- STEP 1 OUTPUT ---\n${data.output}`])

      if (res.ok) {
        setStep1Completed(true)
        setCurrentStep(2)
      } else {
        alert(`Step 1 Failed: ${data.detail || 'Unknown error'}`)
      }
    } catch (err) {
      console.error('Step 1 Error:', err)
      alert("Network error during Step 1")
    } finally {
      setIsApplyingStep1(false)
    }
  }

  const handleStep2Complete = async () => {
    if (!canApplyStep2()) return

    setIsApplyingStep2(true)
    const onuIdx = `${formData.rack}/${formData.slot}/${formData.port}:${formData.onuIndex}`

    try {
      const res = await fetch('/api/provisioning/onu/step2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          onu_index: onuIdx,
          gemport_no: parseInt(formData.gemportNo),
          vlan_id: parseInt(formData.vlanId),
          username: formData.username,
          password: formData.password,
          vlan_profile: formData.vlanProfile,
          service_name: formData.serviceName,
          veip_name: formData.veipName,
          wan_ip_index: parseInt(formData.wanIpIndex),
          host: parseInt(formData.host),
          wan: parseInt(formData.wan),
          security_mgmt_num: parseInt(formData.securityMgmtNum),
          protocols: formData.protocols,
          service_port: isC6xx ? parseInt(formData.servicePort) : null
        }),
        credentials: 'include'
      })

      const data = await res.json()
      if (data.output) setCliLogs(prev => [...prev, `--- STEP 2 OUTPUT ---\n${data.output}`])

      if (res.ok) {
        setStep2Completed(true)
        setCurrentStep(3)
      } else {
        alert(`Step 2 Failed: ${data.detail || 'Unknown error'}`)
      }
    } catch (err) {
      console.error('Step 2 Error:', err)
      alert("Network error during Step 2")
    } finally {
      setIsApplyingStep2(false)
    }
  }

  const handleStep3Complete = async () => {
    if (!canApplyStep3()) return
    setIsApplyingStep3(true)
    const onuIdx = `${formData.rack}/${formData.slot}/${formData.port}:${formData.onuIndex}`

    try {
      const res = await fetch('/api/provisioning/onu/step3', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          onu_index: onuIdx,
          wifi_configs: formData.wifiConfigs.map(w => ({
            slot: w.slot,
            port: w.port,
            ssid_name: w.ssidName,
            state: w.state,
            auth_type: w.authType === 'Open System' ? 'open-system' :
                       w.authType === 'WPA-PSK' ? 'wpa-psk' :
                       w.authType === 'WPA/WPA2-PSK' ? 'wpa-wpa2-psk' :
                       w.authType === 'WPA3-SAE' ? 'wpa3-sae' :
                       w.authType === 'WPA2-PSK/WPA3-SAE' ? 'wpa2-psk/wpa3-sae' : 'wpa2-psk',
            passphrase: w.passphrase,
            max_users: w.maxUsers !== undefined ? w.maxUsers : 32,
            hide: w.hide || false
          }))
        }),
        credentials: 'include'
      })

      const data = await res.json()
      if (data.output) setCliLogs(prev => [...prev, `--- STEP 3 OUTPUT ---\n${data.output}`])
      if (data.verification && data.verification.output) {
        setCliLogs(prev => [...prev, `--- STATUS VERIFICATION OUTPUT ---\n${data.verification.output}`])
      }

      if (res.ok) {
        setStep3Completed(true)
        const result = data.verification || { onu_status: 'Unconfigured', wan_ip: '-' }
        setVerificationResult(result)
        
        let count = 10
        setCountdown(count)
        
        const intervalId = setInterval(() => {
          count -= 1
          setCountdown(count)
          if (count <= 0) {
            clearInterval(intervalId)
            onApply(onu.id, result.onu_status)
          }
        }, 1000)
      } else {
        alert(`Step 3 Failed: ${data.detail || 'Unknown error'}`)
      }
    } catch (err) {
      console.error('Step 3 Error:', err)
      alert("Network error during Step 3")
    } finally {
      setIsApplyingStep3(false)
    }
  }

  const handleNumWifiPortsChange = (num: number) => {
    const safeNum = Math.min(8, Math.max(0, num))
    const currentConfigs = [...formData.wifiConfigs]
    
    if (safeNum > currentConfigs.length) {
      for (let i = currentConfigs.length; i < safeNum; i++) {
        currentConfigs.push({
          slot: 1,
          port: 1,
          ssidName: `ZTE-WiFi-${i + 1}`,
          state: 'unlock',
          authType: 'WPA2-PSK',
          passphrase: '',
          maxUsers: 32,
          hide: false,
        })
      }
    } else {
      currentConfigs.splice(safeNum)
    }
    
    setFormData({ ...formData, numWifiPorts: safeNum, wifiConfigs: currentConfigs })
  }

  const toggleWifiState = (index: number) => {
    const newConfigs = [...formData.wifiConfigs]
    newConfigs[index] = {
      ...newConfigs[index],
      state: newConfigs[index].state === 'unlock' ? 'lock' : 'unlock'
    }
    setFormData({ ...formData, wifiConfigs: newConfigs })
  }

  const updateWifiPort = (index: number, field: keyof WifiPortConfig, value: any) => {
    const newConfigs = [...formData.wifiConfigs]
    newConfigs[index] = { ...newConfigs[index], [field]: value }
    setFormData({ ...formData, wifiConfigs: newConfigs })
  }

  const canApplyStep1 = () => {
    if (!formData.tcontProfile || !formData.vlanId) return false
    const tVal = parseInt(formData.tcontNo)
    const gVal = parseInt(formData.gemportNo)
    if (isNaN(tVal) || tVal < 1 || tVal > 255) return false
    if (isNaN(gVal) || gVal < 1 || gVal > 255) return false
    if (!isC6xx) {
      const sVal = parseInt(formData.servicePort)
      const vVal = parseInt(formData.vport)
      if (isNaN(sVal) || sVal < 1 || sVal > 128) return false
      if (isNaN(vVal) || vVal < 1 || vVal > 128) return false
    }
    return true
  }

  const canApplyStep2 = () => {
    if (!step1Completed) return false
    if (!formData.username || formData.username.length < 1 || formData.username.length > 64) return false
    if (!formData.password || formData.password.length < 1 || formData.password.length > 64) return false
    if (!formData.vlanProfile) return false
    
    if (!formData.serviceName || formData.serviceName.length < 1 || formData.serviceName.length > 32) return false
    
    const veipVal = parseInt(formData.veipName)
    if (isNaN(veipVal) || veipVal < 1) return false
    
    const wanIpVal = parseInt(formData.wanIpIndex)
    if (isNaN(wanIpVal) || wanIpVal < 1 || wanIpVal > 255) return false
    
    const hostVal = parseInt(formData.host)
    if (isNaN(hostVal) || hostVal < 1 || hostVal > 127) return false
    
    const wanVal = parseInt(formData.wan)
    if (isNaN(wanVal) || wanVal < 1 || wanVal > 255) return false
    
    const secVal = parseInt(formData.securityMgmtNum)
    if (isNaN(secVal) || secVal < 1 || secVal > 65535) return false
    
    if (isC6xx) {
      const sVal = parseInt(formData.servicePort)
      if (isNaN(sVal) || sVal < 1 || sVal > 128) return false
    }
    
    return true
  }

  const canApplyStep3 = () => {
    if (isApplyingStep3) return false
    if (formData.numWifiPorts > 0) {
      for (const wifi of formData.wifiConfigs) {
        if (!wifi.ssidName || wifi.ssidName.length < 1 || wifi.ssidName.length > 32) return false
        if (wifi.authType !== 'Open System') {
          if (!wifi.passphrase || wifi.passphrase.length < 8 || wifi.passphrase.length > 63) return false
        }
      }
    }
    return true
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col border border-gray-200 overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white flex-shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center text-red-600">
              <Settings size={24} />
            </div>
            <div>
              <h3 className="text-xl font-bold text-gray-900 tracking-tight">ONU Provisioning Wizard</h3>
              <p className="text-sm text-gray-500 font-medium">Provisioning {onu.sn} ({onu.onuType})</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-xl transition-all duration-200 text-gray-400 hover:text-gray-600"
          >
            <X size={20} />
          </button>
        </div>

        {/* Wizard Progress Stepper */}
        <div className="flex items-center justify-between px-8 py-6 bg-gray-50/50 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300 ${
              step1Completed ? 'bg-emerald-500 text-white' : currentStep === 1 ? 'bg-red-600 text-white shadow-lg shadow-red-200 scale-110' : 'bg-gray-200 text-gray-500'
            }`}>
              {step1Completed ? '✓' : '1'}
            </div>
            <span className={`text-sm font-bold tracking-tight ${currentStep === 1 ? 'text-gray-900' : 'text-gray-400'}`}>Hardware & TCONT</span>
          </div>

          <div className="flex-1 mx-4 h-0.5 bg-gray-200 relative">
             <div className={`absolute left-0 top-0 h-full bg-emerald-500 transition-all duration-500 ${step1Completed ? 'w-full' : 'w-0'}`} />
          </div>

          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300 ${
              step2Completed ? 'bg-emerald-500 text-white' : currentStep === 2 ? 'bg-red-600 text-white shadow-lg shadow-red-200 scale-110' : 'bg-gray-200 text-gray-500'
            }`}>
              {step2Completed ? '✓' : currentStep < 2 ? <Lock size={14} className="text-gray-400" /> : '2'}
            </div>
            <span className={`text-sm font-bold tracking-tight ${currentStep === 2 ? 'text-gray-900' : 'text-gray-400'}`}>Service Config</span>
          </div>

          <div className="flex-1 mx-4 h-0.5 bg-gray-200 relative">
             <div className={`absolute left-0 top-0 h-full bg-emerald-500 transition-all duration-500 ${step2Completed ? 'w-full' : 'w-0'}`} />
          </div>

          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300 ${
              step3Completed ? 'bg-emerald-500 text-white' : currentStep === 3 ? 'bg-red-600 text-white shadow-lg shadow-red-200 scale-110' : 'bg-gray-200 text-gray-500'
            }`}>
              {step3Completed ? '✓' : currentStep < 3 ? <Lock size={14} className="text-gray-400" /> : '3'}
            </div>
            <span className={`text-sm font-bold tracking-tight ${currentStep === 3 ? 'text-gray-900' : 'text-gray-400'}`}>Wi-Fi Config</span>
          </div>
        </div>

        {/* Modal Content */}
        <div className="p-8 overflow-y-auto flex-1 min-h-0 bg-white space-y-8">
          {currentStep === 1 && (
            <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">
              <section>
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <Settings size={14} />
                  Hardware Addressing
                </h4>
                <div className="grid grid-cols-4 gap-4">
                  {[
                    { label: 'Rack', value: formData.rack },
                    { label: 'Slot', value: formData.slot },
                    { label: 'Port', value: formData.port },
                    { label: 'ONU Index', value: formData.onuIndex }
                  ].map((item, idx) => (
                    <div key={idx} className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">{item.label}</label>
                      <div className="text-sm font-mono font-bold text-gray-700">{item.value}</div>
                    </div>
                  ))}
                </div>
              </section>

              <div className="grid md:grid-cols-2 gap-8">
                <section>
                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">TCONT Profile</h4>
                  {isLoadingTcont ? (
                    <div className="flex items-center gap-3 text-sm text-gray-500 py-4 px-4 bg-gray-50 rounded-xl border border-gray-100 animate-pulse">
                      <Loader2 className="animate-spin text-red-600" size={18} />
                      <span className="font-medium">Querying OLT hardware profiles...</span>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <select
                        value={formData.tcontProfile}
                        onChange={(e) => setFormData({ ...formData, tcontProfile: e.target.value })}
                        className="w-full px-4 py-3.5 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-900 focus:outline-none focus:ring-4 focus:ring-red-500/10 focus:border-red-500 transition-all"
                      >
                        <option value="">Select TCONT Profile</option>
                        {tcontProfiles.map((p, idx) => (
                          <option key={idx} value={p.profileName}>{p.profileName} (Type {p.type})</option>
                        ))}
                      </select>
                      <p className="text-[10px] text-gray-400 font-medium flex items-center gap-1.5 px-1">
                        <AlertCircle size={12} className="text-amber-500" />
                        Synchronized with active OLT profiles
                      </p>
                    </div>
                  )}
                </section>

                <section>
                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Service VLAN</h4>
                  <select
                    value={formData.vlanId}
                    onChange={(e) => setFormData({ ...formData, vlanId: e.target.value })}
                    disabled={isLoadingVlans}
                    className="w-full px-4 py-3.5 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-900 focus:outline-none focus:ring-4 focus:ring-red-500/10 focus:border-red-500 transition-all disabled:bg-gray-50"
                  >
                    <option value="">{isLoadingVlans ? "Fetching VLANs..." : "Select Service VLAN"}</option>
                    {vlanList.map((v, idx) => (
                      <option key={idx} value={v.vlanId || v.vlan_id}>{v.vlanId || v.vlan_id} {v.name && v.name !== '-' ? `(${v.name})` : ''}</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-gray-400 font-medium mt-3 flex items-center gap-1.5 px-1">
                    <AlertCircle size={12} className="text-red-500" />
                    Essential for initial gemport traffic mapping
                  </p>
                </section>

                <section>
                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">TCONT & GEMPORT Numbers</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 ml-1">TCONT No (1-255)</label>
                      <input
                        type="number"
                        min="1"
                        max="255"
                        value={formData.tcontNo}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === '') {
                            setFormData({ ...formData, tcontNo: '' });
                            return;
                          }
                          const num = parseInt(val, 10);
                          if (!isNaN(num)) {
                            setFormData({ ...formData, tcontNo: Math.min(255, Math.max(1, num)).toString() });
                          }
                        }}
                        className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-4 focus:ring-red-500/10 focus:border-red-500 transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 ml-1">GEMPORT No (1-255)</label>
                      <input
                        type="number"
                        min="1"
                        max="255"
                        value={formData.gemportNo}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === '') {
                            setFormData({ ...formData, gemportNo: '' });
                            return;
                          }
                          const num = parseInt(val, 10);
                          if (!isNaN(num)) {
                            setFormData({ ...formData, gemportNo: Math.min(255, Math.max(1, num)).toString() });
                          }
                        }}
                        className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-4 focus:ring-red-500/10 focus:border-red-500 transition-all"
                      />
                    </div>
                  </div>
                </section>

                {!isC6xx && (
                  <section>
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Service Port & VPort</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 ml-1">Service Port (1-128)</label>
                        <input
                          type="number"
                          min="1"
                          max="128"
                          value={formData.servicePort}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === '') {
                              setFormData({ ...formData, servicePort: '' });
                              return;
                            }
                            const num = parseInt(val, 10);
                            if (!isNaN(num)) {
                              setFormData({ ...formData, servicePort: Math.min(128, Math.max(1, num)).toString() });
                            }
                          }}
                          className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-4 focus:ring-red-500/10 focus:border-red-500 transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 ml-1">VPort (1-128)</label>
                        <input
                          type="number"
                          min="1"
                          max="128"
                          value={formData.vport}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === '') {
                              setFormData({ ...formData, vport: '' });
                              return;
                            }
                            const num = parseInt(val, 10);
                            if (!isNaN(num)) {
                              setFormData({ ...formData, vport: Math.min(128, Math.max(1, num)).toString() });
                            }
                          }}
                          className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-4 focus:ring-red-500/10 focus:border-red-500 transition-all"
                        />
                      </div>
                    </div>
                  </section>
                )}
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">
              <div className="flex items-center justify-between p-4 bg-emerald-50 rounded-xl border border-emerald-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-emerald-600 shadow-sm">
                    <Unlock size={20} />
                  </div>
                  <div>
                    <h5 className="text-sm font-bold text-emerald-900">Step 1 Completed Successfully</h5>
                    <p className="text-xs text-emerald-700 font-medium">Hardware gems and tconts are active.</p>
                  </div>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-8">
                <section className="space-y-6">
                  <div>
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Connection Parameters</h4>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 ml-1">Username (PPPoE)</label>
                        <input
                          type="text"
                          maxLength={64}
                          value={formData.username}
                          onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                          placeholder="Client ID / Username"
                          className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-4 focus:ring-red-500/10 focus:border-red-500 transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 ml-1">Password</label>
                        <div className="relative group">
                          <input
                            type={showWizardPassword ? "text" : "password"}
                            maxLength={64}
                            value={formData.password}
                            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                            placeholder="••••••••"
                            className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-4 focus:ring-red-500/10 focus:border-red-500 transition-all pr-12"
                          />
                          <button
                            type="button"
                            onClick={() => setShowWizardPassword(!showWizardPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                          >
                            {showWizardPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                          </button>
                        </div>
                      </div>
                      {isC6xx && (
                        <div>
                          <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 ml-1">Service Port (1-128)</label>
                          <input
                            type="number"
                            min="1"
                            max="128"
                            value={formData.servicePort}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === '') {
                                setFormData({ ...formData, servicePort: '' });
                                return;
                              }
                              const num = parseInt(val, 10);
                              if (!isNaN(num)) {
                                setFormData({ ...formData, servicePort: Math.min(128, Math.max(1, num)).toString() });
                              }
                            }}
                            className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-4 focus:ring-red-500/10 focus:border-red-500 transition-all"
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">VLAN Profile</h4>
                    <select
                      value={formData.vlanProfile}
                      onChange={(e) => setFormData({ ...formData, vlanProfile: e.target.value })}
                      className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-4 focus:ring-red-500/10 focus:border-red-500 transition-all"
                    >
                      <option value="">Select VLAN Profile</option>
                      {vlanProfiles.map((p, idx) => (
                        <option key={idx} value={p.profileName || p.profile_name}>{p.profileName || p.profile_name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Service & VEIP Configuration</h4>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 ml-1">Service Name (1-32 chars)</label>
                        <input
                          type="text"
                          maxLength={32}
                          value={formData.serviceName}
                          onChange={(e) => setFormData({ ...formData, serviceName: e.target.value })}
                          placeholder="e.g. internet"
                          className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-4 focus:ring-red-500/10 focus:border-red-500 transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 ml-1">VEIP Suffix Number (prefixed as veip_)</label>
                        <div className="relative flex items-center">
                          <span className="absolute left-4 font-mono text-sm font-bold text-gray-400 select-none">veip_</span>
                          <input
                            type="number"
                            min="1"
                            max="255"
                            value={formData.veipName}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === '') {
                                setFormData({ ...formData, veipName: '' });
                                return;
                              }
                              const num = parseInt(val, 10);
                              if (!isNaN(num)) {
                                setFormData({ ...formData, veipName: Math.min(255, Math.max(1, num)).toString() });
                              }
                            }}
                            className="w-full pl-14 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-4 focus:ring-red-500/10 focus:border-red-500 transition-all font-mono font-bold"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="space-y-6">
                  <div>
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">WAN IP Parameters</h4>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 ml-1">WAN IP Index (1-255)</label>
                        <input
                          type="number"
                          min="1"
                          max="255"
                          value={formData.wanIpIndex}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === '') {
                              setFormData({ ...formData, wanIpIndex: '' });
                              return;
                            }
                            const num = parseInt(val, 10);
                            if (!isNaN(num)) {
                              setFormData({ ...formData, wanIpIndex: Math.min(255, Math.max(1, num)).toString() });
                            }
                          }}
                          className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-4 focus:ring-red-500/10 focus:border-red-500 transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 ml-1">Host Number (1-127)</label>
                        <input
                          type="number"
                          min="1"
                          max="127"
                          value={formData.host}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === '') {
                              setFormData({ ...formData, host: '' });
                              return;
                            }
                            const num = parseInt(val, 10);
                            if (!isNaN(num)) {
                              setFormData({ ...formData, host: Math.min(127, Math.max(1, num)).toString() });
                            }
                          }}
                          className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-4 focus:ring-red-500/10 focus:border-red-500 transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 ml-1">WAN Index (1-255)</label>
                        <input
                          type="number"
                          min="1"
                          max="255"
                          value={formData.wan}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === '') {
                              setFormData({ ...formData, wan: '' });
                              return;
                            }
                            const num = parseInt(val, 10);
                            if (!isNaN(num)) {
                              setFormData({ ...formData, wan: Math.min(255, Math.max(1, num)).toString() });
                            }
                          }}
                          className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-4 focus:ring-red-500/10 focus:border-red-500 transition-all"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Security Configuration</h4>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 ml-1">Security Mgmt Number (1-65535)</label>
                      <input
                        type="number"
                        min="1"
                        max="65535"
                        value={formData.securityMgmtNum}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === '') {
                            setFormData({ ...formData, securityMgmtNum: '' });
                            return;
                          }
                          const num = parseInt(val, 10);
                          if (!isNaN(num)) {
                            setFormData({ ...formData, securityMgmtNum: Math.min(65535, Math.max(1, num)).toString() });
                          }
                        }}
                        className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-4 focus:ring-red-500/10 focus:border-red-500 transition-all"
                      />
                    </div>
                  </div>
                </section>

                <div className="col-span-2 mt-4">
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-3 ml-1">Security Mgmt Ingress Protocols</label>
                  <div className="grid grid-cols-4 sm:grid-cols-7 gap-3 bg-gray-50 p-4 rounded-2xl border border-gray-100">
                    {['web', 'tr069', 'ftp', 'https', 'snmp', 'ssh', 'telnet'].map((p) => {
                      const isChecked = formData.protocols.includes(p)
                      return (
                        <button
                          type="button"
                          key={p}
                          onClick={() => {
                            const next = isChecked
                              ? formData.protocols.filter((x) => x !== p)
                              : [...formData.protocols, p]
                            setFormData({ ...formData, protocols: next })
                          }}
                          className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-bold transition-all duration-200 ${
                            isChecked
                              ? 'bg-red-600 border-red-600 text-white shadow-md'
                              : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                          }`}
                        >
                          <span className="uppercase">{p}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

                     {currentStep === 3 && (
            <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">
              {step3Completed && verificationResult ? (
                <div className="space-y-6 max-w-xl mx-auto py-8 text-center animate-in fade-in zoom-in-95 duration-500">
                  <div className="relative inline-flex mb-6">
                    <div className="absolute inset-0 rounded-full bg-emerald-500/10 animate-ping" />
                    <div className={`w-20 h-20 rounded-full flex items-center justify-center shadow-lg ${
                      verificationResult.onu_status.toLowerCase() === 'online'
                        ? 'bg-emerald-500 text-white shadow-emerald-200'
                        : 'bg-amber-500 text-white shadow-amber-200'
                    }`}>
                      {verificationResult.onu_status.toLowerCase() === 'online' ? (
                        <CheckCircle2 size={40} className="stroke-[2.5]" />
                      ) : (
                        <AlertCircle size={40} className="stroke-[2.5]" />
                      )}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h4 className="text-2xl font-bold tracking-tight text-gray-900">
                      Konfigurasi Wi-Fi Selesai
                    </h4>
                    <p className="text-sm text-gray-500 max-w-md mx-auto">
                      Perintah konfigurasi Wi-Fi sukses diterapkan ke OLT. Verifikasi status telemetri ONU selesai dijalankan.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-4 bg-gray-50 p-6 rounded-2xl border border-gray-100 max-w-md mx-auto text-left mt-8">
                    <div>
                      <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                        Status Verifikasi OLT
                      </span>
                      <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                        verificationResult.onu_status.toLowerCase() === 'online'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                          : 'bg-amber-50 text-amber-700 border border-amber-100'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          verificationResult.onu_status.toLowerCase() === 'online'
                            ? 'bg-emerald-500'
                            : 'bg-amber-500'
                        }`} />
                        {verificationResult.onu_status}
                      </span>
                    </div>

                    <div>
                      <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                        IP WAN Terdeteksi
                      </span>
                      <span className="text-sm font-mono font-bold text-gray-950">
                        {verificationResult.wan_ip || '-'}
                      </span>
                    </div>
                  </div>

                  {countdown !== null && (
                    <div className="mt-8 space-y-2 max-w-xs mx-auto">
                      <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden relative">
                        <motion.div
                          initial={{ width: "100%" }}
                          animate={{ width: "0%" }}
                          transition={{ duration: 10, ease: "linear" }}
                          className="h-full bg-emerald-500"
                        />
                      </div>
                      <p className="text-xs text-gray-400 font-bold tracking-tight uppercase">
                        Kembali ke ONU List dalam {countdown} Detik...
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-4 p-6 bg-gray-50 rounded-2xl border border-gray-100">
                    <div className="flex-1">
                      <h4 className="text-sm font-bold text-gray-900 mb-1">Wi-Fi Port Provisioning</h4>
                      <p className="text-xs text-gray-500 font-medium">Specify number of active Wi-Fi ports for this ONU.</p>
                    </div>
                    <div className="w-32">
                      <input
                        type="number"
                        min="0"
                        max="8"
                        value={formData.numWifiPorts}
                        onChange={(e) => handleNumWifiPortsChange(parseInt(e.target.value) || 0)}
                        className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-center font-bold text-gray-900 focus:outline-none focus:ring-4 focus:ring-red-500/10 focus:border-red-500 transition-all"
                      />
                    </div>
                  </div>

                  {formData.numWifiPorts > 0 && (
                    <div className="grid md:grid-cols-2 gap-6">
                      {formData.wifiConfigs.map((wifi, idx) => (
                        <div key={idx} className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm hover:shadow-md transition-shadow group relative">
                          <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-gray-900 text-white flex items-center justify-center font-bold text-xs">
                                {idx + 1}
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="flex flex-col">
                                  <label className="text-[9px] font-bold text-gray-400 uppercase ml-1">Slot</label>
                                  <input 
                                    type="number" 
                                    min="0"
                                    value={wifi.slot}
                                    onChange={(e) => updateWifiPort(idx, 'slot', Math.max(0, parseInt(e.target.value) || 0))}
                                    className="w-12 px-2 py-1 bg-white border border-gray-200 rounded text-xs font-bold focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                                  />
                                </div>
                                <div className="flex flex-col">
                                  <label className="text-[9px] font-bold text-gray-400 uppercase ml-1">Port</label>
                                  <input 
                                    type="number" 
                                    min="0"
                                    value={wifi.port}
                                    onChange={(e) => updateWifiPort(idx, 'port', Math.max(0, parseInt(e.target.value) || 0))}
                                    className="w-12 px-2 py-1 bg-white border border-gray-200 rounded text-xs font-bold focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                                  />
                                </div>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => toggleWifiState(idx)}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[10px] font-bold transition-all duration-200 ${
                                wifi.state === 'unlock'
                                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                                  : 'bg-red-50 border-red-200 text-red-700'
                              }`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${wifi.state === 'unlock' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                              {wifi.state === 'unlock' ? 'ACTIVE' : 'LOCKED'}
                            </button>
                          </div>

                          <div className="space-y-4">
                            <div>
                              <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 ml-1">SSID Name</label>
                              <input
                                type="text"
                                value={wifi.ssidName}
                                onChange={(e) => updateWifiPort(idx, 'ssidName', e.target.value)}
                                placeholder="Wi-Fi Name"
                                maxLength={32}
                                className="w-full px-4 py-2.5 bg-gray-50 border border-transparent rounded-xl text-sm font-medium focus:bg-white focus:border-red-500 focus:outline-none transition-all"
                              />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 ml-1">Authentication</label>
                                <select
                                  value={wifi.authType}
                                  onChange={(e) => updateWifiPort(idx, 'authType', e.target.value as any)}
                                  className="w-full px-4 py-2.5 bg-gray-50 border border-transparent rounded-xl text-sm font-medium focus:bg-white focus:border-red-500 focus:outline-none transition-all"
                                >
                                  <option value="Open System">Open System</option>
                                  <option value="WPA-PSK">WPA-PSK</option>
                                  <option value="WPA/WPA2-PSK">WPA/WPA2-PSK</option>
                                  <option value="WPA2-PSK">WPA2-PSK</option>
                                  {isC6xx && (
                                    <>
                                      <option value="WPA3-SAE">WPA3-SAE</option>
                                      <option value="WPA2-PSK/WPA3-SAE">WPA2-PSK/WPA3-SAE</option>
                                    </>
                                  )}
                                </select>
                              </div>
                              <div>
                                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 ml-1">Max Users (1-32)</label>
                                <input
                                  type="number"
                                  min="1"
                                  max="32"
                                  value={wifi.maxUsers !== undefined ? wifi.maxUsers : 32}
                                  onChange={(e) => updateWifiPort(idx, 'maxUsers', Math.min(32, Math.max(1, parseInt(e.target.value) || 32)))}
                                  className="w-full px-4 py-2.5 bg-gray-50 border border-transparent rounded-xl text-sm font-medium focus:bg-white focus:border-red-500 focus:outline-none transition-all"
                                />
                              </div>
                            </div>

                            {wifi.authType !== 'Open System' && (
                              <div className="animate-in slide-in-from-top-2 duration-300">
                                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 ml-1">
                                  Passphrase
                                  {wifi.passphrase && (wifi.passphrase.length < 8 || wifi.passphrase.length > 63) && (
                                    <span className="text-red-500 ml-2 normal-case">(8-63 characters required)</span>
                                  )}
                                </label>
                                <div className="relative">
                                  <input
                                    type={showPassphrases[idx] ? "text" : "password"}
                                    value={wifi.passphrase}
                                    onChange={(e) => updateWifiPort(idx, 'passphrase', e.target.value.replace(/\s/g, ''))}
                                    placeholder="Min. 8 characters"
                                    maxLength={63}
                                    className={`w-full pl-4 pr-12 py-2.5 bg-gray-50 border rounded-xl text-sm font-medium focus:bg-white focus:outline-none transition-all ${
                                      wifi.passphrase && (wifi.passphrase.length < 8 || wifi.passphrase.length > 63)
                                        ? 'border-red-500 focus:border-red-600'
                                        : 'border-transparent focus:border-red-500'
                                    }`}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setShowPassphrases(prev => ({ ...prev, [idx]: !prev[idx] }))}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-gray-600 transition-colors"
                                  >
                                    {showPassphrases[idx] ? <EyeOff size={18} /> : <Eye size={18} />}
                                  </button>
                                </div>
                              </div>
                            )}

                            <div className="flex items-center gap-3 pt-2">
                              <input
                                type="checkbox"
                                id={`hide-ssid-${idx}`}
                                checked={wifi.hide || false}
                                onChange={(e) => updateWifiPort(idx, 'hide', e.target.checked)}
                                className="w-4 h-4 text-red-600 border-gray-300 rounded focus:ring-red-500 cursor-pointer"
                              />
                              <label htmlFor={`hide-ssid-${idx}`} className="text-xs font-bold text-gray-600 cursor-pointer select-none">
                                Hide SSID
                              </label>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* CLI Logs section */}
          {cliLogs.length > 0 && (
            <div className="mt-8 pt-8 border-t border-gray-100">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-red-600 animate-pulse" />
                  <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                    <Terminal size={14} className="text-gray-900" />
                    Asynchronous Hardware CLI Feedback
                  </h4>
                </div>
                <button
                  onClick={() => setCliLogs([])}
                  className="text-[10px] font-bold text-red-500 hover:text-red-700 transition-colors uppercase"
                >
                  Clear Console
                </button>
              </div>
              <div className="bg-gray-950 rounded-2xl p-6 font-mono text-[11px] leading-relaxed text-emerald-400/90 overflow-x-auto whitespace-pre max-h-[300px] border border-gray-800 shadow-inner">
                {cliLogs.map((log, i) => (
                  <div key={i} className="mb-4 last:mb-0">
                    <span className="text-gray-600 mr-2">[{new Date().toLocaleTimeString()}]</span>
                    {log}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between p-8 border-t border-gray-100 bg-gray-50/50 flex-shrink-0">
          <button
            onClick={onClose}
            disabled={step3Completed}
            className={`px-8 py-3.5 bg-white border border-gray-200 text-gray-700 font-bold text-sm rounded-xl transition-all duration-200 shadow-sm ${
              step3Completed ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50'
            }`}
          >
            Cancel Session
          </button>

          <div className="flex gap-4">
            {currentStep > 1 && !step3Completed && (
              <button
                onClick={() => {
                  if (currentStep === 2) {
                    setCurrentStep(1)
                    setStep1Completed(false)
                    setStep2Completed(false)
                  } else if (currentStep === 3) {
                    setCurrentStep(2)
                    setStep2Completed(false)
                    setStep3Completed(false)
                  }
                }}
                className="px-8 py-3.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 font-bold text-sm rounded-xl transition-all duration-200 shadow-sm"
              >
                Back
              </button>
            )}

            {currentStep === 1 ? (
              <button
                onClick={handleStep1Complete}
                disabled={!canApplyStep1() || isApplyingStep1}
                className={`px-10 py-3.5 font-bold text-sm rounded-xl transition-all duration-300 flex items-center gap-3 ${
                  (canApplyStep1() && !isApplyingStep1)
                    ? 'bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-200 active:scale-95'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                {isApplyingStep1 ? <Loader2 size={18} className="animate-spin" /> : null}
                Provision Hardware
                <ChevronRight size={18} />
              </button>
            ) : currentStep === 2 ? (
              <button
                onClick={handleStep2Complete}
                disabled={!canApplyStep2() || isApplyingStep2}
                className={`px-10 py-3.5 font-bold text-sm rounded-xl transition-all duration-300 flex items-center gap-3 ${
                  (canApplyStep2() && !isApplyingStep2)
                    ? 'bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-200 active:scale-95'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                {isApplyingStep2 ? <Loader2 size={18} className="animate-spin" /> : null}
                Apply Service
                <ChevronRight size={18} />
              </button>
            ) : step3Completed ? (
              <button
                disabled={true}
                className="px-10 py-3.5 font-bold text-sm rounded-xl bg-emerald-600 text-white cursor-not-allowed flex items-center gap-3 shadow-lg shadow-emerald-100"
              >
                <Loader2 size={18} className="animate-spin text-white" />
                Verifying Status...
              </button>
            ) : (
              <button
                onClick={handleStep3Complete}
                disabled={!canApplyStep3() || isApplyingStep3}
                className={`px-10 py-3.5 font-bold text-sm rounded-xl transition-all duration-300 flex items-center gap-3 ${
                  (canApplyStep3() && !isApplyingStep3)
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-200 active:scale-95'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                {isApplyingStep3 ? <Loader2 size={18} className="animate-spin" /> : <Wifi size={18} />}
                Complete Configuration
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}


// Map OLT ID to display name
const oltIdToName: Record<string, string> = {
  'c600': 'ZTE C600',
  'c300': 'ZTE C300',
  'c320': 'ZTE C320'
}

const oltNameToId: Record<string, string> = {
  'ZTE C600': 'c600',
  'ZTE C300': 'c300',
  'ZTE C320': 'c320'
}

function PerformanceTab({ data, isLoading }: { data: any[], isLoading: boolean }) {
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set())

  const oltAreas = useMemo(() => {
    if (!data || data.length === 0) return []
    const areas = []
    let startIndex = 0
    let currentType = data[0].olt_type

    for (let i = 1; i < data.length; i++) {
      if (data[i].olt_type !== currentType) {
        if (currentType) {
          areas.push({
            x1: data[startIndex].time,
            x2: data[i].time,
            type: currentType
          })
        }
        currentType = data[i].olt_type
        startIndex = i
      }
    }
    if (currentType) {
      areas.push({
        x1: data[startIndex].time,
        x2: data[data.length - 1].time,
        type: currentType
      })
    }
    return areas
  }, [data])

  const uniqueOltTypes = useMemo(() => {
    if (!data || data.length === 0) return []
    const types = new Set<string>()
    data.forEach(d => { if (d.olt_type && d.olt_type !== 'unknown') types.add(d.olt_type) })
    return Array.from(types)
  }, [data])

  const toggleSeries = (key: string) => {
    setHiddenSeries(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <Loader2 className="animate-spin text-red-600" size={40} />
        <p className="text-gray-500 font-medium">Loading performance history...</p>
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4 bg-white rounded-2xl border border-dashed border-gray-200">
        <Activity size={40} className="text-gray-300" />
        <p className="text-gray-500 font-medium">No performance data available yet.</p>
        <p className="text-xs text-gray-400">Data is collected every 10 minutes (GMT+7).</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-red-50 p-5 rounded-2xl border border-red-100 shadow-sm">
          <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest mb-1">Current Rx Power</p>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-red-900">
              {data[data.length - 1]?.rx?.toFixed(2) || '-'}
            </span>
            <span className="text-xs font-bold text-red-600">dBm</span>
          </div>
        </div>
        <div className="bg-blue-50 p-5 rounded-2xl border border-blue-100 shadow-sm">
          <p className="text-[10px] font-bold text-blue-500 uppercase tracking-widest mb-1">Current Tx Power</p>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-blue-900">
              {data[data.length - 1]?.tx?.toFixed(2) || '-'}
            </span>
            <span className="text-xs font-bold text-blue-600">dBm</span>
          </div>
        </div>
        <div className="bg-orange-50 p-5 rounded-2xl border border-orange-100 shadow-sm">
          <p className="text-[10px] font-bold text-orange-500 uppercase tracking-widest mb-1">Current Temp</p>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-orange-900">
              {data[data.length - 1]?.temp?.toFixed(2) || '-'}
            </span>
            <span className="text-xs font-bold text-orange-600">°C</span>
          </div>
        </div>
      </div>
      
      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex items-center justify-between mb-8">
          <div className="flex flex-col gap-1.5">
            <h4 className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <Activity size={18} className="text-red-600" />
              Optical Power Trends (dBm)
            </h4>
            <div className="flex items-center gap-3 text-xs font-medium text-gray-500">
              {uniqueOltTypes.map(type => {
                const isC3 = type.toLowerCase().includes('c3')
                const color = isC3 ? '#f59e0b' : '#3b82f6'
                return (
                  <div key={type} className="flex items-center gap-1.5">
                    <div className={`w-3 h-3 rounded-[3px] opacity-20`} style={{ backgroundColor: color }}></div> 
                    ZTE {type.toUpperCase()} Area
                  </div>
                )
              })}
            </div>
          </div>
          <div className="flex gap-4">
            <button
              onClick={() => toggleSeries('rx')}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all duration-200 hover:bg-gray-100 active:scale-95"
            >
              <div className={`w-3 h-3 rounded-full transition-all duration-200 ${hiddenSeries.has('rx') ? 'bg-gray-300' : 'bg-red-500'}`} />
              <span className={`text-xs font-bold transition-all duration-200 ${hiddenSeries.has('rx') ? 'text-gray-300 line-through' : 'text-gray-500'}`}>
                Rx Power
              </span>
            </button>
            <button
              onClick={() => toggleSeries('tx')}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all duration-200 hover:bg-gray-100 active:scale-95"
            >
              <div className={`w-3 h-3 rounded-full transition-all duration-200 ${hiddenSeries.has('tx') ? 'bg-gray-300' : 'bg-blue-500'}`} />
              <span className={`text-xs font-bold transition-all duration-200 ${hiddenSeries.has('tx') ? 'text-gray-300 line-through' : 'text-gray-500'}`}>
                Tx Power
              </span>
            </button>
          </div>
        </div>
        
        <div className="h-[350px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              {oltAreas.map((area, idx) => {
                const typeStr = (area.type || '').toLowerCase()
                if (typeStr.includes('c3')) {
                  return <ReferenceArea key={idx} x1={area.x1} x2={area.x2} yAxisId="left" fillOpacity={0.05} fill="#f59e0b" />
                } else if (typeStr.includes('c6')) {
                  return <ReferenceArea key={idx} x1={area.x1} x2={area.x2} yAxisId="left" fillOpacity={0.05} fill="#3b82f6" />
                }
                return null
              })}
              <XAxis 
                dataKey="time" 
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }}
                dy={10}
              />
              <YAxis 
                yAxisId="left"
                domain={['auto', 'auto']} 
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 11, fill: '#ef4444', fontWeight: 600 }}
                width={40}
              />
              <YAxis 
                yAxisId="right"
                orientation="right"
                domain={['auto', 'auto']} 
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 11, fill: '#3b82f6', fontWeight: 600 }}
                width={40}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'rgba(255, 255, 255, 0.95)', 
                  borderRadius: '16px', 
                  border: '1px solid #f1f5f9', 
                  boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
                  padding: '12px'
                }}
                labelStyle={{ fontWeight: 800, color: '#1e293b', marginBottom: '4px' }}
                itemStyle={{ fontSize: '12px', fontWeight: 700, padding: '2px 0' }}
              />
              <Line 
                yAxisId="left"
                type="monotone" 
                dataKey="rx" 
                stroke="#ef4444" 
                strokeWidth={3} 
                dot={{ fill: '#ef4444', strokeWidth: 2, r: 4, stroke: '#fff' }} 
                activeDot={{ r: 6, strokeWidth: 0 }}
                animationDuration={1500}
                hide={hiddenSeries.has('rx')}
              />
              <Line 
                yAxisId="right"
                type="monotone" 
                dataKey="tx" 
                stroke="#3b82f6" 
                strokeWidth={3} 
                dot={{ fill: '#3b82f6', strokeWidth: 2, r: 4, stroke: '#fff' }} 
                activeDot={{ r: 6, strokeWidth: 0 }}
                animationDuration={1500}
                hide={hiddenSeries.has('tx')}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm mt-6">
        <div className="flex items-center justify-between mb-8">
          <div className="flex flex-col gap-1.5">
            <h4 className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <Thermometer size={18} className="text-orange-600" />
              ONU Temperature Trends (°C)
            </h4>
            <div className="flex items-center gap-3 text-xs font-medium text-gray-500">
              {uniqueOltTypes.map(type => {
                const isC3 = type.toLowerCase().includes('c3')
                const color = isC3 ? '#f59e0b' : '#3b82f6'
                return (
                  <div key={type} className="flex items-center gap-1.5">
                    <div className={`w-3 h-3 rounded-[3px] opacity-20`} style={{ backgroundColor: color }}></div> 
                    ZTE {type.toUpperCase()} Area
                  </div>
                )
              })}
            </div>
          </div>
        </div>
        <div className="h-[250px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              {oltAreas.map((area, idx) => {
                const typeStr = (area.type || '').toLowerCase()
                if (typeStr.includes('c3')) {
                  return <ReferenceArea key={idx} x1={area.x1} x2={area.x2} fillOpacity={0.15} fill="#f59e0b" />
                } else if (typeStr.includes('c6')) {
                  return <ReferenceArea key={idx} x1={area.x1} x2={area.x2} fillOpacity={0.15} fill="#3b82f6" />
                }
                return null
              })}
              <XAxis 
                dataKey="time" 
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }}
                dy={10}
              />
              <YAxis 
                domain={['auto', 'auto']} 
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 11, fill: '#ea580c', fontWeight: 600 }}
                width={40}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'rgba(255, 255, 255, 0.95)', 
                  borderRadius: '16px', 
                  border: '1px solid #f1f5f9', 
                  boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
                  padding: '12px'
                }}
                labelStyle={{ fontWeight: 800, color: '#1e293b', marginBottom: '4px' }}
                itemStyle={{ fontSize: '12px', fontWeight: 700, padding: '2px 0' }}
              />
              <Line 
                type="monotone" 
                dataKey="temp" 
                stroke="#ea580c" 
                strokeWidth={3} 
                dot={{ fill: '#ea580c', strokeWidth: 2, r: 4, stroke: '#fff' }} 
                activeDot={{ r: 6, strokeWidth: 0 }}
                animationDuration={1500}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}


interface ONUListProps {
  userRole: 'admin' | 'guest'
  filterStatus?: string | null
  selectedOLT: string
  onOLTChange: (oltId: string) => void
  onOMCIConfig?: (onu: ONU) => void
  completedOMCIOnuIds?: Set<string>
}

export default function ONUList({ userRole, filterStatus, selectedOLT, onOLTChange, onOMCIConfig, completedOMCIOnuIds }: ONUListProps) {
  const { connectionState } = useNetworkAgent()
  const isMatch = connectionState === 'MATCH'

  // Convert OLT ID to display name for internal use
  const selectedOLTName = oltIdToName[selectedOLT] || 'ZTE C600'
  const isC6xx = selectedOLT ? selectedOLT.toLowerCase().includes('c6') : false
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'offline' | 'unconfigured' | 'los' | 'unregistered'>(filterStatus as any || 'all')
  const [searchQuery, setSearchQuery] = useState('')

  // Update status filter when filterStatus changes from Dashboard
  useEffect(() => {
    if (filterStatus) {
      setStatusFilter(filterStatus as any)
    }
  }, [filterStatus])
  const [registerModalONU, setRegisterModalONU] = useState<ONU | null>(null)
  const [registerOnuIndex, setRegisterOnuIndex] = useState<string>('')
  const [registrationResult, setRegistrationResult] = useState<any>(null)
  const [configWizardONU, setConfigWizardONU] = useState<ONU | null>(null)
  const [editONU, setEditONU] = useState<ONU | null>(null)
  const [sortConfig, setSortConfig] = useState<{ key: keyof ONU; direction: 'asc' | 'desc' } | null>(null)
  const [selectedONU, setSelectedONU] = useState<ONU | null>(null)
  const [onuStates, setOnuStates] = useState<Map<string, ONU>>(new Map())
  const [isLoading, setIsLoading] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isRebooting, setIsRebooting] = useState(false)
  const [verifyingWanONUId, setVerifyingWanONUId] = useState<string | null>(null)
  const [performanceData, setPerformanceData] = useState<any[]>([])
  const [isLoadingPerformance, setIsLoadingPerformance] = useState(false)
  const [detailsTab, setDetailsTab] = useState<'info' | 'performance'>('info')
  const [stats, setStats] = useState({ online: 0, offline: 0, los: 0, unconfigured: 0 })
  const [isFetchingStats, setIsFetchingStats] = useState(false)

  const fetchStats = async () => {
    if (!isMatch) {
      setStats({ online: 0, offline: 0, los: 0, unconfigured: 0 })
      return
    }
    setIsFetchingStats(true)
    try {
      const res = await fetch(`/api/dashboard/onu-stats?t=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'Pragma': 'no-cache', 'Cache-Control': 'no-cache' },
        credentials: 'include'
      })
      if (res.ok) {
        const data: ONUStats = await res.json()
        setStats(data)
      }
    } catch (error) {
      console.warn("Failed to fetch ONU stats", error)
    } finally {
      setIsFetchingStats(false)
    }
  }

  useEffect(() => {
    if (isMatch) {
      fetchStats()
      const interval = setInterval(fetchStats, 20000)
      return () => clearInterval(interval)
    } else {
      setStats({ online: 0, offline: 0, los: 0, unconfigured: 0 })
    }
  }, [isMatch, selectedOLT])

  const fetchPerformanceData = async (sn: string) => {
    setIsLoadingPerformance(true)
    try {
      
      const res = await fetch(`/api/onus/${sn}/performance`, {
        credentials: 'include'
      })
      if (res.ok) {
        const data = await res.json()
        setPerformanceData(data)
      }
    } catch (err) {
      console.error('Failed to fetch performance data:', err)
    } finally {
      setIsLoadingPerformance(false)
    }
  }

  useEffect(() => {
    if (detailsTab === 'performance' && selectedONU?.sn) {
      fetchPerformanceData(selectedONU.sn)
    }
  }, [detailsTab, selectedONU?.sn])

  const [isRegistering, setIsRegistering] = useState(false)
  const [checkedONUs, setCheckedONUs] = useState<Set<string>>(new Set())

  const [isLoadingDetails, setIsLoadingDetails] = useState(false)
  const [lastRefreshTime, setLastRefreshTime] = useState<number>(0)
  const [refreshCooldown, setRefreshCooldown] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)



  // Change ONU data when OLT is selected or connection state changes
  useEffect(() => {
    setCheckedONUs(new Set())

    // If not matched, clear data and don't fetch
    if (connectionState !== 'MATCH') {
      setOnuStates(new Map())
      return
    }

    const fetchONUs = async (silent = false) => {
      if (!silent) {
        if (onuStates.size === 0) setIsLoading(true)
        else setIsRefreshing(true)
      }
      try {
        
        // Use the enriched details endpoint (SN, model, Rx/Tx from database cache first)
        // Use refresh=false to prevent SNMP storm on initial load and enable database-first loading
        const res = await fetch(`/api/onus/details?refresh=false&t=${Date.now()}`, {
          cache: 'no-store',
          headers: { 'Pragma': 'no-cache', 'Cache-Control': 'no-cache' },
          credentials: 'include'
        })
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`)
        const data: ONU[] = await res.json()

        if (data && Array.isArray(data)) {
          setOnuStates(new Map(data.map((onu) => [onu.id, onu])))
        }
      } catch (e) {
        console.warn("ONUList: Failed to fetch live ONU data", e)
      } finally {
        if (!silent) {
          setIsLoading(false)
          setIsRefreshing(false)
        }
      }
    }

    fetchONUs()

    // Auto-refresh every 60 seconds (user requested 1 min)
    // Avoid refreshing at the 10-minute marks (:10, :20, etc.) to prevent SNMP collisions
    const interval = setInterval(() => {
      const now = new Date();
      const minutes = now.getMinutes();
      const is10MinMark = (minutes % 10 === 0);

      if (connectionState === 'MATCH' && !is10MinMark) {
        fetchONUs(true)
      }
    }, 60000)

    // Auto-refresh when window regains focus (switching tabs)
    const handleFocus = () => {
      if (connectionState === 'MATCH') {
        fetchONUs(true)
      }
    }
    window.addEventListener('focus', handleFocus)

    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', handleFocus)
    }
  }, [selectedOLT, connectionState])
  // Effect to fetch live status when an ONU is selected for details
  useEffect(() => {
    const fetchDetailsData = async () => {
      if (!selectedONU) return
      
      const isInitial = !selectedONU.wan_ip && selectedONU.opticalPower === -99
      if (isInitial) setIsLoadingDetails(true)

      
      const isTransient = selectedONU.status?.toLowerCase() === 'sync mib' || selectedONU.status?.toLowerCase() === 'logging' || selectedONU.status?.toLowerCase() === 'unregistered';
      const onuIdx = selectedONU.index || `${selectedONU.rack || '1'}/${selectedONU.oltCard}/${selectedONU.port}:${isTransient ? '-' : selectedONU.onuNumber}`
      
      try {
        // Fetch Live Status (Power, WAN IP, Physical Truth)
        const liveRes = await fetch(`/api/onus/${encodeURIComponent(onuIdx)}/live`, {
          credentials: 'include'
        })
        if (liveRes.ok) {
          const liveData = await liveRes.json()
          // Update the selected ONU with live results
          setSelectedONU(prev => prev ? {
            ...prev,
            opticalPower: liveData.rx,
            powerTx: liveData.tx,
            wan_ip: liveData.wan_ip || liveData.ip,
            status: liveData.phys || prev.status
          } : null)
        }
      } catch (err) {
        console.error("Error fetching detail data:", err)
      } finally {
        setIsLoadingDetails(false)
      }
    }

    if (selectedONU && connectionState === 'MATCH') {
      fetchDetailsData()
      const intervalId = setInterval(fetchDetailsData, 30000)
      return () => clearInterval(intervalId)
    }
  }, [selectedONU, connectionState])
  useEffect(() => {
    if (completedOMCIOnuIds && completedOMCIOnuIds.size > 0) {
      const newStates = new Map(onuStates)
      let hasChanges = false
      completedOMCIOnuIds.forEach(onuId => {
        const onu = newStates.get(onuId)
        if (onu && onu.status === 'unconfigured') {
          newStates.set(onuId, { ...onu, status: 'online' })
          hasChanges = true
        }
      })
      if (hasChanges) {
        setOnuStates(newStates)
      }
    }
  }, [completedOMCIOnuIds])

  // Filter by status
  const statusFiltered = statusFilter === 'all'
    ? Array.from(onuStates.values())
    : statusFilter === 'unconfigured'
      ? Array.from(onuStates.values()).filter(onu => 
          onu.status === 'unconfigured' || 
          onu.status === 'unregistered' ||
          onu.status === 'los' ||
          onu.status === 'offline' ||
          onu.status === 'logging' ||
          onu.status === 'syncmib' ||
          onu.status === 'authfailed' ||
          onu.status === 'auth-failed' ||
          onu.status === 'dyinggasp' ||
          onu.status === 'dying-gasp'
        )
      : Array.from(onuStates.values()).filter(onu => onu.status === statusFilter)

  // Filter by search query (SN, index, or ONU type)
  const filteredONUs = searchQuery.trim() === ''
    ? statusFiltered
    : statusFiltered.filter(onu => {
      const q = searchQuery.toLowerCase()
      const shelfVal = onu.shelf !== undefined ? onu.shelf : '1'
      const idx = `${shelfVal}/${onu.oltCard}/${onu.port}:${onu.onuNumber}`
      return (
        onu.sn.toLowerCase().includes(q) ||
        idx.toLowerCase().includes(q) ||
        onu.onuType.toLowerCase().includes(q)
      )
    })

  const sortedONUs = [...filteredONUs].sort((a, b) => {
    if (!sortConfig) return 0
    
    // Special handling for Index column (mapped to 'port')
    if (sortConfig.key === 'port') {
      const direction = sortConfig.direction === 'asc' ? 1 : -1
      
      // Compare by oltCard (slot)
      if (a.oltCard !== b.oltCard) {
        return (a.oltCard - b.oltCard) * direction
      }
      // Compare by port
      if (a.port !== b.port) {
        return (a.port - b.port) * direction
      }
      // Compare by onuNumber
      return (a.onuNumber - b.onuNumber) * direction
    }

    const aVal = a[sortConfig.key]
    const bVal = b[sortConfig.key]
    if (typeof aVal === 'string') {
      return sortConfig.direction === 'asc' ? aVal.localeCompare(bVal as string) : (bVal as string).localeCompare(aVal)
    }
    return sortConfig.direction === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number)
  })

  const handleSort = (key: keyof ONU) => {
    setSortConfig(prev => {
      if (prev?.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
      }
      return { key, direction: 'asc' }
    })
  }

  const handleResetONU = (onu: ONU) => {
    const updatedOnu = { ...onu, status: 'unregistered' as const }
    const newStates = new Map(onuStates)
    newStates.set(onu.id, updatedOnu)
    setOnuStates(newStates)
  }

  const handleVerifyWanIp = async (onu: ONU) => {
    if (verifyingWanONUId) return
    setVerifyingWanONUId(onu.id)
    
    const shelf = onu.shelf ?? parseInt(onu.rack || '1')
    const slot = onu.oltCard
    const port = onu.port
    const onuId = onu.onuNumber
    const indexStr = `${shelf}/${slot}/${port}:${onuId}`
    
    try {
      const res = await fetch(`/api/onus/${encodeURIComponent(indexStr)}/verify-wan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      })
      
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        alert(`Telnet verification failed: ${err.detail || res.statusText}`)
        return
      }
      
      const data = await res.json()
      
      const updatedOnu = { 
        ...onu, 
        wan_ip: data.wan_ip || '-',
        mode: data.mode || undefined,
        wan_username: data.username || undefined,
        wan_hostname: data.hostname || undefined,
        status: data.onu_status || onu.status
      }
      
      const newStates = new Map(onuStates)
      newStates.set(onu.id, updatedOnu)
      setOnuStates(newStates)
      
      // Update dashboard counts immediately
      fetchStats()
      
      alert(`WAN IP retrieved successfully:\nIP: ${data.wan_ip || '-'}\nMode: ${data.mode || '-'}`)
    } catch (err) {
      console.error('[Verify WAN] Error:', err)
      alert('Network error while running Telnet verification.')
    } finally {
      setVerifyingWanONUId(null)
    }
  }

  const handleCheckONU = (onuId: string) => {
    const onu = onuStates.get(onuId)
    if (onu?.status?.toLowerCase() === 'unregistered') return

    const newChecked = new Set(checkedONUs)
    if (newChecked.has(onuId)) {
      newChecked.delete(onuId)
    } else {
      newChecked.add(onuId)
    }
    setCheckedONUs(newChecked)
  }

  const handleCheckAll = () => {
    const selectableONUs = sortedONUs.filter(onu => onu.status?.toLowerCase() !== 'unregistered')
    
    if (checkedONUs.size === selectableONUs.length && selectableONUs.length > 0) {
      setCheckedONUs(new Set())
    } else {
      setCheckedONUs(new Set(selectableONUs.map(onu => onu.id)))
    }
  }

  const handleRebootSelected = async () => {
    if (checkedONUs.size === 0 || isRebooting) return

    // Build the payload from the current ONU map
    const items = Array.from(checkedONUs)
      .map(id => onuStates.get(id))
      .filter((onu): onu is ONU => !!onu)
      .map(onu => ({
        olt_index: `${onu.shelf ?? (onu.rack || 1)}/${onu.oltCard}/${onu.port}`,
        onu_id: onu.onuNumber,
        sn: onu.sn,
        internal_id: onu.id,
      }))

    if (items.length === 0) return

    const confirmReboot = window.confirm(`Apakah Anda yakin ingin me-reboot ${items.length} ONU yang dipilih?`)
    if (!confirmReboot) return

    setIsRebooting(true)

    try {
      const res = await fetch(`/api/onus/reboot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
        credentials: 'include'
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        console.error('[Reboot ONU] API error:', err)
        alert(`Reboot failed: ${err.detail ?? res.statusText}`)
        return
      }

      const data: { results: { internal_id: string; result_status: string }[] } = await res.json()

      let successCount = 0
      for (const r of data.results) {
        if (r.result_status === 'rebooted') {
          successCount++
        }
      }
      
      alert(`Berhasil mengirimkan perintah reboot untuk ${successCount} dari ${items.length} ONU.`)
      setCheckedONUs(new Set())

      // Set status refreshing langsung agar UI terlihat loading
      setIsRefreshing(true)
      
      // Auto-refresh UI setelah 6 detik (menunggu backend sleep 5 detik + proses)
      setTimeout(() => {
        fetch(`/api/onus/details?refresh=true&force=true&t=${Date.now()}`, {
          cache: 'no-store',
          headers: { 'Pragma': 'no-cache', 'Cache-Control': 'no-cache' },
          credentials: 'include'
        })
          .then(r => r.json())
          .then((data: ONU[]) => {
            if (Array.isArray(data)) {
              setOnuStates(new Map(data.map((o) => [o.id, o])))
            }
            fetchStats()
          })
          .catch(() => { })
          .finally(() => {
            setIsRefreshing(false)
          })
      }, 6000)

    } catch (e) {
      console.error('[Reboot ONU] Network error:', e)
      alert('Reboot failed: Could not reach the backend.')
    } finally {
      setIsRebooting(false)
    }
  }

  const handleDeleteSelected = async () => {
    if (checkedONUs.size === 0 || isDeleting) return

    // Build the payload from the current ONU map
    const items = Array.from(checkedONUs)
      .map(id => onuStates.get(id))
      .filter((onu): onu is ONU => !!onu)
      .map(onu => ({
        olt_index: `${onu.shelf ?? (onu.rack || 1)}/${onu.oltCard}/${onu.port}`,
        onu_id: onu.onuNumber,
        sn: onu.sn,
        internal_id: onu.id,
      }))

    if (items.length === 0) return

    setIsDeleting(true)
    

    try {
      const res = await fetch(`/api/onus`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
        credentials: 'include'
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        console.error('[Delete ONU] API error:', err)
        alert(`Delete failed: ${err.detail ?? res.statusText}`)
        return
      }

      const data: { results: { internal_id: string; result_status: string }[] } = await res.json()

      // Merge response into current state — no full reload needed
      const newStates = new Map(onuStates)
      for (const r of data.results) {
        if (r.result_status === 'removed') {
          newStates.delete(r.internal_id)
        } else if (r.result_status === 'unregistered') {
          const existing = newStates.get(r.internal_id)
          if (existing) {
            newStates.set(r.internal_id, { ...existing, status: 'unregistered' })
          }
        }
      }
      setOnuStates(newStates)
      setCheckedONUs(new Set())

    } catch (e) {
      console.error('[Delete ONU] Network error:', e)
      alert('Delete failed: Could not reach the backend.')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleApplyConfig = (onuId: string, status?: string) => {
    const newStates = new Map(onuStates)
    const onu = newStates.get(onuId)
    if (onu) {
      const targetStatus = (status || 'online').toLowerCase() as any
      newStates.set(onuId, { ...onu, status: targetStatus })
      setOnuStates(newStates)
    }
    setConfigWizardONU(null)
  }

  const handleRegisterONU = async (onu: ONU) => {
    if (isRegistering) return

    setIsRegistering(true)
    

    try {
      const res = await fetch(`/api/onus/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          olt_index: `${onu.shelf ?? (onu.rack || 1)}/${onu.oltCard}/${onu.port}`,
          sn: onu.sn,
          onu_id: registerOnuIndex && registerOnuIndex !== 'Auto' ? parseInt(registerOnuIndex) : undefined
        }),
        credentials: 'include'
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        alert(`Registration failed: ${err.detail ?? res.statusText}`)
        return
      }

      const data = await res.json()
      const newId = `unconf_${data.id}`

      // Update local state: change status to unconfigured and enrich with SNMP & Telnet data
      const newStates = new Map(onuStates)
      const updatedOnu: ONU = {
        ...onu,
        id: newId,
        status: 'unconfigured',
        onuNumber: data.onu_id,
        name: data.snmp_verification?.name !== '-' ? data.snmp_verification?.name : '-',
        description: data.snmp_verification?.description !== '-' ? data.snmp_verification?.description : undefined,
        wan_ip: data.telnet_verification?.parsed?.current_ip || undefined,
        wan_username: data.telnet_verification?.parsed?.username || undefined,
        wan_password: data.telnet_verification?.parsed?.password || undefined,
        wan_hostname: data.telnet_verification?.parsed?.hostname || undefined,
        mode: data.telnet_verification?.parsed?.mode || undefined
      }
      newStates.delete(onu.id)
      newStates.set(newId, updatedOnu)
      setOnuStates(newStates)
      setRegisterModalONU(null)

    } catch (e) {
      console.error('[Register ONU] error:', e)
      alert('Registration failed: Could not reach the backend.')
    } finally {
      setIsRegistering(false)
    }
  }

  const getStatusIcon = (status: string) => {
    const s = status?.toLowerCase();
    switch (s) {
      case 'online':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center gap-1 w-fit shadow-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            Online
          </span>
        )
      case 'los':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-red-50 text-red-600 border border-red-100 flex items-center gap-1 w-fit shadow-sm">
            <WifiOff size={10} />
            LOS
          </span>
        )
      case 'offline':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-gray-50 text-gray-500 border border-gray-200 flex items-center gap-1 w-fit">
            <WifiOff size={10} />
            Offline
          </span>
        )
      case 'dying-gasp':
      case 'dyinggasp':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-700 border border-red-200 flex items-center gap-1 w-fit shadow-sm">
            <AlertCircle size={10} />
            Dying Gasp
          </span>
        )
      case 'unregistered':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-purple-50 text-purple-600 border border-purple-100 flex items-center gap-1 w-fit shadow-sm">
            <PlusCircle size={10} />
            Unregistered
          </span>
        )
      case 'unconfigured':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-50 text-amber-600 border border-amber-100 flex items-center gap-1 w-fit shadow-sm">
            <Settings size={10} className="animate-spin-slow" />
            Unconfigured
          </span>
        )
      case 'syncmib':
      case 'logging':
      case 'auth-failed':
      case 'authfailed':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-blue-600 border border-blue-100 flex items-center gap-1 w-fit shadow-sm">
            <Loader2 size={10} className="animate-spin" />
            {(s === 'auth-failed' || s === 'authfailed') ? 'Registering...' : s === 'syncmib' ? 'Sync MIB' : 'Logging'}
          </span>
        )
      default:
        return <span className="text-xs text-gray-500 font-medium">{status}</span>
    }
  }

  // Determine which columns to show based on OLT type
  const showDistance = false
  const showLastSeen = false
  const showFirmware = false
  const showMac = false

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6">
      {/* Page Title */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-gray-900">ONU List</h2>
          {statusFilter !== 'all' && (
            <p className="text-sm text-gray-600 mt-1">
              Showing {statusFilter === 'online' ? 'Online' : statusFilter === 'offline' ? 'Offline' : statusFilter === 'los' ? 'LOS' : 'Unconfigured'} ONUs
            </p>
          )}
        </div>
      </div>

      {/* Premium ONU Status Dock */}
      <PremiumONUStats 
        stats={stats} 
        activeFilter={statusFilter} 
        onFilterChange={setStatusFilter} 
        loading={isFetchingStats && stats.online === 0} 
      />

      {/* Toolbar: OLT Selector, Search, Filter, Refresh, Delete */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center flex-wrap">
        <div className="flex items-center gap-2 relative z-30">
          <label className="text-sm font-medium text-gray-700 whitespace-nowrap">Select OLT:</label>
          <OLTSelector selectedOLT={selectedOLT} onOLTChange={onOLTChange} variant="compact" />
        </div>

        {/* Search Input */}
        <div className="relative flex-1 min-w-[180px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search by SN, index, or type..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-red-200 rounded-lg bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
          />
        </div>

        {/* Status Filter */}
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700 whitespace-nowrap">Filter:</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="px-3 py-2 border border-red-200 rounded-lg bg-white text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
          >
            <option value="all">All</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
            <option value="los">LOS</option>
            <option value="unconfigured">Unconfigured</option>
          </select>
        </div>

        {/* Refresh Button */}
        <button
          onClick={() => {
            if (isRefreshing || isLoading) return;

            if (onuStates.size === 0) setIsLoading(true)
            else setIsRefreshing(true)
            
            
            // Use refresh=true to bypass server-side cache and trigger fresh SNMP walk
            fetch(`/api/onus/details?refresh=true&force=true&t=${Date.now()}`, {
              cache: 'no-store',
              headers: { 'Pragma': 'no-cache', 'Cache-Control': 'no-cache' }
            })
              .then(r => r.json())
              .then((data: ONU[]) => {
                if (Array.isArray(data)) {
                  setOnuStates(new Map(data.map((o) => [o.id, o])))
                }
                // Update stats immediately after force refresh completes!
                fetchStats()
              })
              .catch(() => { })
              .finally(() => {
                setIsLoading(false)
                setIsRefreshing(false)
              })
          }}
          disabled={!isMatch || isLoading || isRefreshing}
          title={isRefreshing ? "Refreshing..." : "Force refresh ONU list from hardware"}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-red-200 bg-white text-red-600 text-sm font-medium hover:bg-red-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RefreshCw size={15} className={isLoading || isRefreshing ? 'animate-spin' : ''} />
          {isRefreshing ? 'Refreshing...' : 'Force Refresh'}
        </button>

        {/* Reboot Button - Admin Only */}
        {userRole === 'admin' && (
          <button
            onClick={handleRebootSelected}
            disabled={checkedONUs.size === 0 || isRebooting || isDeleting}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${checkedONUs.size > 0 && !isRebooting && !isDeleting
                ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-sm'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
          >
            {isRebooting ? (
              <><RefreshCw size={16} className="animate-spin" /> Rebooting...</>
            ) : (
              <><RefreshCw size={16} /> Reboot {checkedONUs.size > 0 && `(${checkedONUs.size})`}</>
            )}
          </button>
        )}

        {/* Delete Button - Admin Only */}
        {userRole === 'admin' && (
          <button
            onClick={handleDeleteSelected}
            disabled={checkedONUs.size === 0 || isDeleting || !isMatch}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${checkedONUs.size > 0 && !isDeleting && isMatch
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
          >
            {isDeleting ? (
              <><RefreshCw size={16} className="animate-spin" /> Deleting...</>
            ) : (
              <><Trash2 size={16} /> Delete {checkedONUs.size > 0 && `(${checkedONUs.size})`}</>
            )}
          </button>
        )}
      </div>

      {/* ONU Table */}
      <div className={`bg-white/95 backdrop-blur-md rounded-lg shadow-md border border-red-100 overflow-hidden relative transition-opacity ${(isDeleting || isRebooting) ? 'opacity-60 pointer-events-none' : ''
        }`}>
        {/* Deleting overlay */}
        {isDeleting && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 backdrop-blur-sm rounded-lg">
            <div className="flex flex-col items-center gap-3">
              <RefreshCw size={28} className="animate-spin text-red-600" />
              <span className="text-sm font-semibold text-red-700">Deleting ONU(s) from OLT…</span>
              <span className="text-xs text-gray-500">Verifying hardware state after deletion</span>
            </div>
          </div>
        )}
        {/* Rebooting overlay */}
        {isRebooting && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 backdrop-blur-sm rounded-lg">
            <div className="flex flex-col items-center gap-3">
              <RefreshCw size={28} className="animate-spin text-amber-600" />
              <span className="text-sm font-semibold text-amber-700">Rebooting ONU(s) remotely…</span>
              <span className="text-xs text-gray-500">Sending Telnet reboot commands to hardware</span>
            </div>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-red-50 border-b border-red-100">
              <tr>
                {userRole === 'admin' && (
                  <th className="px-4 py-3 text-center w-12">
                    <input
                      type="checkbox"
                      checked={
                        sortedONUs.filter(o => o.status?.toLowerCase() !== 'unregistered').length > 0 && 
                        checkedONUs.size === sortedONUs.filter(o => o.status?.toLowerCase() !== 'unregistered').length
                      }
                      onChange={handleCheckAll}
                      className="w-4 h-4 text-red-600 border-gray-300 rounded focus:ring-red-500 cursor-pointer"
                    />
                  </th>
                )}
                <th className="px-4 py-3 text-left">
                  <button onClick={() => handleSort('status')} className="flex items-center gap-1 text-xs font-semibold text-gray-700 hover:text-red-600">
                    Status {sortConfig?.key === 'status' && (sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                  </button>
                </th>
                <th className="px-4 py-3 text-left">
                  <button onClick={() => handleSort('port')} className="flex items-center gap-1 text-xs font-semibold text-gray-700 hover:text-red-600">
                    Index {sortConfig?.key === 'port' && (sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                  </button>
                </th>
                <th className="px-4 py-3 text-left">
                  <button onClick={() => handleSort('sn')} className="flex items-center gap-1 text-xs font-semibold text-gray-700 hover:text-red-600">
                    SN {sortConfig?.key === 'sn' && (sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                  </button>
                </th>
                <th className="px-4 py-3 text-left">
                  <button onClick={() => handleSort('name')} className="flex items-center gap-1 text-xs font-semibold text-gray-700 hover:text-red-600">
                    Name {sortConfig?.key === 'name' && (sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                  </button>
                </th>
                <th className="px-4 py-3 text-left">
                  <button onClick={() => handleSort('description')} className="flex items-center gap-1 text-xs font-semibold text-gray-700 hover:text-red-600">
                    Description {sortConfig?.key === 'description' && (sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                  </button>
                </th>
                <th className="px-4 py-3 text-left">
                  <button onClick={() => handleSort('onuType')} className="flex items-center gap-1 text-xs font-semibold text-gray-700 hover:text-red-600">
                    ONU Type {sortConfig?.key === 'onuType' && (sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                  </button>
                </th>
                {isC6xx && (
                  <th className="px-4 py-3 text-left">
                    <button onClick={() => handleSort('hardwareVersion')} className="flex items-center gap-1 text-xs font-semibold text-gray-700 hover:text-red-600">
                      HW Version {sortConfig?.key === 'hardwareVersion' && (sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                    </button>
                  </th>
                )}
                <th className="px-4 py-3 text-left">
                  <button onClick={() => handleSort('softwareVersion')} className="flex items-center gap-1 text-xs font-semibold text-gray-700 hover:text-red-600">
                    SW Version {sortConfig?.key === 'softwareVersion' && (sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                  </button>
                </th>
                {/* Power Rx/Tx and Distance columns hidden for performance (Use View Details for live check) */}
                {/* 
                <th className="px-4 py-3 text-left">
                  <button onClick={() => handleSort('opticalPower')} className="flex items-center gap-1 text-xs font-semibold text-gray-700 hover:text-red-600">
                    <div>
                      <div>Power Rx</div>
                      <div className="text-gray-500">(dBm)</div>
                    </div>
                    {sortConfig?.key === 'opticalPower' && (sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                  </button>
                </th>
                <th className="px-4 py-3 text-left">
                  <button onClick={() => handleSort('powerTx')} className="flex items-center gap-1 text-xs font-semibold text-gray-700 hover:text-red-600">
                    <div>
                      <div>Power Tx</div>
                      <div className="text-gray-500">(dBm)</div>
                    </div>
                    {sortConfig?.key === 'powerTx' && (sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                  </button>
                </th>
                {showDistance && (
                  <th className="px-4 py-3 text-left">
                    <div className="text-xs font-semibold text-gray-700">
                      <div>Distance</div>
                      <div className="text-gray-500">(km)</div>
                    </div>
                  </th>
                )}
                */}
                {showLastSeen && (
                  <th className="px-4 py-3 text-left">
                    <div className="text-xs font-semibold text-gray-700">Last Seen</div>
                  </th>
                )}
                {showFirmware && (
                  <th className="px-4 py-3 text-left">
                    <div className="text-xs font-semibold text-gray-700">Firmware</div>
                  </th>
                )}
                {showMac && (
                  <th className="px-4 py-3 text-left">
                    <div className="text-xs font-semibold text-gray-700">MAC Address</div>
                  </th>
                )}
                {userRole === 'admin' && (
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-red-50">
              {isLoading && sortedONUs.length === 0 ? (
                // ── Shimmer skeleton rows ──
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={`skeleton-${i}`} className="animate-pulse">
                    {userRole === 'admin' && (
                      <td className="px-4 py-3">
                        <div className="w-4 h-4 bg-gray-200 rounded" />
                      </td>
                    )}
                    <td className="px-4 py-3"><div className="h-5 w-20 bg-gray-200 rounded-full" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-24 bg-gray-200 rounded" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-28 bg-gray-200 rounded" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-32 bg-gray-200 rounded" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-40 bg-gray-200 rounded" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-20 bg-gray-200 rounded" /></td>
                    {isC6xx && (
                      <td className="px-4 py-3"><div className="h-4 w-20 bg-gray-200 rounded mx-auto" /></td>
                    )}
                    <td className="px-4 py-3"><div className="h-4 w-14 bg-gray-200 rounded mx-auto" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-14 bg-gray-200 rounded mx-auto" /></td>
                    {userRole === 'admin' && (
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <div className="h-6 w-14 bg-gray-200 rounded" />
                          <div className="h-6 w-20 bg-gray-200 rounded" />
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              ) : sortedONUs.length === 0 ? (
                <tr>
                  <td colSpan={userRole === 'admin' ? (isC6xx ? 13 : 12) : (isC6xx ? 12 : 11)} className="px-4 py-20 text-center">
                    {!isMatch ? (
                      connectionState === 'MISMATCH' ? (
                        <div className="flex flex-col items-center gap-3">
                          <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mb-2">
                            <AlertCircle className="text-amber-500" size={32} />
                          </div>
                          <p className="text-gray-900 font-semibold text-lg">Identity Mismatch!</p>
                          <p className="text-gray-500 text-sm max-w-md mx-auto">Selected OLT model does not match the connected hardware. Please check your selection.</p>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-5">
                          <div className="relative">
                            <div className="w-20 h-20 border-4 border-red-100 border-t-red-600 rounded-full animate-spin" />
                            <div className="absolute inset-0 flex items-center justify-center">
                              <Wifi className="text-red-600 animate-pulse" size={28} />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <p className="text-gray-900 font-bold text-xl tracking-tight">Connecting to OLT Hardware</p>
                            <p className="text-gray-500 text-sm flex items-center justify-center gap-2">
                              <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-ping" />
                              Synchronizing live state via Serial...
                            </p>
                          </div>
                        </div>
                      )
                    ) : (
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-2">
                          <Search className="text-gray-400" size={32} />
                        </div>
                        <p className="text-gray-900 font-semibold text-lg">No ONUs Found</p>
                        <p className="text-gray-500 text-sm">There are no ONUs registered on this OLT port.</p>
                      </div>
                    )}
                  </td>
                </tr>
              ) : sortedONUs.map(onu => (
                <tr key={onu.id} className="hover:bg-red-50/50 transition-colors">
                  {userRole === 'admin' && (
                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={checkedONUs.has(onu.id)}
                        onChange={() => handleCheckONU(onu.id)}
                        disabled={onu.status?.toLowerCase() === 'unregistered'}
                        className={`w-4 h-4 text-red-600 border-gray-300 rounded focus:ring-red-500 ${
                          onu.status?.toLowerCase() === 'unregistered' ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
                        }`}
                      />
                    </td>
                  )}
                  <td className="px-4 py-3">{getStatusIcon(onu.status)}</td>
                  <td className="px-4 py-3 text-sm text-gray-900 font-medium font-mono">
                    {onu.shelf !== undefined ? onu.shelf : '1'}/{onu.oltCard}/{onu.port}:{(onu.status?.toLowerCase() === 'unregistered' || onu.status?.toLowerCase() === 'sync mib' || onu.status?.toLowerCase() === 'logging') ? '-' : onu.onuNumber}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 font-mono">{onu.sn}</td>
                  <td className="px-4 py-3 text-sm text-gray-900 font-medium">{onu.name || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 italic truncate max-w-[150px]" title={onu.description}>{onu.description || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-900">{onu.onuType}</td>
                  {isC6xx && (
                    <td className="px-4 py-3 text-sm text-gray-600 font-mono">{onu.hardwareVersion || '-'}</td>
                  )}
                  <td className="px-4 py-3 text-sm text-gray-600 font-mono">{onu.softwareVersion || '-'}</td>
                  {/* Power Rx/Tx and Distance cells hidden for performance */}
                  {/* 
                  <td className="px-4 py-3 text-sm font-mono text-gray-900 text-center">
                    {(onu.status === 'offline' || onu.status === 'los' || onu.status === 'unregistered') ? (
                      <span className="text-gray-400">-</span>
                    ) : (
                      <span className={onu.opticalPower === -99 ? 'text-gray-400' : onu.opticalPower >= -28 ? 'text-emerald-600' : onu.opticalPower >= -30 ? 'text-amber-500' : 'text-red-600'}>
                        {onu.opticalPower === -99 ? '-' : onu.opticalPower}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm font-mono text-gray-900 text-center">
                    {(onu.status === 'offline' || onu.status === 'los' || onu.status === 'unregistered') ? (
                      <span className="text-gray-400">-</span>
                    ) : onu.powerTx !== undefined ? (
                      <span className="text-emerald-600">{onu.powerTx}</span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  {showDistance && (
                    <td className="px-4 py-3 text-sm font-mono text-gray-900 text-center">
                      {onu.distance !== undefined ? onu.distance : '-'}
                    </td>
                  )}
                  */}
                  {showLastSeen && (
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {onu.lastSeen || '-'}
                    </td>
                  )}
                  {showFirmware && (
                    <td className="px-4 py-3 text-sm text-gray-600 font-mono">
                      {onu.firmwareVersion || '-'}
                    </td>
                  )}
                  {showMac && (
                    <td className="px-4 py-3 text-sm text-gray-600 font-mono">
                      {onu.macAddress || '-'}
                    </td>
                  )}
                  {userRole === 'admin' && (
                    <td className="px-4 py-3 text-sm">
                      <div className="flex items-center gap-2">
                        {(onu.id?.startsWith('unconf_')) && (
                          <>
                            {onu.status?.toLowerCase() === 'unconfigured' && (
                              <button
                                onClick={() => setConfigWizardONU(onu)}
                                className="px-3 py-1 bg-blue-50 hover:bg-blue-100 text-blue-600 text-xs font-medium rounded transition-colors shadow-sm"
                              >
                                Config
                              </button>
                            )}
                            <button
                              onClick={() => setEditONU(onu)}
                              className="px-3 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-xs font-medium rounded transition-colors shadow-sm flex items-center gap-1"
                            >
                              <Edit size={12} />
                              Edit
                            </button>
                            <button
                              onClick={() => setSelectedONU(onu)}
                              className="px-3 py-1 bg-gray-50 hover:bg-gray-100 text-gray-600 text-xs font-medium rounded transition-colors shadow-sm"
                            >
                              View Details
                            </button>
                            {(onu.status?.toLowerCase() === 'unconfigured' || onu.status?.toLowerCase() === 'online') && (
                              <button
                                onClick={() => handleVerifyWanIp(onu)}
                                disabled={verifyingWanONUId === onu.id}
                                title="Verify WAN IP via Telnet"
                                className="p-1 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors flex items-center justify-center"
                              >
                                <RefreshCw size={14} className={verifyingWanONUId === onu.id ? 'animate-spin' : ''} />
                              </button>
                            )}
                          </>
                        )}
                        {(onu.id?.startsWith('unreg_')) && (
                          <>
                            <button
                              onClick={() => {
                                setRegisterModalONU(onu);
                                setRegisterOnuIndex(onu.onuNumber === 0 ? "" : onu.onuNumber.toString());
                              }}
                              className="px-3 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-600 text-xs font-medium rounded transition-colors shadow-sm"
                            >
                              Regist
                            </button>
                            <button
                              onClick={() => setSelectedONU(onu)}
                              className="px-3 py-1 bg-gray-50 hover:bg-gray-100 text-gray-600 text-xs font-medium rounded transition-colors shadow-sm"
                            >
                              View Details
                            </button>
                          </>
                        )}
                        {(onu.status?.toLowerCase() === 'online' && !onu.id?.startsWith('unconf_') && !onu.id?.startsWith('unreg_')) && (
                          <>
                            <button
                              onClick={() => handleResetONU(onu)}
                              className="px-3 py-1 bg-amber-50 hover:bg-amber-100 text-amber-600 text-xs font-medium rounded transition-colors shadow-sm"
                            >
                              Reset
                            </button>
                            <button
                              onClick={() => setSelectedONU(onu)}
                              className="px-3 py-1 bg-gray-50 hover:bg-gray-100 text-gray-600 text-xs font-medium rounded transition-colors shadow-sm"
                            >
                              View Details
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Details Modal */}
      {selectedONU && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full max-h-[90vh] flex flex-col border border-gray-200 overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white flex-shrink-0">
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-sm ${
                  selectedONU.status === 'online' ? 'bg-emerald-50 text-emerald-600' :
                  selectedONU.status === 'offline' ? 'bg-red-50 text-red-600' : 
                  selectedONU.status === 'unregistered' ? 'bg-purple-50 text-purple-600' : 'bg-amber-50 text-amber-600'
                }`}>
                  <Search size={24} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-xl font-bold text-gray-900 tracking-tight">ONU Details</h3>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                      selectedONU.status === 'online' ? 'bg-emerald-100 text-emerald-700' :
                      selectedONU.status === 'offline' ? 'bg-red-100 text-red-700' : 
                      selectedONU.status === 'unregistered' ? 'bg-purple-100 text-purple-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                      {selectedONU.status}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 font-medium">SN: {selectedONU.sn} • {selectedONU.onuType}</p>
                </div>
              </div>
              <button
                onClick={() => { setSelectedONU(null); setDetailsTab('info'); }}
                className="p-2 hover:bg-gray-100 rounded-xl transition-all duration-200 text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>

            {/* Tab Navigation */}
            <div className="flex border-b border-gray-100 px-8 bg-white flex-shrink-0">
              {[
                { id: 'info', label: 'Device Info', icon: Settings },
                { id: 'performance', label: 'Performance', icon: BarChart },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setDetailsTab(tab.id as any)}
                  className={`px-6 py-4 text-sm font-bold transition-all relative flex items-center gap-2 group ${
                    detailsTab === tab.id
                      ? 'text-red-600'
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  <tab.icon size={16} />
                  {tab.label}
                  {detailsTab === tab.id && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-red-600 rounded-t-full" />
                  )}
                </button>
              ))}
            </div>

            {/* Modal Content */}
            <div className="p-8 overflow-y-auto flex-1 min-h-0 bg-gray-50/30">
              {detailsTab === 'info' && (
                <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-300">
                  <div className="grid md:grid-cols-2 gap-8">
                    <section>
                      <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                        <AlertCircle size={14} className="text-red-500" />
                        Network Identity
                      </h4>
                      <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm space-y-4">
                        <div className="flex justify-between items-center py-2 border-b border-gray-50">
                          <span className="text-sm text-gray-500 font-medium">Serial Number</span>
                          <span className="text-sm font-bold text-gray-900 font-mono">{selectedONU.sn}</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b border-gray-50">
                          <span className="text-sm text-gray-500 font-medium">ONU Name</span>
                          <span className="text-sm font-bold text-red-600">{selectedONU.name || '-'}</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b border-gray-50">
                          <span className="text-sm text-gray-500 font-medium">Description</span>
                          <span className="text-sm font-medium text-gray-700 italic">{selectedONU.description || '-'}</span>
                        </div>

                        <div className="flex justify-between items-center py-2 border-b border-gray-50">
                          <span className="text-sm text-gray-500 font-medium">Hardware Model</span>
                          <span className="text-sm font-bold text-gray-900">{selectedONU.onuType}</span>
                        </div>
                        {isC6xx && (
                          <div className="flex justify-between items-center py-2 border-b border-gray-50">
                            <span className="text-sm text-gray-500 font-medium">Hardware Version</span>
                            <span className="text-sm font-bold text-gray-900">{selectedONU.hardwareVersion || '-'}</span>
                          </div>
                        )}
                        <div className="flex justify-between items-center py-2">
                          <span className="text-sm text-gray-500 font-medium">Software Version</span>
                          <span className="text-sm font-bold text-gray-900">{selectedONU.softwareVersion || '-'}</span>
                        </div>
                      </div>
                    </section>

                    <section>
                      <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                        <Wifi size={14} className="text-blue-500" />
                        Optical Status
                      </h4>
                      <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm space-y-4">
                        <div className="flex justify-between items-center py-2 border-b border-gray-50">
                          <span className="text-sm text-gray-500 font-medium">Rx Optical Power</span>
                          <div className="flex items-center gap-2">
                             <div className={`w-2 h-2 rounded-full ${selectedONU.opticalPower === -99 ? 'bg-gray-400' : selectedONU.opticalPower > -25 ? 'bg-emerald-500' : 'bg-red-500'}`} />
                             <span className={`text-sm font-bold ${selectedONU.opticalPower === -99 ? 'text-gray-400' : selectedONU.opticalPower > -25 ? 'text-emerald-600' : 'text-red-600'}`}>
                               {selectedONU.opticalPower === -99 ? '-' : `${selectedONU.opticalPower} dBm`}
                             </span>
                          </div>
                        </div>
                        <div className="flex justify-between items-center py-2">
                          <span className="text-sm text-gray-500 font-medium">Tx Optical Power</span>
                          <span className="text-sm font-bold text-gray-900">{selectedONU.powerTx === -99 || !selectedONU.powerTx ? '-' : `${selectedONU.powerTx} dBm`}</span>
                        </div>
                      </div>
                    </section>
                  </div>
                  
                  {/* Premium WAN & PPPoE Details Section */}
                  {(selectedONU.mode || selectedONU.wan_username || selectedONU.wan_ip || selectedONU.wan_hostname) && (
                    <div className="mt-8 animate-in slide-in-from-bottom-4 duration-500">
                      <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                        <Globe size={14} className="text-indigo-500" />
                        WAN & PPPoE Configuration
                      </h4>
                      <div className="bg-gradient-to-br from-indigo-50/20 to-white rounded-2xl p-6 border border-indigo-100/50 shadow-sm grid md:grid-cols-2 gap-8">
                        <div className="space-y-4">
                          <div className="flex justify-between items-center py-2 border-b border-indigo-50/50">
                            <span className="text-sm text-gray-500 font-medium">WAN Mode</span>
                            <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-100/50 uppercase tracking-wider">{selectedONU.mode || '-'}</span>
                          </div>
                          <div className="flex justify-between items-center py-2 border-b border-indigo-50/50">
                            <span className="text-sm text-gray-500 font-medium">WAN Username</span>
                            <span className="text-sm font-bold text-gray-900 font-mono">{selectedONU.wan_username || '-'}</span>
                          </div>
                          <div className="flex justify-between items-center py-2">
                            <span className="text-sm text-gray-500 font-medium">WAN Password</span>
                            <span className="text-sm font-bold text-gray-900 font-mono">{selectedONU.wan_password || '-'}</span>
                          </div>
                        </div>
                        <div className="space-y-4">
                          <div className="flex justify-between items-center py-2 border-b border-indigo-50/50">
                            <span className="text-sm text-gray-500 font-medium">Current WAN IP</span>
                            <span className="text-sm font-bold text-indigo-600 bg-indigo-50/30 px-2.5 py-0.5 rounded font-mono">
                              {selectedONU.status?.toLowerCase() === 'online' ? (selectedONU.wan_ip || '-') : '-'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center py-2 border-b border-indigo-50/50">
                            <span className="text-sm text-gray-500 font-medium">WAN Hostname</span>
                            <span className="text-sm font-medium text-gray-700">{selectedONU.wan_hostname || '-'}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  </div>
              )}

              {detailsTab === 'performance' && (
                <div className="animate-in slide-in-from-right-4 duration-300">
                  <PerformanceTab data={performanceData} isLoading={isLoadingPerformance} />
                </div>
              )}



            </div>

            {/* Modal Footer */}
            <div className="p-6 border-t border-gray-100 bg-white flex justify-end flex-shrink-0">
              <button
                onClick={() => { setSelectedONU(null); setDetailsTab('info'); }}
                className="px-8 py-3 bg-gray-900 hover:bg-gray-800 text-white font-bold rounded-xl transition-all shadow-lg shadow-gray-200"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Register ONU Modal */}
      {registerModalONU && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white/95 backdrop-blur-md rounded-xl shadow-2xl w-full border border-white/20 transition-all duration-300 max-w-md">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Register ONU</h3>
                <p className="text-sm text-gray-500 mt-1">Hardware parameters detected automatically</p>
              </div>
              <button
                onClick={() => setRegisterModalONU(null)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X size={20} className="text-gray-500" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-4">
              {/* Read-only hardware parameters */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Rack</label>
                  <input
                    type="text"
                    value={registerModalONU.shelf !== undefined ? registerModalONU.shelf : (registerModalONU.rack || '1')}
                    disabled
                    className="w-full px-3 py-2.5 bg-gray-100/80 border border-gray-200 rounded-lg text-gray-700 font-mono text-sm cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Slot</label>
                  <input
                    type="text"
                    value={registerModalONU.oltCard.toString()}
                    disabled
                    className="w-full px-3 py-2.5 bg-gray-100/80 border border-gray-200 rounded-lg text-gray-700 font-mono text-sm cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Port</label>
                  <input
                    type="text"
                    value={registerModalONU.port.toString()}
                    disabled
                    className="w-full px-3 py-2.5 bg-gray-100/80 border border-gray-200 rounded-lg text-gray-700 font-mono text-sm cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">ONU Index</label>
                  <input
                    type="text"
                    value={registerOnuIndex}
                    onChange={(e) => setRegisterOnuIndex(e.target.value)}
                    placeholder="Enter Index (1-128)"
                    className="w-full px-4 py-3.5 bg-white border border-gray-200 rounded-xl text-sm font-mono font-bold focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all placeholder:text-gray-300"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Serial Number (SN)</label>
                <input
                  type="text"
                  value={registerModalONU.sn}
                  disabled
                  className="w-full px-3 py-2.5 bg-gray-100/80 border border-gray-200 rounded-lg text-gray-700 font-mono text-sm cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">ONU Type</label>
                <input
                  type="text"
                  value={registerModalONU.onuType}
                  disabled
                  className="w-full px-3 py-2.5 bg-gray-100/80 border border-gray-200 rounded-lg text-gray-700 font-mono text-sm cursor-not-allowed"
                />
              </div>

              {/* Info notice */}
              <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-[10px] text-gray-400 font-medium flex items-center gap-1.5 px-1">
                  <AlertCircle size={12} className="text-amber-500" />
                  Hardware parameters are detected automatically. Please specify the ONU Index manually.
                </p>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex gap-3 p-6 border-t border-gray-200 bg-gray-50/50">
              <button
                onClick={() => setRegisterModalONU(null)}
                className="flex-1 px-4 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleRegisterONU(registerModalONU)}
                disabled={isRegistering}
                className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {isRegistering ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Registering...
                  </>
                ) : (
                  'Proceed to Register'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ONU Configuration Wizard Modal */}
      {configWizardONU && (
        <ONUConfigWizard
          onu={configWizardONU}
          isC6xx={isC6xx}
          onClose={() => setConfigWizardONU(null)}
          onApply={handleApplyConfig}
        />
      )}

      {/* Edit Unconfigured ONU Modal */}
      {editONU && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[60] flex items-center justify-center p-4 animate-in fade-in duration-300">
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden border border-gray-100"
          >
            <div className="p-6 border-b border-gray-50 flex items-center justify-between bg-gradient-to-r from-gray-50 to-white">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shadow-sm">
                  <Edit size={20} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Edit ONU Info</h3>
                  <p className="text-xs text-gray-500 font-medium">{editONU.sn}</p>
                </div>
              </div>
              <button onClick={() => setEditONU(null)} className="p-2 hover:bg-gray-100 rounded-xl transition-colors text-gray-400">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-8 space-y-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">ONU Name</label>
                <input
                  type="text"
                  placeholder="e.g. CUSTOMER-1"
                  defaultValue={editONU.name || ''}
                  id="edit-onu-name"
                  minLength={1}
                  maxLength={127}
                  required
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all font-medium text-gray-900"
                />
                <p className="text-[10px] text-gray-400 ml-1 italic">1-127 characters (All allowed)</p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Description</label>
                <textarea
                  placeholder="e.g. Residential 100Mbps"
                  defaultValue={editONU.description || ''}
                  id="edit-onu-desc"
                  rows={3}
                  minLength={1}
                  maxLength={200}
                  required
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all font-medium text-gray-900 resize-none"
                />
                <p className="text-[10px] text-gray-400 ml-1 italic">1-200 characters</p>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setEditONU(null)}
                  className="flex-1 px-6 py-3 border border-gray-200 text-gray-600 font-bold rounded-xl hover:bg-gray-50 transition-all active:scale-95"
                >
                  Cancel
                </button>
                <button
                  id="btn-apply-edit"
                  onClick={async () => {
                    const name = (document.getElementById('edit-onu-name') as HTMLInputElement).value.trim();
                    const desc = (document.getElementById('edit-onu-desc') as HTMLTextAreaElement).value.trim();
                    
                    // Frontend Validation
                    if (!name || name.length > 127) {
                      alert("Invalid Name: 1-127 characters required.");
                      return;
                    }
                    if (!desc || desc.length > 200) {
                      alert("Invalid Description: 1-200 characters required.");
                      return;
                    }

                    const btn = document.getElementById('btn-apply-edit') as HTMLButtonElement;
                    const originalText = btn.innerText;
                    btn.disabled = true;
                    btn.innerText = "Applying...";

                    try {
                      const res = await fetch('/api/onus/unconfigured/edit', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: editONU.id, name, description: desc }),
                      });
                      
                      const data = await res.json();
                      if (res.ok) {
                        // Update local state
                        const newStates = new Map(onuStates);
                        const updated = { ...editONU, name, description: desc };
                        newStates.set(editONU.id, updated);
                        setOnuStates(newStates);
                        setEditONU(null);
                      } else {
                        const errorMsg = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail);
                        alert(`Error: ${errorMsg || 'Failed to update ONU'}`);
                      }
                    } catch (err) {
                      alert("Network error occurred.");
                    } finally {
                      btn.disabled = false;
                      btn.innerText = originalText;
                    }
                  }}
                  className="flex-1 px-6 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  Apply Changes
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  )
}

interface ONUStats {
  online: number;
  offline: number;
  los: number;
  unconfigured: number;
}

function PremiumONUStats({ 
  stats, 
  activeFilter, 
  onFilterChange,
  loading 
}: { 
  stats: ONUStats, 
  activeFilter: string, 
  onFilterChange: (s: 'all' | 'online' | 'offline' | 'unconfigured' | 'los' | 'unregistered') => void,
  loading: boolean
}) {
  const items = [
    { label: 'Online', key: 'online' as const, color: 'emerald', icon: Wifi, count: stats.online },
    { label: 'Offline', key: 'offline' as const, color: 'red', icon: WifiOff, count: stats.offline },
    { label: 'LOS', key: 'los' as const, color: 'orange', icon: AlertCircle, count: stats.los },
    { label: 'Unconfigured', key: 'unconfigured' as const, color: 'blue', icon: Settings, count: stats.unconfigured },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {items.map((item) => {
        const isActive = activeFilter === item.key
        const colorClass = 
          item.color === 'emerald' ? 'from-emerald-500/20 to-emerald-600/5 border-emerald-500/30 text-gray-900 shadow-emerald-500/10' :
          item.color === 'red' ? 'from-red-500/20 to-red-600/5 border-red-500/30 text-gray-900 shadow-red-500/10' :
          item.color === 'orange' ? 'from-orange-500/20 to-orange-600/5 border-orange-500/30 text-gray-900 shadow-orange-500/10' :
          'from-blue-500/20 to-blue-600/5 border-blue-500/30 text-gray-900 shadow-blue-500/10'

        const iconBg = 
          item.color === 'emerald' ? 'bg-emerald-500 text-white shadow-emerald-500/40' :
          item.color === 'red' ? 'bg-red-500 text-white shadow-red-500/40' :
          item.color === 'orange' ? 'bg-orange-500 text-white shadow-orange-500/40' :
          'bg-blue-500 text-white shadow-blue-500/40'

        return (
          <motion.button
            key={item.key}
            whileHover={{ scale: 1.02, y: -2 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onFilterChange(isActive ? 'all' : item.key)}
            className={`relative overflow-hidden group p-4 rounded-2xl border backdrop-blur-xl transition-all duration-500 flex items-center gap-4 text-left ${
              isActive 
                ? `bg-gradient-to-br ${colorClass} ring-2 ring-offset-2 ring-${item.color}-500/50` 
                : 'bg-white/40 border-gray-100/50 hover:bg-white/80 hover:border-gray-200 shadow-sm'
            }`}
          >
            {/* Background Glow Effect */}
            <div className={`absolute -right-4 -bottom-4 w-24 h-24 rounded-full blur-3xl opacity-0 group-hover:opacity-20 transition-opacity duration-700 bg-${item.color}-500`} />
            
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-500 ${isActive ? iconBg : 'bg-gray-50 text-gray-400 group-hover:scale-110 shadow-sm'}`}>
              <item.icon size={22} className={isActive ? 'animate-pulse' : ''} />
            </div>

            <div className="flex-1 min-w-0">
              <p className={`text-[10px] font-bold uppercase tracking-widest mb-0.5 transition-colors duration-500 ${isActive ? 'text-inherit' : 'text-gray-400'}`}>
                {item.label}
              </p>
              <div className="flex items-baseline gap-1.5">
                <AnimatePresence mode="wait">
                  <motion.span
                    key={item.count}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className={`text-2xl font-black tracking-tight ${isActive ? 'text-inherit' : 'text-gray-900'}`}
                  >
                    {loading ? '...' : item.count}
                  </motion.span>
                </AnimatePresence>
                <span className={`text-[10px] font-bold opacity-60 ${isActive ? 'text-inherit' : 'text-gray-400'}`}>UNITS</span>
              </div>
            </div>

            {isActive && (
              <motion.div 
                layoutId="active-indicator"
                className={`absolute top-3 right-3 w-1.5 h-1.5 rounded-full animate-ping ${
                  item.color === 'emerald' ? 'bg-emerald-500' :
                  item.color === 'red' ? 'bg-red-500' :
                  item.color === 'orange' ? 'bg-orange-500' :
                  'bg-blue-500'
                }`} 
              />
            )}
          </motion.button>
        )
      })}
    </div>
  )
}
