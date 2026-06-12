export interface ONU {
  id: string
  status: 'online' | 'offline' | 'unconfigured' | 'unregistered' | 'los' | 'logging' | 'syncmib' | 'authfailed' | 'auth-failed' | 'dyinggasp' | 'dying-gasp'
  oltCard: number
  port: number
  onuNumber: number
  shelf?: number
  rack?: string
  sn: string
  name?: string
  description?: string
  onuType: string
  /** Rx optical power in dBm (aliased as opticalPower for backwards compat) */
  opticalPower: number
  /** Tx optical power in dBm */
  powerTx?: number
  /** Traffic statistics in Mbps (optional — not always available from live hardware) */
  trafficUp?: number
  trafficDown?: number
  /** Pre-formatted index string e.g. "1/1/1:1" */
  index?: string
  lat?: number
  lng?: number
  address?: string
  ip?: string
  distance?: number
  lastSeen?: string
  firmwareVersion?: string
  softwareVersion?: string
  hardwareVersion?: string
  macAddress?: string
  customerName?: string
  wan_ip?: string
  mode?: string
  wan_username?: string
  wan_password?: string
  wan_hostname?: string
}
